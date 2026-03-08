// js/net/ollama.js
// Flux reseau Ollama + rendu des messages (compatible KaTeX)

import { renderMsg } from '../chat/render.js';
import { Store, fmtTitle, mountHistory } from '../store/conversations.js';
import { qs } from '../core/dom.js';

function normalizeLatex(input) {
  if (!input) return '';
  let s = String(input);

  s = s.replace(/```(?:math|latex)?\s*([\s\S]*?)```/gi, (_, body) => `\\[${body.trim()}\\]`);
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_, body) => `\\[${body.trim()}\\]`);

  if (!/\\\(|\\\[/.test(s)) {
    s = s.replace(/\$([^\$]+)\$/g, (_, body) => `\\(${body.trim()}\\)`);
  }

  s = s.replace(/\\\\\(/g, '\\(')
    .replace(/\\\\\)/g, '\\)')
    .replace(/\\\\\[/g, '\\[')
    .replace(/\\\\\]/g, '\\]')
    .replace(/\\\\([A-Za-z])/g, '\\$1');

  return s;
}

const LS = { base: 'ollamaBase', model: 'ollamaModel', sys: 'systemPrompt' };
const getRaw = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const setLS = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

export function readBase() {
  const v = (getRaw(LS.base) || '').trim();
  if (!v || !/^(https?:)?\/\//i.test(v)) return 'http://127.0.0.1:11434';
  return v.replace(/\/+$/, '');
}

export async function listModels() {
  const base = readBase();
  const res = await fetch(`${base}/api/tags`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('/api/tags ' + res.status);

  const data = await res.json();
  const arr = Array.isArray(data) ? data : (data.models || []);
  return [...new Set(arr.map((m) => m.name || m.model).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

export function readModel() {
  const v = (getRaw(LS.model) || '').trim();
  return v || 'gpt-oss:20b';
}

export function readSys() {
  const raw = getRaw(LS.sys);
  return raw == null ? '' : String(raw);
}

export async function ping(base) {
  const res = await fetch(base + '/api/tags', { method: 'GET' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

function readHistory(convId) {
  const conversation = Store.get(convId);
  return Array.isArray(conversation?.messages) ? conversation.messages : [];
}

function toChatHistory(arr) {
  return (arr || [])
    .map((m) => {
      const role = (m.role || m.r || '').toLowerCase();
      const content = (m.content ?? m.text ?? '').toString();
      if (role === 'user' || role === 'assistant') return { role, content };
      return null;
    })
    .filter(Boolean);
}

function buildChatMessages({ sys, convId, userText, maxPast = 16 }) {
  const out = [];
  const history = toChatHistory(readHistory(convId));

  let hist = history.slice();
  if (hist.length) {
    const last = hist[hist.length - 1];
    if (last.role === 'user' && last.content === userText) {
      hist = hist.slice(0, -1);
    }
  }

  const trimmed = hist.slice(-maxPast);

  if (sys && sys.trim()) {
    out.push({ role: 'system', content: sys.trim() });
  }
  for (const m of trimmed) {
    out.push({ role: m.role, content: m.content });
  }
  out.push({ role: 'user', content: userText });

  return out;
}

function buildGeneratePrompt({ sys, convId, userText, maxPast = 16 }) {
  const history = toChatHistory(readHistory(convId)).slice(-maxPast);
  const parts = [];
  if (sys && sys.trim()) parts.push(`System:\n${sys.trim()}`);
  for (const m of history) {
    parts.push((m.role === 'user' ? 'User' : 'Assistant') + ':\n' + m.content);
  }
  parts.push('User:\n' + userText);
  parts.push('Assistant:');
  return parts.join('\n\n');
}

export async function* streamChat({ base, model, sys, prompt, convId, maxPast = 16 }) {
  const body = {
    model,
    messages: buildChatMessages({ sys, convId, userText: prompt, maxPast }),
    stream: true,
  };
  let res = await fetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (res.status === 404 || res.status === 400) {
    return yield* streamGenerate({ base, model, sys, prompt, convId, maxPast });
  }
  if (!res.ok) throw new Error('HTTP ' + res.status);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.message && typeof obj.message.content === 'string') yield obj.message.content;
        if (obj.done) return;
      } catch (_) {}
    }
  }
}

export async function* streamGenerate({ base, model, sys, prompt, convId, maxPast = 16 }) {
  const res = await fetch(base + '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      system: (sys || '').trim() || undefined,
      prompt: buildGeneratePrompt({ sys, convId, userText: prompt, maxPast }),
      stream: true,
    }),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' (/api/generate)');

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        if (typeof obj.response === 'string') yield obj.response;
        if (obj.done) return;
      } catch (_) {}
    }
  }
}

export async function sendCurrent() {
  const ta = qs('#composer-input');
  if (!ta) return alert('Zone de saisie introuvable.');

  const text = (ta.value || '').trim();
  if (!text) return;

  if (window.kivroEnsureConversationPromise) {
    try { await window.kivroEnsureConversationPromise; } catch (_) {}
  }

  const base = readBase();
  const model = readModel();
  const sys = readSys();

  let convId = (Store.currentId && Store.currentId()) || null;
  if (convId) {
    try { await Store.ensureLoaded(convId); } catch (_) {}
  }
  if (!convId && Store.create) {
    const c = await Store.create('Nouvelle conversation');
    convId = c.id;
  }

  renderMsg('user', text);
  if (convId) {
    try { await Store.addMsg(convId, 'user', text); } catch (_) {}
    try { await Store.renameIfDefault(convId, fmtTitle(text)); } catch (_) {}
    try { await mountHistory(); } catch (_) {}
  }

  const aiB = renderMsg('assistant', '');
  ta.value = '';

  let aiText = '';
  const footer = () => '';
  try {
    for await (const chunk of streamChat({ base, model, sys, prompt: text, convId })) {
      aiText += chunk;
      aiB.innerHTML = (
        (window.kivroRenderMarkdown
          ? window.kivroRenderMarkdown(
            window.kivroNormalizeLatex ? window.kivroNormalizeLatex(aiText) : aiText,
          )
          : (window.kivroNormalizeLatex ? window.kivroNormalizeLatex(aiText) : aiText))
      ) + footer();
      if (window.kivroRenderMath) window.kivroRenderMath(aiB);
    }
    if (convId) await Store.addMsg(convId, 'assistant', aiText);
    try { await mountHistory(); } catch (_) {}
  } catch (err) {
    const msg = 'Erreur: ' + (err && err.message ? err.message : String(err));
    aiB.innerHTML = (
      (window.kivroRenderMarkdown
        ? window.kivroRenderMarkdown(
          window.kivroNormalizeLatex ? window.kivroNormalizeLatex(msg) : msg,
        )
        : (window.kivroNormalizeLatex ? window.kivroNormalizeLatex(msg) : msg))
    ) + footer();
    if (window.kivroRenderMath) window.kivroRenderMath(aiB);
    if (convId) await Store.addMsg(convId, 'assistant', msg);
    try { await mountHistory(); } catch (_) {}
    console.warn('Fetch error', err);
  }
}

document.addEventListener('settings:model-changed', (e) => {
  const m = (e.detail || '').trim();
  if (m) setLS(LS.model, m);
});
