'use strict';

import { initTheme } from './core/theme.js';
import { wireUserMenu, wirePromptModal, wireSettingsModal } from './ui/menus.js';
import { wireSendAction, mountStatusPill } from './ui/actions.js';
import { wireLogout } from './auth/logout.js';
import { wireUploads } from './features/uploads.js';
import('./features/math/katex-init.js')
  .then(({ initKatex }) => {
    initKatex();
  })
  .catch((err) => console.warn('[KaTeX] not loaded:', err));
import { wirePyodide } from './features/pyodide.js';
import { runPython } from './features/python/pyodideLoader.js';
import { mountHistory, Store } from './store/conversations.js';

const SEL = {
  newChatBtn: '#new-chat',
  sendBtn: '#send-btn',
  composer: '#composer-input',
  chatLog: '#chat-log',
  composerForm: '#composer-form',
};

const state = {
  awaitingFirstPrompt: false,
  currentConvId: null,
  chatObserver: null,
};

function $(sel) { return document.querySelector(sel); }

function setMainViewMode(mode = 'empty') {
  const main = document.querySelector('.main');
  if (!main) return;
  const isConversation = mode === 'conversation';
  main.classList.toggle('is-conversation', isConversation);
  main.dataset.viewMode = isConversation ? 'conversation' : 'empty';
}

function hasRenderedMessages() {
  const log = $(SEL.chatLog);
  return !!log?.querySelector('.msg');
}

function syncMainViewMode() {
  setMainViewMode(hasRenderedMessages() ? 'conversation' : 'empty');
}

function hasCurrentConversation() {
  try {
    return !!Store?.currentId?.();
  } catch (_) {
    return false;
  }
}

function makeTitleFromText(txt, max = 60) {
  const clean = (txt || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^([#>*\-]+\s*)+/, '');
  const first = clean.split(/(?<=[.!?])\s+/)[0] || clean;
  return first.length > max ? first.slice(0, max - 1) + '...' : first;
}

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

function clearChatUI() {
  try {
    if (typeof window.clearChat === 'function') {
      window.clearChat();
      return;
    }
  } catch (_) {}
  const log = $(SEL.chatLog);
  if (log) log.innerHTML = '';
  try { window.kivroClearPendingUploads?.(); } catch (_) {}
}

function getLatestUserTextFromChatLog() {
  const log = $(SEL.chatLog);
  if (!log) return '';
  const userMsgs = log.querySelectorAll('[data-role="user"], .msg.user, .message.user, .bubble.user, .chat-user');
  const last = userMsgs[userMsgs.length - 1];
  if (!last) return '';
  const textEl = last.querySelector('[data-type="text"], .text, .content, p, span');
  const raw = (textEl ? textEl.textContent : last.textContent) || '';
  return raw.trim();
}

async function createConversationWithBestEffort(title) {
  if (window.kivroEnsureConversationPromise) {
    return window.kivroEnsureConversationPromise;
  }

  window.kivroEnsureConversationPromise = (async () => {
    let id = null;
    try {
      if (typeof Store?.create === 'function') {
        const conversation = await Store.create({ title });
        id = conversation?.id || null;
      } else if (typeof window.kivroCreateConversation === 'function') {
        id = await window.kivroCreateConversation(title);
      } else {
        document.dispatchEvent(new CustomEvent('conversation:create', { detail: { title } }));
      }
    } finally {
      try { await mountHistory(); } catch (e) { console.warn('[mountHistory] failed', e); }
    }
    return id;
  })();

  try {
    return await window.kivroEnsureConversationPromise;
  } finally {
    window.kivroEnsureConversationPromise = null;
  }
}

function wireNewChatButton() {
  const btn = $(SEL.newChatBtn);
  if (!btn) return;

  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopImmediatePropagation();

    cancelOngoingStream();
    clearChatUI();

    try { if (typeof Store?.clearCurrent === 'function') Store.clearCurrent(); } catch (_) {}
    state.currentConvId = null;
    state.awaitingFirstPrompt = true;
    setMainViewMode('empty');

    const input = $(SEL.composer);
    if (input) { input.value = ''; input.focus(); }
  }, { capture: true });
}

function wireEnsureConversationAtFirstPromptDelegated() {
  async function ensure() {
    if (!state.awaitingFirstPrompt) return;

    let text = ($(SEL.composer)?.value ?? '').trim();
    if (!text) text = getLatestUserTextFromChatLog();
    if (!text) return;
    if (hasCurrentConversation()) {
      state.currentConvId = Store.currentId?.() || state.currentConvId;
      state.awaitingFirstPrompt = false;
      return;
    }

    const title = makeTitleFromText(text);
    const id = await createConversationWithBestEffort(title);

    state.currentConvId = id || null;
    state.awaitingFirstPrompt = false;
  }

  document.addEventListener('click', (ev) => {
    if (ev.target && ev.target.closest && ev.target.closest(SEL.sendBtn)) {
      ensure();
    }
  }, { capture: true });

  document.addEventListener('keydown', (ev) => {
    if (
      ev.key === 'Enter'
      && !ev.shiftKey
      && (ev.ctrlKey || ev.metaKey)
      && ev.target
      && ev.target.closest
      && ev.target.closest(SEL.composer)
    ) {
      ensure();
    }
  }, { capture: true });

  document.addEventListener('submit', (ev) => {
    if (ev.target && ev.target.matches && ev.target.matches(SEL.composerForm)) {
      ensure();
    }
  }, { capture: true });
}

function startChatLogObserver() {
  const center = document.querySelector('.center');
  if (!center || state.chatObserver) return;

  const obs = new MutationObserver(() => {
    syncMainViewMode();
    if (!state.awaitingFirstPrompt) return;
    const text = getLatestUserTextFromChatLog();
    if (!text) return;
    Promise.resolve().then(async () => {
      if (!state.awaitingFirstPrompt) return;
      if (hasCurrentConversation()) {
        state.currentConvId = Store.currentId?.() || state.currentConvId;
        state.awaitingFirstPrompt = false;
        return;
      }
      const title = makeTitleFromText(text);
      const id = await createConversationWithBestEffort(title);
      state.currentConvId = id || null;
      state.awaitingFirstPrompt = false;
    });
  });

  obs.observe(center, { childList: true, subtree: true });
  state.chatObserver = obs;
}

document.addEventListener('chat:view-mode', (event) => {
  const mode = event?.detail?.mode === 'conversation' ? 'conversation' : 'empty';
  setMainViewMode(mode);
});

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  try { await mountHistory(); } catch (e) { console.warn('[mountHistory] failed', e); }
  wireUserMenu();
  wirePromptModal();
  wireSettingsModal();
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
        alert(`STDOUT:\n${stdout}${stderr ? `\n\nSTDERR:\n${stderr}` : ''}`);
      } catch (e) {
        alert('Erreur Pyodide: ' + (e?.message || e));
      } finally {
        chipPy.disabled = false;
      }
    });
  }

  wireNewChatButton();
  wireEnsureConversationAtFirstPromptDelegated();
  startChatLogObserver();

  const currentId = Store.currentId?.() || null;
  if (currentId) {
    try { await Store.ensureLoaded(currentId); } catch (_) {}
  }
  state.awaitingFirstPrompt = !hasCurrentConversation();
  syncMainViewMode();
});
