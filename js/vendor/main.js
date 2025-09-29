'use strict';

/**
 * Kivro – main.js (mise à jour complète)
 * Demande fonctionnelle :
 * - Clic "Nouvelle conversation" : stoppe la génération en cours, efface l'UI,
 *   réinitialise la session. (AUCUNE écriture dans l'historique ici)
 * - Au 1er prompt envoyé : crée la conversation (titre = mini-résumé du prompt),
 *   puis met à jour immédiatement l'historique.
 * - Délégation d'événements + observer DOM pour survivre aux re-rendus.
 */

/* =========================
 * Imports UI & Features
 * ========================= */
import { initTheme } from './core/theme.js';
import { wireUserMenu, wirePromptModal, wireSettingsModal } from './ui/menus.js';
import { wireAddModal } from './ui/modals.js';
import { wireSendAction, mountStatusPill } from './ui/actions.js';
import { wireLogout } from './auth/logout.js';
import { wireUploads } from './features/uploads.js';
// Initialisation KaTeX (offline, non bloquante)
import('./features/math/katex-init.js')
  .then(({ initKatex }) => {
    initKatex(); // active KaTeX offline
  })
  .catch(err => console.warn('[KaTeX] non chargé :', err));
import { wirePyodide } from './features/pyodide.js';
import { runPython } from './features/python/pyodideLoader.js';

/* =========================
 * Historique (existant dans Kivro)
 * ========================= */
import { mountHistory, Store } from './store/conversations.js';

/* =========================
 * Sélecteurs & état local
 * ========================= */
const SEL = {
  newChatBtn: '#new-chat',
  sendBtn: '#send-btn',
  composer: '#composer-input',
  chatLog: '#chat-log',
  composerForm: '#composer-form' // Si un <form> existe autour du composer
};

const state = {
  awaitingFirstPrompt: false,  // true => la prochaine action d’envoi créera une conversation
  currentConvId: null,         // id conversation courante (si connu)
  chatObserver: null           // MutationObserver pour fallback
};

/* =========================
 * Utilitaires
 * ========================= */
function $(sel) { return document.querySelector(sel); }

/** Détection (best-effort) d’une conversation déjà active au boot */
function hasCurrentConversation() {
  try {
    if (typeof Store?.getCurrent === 'function') return !!Store.getCurrent();
    if (Store?.currentId || Store?.current) return true;
  } catch {}
  return false;
}

/** Mini-résumé : première phrase/ligne nettoyée, ellipsée à 60 caractères */
function makeTitleFromText(txt, max = 60) {
  const clean = (txt || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^([#>*\-]+\s*)+/, '');
  const first = clean.split(/(?<=[.!?])\s+/)[0] || clean;
  return first.length > max ? first.slice(0, max - 1) + '…' : first;
}

/** Annule une génération en cours (si pipeline expose un AbortController ou écoute 'ai:cancel') */
function cancelOngoingStream() {
  try {
    if (window.kivroAbortController && typeof window.kivroAbortController.abort === 'function') {
      window.kivroAbortController.abort();
    } else {
      document.dispatchEvent(new CustomEvent('ai:cancel'));
    }
  } catch (e) {
    console.warn('[cancelOngoingStream] noop', e);
  }
}

/** Efface le fil de discussion visuellement */
function clearChatUI() {
  try {
    if (typeof window.clearChat === 'function') {
      window.clearChat();
      return;
    }
  } catch {}
  const log = $(SEL.chatLog);
  if (log) log.innerHTML = '';
}

/** Tente d'extraire le dernier message utilisateur depuis le DOM du chat */
function getLatestUserTextFromChatLog() {
  const log = $(SEL.chatLog);
  if (!log) return '';
  // Heuristiques courantes : adapter si votre DOM diffère
  const userMsgs = log.querySelectorAll('[data-role="user"], .msg.user, .message.user, .bubble.user, .chat-user');
  const last = userMsgs[userMsgs.length - 1];
  if (!last) return '';
  // Essayer différents conteneurs de texte
  const textEl = last.querySelector('[data-type="text"], .text, .content, p, span');
  const raw = (textEl ? textEl.textContent : last.textContent) || '';
  return raw.trim();
}

/**
 * Création "best-effort" d'une conversation, en s’adaptant à l’API disponible.
 * Retourne l'id si connu, sinon null.
 */
async function createConversationWithBestEffort(title) {
  let id = null;
  try {
    if (typeof Store?.createConversation === 'function') {
      id = await Store.createConversation({ title });
      if (typeof Store?.setCurrent === 'function') Store.setCurrent(id);
    } else if (typeof Store?.create === 'function') {
      id = await Store.create({ title });
      if (typeof Store?.setCurrent === 'function') Store.setCurrent(id);
    } else if (typeof window.kivroCreateConversation === 'function') {
      id = await window.kivroCreateConversation(title);
    } else {
      // Fallback : prévenir le reste de l'app qu'il faut créer une conv
      document.dispatchEvent(new CustomEvent('conversation:create', { detail: { title } }));
    }
  } finally {
    // Re-rendu de l’historique (best-effort)
    try { await mountHistory(); } catch (e) { console.warn('[mountHistory] failed', e); }
  }
  return id;
}

/* =========================
 * Wiring "Nouvelle conversation" (capture) – bloque les handlers existants qui créent une conv
 * ========================= */
function wireNewChatButton() {
  const btn = $(SEL.newChatBtn);
  if (!btn) return;

  // Capture = on passe AVANT les listeners existants et on peut les bloquer
  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopImmediatePropagation(); // empêche un handler existant de créer la conv ici

    cancelOngoingStream(); // 1) stop stream
    clearChatUI();         // 2) vider UI

    // 3) reset Store + état local (aucune écriture d’historique ici)
    try { if (typeof Store?.clearCurrent === 'function') Store.clearCurrent(); } catch {}
    state.currentConvId = null;
    state.awaitingFirstPrompt = true;

    // 4) Préparer la saisie du 1er prompt
    const input = $(SEL.composer);
    if (input) { input.value = ''; input.focus(); }
  }, { capture: true });
}

/* =========================
 * Délégation : assurer la création au 1er prompt (click/submit/keydown)
 * ========================= */
function wireEnsureConversationAtFirstPromptDelegated() {
  async function ensure() {
    if (!state.awaitingFirstPrompt) return;

    // 1) Texte prioritaire : la valeur du composer
    let text = ($(SEL.composer)?.value ?? '').trim();

    // 2) Fallback : si vide, tenter de lire le dernier bubble user dans le log (en cas d'envoi programmatique)
    if (!text) text = getLatestUserTextFromChatLog();
    if (!text) return;

    const title = makeTitleFromText(text);
    const id = await createConversationWithBestEffort(title);

    state.currentConvId = id || null;
    state.awaitingFirstPrompt = false;
  }

  // Clic sur le bouton envoyer (ou son conteneur)
  document.addEventListener('click', (ev) => {
    if (ev.target && ev.target.closest && ev.target.closest(SEL.sendBtn)) {
      ensure();
    }
  }, { capture: true });

  // Enter (sans Shift) dans le champ composer
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey && ev.target && ev.target.closest && ev.target.closest(SEL.composer)) {
      ensure();
    }
  }, { capture: true });

  // Submit du formulaire (si présent)
  document.addEventListener('submit', (ev) => {
    if (ev.target && ev.target.matches && ev.target.matches(SEL.composerForm)) {
      ensure();
    }
  }, { capture: true });
}

/* =========================
 * Fallback : observer le chat-log (si le DOM est reconstruit/envoyé programmatique)
 * ========================= */
function startChatLogObserver() {
  const log = $(SEL.chatLog);
  if (!log || state.chatObserver) return;

  const obs = new MutationObserver(() => {
    // Si on attend un 1er prompt mais qu'un message user vient d'apparaître : créer la conv.
    if (!state.awaitingFirstPrompt) return;
    const text = getLatestUserTextFromChatLog();
    if (!text) return;
    // Décaler légèrement pour laisser la pipeline poser le DOM
    Promise.resolve().then(async () => {
      if (!state.awaitingFirstPrompt) return;
      const title = makeTitleFromText(text);
      const id = await createConversationWithBestEffort(title);
      state.currentConvId = id || null;
      state.awaitingFirstPrompt = false;
    });
  });

  obs.observe(log, { childList: true, subtree: true });
  state.chatObserver = obs;
}

/* =========================
 * Boot
 * ========================= */
document.addEventListener('DOMContentLoaded', () => {
  // Initialisation UI
  initTheme();
  try { mountHistory(); } catch (e) { console.warn('[mountHistory] failed', e); }
  wireUserMenu();
  wirePromptModal();
  wireSettingsModal();
  wireAddModal();
  wireSendAction();
  mountStatusPill();
  wireLogout();
  wireUploads();
  wirePyodide();
  const chipPy = document.getElementById('chip-py');
if (chipPy) {
  chipPy.addEventListener('click', async () => {
    chipPy.disabled = true;
    try {
      const code = `
print("Hello from Pyodide")
x = 2**10
print("2**10 =", x)
`;
      const { stdout, stderr } = await runPython(code);
      alert(`STDOUT:\n${stdout}${stderr ? '\n\nSTDERR:\n' + stderr : ''}`);
    } catch (e) {
      alert('Erreur Pyodide: ' + (e?.message || e));
    } finally {
      chipPy.disabled = false;
    }
  });
}

  // Flux "nouvelle conversation" + création au 1er prompt
  wireNewChatButton();
  wireEnsureConversationAtFirstPromptDelegated();
  startChatLogObserver();

  // État initial : s'il n'y a pas de conversation active au boot, on attend le 1er prompt
  state.awaitingFirstPrompt = !hasCurrentConversation();
});
