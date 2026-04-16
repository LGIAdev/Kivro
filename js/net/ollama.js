// js/net/ollama.js
// Flux reseau Ollama + rendu des messages (compatible KaTeX)

import { bindMessageRecord, renderMsg, updateBubbleContent } from '../chat/render.js';
import { Store, fmtTitle, mountHistory } from '../store/conversations.js';
import { qs } from '../core/dom.js';
import { canModelReadFiles } from '../config/file-capable-models.js';
import {
  detachPendingUploads,
  getPendingUploads,
  preparePendingUploadsForSend,
  releaseUploadItems,
  restorePendingUploads,
} from '../features/uploads.js';
import {
  getSystemPrompt,
  saveSystemPrompt,
  uploadConversationAttachments,
} from './conversationsApi.js';

const LS = { base: 'ollamaBase', model: 'ollamaModel' };
const OCR_PROGRESS_HINT_DELAY_MS = 8000;
const THINK_START_TAG = '<think>';
const THINK_END_TAG = '</think>';
const CHAT_REASONING_PATHS = [
  'message.thinking',
  'message.reasoning',
  'message.reasoning_content',
  'message.thought',
  'thinking',
  'reasoning',
  'reasoning_content',
  'thought',
];
const CHAT_ANSWER_PATHS = [
  'message.content',
  'response',
];
const GENERATE_REASONING_PATHS = [
  'thinking',
  'reasoning',
  'reasoning_content',
  'message.thinking',
  'message.reasoning',
  'message.reasoning_content',
];
const GENERATE_ANSWER_PATHS = [
  'response',
  'message.content',
];
let isSendInFlight = false;
let systemPrompt = '';
let systemPromptLoadPromise = null;
const VARIATION_FALLBACK_GUIDANCE = [
  'Pour une etude de variations, privilegie une explication mathematique claire et fiable.',
  'Si tu ne peux pas fournir un tableau de variation strictement structure, reponds en texte plutot que d inventer un faux tableau de type Lycee.',
  'Quand c est utile, donne les intervalles de croissance et de decroissance, les extrema et le signe de la derivee dans l explication.',
  ].join('\n');
  const VARIATION_TABLE_HTML_OPEN = '<variation-table-html>';
  const VARIATION_TABLE_HTML_CLOSE = '</variation-table-html>';
  const EQUATION_SOLVE_HTML_OPEN = '<equation-solve-html>';
  const EQUATION_SOLVE_HTML_CLOSE = '</equation-solve-html>';
  const DERIVATIVE_HTML_OPEN = '<derivative-html>';
  const DERIVATIVE_HTML_CLOSE = '</derivative-html>';
  const LIMIT_HTML_OPEN = '<limit-html>';
  const LIMIT_HTML_CLOSE = '</limit-html>';
  const INTEGRAL_HTML_OPEN = '<integral-html>';
  const INTEGRAL_HTML_CLOSE = '</integral-html>';
  const ODE_HTML_OPEN = '<ode-html>';
  const ODE_HTML_CLOSE = '</ode-html>';
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
  return systemPrompt;
}

export async function loadSystemPrompt(force = false) {
  if (!force && systemPromptLoadPromise) return systemPromptLoadPromise;

  systemPromptLoadPromise = (async () => {
    const payload = await getSystemPrompt();
    systemPrompt = String(payload?.prompt || '');
    return systemPrompt;
  })();

  try {
    return await systemPromptLoadPromise;
  } catch (err) {
    systemPromptLoadPromise = null;
    throw err;
  }
}

export async function saveSystemPromptValue(prompt) {
  const payload = await saveSystemPrompt(prompt);
  systemPrompt = String(payload?.prompt || '');
  systemPromptLoadPromise = Promise.resolve(systemPrompt);
  return systemPrompt;
}

function readPathValue(obj, path) {
  return String(path || '')
    .split('.')
    .filter(Boolean)
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function coerceTextValue(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => coerceTextValue(item)).filter(Boolean).join('');
  }
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.content === 'string') return value.content;
  }
  return '';
}

function pickFirstString(obj, paths) {
  for (const path of (paths || [])) {
    const value = coerceTextValue(readPathValue(obj, path));
    if (value) return value;
  }
  return '';
}

function normalizeStreamChunk(obj, kind) {
  const reasoningChunk = pickFirstString(
    obj,
    kind === 'generate' ? GENERATE_REASONING_PATHS : CHAT_REASONING_PATHS,
  );
  const answerChunk = pickFirstString(
    obj,
    kind === 'generate' ? GENERATE_ANSWER_PATHS : CHAT_ANSWER_PATHS,
  );

  return {
    reasoningChunk,
    answerChunk,
  };
}

function createAssistantStreamState() {
  return {
    answerText: '',
    reasoningText: '',
    reasoningStartedAt: null,
    reasoningEndedAt: null,
    tagMode: 'answer',
    tagBuffer: '',
    nativeReasoningSeen: false,
  };
}

function markReasoningStarted(state) {
  if (state.reasoningStartedAt === null) state.reasoningStartedAt = Date.now();
}

function markReasoningEnded(state) {
  if (state.reasoningStartedAt !== null && state.reasoningEndedAt === null) {
    state.reasoningEndedAt = Date.now();
  }
}

function appendReasoningText(state, text) {
  const value = String(text || '');
  if (!value) return;
  markReasoningStarted(state);
  state.reasoningText += value;
}

function appendAnswerText(state, text) {
  const value = String(text || '');
  if (!value) return;
  if (state.reasoningStartedAt !== null && state.reasoningEndedAt === null) {
    markReasoningEnded(state);
  }
  state.answerText += value;
}

function partialTagSuffixLength(text, tag) {
  const source = String(text || '');
  for (let len = Math.min(source.length, tag.length - 1); len > 0; len -= 1) {
    if (tag.startsWith(source.slice(-len))) return len;
  }
  return 0;
}

function consumeTaggedAnswerChunk(state, chunk) {
  let input = state.tagBuffer + String(chunk || '');
  state.tagBuffer = '';
  let cursor = 0;

  while (cursor < input.length) {
    if (state.tagMode === 'reasoning') {
      const closeIdx = input.indexOf(THINK_END_TAG, cursor);
      if (closeIdx === -1) {
        const partialLength = partialTagSuffixLength(input.slice(cursor), THINK_END_TAG);
        const end = input.length - partialLength;
        appendReasoningText(state, input.slice(cursor, end));
        state.tagBuffer = input.slice(end);
        break;
      }

      appendReasoningText(state, input.slice(cursor, closeIdx));
      cursor = closeIdx + THINK_END_TAG.length;
      state.tagMode = 'answer';
      markReasoningEnded(state);
      continue;
    }

    const openIdx = input.indexOf(THINK_START_TAG, cursor);
    if (openIdx === -1) {
      const partialLength = partialTagSuffixLength(input.slice(cursor), THINK_START_TAG);
      const end = input.length - partialLength;
      appendAnswerText(state, input.slice(cursor, end));
      state.tagBuffer = input.slice(end);
      break;
    }

    appendAnswerText(state, input.slice(cursor, openIdx));
    cursor = openIdx + THINK_START_TAG.length;
    state.tagMode = 'reasoning';
  }
}

function mergeAssistantStreamChunk(state, chunk) {
  if (!chunk) return;

  if (chunk.reasoningChunk) {
    state.nativeReasoningSeen = true;
    appendReasoningText(state, chunk.reasoningChunk);
  }

  if (!chunk.answerChunk) return;
  if (state.nativeReasoningSeen) {
    appendAnswerText(state, chunk.answerChunk);
    return;
  }
  consumeTaggedAnswerChunk(state, chunk.answerChunk);
}

function buildAssistantPayload(state, { live = false } = {}) {
  const reasoningText = String(state?.reasoningText || '');
  const answerText = String(state?.answerText || '');
  let durationMs = null;
  if (state?.reasoningStartedAt !== null) {
    const endedAt = state.reasoningEndedAt ?? (live ? Date.now() : null);
    if (endedAt !== null) {
      durationMs = Math.max(1, endedAt - state.reasoningStartedAt);
    }
  }
  return {
    answerText,
    reasoningText,
    reasoningDurationMs: durationMs,
  };
}

function finalizeAssistantStreamState(state) {
  if (state.tagBuffer) {
    if (state.tagMode === 'reasoning') {
      appendReasoningText(state, state.tagBuffer);
    } else {
      appendAnswerText(state, state.tagBuffer);
    }
    state.tagBuffer = '';
  }
  if (state.reasoningStartedAt !== null && state.reasoningEndedAt === null) {
    markReasoningEnded(state);
  }
  return buildAssistantPayload(state);
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

function normalizeVariationIntentProbe(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeVariationTableRequest(text) {
  const raw = normalizeVariationIntentProbe(text);
  if (!raw) return false;

  const asksVariationTable =
    /tableau\s+de\s+variation/.test(raw) ||
    /tableau\s+des\s+variations/.test(raw) ||
    (/\bvariation\b/.test(raw) && /\btableau\b/.test(raw));

  const mentionsFunction =
    /\bfonction\b/.test(raw) ||
    /\bderivee\b/.test(raw) ||
    /\bsigne\s+de\b/.test(raw) ||
    /[a-z]\s*\(\s*x\s*\)/.test(raw);

  return asksVariationTable && mentionsFunction;
}

function normalizeOdeIntentProbe(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeOdeRequest(text) {
  const source = String(text || '');
  const raw = normalizeOdeIntentProbe(source);
  if (!raw || looksLikeVariationTableRequest(raw)) return false;

  const mentionsOde =
    /\bequation\s+differentielle\b/.test(raw) ||
    /\bdifferentielle\b/.test(raw) ||
    /\bed\b/.test(raw) ||
    /\\frac\s*\{d/.test(source) ||
    /\bd[a-z]\s*\/\s*d[a-z]\b/.test(raw);

  const hasPrimeEquation =
    /\b[a-z]\w*\s*'\s*(?:\(\s*[a-z]\s*\))?\s*=/.test(raw) ||
    /\b[a-z]\w*\s*'\s*[+\-]/.test(raw);

  if (/\bderivee\b/.test(raw) || /\bderiver\b/.test(raw)) return false;

  return mentionsOde || hasPrimeEquation;
}

function normalizeEquationIntentProbe(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeEquationSolveRequest(text) {
  const raw = normalizeEquationIntentProbe(text);
  if (!raw || looksLikeVariationTableRequest(raw) || looksLikeOdeRequest(raw)) return false;

  const asksEquationSolve =
    /\bresoudre\b/.test(raw) ||
    /\btrouver\b/.test(raw) ||
    /\bsolution\b/.test(raw) ||
    /\bequation\b/.test(raw);

  const hasEquality = /=/.test(raw);
  const isBareEquation = /^[^=\n]+=[^=\n]+$/.test(raw);
  const definesFunction = /\b[a-z]\w*\s*\(\s*[a-z]\s*\)\s*=/.test(raw);

  if (definesFunction) return false;

  return hasEquality && (asksEquationSolve || isBareEquation);
}

function normalizeDerivativeIntentProbe(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeDerivativeRequest(text) {
  const raw = normalizeDerivativeIntentProbe(text);
  if (!raw || looksLikeVariationTableRequest(raw) || looksLikeEquationSolveRequest(raw) || looksLikeOdeRequest(raw)) return false;

  const asksDerivative =
    /\bderivee\b/.test(raw) ||
    /\bderiver\b/.test(raw) ||
    /[a-z]\s*'\s*\(\s*[a-z]\s*\)/.test(raw) ||
    /\bprime\b/.test(raw);

  if (!asksDerivative) return false;
  if (/\btableau\b/.test(raw) || /\bsigne\b/.test(raw) || /\blimite\b/.test(raw)) return false;

  const hasFunctionDefinition = /\b[a-z]\w*\s*\(\s*[a-z]\s*\)\s*=/.test(raw);
  const hasMathContent = /[a-z0-9)\]]/.test(raw);
  return hasFunctionDefinition || hasMathContent;
}

function normalizeLimitIntentProbe(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/→/g, '->')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeLimitRequest(text) {
  const raw = normalizeLimitIntentProbe(text);
  if (!raw || looksLikeVariationTableRequest(raw) || looksLikeEquationSolveRequest(raw) || looksLikeOdeRequest(raw) || looksLikeDerivativeRequest(raw)) return false;

  const asksLimit = /\blimite\b/.test(raw) || /^lim\b/.test(raw);
  if (!asksLimit) return false;
  if (/\btableau\b/.test(raw) || /\bsigne\b/.test(raw) || /\bderivee\b/.test(raw)) return false;

  const hasTarget =
    /\btend vers\b/.test(raw) ||
    /->/.test(raw) ||
    /\ben\s+[+\-]?(?:oo|inf|infty|infinity)\b/.test(raw) ||
    /\ben\s+[+\-]?\d/.test(raw);

  const hasMathContent = /[a-z0-9)\]]/.test(raw);
  return asksLimit && hasTarget && hasMathContent;
}

function normalizeIntegralIntentProbe(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeIntegralRequest(text) {
  const raw = normalizeIntegralIntentProbe(text);
  if (!raw || looksLikeVariationTableRequest(raw) || looksLikeEquationSolveRequest(raw) || looksLikeOdeRequest(raw) || looksLikeDerivativeRequest(raw) || looksLikeLimitRequest(raw)) return false;

  const asksIntegral =
    /\bintegrale\b/.test(raw) ||
    /\bprimitive\b/.test(raw) ||
    /∫/.test(String(text || '')) ||
    /\\int/.test(String(text || '')) ||
    /\bint\b/.test(raw);

  if (!asksIntegral) return false;
  if (/\btableau\b/.test(raw) || /\bsigne\b/.test(raw) || /\bderivee\b/.test(raw) || /\blimite\b/.test(raw)) return false;

  const hasMathContent = /[a-z0-9)\]]/.test(raw);
  return asksIntegral && hasMathContent;
}

function buildEffectiveSystemPrompt(sys, userText) {
  const base = String(sys || '').trim();
  if (!looksLikeVariationTableRequest(userText)) return base;
  return base ? `${base}\n\n${VARIATION_FALLBACK_GUIDANCE}` : VARIATION_FALLBACK_GUIDANCE;
}

function wrapVariationTableHtml(html) {
  const body = String(html || '').trim();
  if (!body) return '';
  return `${VARIATION_TABLE_HTML_OPEN}${body}${VARIATION_TABLE_HTML_CLOSE}`;
}

function wrapEquationSolveHtml(html) {
  const body = String(html || '').trim();
  if (!body) return '';
  return `${EQUATION_SOLVE_HTML_OPEN}${body}${EQUATION_SOLVE_HTML_CLOSE}`;
}

function wrapDerivativeHtml(html) {
  const body = String(html || '').trim();
  if (!body) return '';
  return `${DERIVATIVE_HTML_OPEN}${body}${DERIVATIVE_HTML_CLOSE}`;
}

function wrapLimitHtml(html) {
  const body = String(html || '').trim();
  if (!body) return '';
  return `${LIMIT_HTML_OPEN}${body}${LIMIT_HTML_CLOSE}`;
}

function wrapIntegralHtml(html) {
  const body = String(html || '').trim();
  if (!body) return '';
  return `${INTEGRAL_HTML_OPEN}${body}${INTEGRAL_HTML_CLOSE}`;
}

function wrapOdeHtml(html) {
  const body = String(html || '').trim();
  if (!body) return '';
  return `${ODE_HTML_OPEN}${body}${ODE_HTML_CLOSE}`;
}

function createVariationPipelineAttempt({
  matched = false,
  payload = null,
  rawPayload = null,
  fallbackReason = '',
  fallbackMessage = '',
} = {}) {
  return {
    matched: Boolean(matched),
    payload: payload || null,
    rawPayload: rawPayload || null,
    fallbackReason: String(fallbackReason || ''),
    fallbackMessage: String(fallbackMessage || ''),
  };
}

function createEquationPipelineAttempt({
  matched = false,
  payload = null,
  rawPayload = null,
  fallbackReason = '',
  fallbackMessage = '',
} = {}) {
  return {
    matched: Boolean(matched),
    payload: payload || null,
    rawPayload: rawPayload || null,
    fallbackReason: String(fallbackReason || ''),
    fallbackMessage: String(fallbackMessage || ''),
  };
}

function createDerivativePipelineAttempt({
  matched = false,
  payload = null,
  rawPayload = null,
  fallbackReason = '',
  fallbackMessage = '',
} = {}) {
  return {
    matched: Boolean(matched),
    payload: payload || null,
    rawPayload: rawPayload || null,
    fallbackReason: String(fallbackReason || ''),
    fallbackMessage: String(fallbackMessage || ''),
  };
}

function createLimitPipelineAttempt({
  matched = false,
  payload = null,
  rawPayload = null,
  fallbackReason = '',
  fallbackMessage = '',
} = {}) {
  return {
    matched: Boolean(matched),
    payload: payload || null,
    rawPayload: rawPayload || null,
    fallbackReason: String(fallbackReason || ''),
    fallbackMessage: String(fallbackMessage || ''),
  };
}

function createIntegralPipelineAttempt({
  matched = false,
  payload = null,
  rawPayload = null,
  fallbackReason = '',
  fallbackMessage = '',
} = {}) {
  return {
    matched: Boolean(matched),
    payload: payload || null,
    rawPayload: rawPayload || null,
    fallbackReason: String(fallbackReason || ''),
    fallbackMessage: String(fallbackMessage || ''),
  };
}

function createOdePipelineAttempt({
  matched = false,
  payload = null,
  rawPayload = null,
  fallbackReason = '',
  fallbackMessage = '',
} = {}) {
  return {
    matched: Boolean(matched),
    payload: payload || null,
    rawPayload: rawPayload || null,
    fallbackReason: String(fallbackReason || ''),
    fallbackMessage: String(fallbackMessage || ''),
  };
}

async function requestDeterministicVariationTable(prompt) {
  if (!looksLikeVariationTableRequest(prompt)) return createVariationPipelineAttempt();

  try {
    const res = await fetch('/api/math/variation-table', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: String(prompt || '') }),
    });
    let payload = null;
    try {
      payload = await res.json();
    } catch (_) {}
    if (!res.ok) {
      return createVariationPipelineAttempt({
        matched: true,
        fallbackReason: String(payload?.reason || `http-${res.status}`),
        fallbackMessage: String(payload?.error || ''),
      });
    }
    const html = wrapVariationTableHtml(payload?.html || '');
    if (!html) {
      return createVariationPipelineAttempt({
        matched: true,
        fallbackReason: 'missing_html',
        fallbackMessage: 'La reponse deterministe ne contient pas de tableau exploitable.',
      });
    }
    return createVariationPipelineAttempt({
      matched: true,
      payload: {
        answerText: html,
        reasoningText: '',
        reasoningDurationMs: null,
        pipeline: String(payload?.pipeline || 'deterministic-variation'),
      },
      rawPayload: payload,
    });
  } catch (err) {
    return createVariationPipelineAttempt({
      matched: true,
      fallbackReason: 'request_failed',
      fallbackMessage: err?.message || String(err || ''),
    });
  }
}

async function requestDeterministicEquationSolve(prompt) {
  if (!looksLikeEquationSolveRequest(prompt)) return createEquationPipelineAttempt();

  try {
    const res = await fetch('/api/math/equation-solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: String(prompt || '') }),
    });
    let payload = null;
    try {
      payload = await res.json();
    } catch (_) {}
    if (!res.ok) {
      return createEquationPipelineAttempt({
        matched: true,
        fallbackReason: String(payload?.reason || `http-${res.status}`),
        fallbackMessage: String(payload?.error || ''),
      });
    }
    const html = wrapEquationSolveHtml(payload?.html || '');
    if (!html) {
      return createEquationPipelineAttempt({
        matched: true,
        fallbackReason: 'missing_html',
        fallbackMessage: 'La reponse deterministe ne contient pas de rendu exploitable.',
      });
    }
    return createEquationPipelineAttempt({
      matched: true,
      payload: {
        answerText: html,
        reasoningText: '',
        reasoningDurationMs: null,
        pipeline: String(payload?.pipeline || 'deterministic-equation'),
      },
      rawPayload: payload,
    });
  } catch (err) {
    return createEquationPipelineAttempt({
      matched: true,
      fallbackReason: 'request_failed',
      fallbackMessage: err?.message || String(err || ''),
    });
  }
}

async function requestDeterministicDerivative(prompt) {
  if (!looksLikeDerivativeRequest(prompt)) return createDerivativePipelineAttempt();

  try {
    const res = await fetch('/api/math/derivative', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: String(prompt || '') }),
    });
    let payload = null;
    try {
      payload = await res.json();
    } catch (_) {}
    if (!res.ok) {
      return createDerivativePipelineAttempt({
        matched: true,
        fallbackReason: String(payload?.reason || `http-${res.status}`),
        fallbackMessage: String(payload?.error || ''),
      });
    }
    const html = wrapDerivativeHtml(payload?.html || '');
    if (!html) {
      return createDerivativePipelineAttempt({
        matched: true,
        fallbackReason: 'missing_html',
        fallbackMessage: 'La reponse deterministe ne contient pas de rendu exploitable.',
      });
    }
    return createDerivativePipelineAttempt({
      matched: true,
      payload: {
        answerText: html,
        reasoningText: '',
        reasoningDurationMs: null,
        pipeline: String(payload?.pipeline || 'deterministic-derivative'),
      },
      rawPayload: payload,
    });
  } catch (err) {
    return createDerivativePipelineAttempt({
      matched: true,
      fallbackReason: 'request_failed',
      fallbackMessage: err?.message || String(err || ''),
    });
  }
}

async function requestDeterministicLimit(prompt) {
  if (!looksLikeLimitRequest(prompt)) return createLimitPipelineAttempt();

  try {
    const res = await fetch('/api/math/limit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: String(prompt || '') }),
    });
    let payload = null;
    try {
      payload = await res.json();
    } catch (_) {}
    if (!res.ok) {
      return createLimitPipelineAttempt({
        matched: true,
        fallbackReason: String(payload?.reason || `http-${res.status}`),
        fallbackMessage: String(payload?.error || ''),
      });
    }
    const html = wrapLimitHtml(payload?.html || '');
    if (!html) {
      return createLimitPipelineAttempt({
        matched: true,
        fallbackReason: 'missing_html',
        fallbackMessage: 'La reponse deterministe ne contient pas de rendu exploitable.',
      });
    }
    return createLimitPipelineAttempt({
      matched: true,
      payload: {
        answerText: html,
        reasoningText: '',
        reasoningDurationMs: null,
        pipeline: String(payload?.pipeline || 'deterministic-limit'),
      },
      rawPayload: payload,
    });
  } catch (err) {
    return createLimitPipelineAttempt({
      matched: true,
      fallbackReason: 'request_failed',
      fallbackMessage: err?.message || String(err || ''),
    });
  }
}

async function requestDeterministicIntegral(prompt) {
  if (!looksLikeIntegralRequest(prompt)) return createIntegralPipelineAttempt();

  try {
    const res = await fetch('/api/math/integral', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: String(prompt || '') }),
    });
    let payload = null;
    try {
      payload = await res.json();
    } catch (_) {}
    if (!res.ok) {
      return createIntegralPipelineAttempt({
        matched: true,
        fallbackReason: String(payload?.reason || `http-${res.status}`),
        fallbackMessage: String(payload?.error || ''),
      });
    }
    const html = wrapIntegralHtml(payload?.html || '');
    if (!html) {
      return createIntegralPipelineAttempt({
        matched: true,
        fallbackReason: 'missing_html',
        fallbackMessage: 'La reponse deterministe ne contient pas de rendu exploitable.',
      });
    }
    return createIntegralPipelineAttempt({
      matched: true,
      payload: {
        answerText: html,
        reasoningText: '',
        reasoningDurationMs: null,
        pipeline: String(payload?.pipeline || 'deterministic-integral'),
      },
      rawPayload: payload,
    });
  } catch (err) {
    return createIntegralPipelineAttempt({
      matched: true,
      fallbackReason: 'request_failed',
      fallbackMessage: err?.message || String(err || ''),
    });
  }
}

async function requestDeterministicOde(prompt) {
  if (!looksLikeOdeRequest(prompt)) return createOdePipelineAttempt();

  try {
    const res = await fetch('/api/math/ode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: String(prompt || '') }),
    });
    let payload = null;
    try {
      payload = await res.json();
    } catch (_) {}
    if (!res.ok) {
      return createOdePipelineAttempt({
        matched: true,
        fallbackReason: String(payload?.reason || `http-${res.status}`),
        fallbackMessage: String(payload?.error || ''),
      });
    }
    const html = wrapOdeHtml(payload?.html || '');
    if (!html) {
      return createOdePipelineAttempt({
        matched: true,
        fallbackReason: 'missing_html',
        fallbackMessage: 'La reponse deterministe ne contient pas de rendu exploitable.',
      });
    }
    return createOdePipelineAttempt({
      matched: true,
      payload: {
        answerText: html,
        reasoningText: '',
        reasoningDurationMs: null,
        pipeline: String(payload?.pipeline || 'deterministic-ode'),
      },
      rawPayload: payload,
    });
  } catch (err) {
    return createOdePipelineAttempt({
      matched: true,
      fallbackReason: 'request_failed',
      fallbackMessage: err?.message || String(err || ''),
    });
  }
}

function logVariationPipelineFallback(attempt) {
  if (!attempt?.matched || attempt?.payload) return;
  const reason = attempt.fallbackReason || 'analysis_failed';
  const details = attempt.fallbackMessage ? ` (${attempt.fallbackMessage})` : '';
  console.info(`[variation-table] fallback vers le pipeline modele: ${reason}${details}`);
}

function logEquationPipelineFallback(attempt) {
  if (!attempt?.matched || attempt?.payload) return;
  const reason = attempt.fallbackReason || 'analysis_failed';
  const details = attempt.fallbackMessage ? ` (${attempt.fallbackMessage})` : '';
  console.info(`[equation-solve] fallback vers le pipeline modele: ${reason}${details}`);
}

function logDerivativePipelineFallback(attempt) {
  if (!attempt?.matched || attempt?.payload) return;
  const reason = attempt.fallbackReason || 'analysis_failed';
  const details = attempt.fallbackMessage ? ` (${attempt.fallbackMessage})` : '';
  console.info(`[derivative] fallback vers le pipeline modele: ${reason}${details}`);
}

function logLimitPipelineFallback(attempt) {
  if (!attempt?.matched || attempt?.payload) return;
  const reason = attempt.fallbackReason || 'analysis_failed';
  const details = attempt.fallbackMessage ? ` (${attempt.fallbackMessage})` : '';
  console.info(`[limit] fallback vers le pipeline modele: ${reason}${details}`);
}

function logIntegralPipelineFallback(attempt) {
  if (!attempt?.matched || attempt?.payload) return;
  const reason = attempt.fallbackReason || 'analysis_failed';
  const details = attempt.fallbackMessage ? ` (${attempt.fallbackMessage})` : '';
  console.info(`[integral] fallback vers le pipeline modele: ${reason}${details}`);
}

function logOdePipelineFallback(attempt) {
  if (!attempt?.matched || attempt?.payload) return;
  const reason = attempt.fallbackReason || 'analysis_failed';
  const details = attempt.fallbackMessage ? ` (${attempt.fallbackMessage})` : '';
  console.info(`[ode] fallback vers le pipeline modele: ${reason}${details}`);
}

async function renderDeterministicVariationReply({ conversationId, targetBubble, payload, model }) {
  let bubble = targetBubble;
  if (!bubble) bubble = renderMsg('assistant', payload.answerText, { model, pyodideFinal: true });
  else renderAssistantChunk(bubble, payload, { model, pyodideFinal: true });

  if (conversationId) {
    const savedAssistantMessage = await Store.addMsg(conversationId, 'assistant', payload.answerText, {
      reasoningText: '',
      model,
      reasoningDurationMs: null,
    });
    bindMessageRecord(bubble, savedAssistantMessage);
  }

  try { await mountHistory(); } catch (_) {}
  return bubble;
}

async function renderDeterministicEquationReply({ conversationId, targetBubble, payload, model }) {
  let bubble = targetBubble;
  if (!bubble) bubble = renderMsg('assistant', payload.answerText, { model, pyodideFinal: true });
  else renderAssistantChunk(bubble, payload, { model, pyodideFinal: true });

  if (conversationId) {
    const savedAssistantMessage = await Store.addMsg(conversationId, 'assistant', payload.answerText, {
      reasoningText: '',
      model,
      reasoningDurationMs: null,
    });
    bindMessageRecord(bubble, savedAssistantMessage);
  }

  try { await mountHistory(); } catch (_) {}
  return bubble;
}

async function renderDeterministicDerivativeReply({ conversationId, targetBubble, payload, model }) {
  let bubble = targetBubble;
  if (!bubble) bubble = renderMsg('assistant', payload.answerText, { model, pyodideFinal: true });
  else renderAssistantChunk(bubble, payload, { model, pyodideFinal: true });

  if (conversationId) {
    const savedAssistantMessage = await Store.addMsg(conversationId, 'assistant', payload.answerText, {
      reasoningText: '',
      model,
      reasoningDurationMs: null,
    });
    bindMessageRecord(bubble, savedAssistantMessage);
  }

  try { await mountHistory(); } catch (_) {}
  return bubble;
}

async function renderDeterministicLimitReply({ conversationId, targetBubble, payload, model }) {
  let bubble = targetBubble;
  if (!bubble) bubble = renderMsg('assistant', payload.answerText, { model, pyodideFinal: true });
  else renderAssistantChunk(bubble, payload, { model, pyodideFinal: true });

  if (conversationId) {
    const savedAssistantMessage = await Store.addMsg(conversationId, 'assistant', payload.answerText, {
      reasoningText: '',
      model,
      reasoningDurationMs: null,
    });
    bindMessageRecord(bubble, savedAssistantMessage);
  }

  try { await mountHistory(); } catch (_) {}
  return bubble;
}

async function renderDeterministicIntegralReply({ conversationId, targetBubble, payload, model }) {
  let bubble = targetBubble;
  if (!bubble) bubble = renderMsg('assistant', payload.answerText, { model, pyodideFinal: true });
  else renderAssistantChunk(bubble, payload, { model, pyodideFinal: true });

  if (conversationId) {
    const savedAssistantMessage = await Store.addMsg(conversationId, 'assistant', payload.answerText, {
      reasoningText: '',
      model,
      reasoningDurationMs: null,
    });
    bindMessageRecord(bubble, savedAssistantMessage);
  }

  try { await mountHistory(); } catch (_) {}
  return bubble;
}

async function renderDeterministicOdeReply({ conversationId, targetBubble, payload, model }) {
  let bubble = targetBubble;
  if (!bubble) bubble = renderMsg('assistant', payload.answerText, { model, pyodideFinal: true });
  else renderAssistantChunk(bubble, payload, { model, pyodideFinal: true });

  if (conversationId) {
    const savedAssistantMessage = await Store.addMsg(conversationId, 'assistant', payload.answerText, {
      reasoningText: '',
      model,
      reasoningDurationMs: null,
    });
    bindMessageRecord(bubble, savedAssistantMessage);
  }

  try { await mountHistory(); } catch (_) {}
  return bubble;
}

function extractExplicitQuestionBlocks(text) {
  const source = String(text || '').replace(/\r/g, '').trim();
  if (!source) return null;

  const markerRe = /^\s*((?:\d+|[a-zA-Z])[.)])\s+([\s\S]*?)(?=^\s*(?:\d+|[a-zA-Z])[.)]\s+|\s*$)/gm;
  const matches = [...source.matchAll(markerRe)];
  if (matches.length < 2) return null;

  const firstIndex = matches[0]?.index ?? 0;
  const preamble = source.slice(0, firstIndex).trim();
  const segments = matches.map((match) => {
    const label = String(match[1] || '').trim();
    const body = String(match[2] || '').trim();
    return {
      label,
      body,
      raw: `${label} ${body}`.trim(),
    };
  }).filter((segment) => segment.label && segment.body);

  if (segments.length < 2) return null;
  return { source, preamble, segments };
}

function segmentContainsFunctionExpression(text) {
  return /(?:[a-zA-Z]\w*\s*\(\s*[a-zA-Z]\s*\)\s*=|\by\s*=)/.test(String(text || ''));
}

function buildSegmentVariationProbeText(exercise, segment) {
  return [exercise?.preamble, segment?.raw].filter(Boolean).join('\n\n').trim();
}

function buildSegmentVariationPrompt(exercise, segment) {
  const scoped = buildSegmentVariationProbeText(exercise, segment);
  if (segmentContainsFunctionExpression(scoped)) return scoped;
  return String(exercise?.source || scoped || '').trim();
}

function latexToPlainMath(value) {
  return String(value || '')
    .replace(/\\left|\\right/g, '')
    .replace(/\\infty/g, '∞')
    .replace(/\\nearrow/g, '↗')
    .replace(/\\searrow/g, '↘')
    .replace(/\^\{([^}]+)\}/g, '^$1')
    .replace(/\\cdot/g, '·')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildVariationContextSummary(rawPayload) {
  const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload : null;
  const segments = Array.isArray(payload?.segments) ? payload.segments : [];
  if (!segments.length) return 'Un tableau de variation deterministe a ete calcule.';

  const pieces = segments.map((segment) => {
    const points = Array.isArray(segment?.points) ? segment.points : [];
    const intervals = Array.isArray(segment?.intervals) ? segment.intervals : [];
    const xValues = points.map((point) => latexToPlainMath(point?.xLabel || '')).filter(Boolean).join(', ');
    const signs = intervals.map((interval) => latexToPlainMath(interval?.sign || '')).filter(Boolean).join(', ');
    const arrows = intervals.map((interval) => latexToPlainMath(interval?.arrow || '')).filter(Boolean).join(', ');
    const values = points.map((point) => latexToPlainMath(point?.valueLabel || '')).filter(Boolean).join(', ');
    const part = [];
    if (xValues) part.push(`x : ${xValues}`);
    if (signs) part.push(`signes de f'(x) : ${signs}`);
    if (values) part.push(`valeurs de f(x) : ${values}`);
    if (arrows) part.push(`variations : ${arrows}`);
    return part.join(' ; ');
  }).filter(Boolean);

  if (!pieces.length) return 'Un tableau de variation deterministe a ete calcule.';
  return `Tableau de variation determine : ${pieces.join(' | ')}`;
}

function buildSegmentModelPrompt({ exercise, segmentIndex, resolvedSegments }) {
  const segment = exercise?.segments?.[segmentIndex];
  if (!segment) return '';

  const resolvedText = (resolvedSegments || [])
    .map((item) => {
      const body = String(item?.contextText || '').trim();
      if (!body) return '';
      return `${item.label} ${body}`.trim();
    })
    .filter(Boolean)
    .join('\n\n');

  return [
    exercise?.preamble ? `Contexte general:\n${exercise.preamble}` : '',
    `Enonce complet:\n${exercise?.source || ''}`,
    resolvedText ? `Sous-questions deja traitees dans l'ordre:\n${resolvedText}` : '',
    `Repondez uniquement a la sous-question ${segment.label}.`,
    "Ne traitez pas les autres sous-questions et ne repetez pas leur intitule.",
    "Donnez directement la reponse utile a cette sous-question.",
    `Sous-question ${segment.label}:\n${segment.body}`,
  ].filter(Boolean).join('\n\n');
}

function formatResolvedSegmentOutput(segment, answerText) {
  const heading = `**${String(segment?.raw || '').trim()}**`;
  const body = String(answerText || '').trim();
  return body ? `${heading}\n\n${body}` : heading;
}

async function collectModelBlockAnswer({ base, model, sys, prompt }) {
  const assistantState = createAssistantStreamState();
  for await (const chunk of streamChat({
    base,
    model,
    sys,
    prompt,
    convId: null,
    images: [],
  })) {
    mergeAssistantStreamChunk(assistantState, chunk);
  }
  return finalizeAssistantStreamState(assistantState);
}

async function attemptSegmentedExerciseReply({ content, conversationId, targetBubble, base, model, sys }) {
  const exercise = extractExplicitQuestionBlocks(content);
  if (!exercise) return null;

  const variationIndexes = exercise.segments
    .map((segment, index) => (
      looksLikeVariationTableRequest(buildSegmentVariationProbeText(exercise, segment)) ? index : -1
    ))
    .filter((index) => index >= 0);

  if (!variationIndexes.length) return null;

  let bubble = targetBubble;
  let combinedAnswer = '';
  const resolvedSegments = [];

  for (let index = 0; index < exercise.segments.length; index += 1) {
    const segment = exercise.segments[index];
    const variationPrompt = buildSegmentVariationPrompt(exercise, segment);
    const wantsDeterministicVariation = variationIndexes.includes(index);

    let sectionAnswer = '';
    let contextText = '';

    if (wantsDeterministicVariation) {
      const variationAttempt = await requestDeterministicVariationTable(variationPrompt);
      if (variationAttempt.payload) {
        sectionAnswer = variationAttempt.payload.answerText;
        contextText = buildVariationContextSummary(variationAttempt.rawPayload);
      } else {
        logVariationPipelineFallback(variationAttempt);
      }
    }

    if (!sectionAnswer) {
      const modelPrompt = buildSegmentModelPrompt({
        exercise,
        segmentIndex: index,
        resolvedSegments,
      });
      const modelPayload = await collectModelBlockAnswer({
        base,
        model,
        sys,
        prompt: modelPrompt,
      });
      sectionAnswer = String(modelPayload?.answerText || modelPayload?.reasoningText || '').trim();
      contextText = sectionAnswer;
    }

    const sectionOutput = formatResolvedSegmentOutput(segment, sectionAnswer);
    combinedAnswer = combinedAnswer ? `${combinedAnswer}\n\n${sectionOutput}` : sectionOutput;
    resolvedSegments.push({
      label: segment.label,
      contextText: contextText || 'Sous-question traitee.',
    });

    if (!bubble) {
      bubble = renderMsg('assistant', combinedAnswer, { model, pyodideFinal: false });
    } else {
      renderAssistantChunk(
        bubble,
        { answerText: combinedAnswer, reasoningText: '', reasoningDurationMs: null },
        { model, pyodideFinal: index === exercise.segments.length - 1 },
      );
    }
  }

  if (bubble) {
    renderAssistantChunk(
      bubble,
      { answerText: combinedAnswer, reasoningText: '', reasoningDurationMs: null },
      { model, pyodideFinal: true },
    );
  }

  if (conversationId && combinedAnswer.trim()) {
    const savedAssistantMessage = await Store.addMsg(conversationId, 'assistant', combinedAnswer, {
      reasoningText: '',
      model,
      reasoningDurationMs: null,
    });
    if (bubble) bindMessageRecord(bubble, savedAssistantMessage);
  }

  try { await mountHistory(); } catch (_) {}
  return {
    bubble,
    answerText: combinedAnswer,
  };
}

function buildChatMessages({ sys, convId, userText, maxPast = 16, images = [] }) {
  const out = [];
  const history = toChatHistory(readHistory(convId));
  const effectiveSys = buildEffectiveSystemPrompt(sys, userText);

  let hist = history.slice();
  if (hist.length) {
    const last = hist[hist.length - 1];
    if (last.role === 'user' && last.content === userText) {
      hist = hist.slice(0, -1);
    }
  }

  const trimmed = hist.slice(-maxPast);

  if (effectiveSys) out.push({ role: 'system', content: effectiveSys });
  for (const message of trimmed) out.push({ role: message.role, content: message.content });

  const current = { role: 'user', content: userText };
  if (images.length) current.images = images;
  out.push(current);
  return out;
}

function buildGeneratePrompt({ sys, convId, userText, maxPast = 16 }) {
  const history = toChatHistory(readHistory(convId)).slice(-maxPast);
  const parts = [];
  const effectiveSys = buildEffectiveSystemPrompt(sys, userText);
  if (effectiveSys) parts.push(`System:\n${effectiveSys}`);
  for (const message of history) {
    parts.push((message.role === 'user' ? 'User' : 'Assistant') + ':\n' + message.content);
  }
  parts.push('User:\n' + userText);
  parts.push('Assistant:');
  return parts.join('\n\n');
}

export async function* streamChat({ base, model, sys, prompt, convId, maxPast = 16, images = [] }) {
  const body = {
    model,
    messages: buildChatMessages({ sys, convId, userText: prompt, maxPast, images }),
    stream: true,
  };
  const res = await fetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if ((res.status === 404 || res.status === 400) && !images.length) {
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
        yield normalizeStreamChunk(obj, 'chat');
        if (obj.done) return;
      } catch (_) {}
    }
  }

  const tail = buf.trim();
  if (!tail) return;
  try {
    yield normalizeStreamChunk(JSON.parse(tail), 'chat');
  } catch (_) {}
}

export async function* streamGenerate({ base, model, sys, prompt, convId, maxPast = 16 }) {
  const effectiveSys = buildEffectiveSystemPrompt(sys, prompt);
  const res = await fetch(base + '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      system: effectiveSys || undefined,
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
        yield normalizeStreamChunk(obj, 'generate');
        if (obj.done) return;
      } catch (_) {}
    }
  }

  const tail = buf.trim();
  if (!tail) return;
  try {
    yield normalizeStreamChunk(JSON.parse(tail), 'generate');
  } catch (_) {}
}

function renderAssistantChunk(target, payload, options = {}) {
  const answerText = payload?.answerText ?? '';
  updateBubbleContent(target, 'assistant', answerText, {
    ...options,
    answerText,
    pyodideFinal: options.pyodideFinal !== false,
    reasoningText: payload?.reasoningText ?? '',
    reasoningDurationMs: payload?.reasoningDurationMs ?? null,
  });
}

function renderConversationSnapshot(conversation) {
  const log = qs('#chat-log');
  if (log) log.innerHTML = '';

  for (const message of (conversation?.messages || [])) {
    renderMsg(message.role, message.content, {
      messageId: message.id,
      conversationId: message.conversationId,
      attachments: message.attachments || [],
      reasoningText: message.reasoningText,
      model: message.model,
      reasoningDurationMs: message.reasoningDurationMs,
    });
  }
}

function hasPendingImageUploads(items = []) {
  return items.some((item) => item?.kind === 'image');
}

function statusMessageFor(stage) {
  if (stage === 'ocr-complete') return 'Transcription terminee, envoi au modele...';
  if (stage === 'ocr-reading-slow') {
    return 'Lecture de l image en cours...\n\nLe premier traitement OCR peut etre plus long.';
  }
  return 'Lecture de l image en cours...';
}

function setSendButtonBusy(isBusy) {
  const btn = qs('#send-btn');
  if (!(btn instanceof HTMLButtonElement)) return;
  btn.disabled = isBusy;
  btn.classList.toggle('is-busy', isBusy);
  btn.setAttribute('aria-busy', isBusy ? 'true' : 'false');
  btn.title = isBusy ? 'Traitement en cours...' : '';
}

export async function regenerateFromEditedMessage({ conversationId, messageId, content }) {
  if (!conversationId || messageId == null) {
    throw new Error('Message introuvable.');
  }
  if (isSendInFlight) {
    throw new Error('Un traitement est deja en cours.');
  }

  isSendInFlight = true;
  setSendButtonBusy(true);

  let aiB = null;
  try {
    const rewrittenConversation = await Store.rewriteFromMessage(conversationId, messageId, {
      content,
      truncate_following: true,
    });
    const conversation = await Store.fetch(conversationId).catch(() => rewrittenConversation);
    renderConversationSnapshot(conversation);
    try { await mountHistory(); } catch (_) {}

    const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
    const lastMessage = messages[messages.length - 1] || null;
    if (!lastMessage || lastMessage.role !== 'user' || !String(lastMessage.content || '').trim()) {
      return conversation;
    }

    const model = readModel();
    const base = readBase();
    let sys = '';
    try {
      await loadSystemPrompt();
      sys = readSys();
    } catch (err) {
      aiB = renderMsg('assistant', `Erreur: ${err?.message || err}`, { model, pyodideFinal: true });
      const savedError = await Store.addMsg(conversationId, 'assistant', `Erreur: ${err?.message || err}`, { model });
      bindMessageRecord(aiB, savedError);
      try { await mountHistory(); } catch (_) {}
      return Store.get(conversationId) || conversation;
    }

    const segmentedReply = await attemptSegmentedExerciseReply({
      content: lastMessage.content,
      conversationId,
      targetBubble: null,
      base,
      model,
      sys,
    });
    if (segmentedReply?.answerText) {
      return Store.get(conversationId) || conversation;
    }

    const variationAttempt = await requestDeterministicVariationTable(lastMessage.content);
    if (variationAttempt.payload) {
      aiB = await renderDeterministicVariationReply({
        conversationId,
        targetBubble: null,
        payload: variationAttempt.payload,
        model,
      });
      return Store.get(conversationId) || conversation;
    }
    logVariationPipelineFallback(variationAttempt);

    const equationAttempt = await requestDeterministicEquationSolve(lastMessage.content);
    if (equationAttempt.payload) {
      aiB = await renderDeterministicEquationReply({
        conversationId,
        targetBubble: null,
        payload: equationAttempt.payload,
        model,
      });
      return Store.get(conversationId) || conversation;
    }
    logEquationPipelineFallback(equationAttempt);

    const odeAttempt = await requestDeterministicOde(lastMessage.content);
    if (odeAttempt.payload) {
      aiB = await renderDeterministicOdeReply({
        conversationId,
        targetBubble: null,
        payload: odeAttempt.payload,
        model,
      });
      return Store.get(conversationId) || conversation;
    }
    logOdePipelineFallback(odeAttempt);

    const derivativeAttempt = await requestDeterministicDerivative(lastMessage.content);
    if (derivativeAttempt.payload) {
      aiB = await renderDeterministicDerivativeReply({
        conversationId,
        targetBubble: null,
        payload: derivativeAttempt.payload,
        model,
      });
      return Store.get(conversationId) || conversation;
    }
    logDerivativePipelineFallback(derivativeAttempt);

    const limitAttempt = await requestDeterministicLimit(lastMessage.content);
    if (limitAttempt.payload) {
      aiB = await renderDeterministicLimitReply({
        conversationId,
        targetBubble: null,
        payload: limitAttempt.payload,
        model,
      });
      return Store.get(conversationId) || conversation;
    }
    logLimitPipelineFallback(limitAttempt);

    const integralAttempt = await requestDeterministicIntegral(lastMessage.content);
    if (integralAttempt.payload) {
      aiB = await renderDeterministicIntegralReply({
        conversationId,
        targetBubble: null,
        payload: integralAttempt.payload,
        model,
      });
      return Store.get(conversationId) || conversation;
    }
    logIntegralPipelineFallback(integralAttempt);

    aiB = renderMsg('assistant', '', { model });
    const assistantState = createAssistantStreamState();

    try {
      for await (const chunk of streamChat({
        base,
        model,
        sys,
        prompt: lastMessage.content,
        convId: conversationId,
        images: [],
      })) {
        mergeAssistantStreamChunk(assistantState, chunk);
        const livePayload = buildAssistantPayload(assistantState, { live: true });
        if (!livePayload.answerText.trim() && !livePayload.reasoningText.trim()) continue;
        renderAssistantChunk(aiB, livePayload, {
          model,
          pyodideFinal: false,
        });
      }

      const finalPayload = finalizeAssistantStreamState(assistantState);
      if (finalPayload.answerText.trim() || finalPayload.reasoningText.trim()) {
        renderAssistantChunk(aiB, finalPayload, { model, pyodideFinal: true });
      }
      if (finalPayload.answerText.trim() || finalPayload.reasoningText.trim()) {
        const savedAssistantMessage = await Store.addMsg(conversationId, 'assistant', finalPayload.answerText, {
          reasoningText: finalPayload.reasoningText,
          model,
          reasoningDurationMs: finalPayload.reasoningDurationMs,
        });
        bindMessageRecord(aiB, savedAssistantMessage);
      }
      try { await mountHistory(); } catch (_) {}
      return Store.get(conversationId) || conversation;
    } catch (err) {
      const msg = 'Erreur: ' + (err && err.message ? err.message : String(err));
      renderAssistantChunk(aiB, { answerText: msg, reasoningText: '', reasoningDurationMs: null }, { model, pyodideFinal: true });
      const savedError = await Store.addMsg(conversationId, 'assistant', msg, { model });
      bindMessageRecord(aiB, savedError);
      try { await mountHistory(); } catch (_) {}
      return Store.get(conversationId) || conversation;
    }
  } finally {
    isSendInFlight = false;
    setSendButtonBusy(false);
  }
}

export async function sendCurrent() {
  const ta = qs('#composer-input');
  if (!ta) return alert('Zone de saisie introuvable.');
  if (isSendInFlight) return;

  const text = (ta.value || '').trim();
  const pendingUploads = getPendingUploads();
  if (!text && !pendingUploads.length) return;
  const model = readModel();
  let sys = '';
  try {
    await loadSystemPrompt();
    sys = readSys();
  } catch (err) {
    alert('Impossible de charger le prompt systeme: ' + (err?.message || err));
    return;
  }
  const needsOcrFeedback = hasPendingImageUploads(pendingUploads) && !canModelReadFiles(model);

  const detachedUploads = pendingUploads.length ? detachPendingUploads() : [];
  const localAttachments = detachedUploads.map((item) => ({
    filename: item?.file?.name || 'Piece jointe',
    mimeType: item?.file?.type || '',
    sizeBytes: Number(item?.file?.size || 0),
    previewUrl: item?.objectUrl || null,
    url: item?.objectUrl || null,
    isImage: item?.kind === 'image',
  }));
  let shouldReleaseDetachedUploads = true;
  let ocrHintTimer = null;

  isSendInFlight = true;
  setSendButtonBusy(true);

  try {
    const userBubble = renderMsg('user', text, { attachments: localAttachments });
    ta.value = '';

    if (window.kivrioEnsureConversationPromise) {
      try { await window.kivrioEnsureConversationPromise; } catch (_) {}
    }

    const base = readBase();
    let aiB = null;
    let ocrStage = 'ocr-reading';
    let hasRenderedModelText = false;

    const updateOcrStatus = (stage) => {
      ocrStage = stage;
      if (!aiB || hasRenderedModelText) return;
      renderAssistantChunk(aiB, { answerText: statusMessageFor(stage) });
    };

    if (needsOcrFeedback) {
      ocrHintTimer = setTimeout(() => {
        if (ocrStage === 'ocr-reading') updateOcrStatus('ocr-reading-slow');
      }, OCR_PROGRESS_HINT_DELAY_MS);
    }

    let convId = Store.currentId?.() || null;
    if (convId) {
      try {
        const existingConversation = await Store.ensureLoaded(convId);
        if (!existingConversation?.id) throw new Error('Conversation not found');
      } catch (_) {
        try { Store.clearCurrent?.(); } catch (_) {}
        convId = null;
      }
    }
    if (!convId && Store.create) {
      const conversation = await Store.create('Nouvelle conversation');
      convId = conversation.id;
    }
    if (!convId) {
      const message = 'Impossible de creer la conversation.';
      if (detachedUploads.length) {
        restorePendingUploads(detachedUploads, message);
        shouldReleaseDetachedUploads = false;
      }
      alert(message);
      return;
    }

    if (needsOcrFeedback) {
      aiB = renderMsg('assistant', statusMessageFor('ocr-reading'), { model, pyodideFinal: false });
    }

    let uploadedAttachments = [];
    if (detachedUploads.length) {
      try {
        uploadedAttachments = await uploadConversationAttachments(convId, detachedUploads.map((item) => item.file));
      } catch (err) {
        const message = err?.message || 'Televersement impossible.';
        restorePendingUploads(detachedUploads, message);
        shouldReleaseDetachedUploads = false;
        if (aiB) {
          renderAssistantChunk(aiB, { answerText: message }, { model });
        } else {
          alert(message);
        }
        return;
      }
    }

    try {
      const savedUserMessage = await Store.addMsg(convId, 'user', text, {
        attachmentIds: uploadedAttachments.map((item) => item.id),
      });
      bindMessageRecord(userBubble, savedUserMessage);
    } catch (_) {
    }

    const prepared = await preparePendingUploadsForSend({
      model,
      userText: text,
      onStatus: needsOcrFeedback ? updateOcrStatus : undefined,
      items: detachedUploads,
    });
    if (ocrHintTimer) clearTimeout(ocrHintTimer);
    if (!prepared.ok) {
      const message = prepared.message || 'Les fichiers joints ne peuvent pas etre envoyes.';
      if (aiB) {
        renderAssistantChunk(aiB, { answerText: message }, { model });
      } else {
        alert(message);
      }
      return;
    }

    try {
      await Store.renameIfDefault(convId, fmtTitle(prepared.suggestedTitle || text || 'Piece jointe'));
    } catch (_) {}
    try {
      await mountHistory();
    } catch (_) {}

    const deterministicPrompt = prepared.promptText || text;
    const canUseDeterministicVariation = !prepared.imagePayloads?.length && detachedUploads.length === 0;
    if (canUseDeterministicVariation) {
      const segmentedReply = await attemptSegmentedExerciseReply({
        content: deterministicPrompt,
        conversationId: convId,
        targetBubble: aiB,
        base,
        model,
        sys,
      });
      if (segmentedReply?.answerText) {
        return;
      }

      const variationAttempt = await requestDeterministicVariationTable(deterministicPrompt);
      if (variationAttempt.payload) {
        aiB = await renderDeterministicVariationReply({
          conversationId: convId,
          targetBubble: aiB,
          payload: variationAttempt.payload,
          model,
        });
        return;
      }
      logVariationPipelineFallback(variationAttempt);

      const equationAttempt = await requestDeterministicEquationSolve(deterministicPrompt);
      if (equationAttempt.payload) {
        aiB = await renderDeterministicEquationReply({
          conversationId: convId,
          targetBubble: aiB,
          payload: equationAttempt.payload,
          model,
        });
        return;
      }
      logEquationPipelineFallback(equationAttempt);

      const odeAttempt = await requestDeterministicOde(deterministicPrompt);
      if (odeAttempt.payload) {
        aiB = await renderDeterministicOdeReply({
          conversationId: convId,
          targetBubble: aiB,
          payload: odeAttempt.payload,
          model,
        });
        return;
      }
      logOdePipelineFallback(odeAttempt);

      const derivativeAttempt = await requestDeterministicDerivative(deterministicPrompt);
      if (derivativeAttempt.payload) {
        aiB = await renderDeterministicDerivativeReply({
          conversationId: convId,
          targetBubble: aiB,
          payload: derivativeAttempt.payload,
          model,
        });
        return;
      }
      logDerivativePipelineFallback(derivativeAttempt);

      const limitAttempt = await requestDeterministicLimit(deterministicPrompt);
      if (limitAttempt.payload) {
        aiB = await renderDeterministicLimitReply({
          conversationId: convId,
          targetBubble: aiB,
          payload: limitAttempt.payload,
          model,
        });
        return;
      }
      logLimitPipelineFallback(limitAttempt);

      const integralAttempt = await requestDeterministicIntegral(deterministicPrompt);
      if (integralAttempt.payload) {
        aiB = await renderDeterministicIntegralReply({
          conversationId: convId,
          targetBubble: aiB,
          payload: integralAttempt.payload,
          model,
        });
        return;
      }
      logIntegralPipelineFallback(integralAttempt);
    }

    if (!aiB) aiB = renderMsg('assistant', '', { model });
    const assistantState = createAssistantStreamState();
    try {
      for await (const chunk of streamChat({
        base,
        model,
        sys,
        prompt: prepared.promptText || text,
        convId,
        images: prepared.imagePayloads || [],
      })) {
        mergeAssistantStreamChunk(assistantState, chunk);
        const livePayload = buildAssistantPayload(assistantState, { live: true });
        if (!livePayload.answerText.trim() && !livePayload.reasoningText.trim()) continue;
        hasRenderedModelText = true;
        renderAssistantChunk(aiB, livePayload, {
          model,
          pyodideFinal: false,
        });
      }
      const finalPayload = finalizeAssistantStreamState(assistantState);
      if (finalPayload.answerText.trim() || finalPayload.reasoningText.trim()) {
        renderAssistantChunk(aiB, finalPayload, { model, pyodideFinal: true });
      }
      if (convId && (finalPayload.answerText.trim() || finalPayload.reasoningText.trim())) {
        const savedAssistantMessage = await Store.addMsg(convId, 'assistant', finalPayload.answerText, {
          reasoningText: finalPayload.reasoningText,
          model,
          reasoningDurationMs: finalPayload.reasoningDurationMs,
        });
        bindMessageRecord(aiB, savedAssistantMessage);
      }
      try { await mountHistory(); } catch (_) {}
    } catch (err) {
      const msg = 'Erreur: ' + (err && err.message ? err.message : String(err));
      renderAssistantChunk(aiB, { answerText: msg, reasoningText: '', reasoningDurationMs: null }, { model, pyodideFinal: true });
      if (convId) await Store.addMsg(convId, 'assistant', msg, { model });
      try { await mountHistory(); } catch (_) {}
      console.warn('Fetch error', err);
    }
  } finally {
    if (ocrHintTimer) clearTimeout(ocrHintTimer);
    if (shouldReleaseDetachedUploads) releaseUploadItems(detachedUploads);
    isSendInFlight = false;
    setSendButtonBusy(false);
  }
}

document.addEventListener('settings:model-changed', (e) => {
  const model = (e.detail || '').trim();
  if (model) setLS(LS.model, model);
});
