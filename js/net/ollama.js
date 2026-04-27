// js/net/ollama.js
// Flux reseau Ollama + rendu des messages (compatible KaTeX)

import { bindMessageRecord, renderMsg, updateBubbleContent } from '../chat/render.js';
import { Store, fmtTitle, mountHistory } from '../store/conversations.js';
import { qs } from '../core/dom.js';
import { runPython } from '../features/python/pyodideLoader.js';
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
const THINK_START_TAG = '<think>';
const THINK_END_TAG = '</think>';
const KIVRIO_PLOT_CONTEXT_MARKER = '__KIVRIO_PLOT_CONTEXT__=';
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
const PYTHON_PLOTTING_GUIDANCE = [
  'Pour toute demande de trace mathematique en Python avec matplotlib, le modele pilote la demarche mais le code doit effectuer les calculs exacts.',
  'Ne jamais ecrire a la main des coordonnees supposees pour les intersections, racines, zeros, sommet, extrema ou autres points remarquables.',
  'Toujours calculer ces valeurs dans le code avec SymPy, NumPy ou une methode Python equivalente avant de tracer les points et leurs etiquettes.',
  'Toute valeur issue de SymPy et transmise a Matplotlib doit etre convertie explicitement en float, en liste de float ou en numpy.ndarray numerique compatible avant plot, scatter, annotate, set_xlim ou set_ylim.',
  'Ne pas passer directement a Matplotlib des listes d objets SymPy, des bornes SymPy ou des expressions symboliques non converties.',
  'Si l utilisateur demande un ajout sur un trace deja present, fournir un script Python complet et coherent qui recalcule les valeurs utiles au lieu de reemployer des coordonnees deduites a la main.',
  `A la fin de chaque script de trace, imprimer une seule ligne machine lisible au format ${KIVRIO_PLOT_CONTEXT_MARKER}{...} avec json.dumps(..., ensure_ascii=False).`,
  'Ce JSON doit venir du calcul Python et resumer, si pertinent, la fonction ou l objet etudie, le domaine, les intersections, les racines, les extrema, le signe, les variations, les asymptotes et un court resume qualitatif factuel.',
  'Si tu fournis du Python, rends un seul bloc ```python``` executable par Kivrio.',
  'Tu peux garder de la marge pour les explications qualitatives, mais pas pour les valeurs mathematiques importantes qui doivent venir du calcul.',
].join('\n');
  const VARIATION_TABLE_HTML_OPEN = '<variation-table-html>';
  const VARIATION_TABLE_HTML_CLOSE = '</variation-table-html>';
  const SYSTEM_SOLVE_HTML_OPEN = '<system-solve-html>';
  const SYSTEM_SOLVE_HTML_CLOSE = '</system-solve-html>';
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
const VARIATION_LOCAL_GUIDANCE_REASONS = new Set([
  'missing_expression',
  'parse_failed',
  'invalid_expression',
  'invalid_variable',
  'ambiguous_variable',
  'constant_expression',
  'missing_study_interval',
  'invalid_study_interval',
]);
const EQUATION_LOCAL_GUIDANCE_REASONS = new Set([
  'missing_equation',
  'invalid_equation',
  'parse_failed',
  'invalid_variable',
  'ambiguous_variable',
  'constant_equation',
  'unsupported_equation',
]);
const SYSTEM_LOCAL_GUIDANCE_REASONS = new Set([
  'missing_system',
  'invalid_system',
  'parse_failed',
  'ambiguous_variable',
  'unsupported_system',
]);
const DERIVATIVE_LOCAL_GUIDANCE_REASONS = new Set([
  'missing_expression',
  'parse_failed',
  'invalid_expression',
  'invalid_variable',
  'ambiguous_variable',
]);
const LIMIT_LOCAL_GUIDANCE_REASONS = new Set([
  'missing_expression',
  'missing_limit',
  'missing_target',
  'parse_failed',
  'invalid_expression',
  'invalid_target',
  'invalid_variable',
  'ambiguous_variable',
]);
const INTEGRAL_LOCAL_GUIDANCE_REASONS = new Set([
  'missing_expression',
  'missing_integral',
  'parse_failed',
  'invalid_expression',
  'invalid_bound',
  'invalid_variable',
  'ambiguous_variable',
]);
const ODE_LOCAL_GUIDANCE_REASONS = new Set([
  'missing_equation',
  'invalid_equation',
  'missing_derivative',
  'parse_failed',
  'invalid_variable',
  'invalid_function',
  'unsupported_order',
  'unsupported_ode',
]);
const VARIATION_LOCAL_GUIDANCE_MESSAGE = [
  'Je comprends que vous demandez un tableau de variation, mais je n\'ai pas pu interpr\u00e9ter l\'expression.',
  '',
  'Essayez par exemple :',
  '- tableau de variation de x^3 - 3x',
  '- \u00e9tudier les variations de x^2 + 1',
  '- \u00e9tudier les variations de f(x)=x^2 + 1',
  '- variations de sin(x) sur [0, pi]',
].join('\n');
const EQUATION_LOCAL_GUIDANCE_MESSAGE = [
  'Je comprends que vous demandez une r\u00e9solution d\'\u00e9quation, mais je n\'ai pas pu interpr\u00e9ter l\'expression.',
  '',
  'Essayez par exemple :',
  '- r\u00e9soudre x^2 - 4 = 0',
  '- solution de 2x + 3 = 7',
  '- r\u00e9soudre sin(x) = 0',
].join('\n');
const SYSTEM_LOCAL_GUIDANCE_MESSAGE = [
  'Je comprends que vous demandez une r\u00e9solution de syst\u00e8me, mais je n\'ai pas pu interpr\u00e9ter les \u00e9quations.',
  '',
  'Essayez par exemple :',
  '- resoudre le systeme x + y = 3 ; x - y = 1',
  '- systeme : 2x + y = 5 et x - y = 1',
  '- resoudre { 3z1 + z2 = 5 + 2i ; -z1 + z2 = 1 - 2i }',
].join('\n');
const DERIVATIVE_LOCAL_GUIDANCE_MESSAGE = [
  'Je comprends que vous demandez une d\u00e9riv\u00e9e, mais je n\'ai pas pu interpr\u00e9ter l\'expression.',
  '',
  'Essayez par exemple :',
  '- d\u00e9riv\u00e9e de x^3',
  '- calculer la d\u00e9riv\u00e9e de sin(x)',
  '- d\u00e9riv\u00e9e de e^x + x^2',
].join('\n');
const LIMIT_LOCAL_GUIDANCE_MESSAGE = [
  'Je comprends que vous demandez une limite, mais je n\'ai pas pu interpr\u00e9ter l\'expression.',
  '',
  'Essayez par exemple :',
  '- limite de sin(x)/x quand x tend vers 0',
  '- calculer la limite de (x^2 - 1)/(x - 1) quand x tend vers 1',
  '- limite de 1/x quand x tend vers +infini',
].join('\n');
const INTEGRAL_LOCAL_GUIDANCE_MESSAGE = [
  'Je comprends que vous demandez une int\u00e9grale, mais je n\'ai pas pu interpr\u00e9ter l\'expression.',
  '',
  'Essayez par exemple :',
  '- int\u00e9grale de x^2',
  '- calculer l\'int\u00e9grale de x^2 entre 0 et 2',
  '- primitive de sin(x)',
].join('\n');
const ODE_LOCAL_GUIDANCE_MESSAGE = [
  'Je comprends que vous demandez une \u00e9quation diff\u00e9rentielle, mais je n\'ai pas pu interpr\u00e9ter l\'expression.',
  '',
  'Essayez par exemple :',
  '- r\u00e9soudre y\' = y',
  '- \u00e9quation diff\u00e9rentielle y\'\' + y = 0',
  '- solution de y\' + 2y = 3',
].join('\n');
const GENERIC_LOCAL_GUIDANCE_MESSAGE = [
  'Je comprends que vous demandez une op\u00e9ration math\u00e9matique, mais je n\'ai pas pu interpr\u00e9ter l\'expression.',
  '',
  'Essayez par exemple :',
  '- int\u00e9grale de x^2',
  '- d\u00e9riv\u00e9e de sin(x)',
  '- r\u00e9soudre x^2 - 4 = 0',
].join('\n');
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
    (/\bvariation\b/.test(raw) && /\btableau\b/.test(raw)) ||
    /\betudier\s+les?\s+variations?\b/.test(raw) ||
    /\betudiez\s+les?\s+variations?\b/.test(raw) ||
    /\bdress(?:er|ez)\s+le\s+tableau\s+de\s+variation\b/.test(raw) ||
    /\bvariations?\s+de\b/.test(raw);

  const mentionsFunction =
    /\bfonction\b/.test(raw) ||
    /\bderivee\b/.test(raw) ||
    /\bsigne\s+de\b/.test(raw) ||
    /[a-z]\s*\(\s*x\s*\)/.test(raw) ||
    /[a-z0-9)\]]/.test(raw);

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

function normalizeSystemIntentProbe(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeSystemSolveRequest(text) {
  const source = String(text || '');
  const raw = normalizeSystemIntentProbe(source);
  if (!raw || looksLikeVariationTableRequest(raw) || looksLikeOdeRequest(raw)) return false;

  const equalityCount = (source.match(/=/g) || []).length;
  if (equalityCount < 2) return false;

  const asksSystem =
    /\bsysteme\b/.test(raw) ||
    /\bsystem\b/.test(raw) ||
    /\bresoudre\b/.test(raw);

  const hasStructuredLayout =
    /\\begin\{aligned\}/.test(source) ||
    /\\begin\{cases\}/.test(source) ||
    /\\left\\\{/.test(source) ||
    /\{[^{}]*=[^{}]*;[^{}]*=/.test(source);

  return asksSystem || hasStructuredLayout;
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
  if (!raw || looksLikeVariationTableRequest(raw) || looksLikeOdeRequest(raw) || looksLikeSystemSolveRequest(text)) return false;

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
  if (!raw || looksLikeVariationTableRequest(raw) || looksLikeSystemSolveRequest(text) || looksLikeEquationSolveRequest(raw) || looksLikeOdeRequest(raw)) return false;

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
  if (!raw || looksLikeVariationTableRequest(raw) || looksLikeSystemSolveRequest(text) || looksLikeEquationSolveRequest(raw) || looksLikeOdeRequest(raw) || looksLikeDerivativeRequest(raw)) return false;

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
  if (!raw || looksLikeVariationTableRequest(raw) || looksLikeSystemSolveRequest(text) || looksLikeEquationSolveRequest(raw) || looksLikeOdeRequest(raw) || looksLikeDerivativeRequest(raw) || looksLikeLimitRequest(raw)) return false;

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

function looksLikeExplanatoryMathRequest(text) {
  const raw = normalizeEquationIntentProbe(text);
  if (!raw) return false;

  const asksExplanation =
    /\bexplique(?:r|z)?\b/.test(raw) ||
    /\bexplication\b/.test(raw) ||
    /\bdemontre(?:r|z)?\b/.test(raw) ||
    /\bdemonstration\b/.test(raw) ||
    /\bjustifie(?:r|z)?\b/.test(raw) ||
    /\bcommente(?:r|z)?\b/.test(raw) ||
    /\bcommentaire\b/.test(raw) ||
    /\bpourquoi\b/.test(raw);

  if (!asksExplanation) return false;

  const mentionsMath =
    /=/.test(raw) ||
    /\b(?:equation|derivee|integrale|primitive|limite|variation|variations|resultat|courbe|systeme)\b/.test(raw) ||
    /[a-z]\s*'\s*(?:\(\s*[a-z]\s*\))?/.test(raw);

  return mentionsMath;
}

function looksLikeGenericMathGuidanceRequest(text) {
  const raw = normalizeEquationIntentProbe(text);
  if (!raw || looksLikeExplanatoryMathRequest(raw)) return false;

  const mentionsKnownMathObject =
    /\b(?:derivee|integrale|primitive|limite|equation|variation|variations|differentielle|tableau|systeme)\b/.test(raw);

  const asksMathOperation =
    /\b(?:calculer|calculez|determiner|determinez|determine|trouver|trouvez|trouve|resoudre|resolvez|resous|etudier|etudiez|dresser|dressez|donner|donnez|donne)\b/.test(raw);

  const hasSymbolicMath =
    /=/.test(raw) ||
    /->/.test(raw) ||
    /[a-z]\s*'\s*(?:\(\s*[a-z]\s*\))?/.test(raw) ||
    /[a-z]\s*\(\s*[a-z]\s*\)/.test(raw) ||
    /\b(?:sin|cos|tan|exp|ln|log)\s*\(/.test(raw) ||
    (/\b\d+\b/.test(raw) && /[a-z]/.test(raw));

  return mentionsKnownMathObject || (asksMathOperation && hasSymbolicMath);
}

function normalizePlotIntentProbe(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function conversationHasPythonPlottingContext(convId) {
  const history = toChatHistory(readHistory(convId)).slice(-8);
  if (!history.length) return false;

  return history.some((message) => {
    const content = String(message?.content || '');
    const normalized = normalizePlotIntentProbe(content);
    if (!normalized) return false;
    if (/```(?:python|python3|py|pyodide)?[\s\S]*?(?:import matplotlib|from matplotlib|plt\.)/i.test(content)) {
      return true;
    }
    return /\b(?:matplotlib|courbe|graphe|graphique|trace|tracer|tracez|plot|intersection|intersections|sommet|extremum|racines?|zeros?)\b/.test(normalized);
  });
}

function looksLikePythonPlottingRequest(userText, convId) {
  const raw = normalizePlotIntentProbe(userText);
  if (!raw) return false;

  const directPlotRequest =
    /\b(?:matplotlib|courbe|graphe|graphique|plot|tracer|trace|tracez)\b/.test(raw);

  if (directPlotRequest) return true;

  if (!conversationHasPythonPlottingContext(convId)) return false;

  return /\b(?:indiquer|ajouter|placer|afficher|marquer|annoter|annotation|intersection|intersections|point|points|sommet|extremum|racines?|zeros?|axe|axes)\b/.test(raw);
}

function looksLikePlotQualitativeExplanationRequest(userText, convId) {
  const raw = normalizePlotIntentProbe(userText);
  if (!raw) return false;
  if (!conversationHasPythonPlottingContext(convId)) return false;

  const asksExplanation =
    /\b(?:expliquer|expliquez|explique|decrire|decrivez|decris|commenter|commentez|commentaire|interpreter|interpretez|interpretation|analyse|analyser|qualitativ)\b/.test(raw);

  if (!asksExplanation) return false;

  return (
    /\b(?:courbe|graphe|graphique|figure|trace)\b/.test(raw)
    || /\bcette\s+courbe\b/.test(raw)
    || /\bce\s+graphe\b/.test(raw)
    || /\bcette\s+figure\b/.test(raw)
  );
}

function extractPythonCodeFences(content) {
  const source = String(content || '');
  const fences = [];
  const pattern = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const info = String(match[1] || '').trim();
    const lang = (info ? info.split(/\s+/)[0] : '').toLowerCase();
    fences.push({
      lang,
      code: String(match[2] || '').replace(/\n$/, ''),
    });
  }
  return fences;
}

function isPlottingPythonFence(fence) {
  const lang = String(fence?.lang || '').trim().toLowerCase();
  const code = String(fence?.code || '');
  if (lang && !['python', 'python3', 'py', 'pyodide'].includes(lang)) return false;
  return /\b(?:import\s+matplotlib|from\s+matplotlib|matplotlib\.pyplot|plt\.)/i.test(code);
}

function findLatestPlottingPythonCode(convId) {
  const history = readHistory(convId).slice().reverse();
  for (const message of history) {
    if (String(message?.role || '').toLowerCase() !== 'assistant') continue;
    const fences = extractPythonCodeFences(message?.content || '');
    for (let index = fences.length - 1; index >= 0; index -= 1) {
      const fence = fences[index];
      if (isPlottingPythonFence(fence)) return fence.code;
    }
  }
  return '';
}

async function resolvePlotExplanationGuidance(userText, convId) {
  if (!looksLikePlotQualitativeExplanationRequest(userText, convId)) return '';

  const code = findLatestPlottingPythonCode(convId);
  if (!code) return '';

  try {
    const result = await runPython(code);
    const contexts = Array.isArray(result?.plotContexts) ? result.plotContexts.filter(Boolean) : [];
    const latestContext = contexts[contexts.length - 1];
    if (!latestContext || typeof latestContext !== 'object') return '';

    return [
      'Pour cette reponse, explique la courbe strictement a partir du contexte calcule ci-dessous.',
      'Ne recalcule pas librement les racines, intersections, extrema, variations, signe ou asymptotes si le contexte les fournit deja.',
      'Si une information manque dans le contexte, dis-le plutot que d inventer.',
      'Tu peux garder une explication qualitative claire et pedagogique, mais elle doit rester ancree sur ces faits calcules.',
      'Contexte de courbe calcule par Python :',
      '```json',
      JSON.stringify(latestContext, null, 2),
      '```',
    ].join('\n');
  } catch (_) {
    return '';
  }
}

function buildEffectiveSystemPrompt(sys, userText, convId, extraGuidance = '') {
  const base = String(sys || '').trim();
  const additions = [];
  if (looksLikeVariationTableRequest(userText)) additions.push(VARIATION_FALLBACK_GUIDANCE);
  if (looksLikePythonPlottingRequest(userText, convId)) additions.push(PYTHON_PLOTTING_GUIDANCE);
  if (String(extraGuidance || '').trim()) additions.push(String(extraGuidance).trim());
  if (!base && additions.length === 0) return '';
  return [base, ...additions].filter(Boolean).join('\n\n');
}

function wrapVariationTableHtml(html) {
  const body = String(html || '').trim();
  if (!body) return '';
  return `${VARIATION_TABLE_HTML_OPEN}${body}${VARIATION_TABLE_HTML_CLOSE}`;
}

function wrapSystemSolveHtml(html) {
  const body = String(html || '').trim();
  if (!body) return '';
  return `${SYSTEM_SOLVE_HTML_OPEN}${body}${SYSTEM_SOLVE_HTML_CLOSE}`;
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

function shouldShowGuidance(reason, allowedReasons) {
  return allowedReasons.has(String(reason || '').trim());
}

function shouldShowVariationGuidance(reason) {
  return shouldShowGuidance(reason, VARIATION_LOCAL_GUIDANCE_REASONS);
}

function shouldShowEquationGuidance(reason) {
  return shouldShowGuidance(reason, EQUATION_LOCAL_GUIDANCE_REASONS);
}

function shouldShowSystemGuidance(reason) {
  return shouldShowGuidance(reason, SYSTEM_LOCAL_GUIDANCE_REASONS);
}

function shouldShowDerivativeGuidance(reason) {
  return shouldShowGuidance(reason, DERIVATIVE_LOCAL_GUIDANCE_REASONS);
}

function shouldShowLimitGuidance(reason) {
  return shouldShowGuidance(reason, LIMIT_LOCAL_GUIDANCE_REASONS);
}

function shouldShowIntegralGuidance(reason) {
  return shouldShowGuidance(reason, INTEGRAL_LOCAL_GUIDANCE_REASONS);
}

function shouldShowOdeGuidance(reason) {
  return shouldShowGuidance(reason, ODE_LOCAL_GUIDANCE_REASONS);
}

function createLocalGuidancePayload(answerText, pipeline) {
  return {
    answerText: String(answerText || '').trim(),
    reasoningText: '',
    reasoningDurationMs: null,
    pipeline: String(pipeline || '').trim() || 'deterministic-guidance',
  };
}

function createVariationGuidancePayload() {
  return createLocalGuidancePayload(VARIATION_LOCAL_GUIDANCE_MESSAGE, 'deterministic-variation-guidance');
}

function createEquationGuidancePayload() {
  return createLocalGuidancePayload(EQUATION_LOCAL_GUIDANCE_MESSAGE, 'deterministic-equation-guidance');
}

function createSystemGuidancePayload() {
  return createLocalGuidancePayload(SYSTEM_LOCAL_GUIDANCE_MESSAGE, 'deterministic-system-guidance');
}

function createDerivativeGuidancePayload() {
  return createLocalGuidancePayload(DERIVATIVE_LOCAL_GUIDANCE_MESSAGE, 'deterministic-derivative-guidance');
}

function createLimitGuidancePayload() {
  return createLocalGuidancePayload(LIMIT_LOCAL_GUIDANCE_MESSAGE, 'deterministic-limit-guidance');
}

function createIntegralGuidancePayload() {
  return createLocalGuidancePayload(INTEGRAL_LOCAL_GUIDANCE_MESSAGE, 'deterministic-integral-guidance');
}

function createOdeGuidancePayload() {
  return createLocalGuidancePayload(ODE_LOCAL_GUIDANCE_MESSAGE, 'deterministic-ode-guidance');
}

function createGenericGuidancePayload() {
  return createLocalGuidancePayload(GENERIC_LOCAL_GUIDANCE_MESSAGE, 'deterministic-generic-guidance');
}

function wrapOdeHtml(html) {
  const body = String(html || '').trim();
  if (!body) return '';
  return `${ODE_HTML_OPEN}${body}${ODE_HTML_CLOSE}`;
}

function createPipelineAttempt({
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

function extractDeterministicPayloadData(payload) {
  if (payload?.data && typeof payload.data === 'object') return payload.data;
  return payload && typeof payload === 'object' ? payload : null;
}

function readDeterministicFallbackMessage(payload) {
  return String(payload?.message || payload?.error || '');
}

function buildDeterministicReplyPayload({ html, pipeline }) {
  return {
    answerText: String(html || '').trim(),
    reasoningText: '',
    reasoningDurationMs: null,
    pipeline: String(pipeline || '').trim() || 'deterministic-pipeline',
  };
}

function tracePromptPreview(text, maxLength = 500) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function logDeterministicPipelineFallback(label, attempt) {
  if (!attempt?.matched || attempt?.payload) return;
  const reason = attempt.fallbackReason || 'analysis_failed';
  const details = attempt.fallbackMessage ? ` (${attempt.fallbackMessage})` : '';
  console.info(`[${label}] fallback vers le pipeline modele: ${reason}${details}`);
}

async function renderDeterministicReply({ conversationId, targetBubble, payload, model }) {
  let bubble = targetBubble;
  if (!bubble) bubble = renderMsg('assistant', payload.answerText, { model, pyodideFinal: true, allowSpecializedHtml: true });
  else renderAssistantChunk(bubble, payload, { model, pyodideFinal: true, allowSpecializedHtml: true });

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

async function requestDeterministicPipeline(prompt, spec) {
  if (!spec?.looksLikeRequest?.(prompt)) return createPipelineAttempt();

  console.info('[Kivrio trace][deterministic-request]', {
    pipeline: spec.pipeline,
    endpoint: spec.endpoint,
    promptPreview: tracePromptPreview(prompt),
  });

  try {
    const res = await fetch(spec.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: String(prompt || '') }),
    });
    let payload = null;
    try {
      payload = await res.json();
    } catch (_) {}

    console.info('[Kivrio trace][deterministic-response]', {
      pipeline: spec.pipeline,
      status: res.status,
      ok: res.ok,
      payloadStatus: String(payload?.status || ''),
      reason: String(payload?.reason || ''),
      hasHtml: Boolean(extractDeterministicPayloadData(payload)?.html || payload?.html),
      message: readDeterministicFallbackMessage(payload),
    });

    if (!res.ok) {
      const reason = String(payload?.reason || `http-${res.status}`);
      const fallbackMessage = readDeterministicFallbackMessage(payload);
      const payloadStatus = String(payload?.status || '').trim().toLowerCase();
      const shouldUseGuidance = payloadStatus === 'guidance'
        || (!payloadStatus && spec.shouldShowGuidance(reason));
      if (shouldUseGuidance) {
        return createPipelineAttempt({
          matched: true,
          payload: spec.createGuidancePayload(),
          rawPayload: payload,
          fallbackReason: reason,
          fallbackMessage,
        });
      }
      return createPipelineAttempt({
        matched: true,
        rawPayload: payload,
        fallbackReason: reason,
        fallbackMessage,
      });
    }

    const responseData = extractDeterministicPayloadData(payload);
    const html = spec.wrapHtml(responseData?.html || payload?.html || '');
    if (!html) {
      console.info('[Kivrio trace][deterministic-missing-html]', {
        pipeline: spec.pipeline,
        message: spec.missingHtmlMessage,
      });
      return createPipelineAttempt({
        matched: true,
        rawPayload: payload,
        fallbackReason: 'missing_html',
        fallbackMessage: spec.missingHtmlMessage,
      });
    }

    return createPipelineAttempt({
      matched: true,
      payload: buildDeterministicReplyPayload({
        html,
        pipeline: String(payload?.pipeline || responseData?.pipeline || spec.pipeline),
      }),
      rawPayload: payload,
    });
  } catch (err) {
    return createPipelineAttempt({
      matched: true,
      fallbackReason: 'request_failed',
      fallbackMessage: err?.message || String(err || ''),
    });
  }
}

const VARIATION_PIPELINE_SPEC = {
  label: 'variation-table',
  pipeline: 'deterministic-variation',
  endpoint: '/api/math/variation-table',
  looksLikeRequest: looksLikeVariationTableRequest,
  shouldShowGuidance: shouldShowVariationGuidance,
  createGuidancePayload: createVariationGuidancePayload,
  wrapHtml: wrapVariationTableHtml,
  missingHtmlMessage: 'La reponse deterministe ne contient pas de tableau exploitable.',
};

const SYSTEM_PIPELINE_SPEC = {
  label: 'system-solve',
  pipeline: 'deterministic-system',
  endpoint: '/api/math/system-solve',
  looksLikeRequest: looksLikeSystemSolveRequest,
  shouldShowGuidance: shouldShowSystemGuidance,
  createGuidancePayload: createSystemGuidancePayload,
  wrapHtml: wrapSystemSolveHtml,
  missingHtmlMessage: 'La reponse deterministe ne contient pas de rendu exploitable.',
};

const EQUATION_PIPELINE_SPEC = {
  label: 'equation-solve',
  pipeline: 'deterministic-equation',
  endpoint: '/api/math/equation-solve',
  looksLikeRequest: looksLikeEquationSolveRequest,
  shouldShowGuidance: shouldShowEquationGuidance,
  createGuidancePayload: createEquationGuidancePayload,
  wrapHtml: wrapEquationSolveHtml,
  missingHtmlMessage: 'La reponse deterministe ne contient pas de rendu exploitable.',
};

const ODE_PIPELINE_SPEC = {
  label: 'ode',
  pipeline: 'deterministic-ode',
  endpoint: '/api/math/ode',
  looksLikeRequest: looksLikeOdeRequest,
  shouldShowGuidance: shouldShowOdeGuidance,
  createGuidancePayload: createOdeGuidancePayload,
  wrapHtml: wrapOdeHtml,
  missingHtmlMessage: 'La reponse deterministe ne contient pas de rendu exploitable.',
};

const DERIVATIVE_PIPELINE_SPEC = {
  label: 'derivative',
  pipeline: 'deterministic-derivative',
  endpoint: '/api/math/derivative',
  looksLikeRequest: looksLikeDerivativeRequest,
  shouldShowGuidance: shouldShowDerivativeGuidance,
  createGuidancePayload: createDerivativeGuidancePayload,
  wrapHtml: wrapDerivativeHtml,
  missingHtmlMessage: 'La reponse deterministe ne contient pas de rendu exploitable.',
};

const LIMIT_PIPELINE_SPEC = {
  label: 'limit',
  pipeline: 'deterministic-limit',
  endpoint: '/api/math/limit',
  looksLikeRequest: looksLikeLimitRequest,
  shouldShowGuidance: shouldShowLimitGuidance,
  createGuidancePayload: createLimitGuidancePayload,
  wrapHtml: wrapLimitHtml,
  missingHtmlMessage: 'La reponse deterministe ne contient pas de rendu exploitable.',
};

const INTEGRAL_PIPELINE_SPEC = {
  label: 'integral',
  pipeline: 'deterministic-integral',
  endpoint: '/api/math/integral',
  looksLikeRequest: looksLikeIntegralRequest,
  shouldShowGuidance: shouldShowIntegralGuidance,
  createGuidancePayload: createIntegralGuidancePayload,
  wrapHtml: wrapIntegralHtml,
  missingHtmlMessage: 'La reponse deterministe ne contient pas de rendu exploitable.',
};

const DETERMINISTIC_PIPELINE_SPECS = [
  VARIATION_PIPELINE_SPEC,
  SYSTEM_PIPELINE_SPEC,
  EQUATION_PIPELINE_SPEC,
  ODE_PIPELINE_SPEC,
  DERIVATIVE_PIPELINE_SPEC,
  LIMIT_PIPELINE_SPEC,
  INTEGRAL_PIPELINE_SPEC,
];

async function resolveDeterministicPipeline(prompt) {
  if (looksLikeExplanatoryMathRequest(prompt)) return { handled: false, attempt: null, spec: null, payload: null };

  for (const spec of DETERMINISTIC_PIPELINE_SPECS) {
    const attempt = await requestDeterministicPipeline(prompt, spec);
    if (attempt.payload) {
      return { handled: true, attempt, spec, payload: attempt.payload };
    }
    logDeterministicPipelineFallback(spec.label, attempt);
  }

  if (looksLikeGenericMathGuidanceRequest(prompt)) {
    const payload = createGenericGuidancePayload();
    return {
      handled: true,
      payload,
      spec: null,
      attempt: createPipelineAttempt({
        matched: true,
        payload,
        fallbackReason: 'generic_guidance',
      }),
    };
  }

  return { handled: false, attempt: null, spec: null, payload: null };
}

async function attemptDeterministicPipelineChain({ prompt, conversationId, targetBubble, model }) {
  let bubble = targetBubble || null;
  const result = await resolveDeterministicPipeline(prompt);
  if (!result.handled || !result.payload) return { handled: false, bubble, ...result };

  bubble = await renderDeterministicReply({
    conversationId,
    targetBubble: bubble,
    payload: result.payload,
    model,
  });
  return { handled: true, bubble, ...result };
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

function buildSegmentPrompt(exercise, segment) {
  return [exercise?.preamble, segment?.body].filter(Boolean).join('\n\n').trim();
}

function buildSegmentVariationProbeText(exercise, segment) {
  return buildSegmentPrompt(exercise, segment);
}

function buildSegmentVariationPrompt(exercise, segment) {
  const scoped = buildSegmentPrompt(exercise, segment);
  if (segmentContainsFunctionExpression(scoped)) return scoped;
  return String(exercise?.source || scoped || '').trim();
}

function looksLikeDeterministicSegmentCandidate(prompt) {
  const text = String(prompt || '');
  return DETERMINISTIC_PIPELINE_SPECS.some((spec) => spec.looksLikeRequest(text))
    || looksLikeGenericMathGuidanceRequest(text)
    || looksLikeExplanatoryMathRequest(text);
}

function shouldUseSegmentedExerciseRouting(exercise) {
  if (!exercise?.segments?.length) return false;
  return exercise.segments.some((segment) => looksLikeDeterministicSegmentCandidate(buildSegmentPrompt(exercise, segment)));
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
  const payload = extractDeterministicPayloadData(rawPayload);
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

function buildEquationContextSummary(rawPayload) {
  const payload = extractDeterministicPayloadData(rawPayload);
  const equation = latexToPlainMath(payload?.equationLatex || '');
  const domain = latexToPlainMath(payload?.domainLatex || '');
  const solution = latexToPlainMath(payload?.solutionSetLatex || '');
  const lines = [];
  if (equation) lines.push(`Equation : ${equation}`);
  if (domain) lines.push(`Domaine : ${domain}`);
  if (solution) lines.push(`Ensemble solution : S = ${solution}`);
  return lines.join('\n') || 'Une equation a ete resolue par le pipeline deterministe.';
}

function buildSystemContextSummary(rawPayload) {
  const payload = extractDeterministicPayloadData(rawPayload);
  const system = latexToPlainMath(payload?.systemLatex || '');
  const rows = Array.isArray(payload?.solutionRows) ? payload.solutionRows : [];
  const lines = [];
  if (system) lines.push(`Systeme : ${system}`);
  for (const row of rows) {
    const variable = String(row?.variable || '').trim();
    const value = latexToPlainMath(row?.valueLatex || '');
    if (variable && value) lines.push(`${variable} = ${value}`);
  }
  if (!rows.length && String(payload?.solutionType || '').trim() === 'none') {
    lines.push('Aucune solution.');
  }
  return lines.join('\n') || 'Un systeme a ete resolu par le pipeline deterministe.';
}

function buildDerivativeContextSummary(rawPayload) {
  const payload = extractDeterministicPayloadData(rawPayload);
  const expression = latexToPlainMath(payload?.expressionLatex || '');
  const variable = String(payload?.variable || 'x').trim() || 'x';
  const derivative = latexToPlainMath(payload?.derivativeLatex || '');
  const lines = [];
  if (expression) lines.push(`Expression : ${expression}`);
  lines.push(`Variable : ${variable}`);
  if (derivative) lines.push(`Derivee : f'(${variable}) = ${derivative}`);
  return lines.join('\n') || 'Une derivee a ete calculee par le pipeline deterministe.';
}

function buildLimitContextSummary(rawPayload) {
  const payload = extractDeterministicPayloadData(rawPayload);
  const statement = latexToPlainMath(payload?.limitStatementLatex || '');
  const expression = latexToPlainMath(payload?.expressionLatex || '');
  const target = latexToPlainMath(payload?.targetLatex || '');
  const value = latexToPlainMath(payload?.limitLatex || '');
  const lines = [];
  if (statement) lines.push(`Limite : ${statement}`);
  else {
    if (expression) lines.push(`Expression : ${expression}`);
    if (target) lines.push(`Point : ${target}`);
    if (value) lines.push(`Valeur de la limite : ${value}`);
  }
  return lines.join('\n') || 'Une limite a ete calculee par le pipeline deterministe.';
}

function buildIntegralContextSummary(rawPayload) {
  const payload = extractDeterministicPayloadData(rawPayload);
  const statement = latexToPlainMath(payload?.integralStatementLatex || '');
  const expression = latexToPlainMath(payload?.expressionLatex || '');
  const variable = String(payload?.variable || 'x').trim() || 'x';
  const lower = latexToPlainMath(payload?.lowerBoundLatex || '');
  const upper = latexToPlainMath(payload?.upperBoundLatex || '');
  const lines = [];
  if (expression) lines.push(`Expression : ${expression}`);
  lines.push(`Variable : ${variable}`);
  if (payload?.isDefinite && lower && upper) lines.push(`Bornes : [${lower}, ${upper}]`);
  if (statement) lines.push(`Resultat : ${statement}`);
  return lines.join('\n') || 'Une integrale a ete calculee par le pipeline deterministe.';
}

function buildOdeContextSummary(rawPayload) {
  const payload = extractDeterministicPayloadData(rawPayload);
  const equation = latexToPlainMath(payload?.equationLatex || '');
  const functionLatex = latexToPlainMath(payload?.functionLatex || '');
  const variable = String(payload?.variable || 'x').trim() || 'x';
  const solution = latexToPlainMath(payload?.solutionLatex || '');
  const lines = [];
  if (equation) lines.push(`Equation : ${equation}`);
  if (functionLatex) lines.push(`Inconnue : ${functionLatex}`);
  lines.push(`Variable : ${variable}`);
  if (solution) lines.push(`Solution : ${solution}`);
  return lines.join('\n') || 'Une equation differentielle a ete resolue par le pipeline deterministe.';
}

function buildDeterministicContextSummary(spec, rawPayload) {
  switch (spec?.pipeline) {
    case VARIATION_PIPELINE_SPEC.pipeline:
      return buildVariationContextSummary(rawPayload);
    case SYSTEM_PIPELINE_SPEC.pipeline:
      return buildSystemContextSummary(rawPayload);
    case EQUATION_PIPELINE_SPEC.pipeline:
      return buildEquationContextSummary(rawPayload);
    case DERIVATIVE_PIPELINE_SPEC.pipeline:
      return buildDerivativeContextSummary(rawPayload);
    case LIMIT_PIPELINE_SPEC.pipeline:
      return buildLimitContextSummary(rawPayload);
    case INTEGRAL_PIPELINE_SPEC.pipeline:
      return buildIntegralContextSummary(rawPayload);
    case ODE_PIPELINE_SPEC.pipeline:
      return buildOdeContextSummary(rawPayload);
    default:
      return 'Une sous-question a ete traitee par le pipeline deterministe.';
  }
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
  if (!shouldUseSegmentedExerciseRouting(exercise)) return null;

  let bubble = targetBubble;
  let combinedAnswer = '';
  const resolvedSegments = [];

  for (let index = 0; index < exercise.segments.length; index += 1) {
    const segment = exercise.segments[index];
    const segmentPrompt = buildSegmentPrompt(exercise, segment);
    const variationPrompt = buildSegmentVariationPrompt(exercise, segment);
    const deterministicPrompt =
      looksLikeVariationTableRequest(buildSegmentVariationProbeText(exercise, segment))
        ? variationPrompt
        : segmentPrompt;

    let sectionAnswer = '';
    let contextText = '';

    const deterministicResult = await resolveDeterministicPipeline(deterministicPrompt);
    if (deterministicResult.handled && deterministicResult.payload) {
      contextText = buildDeterministicContextSummary(
        deterministicResult.spec,
        deterministicResult.attempt?.rawPayload,
      );
      sectionAnswer = contextText;
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

function buildChatMessages({ sys, convId, userText, maxPast = 16, images = [], extraSystemGuidance = '' }) {
  const out = [];
  const history = toChatHistory(readHistory(convId));
  const effectiveSys = buildEffectiveSystemPrompt(sys, userText, convId, extraSystemGuidance);

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

function buildGeneratePrompt({ sys, convId, userText, maxPast = 16, extraSystemGuidance = '' }) {
  const history = toChatHistory(readHistory(convId)).slice(-maxPast);
  const parts = [];
  const effectiveSys = buildEffectiveSystemPrompt(sys, userText, convId, extraSystemGuidance);
  if (effectiveSys) parts.push(`System:\n${effectiveSys}`);
  for (const message of history) {
    parts.push((message.role === 'user' ? 'User' : 'Assistant') + ':\n' + message.content);
  }
  parts.push('User:\n' + userText);
  parts.push('Assistant:');
  return parts.join('\n\n');
}

export async function* streamChat({ base, model, sys, prompt, convId, maxPast = 16, images = [], extraSystemGuidance = '' }) {
  const body = {
    model,
    messages: buildChatMessages({ sys, convId, userText: prompt, maxPast, images, extraSystemGuidance }),
    stream: true,
  };
  const res = await fetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if ((res.status === 404 || res.status === 400) && !images.length) {
    return yield* streamGenerate({ base, model, sys, prompt, convId, maxPast, extraSystemGuidance });
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

export async function* streamGenerate({ base, model, sys, prompt, convId, maxPast = 16, extraSystemGuidance = '' }) {
  const effectiveSys = buildEffectiveSystemPrompt(sys, prompt, convId, extraSystemGuidance);
  const res = await fetch(base + '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      system: effectiveSys || undefined,
      prompt: buildGeneratePrompt({ sys, convId, userText: prompt, maxPast, extraSystemGuidance }),
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

    const deterministicReply = await attemptDeterministicPipelineChain({
      prompt: lastMessage.content,
      conversationId,
      targetBubble: null,
      model,
    });
    if (deterministicReply.handled) {
      aiB = deterministicReply.bubble;
      return Store.get(conversationId) || conversation;
    }

    aiB = renderMsg('assistant', '', { model });
    const assistantState = createAssistantStreamState();
    const plotExplanationGuidance = await resolvePlotExplanationGuidance(lastMessage.content, conversationId);

    try {
      for await (const chunk of streamChat({
        base,
        model,
        sys,
        prompt: lastMessage.content,
        convId: conversationId,
        images: [],
        extraSystemGuidance: plotExplanationGuidance,
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
      items: detachedUploads,
    });
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

    const deterministicPrompt = prepared.deterministicPromptText || prepared.promptText || text;
    const canUseDeterministicPipelines = Boolean(
      prepared.allowDeterministicPipelines
      || (!prepared.imagePayloads?.length && detachedUploads.length === 0),
    );
    console.info('[Kivrio trace][sendCurrent]', {
      model,
      hasImageUploads: detachedUploads.some((item) => item?.kind === 'image'),
      imagePayloadCount: Array.isArray(prepared.imagePayloads) ? prepared.imagePayloads.length : 0,
      allowDeterministicPipelines: Boolean(prepared.allowDeterministicPipelines),
      canUseDeterministicPipelines,
      deterministicPromptPreview: tracePromptPreview(deterministicPrompt),
    });
    if (canUseDeterministicPipelines) {
      const segmentedReply = await attemptSegmentedExerciseReply({
        content: deterministicPrompt,
        conversationId: convId,
        targetBubble: aiB,
        base,
        model,
        sys,
      });
      if (segmentedReply?.answerText) {
        console.info('[Kivrio trace][segmented-route]', {
          handled: true,
          answerPreview: tracePromptPreview(segmentedReply.answerText, 300),
        });
        return;
      }

      const deterministicReply = await attemptDeterministicPipelineChain({
        prompt: deterministicPrompt,
        conversationId: convId,
        targetBubble: aiB,
        model,
      });
      if (deterministicReply.handled) {
        console.info('[Kivrio trace][deterministic-route]', {
          handled: true,
          pipeline: deterministicReply?.spec?.pipeline || deterministicReply?.payload?.pipeline || '',
        });
        aiB = deterministicReply.bubble;
        return;
      }
      console.info('[Kivrio trace][deterministic-route]', {
        handled: false,
        pipeline: deterministicReply?.spec?.pipeline || '',
        fallbackReason: deterministicReply?.attempt?.fallbackReason || '',
        fallbackMessage: deterministicReply?.attempt?.fallbackMessage || '',
      });
    }

    console.info('[Kivrio trace][model-fallback]', {
      model,
      promptPreview: tracePromptPreview(prepared.promptText || text),
    });
    if (!aiB) aiB = renderMsg('assistant', '', { model });
    const assistantState = createAssistantStreamState();
    const plotExplanationGuidance = await resolvePlotExplanationGuidance(prepared.promptText || text, convId);
    try {
      for await (const chunk of streamChat({
        base,
        model,
        sys,
        prompt: prepared.promptText || text,
        convId,
        images: prepared.imagePayloads || [],
        extraSystemGuidance: plotExplanationGuidance,
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
    if (shouldReleaseDetachedUploads) releaseUploadItems(detachedUploads);
    isSendInFlight = false;
    setSendButtonBusy(false);
  }
}

document.addEventListener('settings:model-changed', (e) => {
  const model = (e.detail || '').trim();
  if (model) setLS(LS.model, model);
});
