// js/chat/render.js
// Rendu des messages (Markdown + LaTeX) pour Kivrio
// - Convertit les titres (#, ##, ###) en <h1>/<h2>/<h3> (plus de "###" visibles)
// - Préserve les maths pour KaTeX (\\(...\\), \\[...\\], $$...$$) pendant le rendu Markdown

import { qs } from '../core/dom.js';
import { runPython } from '../features/python/pyodideLoader.js';

/* -----------------------------------------------------------
 * 1) Normalisation LaTeX (pour KaTeX)
 *    - unifie $$...$$ -> \[...\]
 *    - unifie $...$   -> \(...\)
 * ----------------------------------------------------------- */
function normalizeLatex(input){
  if (!input) return '';
  let s = String(input);

  // $$ ... $$ -> \[ ... \]
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_, body) => `\\[${body.trim()}\\]`);

  // Inline $...$ -> \(...\) (si pas déjà échappé)
  // On évite de toucher aux \[...\] et \(...\)
  s = s.replace(/(^|[^\\])\$([^\n$]+?)\$/g, (_, pfx, body) => `${pfx}\\(${body.trim()}\\)`);

  // Nettoyage des doubles antislash accidentels
  s = s.replace(/\\\\\(/g, '\\(').replace(/\\\\\)/g, '\\)')
       .replace(/\\\\\[/g, '\\[').replace(/\\\\\]/g, '\\]');

  return s;
}

/* -----------------------------------------------------------
 * 2) Outils Markdown minimal sécurisé (sans dépendances)
 *    - échappe &, <, >
 *    - protège d'abord maths + fences avec des tokens
 * ----------------------------------------------------------- */
function escapeHtml(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function escapeHtmlAttr(s){
  return escapeHtml(String(s || '')).replace(/"/g, '&quot;');
}

function parseFenceInfo(info){
  const raw = String(info || '').trim();
  const parts = raw ? raw.split(/\s+/) : [];
  const lang = (parts.shift() || '').toLowerCase();
  return { raw, lang };
}

function renderCodeFence(info, body){
  const parsed = parseFenceInfo(info);
  const source = String(body || '').replace(/\n$/, '');
  return `<pre class="kivrio-fenced-code" data-code-lang="${escapeHtmlAttr(parsed.lang)}" data-code-info="${escapeHtmlAttr(parsed.raw)}"><code>${escapeHtml(source)}</code></pre>`;
}

function restoreMathToken(token){
  return typeof token === 'string' ? token : '';
}

function restoreCodeToken(token){
  if (token && token.type === 'fence') return renderCodeFence(token.info, token.body);
  return '';
}

function restoreVariationTableToken(token){
  return typeof token === 'string' ? token : '';
}

function saveEmbeddedVariationHtml(source, saveVariationTable){
  if (!source) return '';
  return String(source).replace(
    /<variation-table-html>([\s\S]*?)<\/variation-table-html>/gi,
    (_, html) => saveVariationTable(sanitizeSpecializedHtmlFragment(html)),
  );
}

function restoreSystemSolveToken(token){
  return typeof token === 'string' ? token : '';
}

function saveEmbeddedSystemHtml(source, saveSystemSolve){
  if (!source) return '';
  return String(source).replace(
    /<system-solve-html>([\s\S]*?)<\/system-solve-html>/gi,
    (_, html) => saveSystemSolve(sanitizeSpecializedHtmlFragment(html)),
  );
}

function restoreEquationSolveToken(token){
  return typeof token === 'string' ? token : '';
}

function saveEmbeddedEquationHtml(source, saveEquationSolve){
  if (!source) return '';
  return String(source).replace(
    /<equation-solve-html>([\s\S]*?)<\/equation-solve-html>/gi,
    (_, html) => saveEquationSolve(sanitizeSpecializedHtmlFragment(html)),
  );
}

function restoreDerivativeToken(token){
  return typeof token === 'string' ? token : '';
}

function saveEmbeddedDerivativeHtml(source, saveDerivative){
  if (!source) return '';
  return String(source).replace(
    /<derivative-html>([\s\S]*?)<\/derivative-html>/gi,
    (_, html) => saveDerivative(sanitizeSpecializedHtmlFragment(html)),
  );
}

function restoreLimitToken(token){
  return typeof token === 'string' ? token : '';
}

function saveEmbeddedLimitHtml(source, saveLimit){
  if (!source) return '';
  return String(source).replace(
    /<limit-html>([\s\S]*?)<\/limit-html>/gi,
    (_, html) => saveLimit(sanitizeSpecializedHtmlFragment(html)),
  );
}

function restoreIntegralToken(token){
  return typeof token === 'string' ? token : '';
}

function saveEmbeddedIntegralHtml(source, saveIntegral){
  if (!source) return '';
  return String(source).replace(
    /<integral-html>([\s\S]*?)<\/integral-html>/gi,
    (_, html) => saveIntegral(sanitizeSpecializedHtmlFragment(html)),
  );
}

function restoreOdeToken(token){
  return typeof token === 'string' ? token : '';
}

function saveEmbeddedOdeHtml(source, saveOde){
  if (!source) return '';
  return String(source).replace(
    /<ode-html>([\s\S]*?)<\/ode-html>/gi,
    (_, html) => saveOde(sanitizeSpecializedHtmlFragment(html)),
  );
}

function sanitizeSpecializedHtmlFragment(source){
  let html = String(source || '').trim();
  if (!html) return '';
  html = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
  html = html.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  html = html.replace(/\s(?:href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\1/gi, '');
  html = html.replace(/\s(?:href|src)\s*=\s*javascript:[^\s>]+/gi, '');
  return html.trim();
}

const SPECIALIZED_HTML_ONLY_RE = /^\s*(?:<variation-table-html>[\s\S]*<\/variation-table-html>|<system-solve-html>[\s\S]*<\/system-solve-html>|<equation-solve-html>[\s\S]*<\/equation-solve-html>|<derivative-html>[\s\S]*<\/derivative-html>|<limit-html>[\s\S]*<\/limit-html>|<integral-html>[\s\S]*<\/integral-html>|<ode-html>[\s\S]*<\/ode-html>)\s*$/i;

function isPythonFenceLanguage(lang){
  return ['python', 'py', 'pyodide'].includes(String(lang || '').toLowerCase());
}

function looksLikeMatplotlibPythonSource(source){
  const text = String(source || '').trim().toLowerCase();
  if (!text) return false;

  return [
    /\bimport\s+matplotlib\b/,
    /\bfrom\s+matplotlib\b/,
    /\bmatplotlib\.pyplot\b/,
    /\bplt\.(plot|scatter|bar|hist|imshow|figure|subplots|subplot|title|xlabel|ylabel|legend|grid|xlim|ylim|axhline|axvline|show|savefig)\b/,
    /\bfig\s*,\s*ax\s*=\s*plt\.subplots\b/,
  ].some((pattern) => pattern.test(text));
}

function isHydratablePythonFence(lang, source){
  const normalizedLang = String(lang || '').trim().toLowerCase();
  if (isPythonFenceLanguage(normalizedLang) || normalizedLang === 'python3') return true;
  if (normalizedLang) return false;
  return looksLikeMatplotlibPythonSource(source);
}

async function copyTextToClipboard(text){
  const value = String(text || '');
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const area = document.createElement('textarea');
  area.value = value;
  area.setAttribute('readonly', 'readonly');
  area.style.position = 'fixed';
  area.style.top = '-9999px';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  document.body.removeChild(area);
}

function cloneAttachments(attachments){
  return Array.isArray(attachments) ? attachments.map((item) => ({ ...item })) : [];
}

function bubbleMetaToOptions(meta){
  return {
    attachments: cloneAttachments(meta?.attachments),
    reasoningText: meta?.reasoningText ?? null,
    model: meta?.model ?? null,
    reasoningDurationMs: meta?.reasoningDurationMs ?? null,
    messageId: meta?.messageId ?? null,
    conversationId: meta?.conversationId ?? null,
    pyodideFinal: meta?.pyodideFinal !== false,
  };
}

function canEditMessage(container){
  const meta = container?.__kivrioMessageMeta;
  return Boolean(
    meta
    && meta.role === 'user'
    && meta.conversationId
    && meta.messageId != null
    && typeof window.kivrioSaveMessageEdit === 'function'
  );
}

function refreshMessageActionState(container){
  if (!(container instanceof HTMLElement)) return;
  const body = container.parentElement;
  if (!(body instanceof HTMLElement)) return;

  const copyButton = body.querySelector('.message-action-button[data-action="copy"]');
  if (copyButton instanceof HTMLButtonElement) {
    copyButton.disabled = !String(container.dataset.copyText || '').trim();
  }

  const editButton = body.querySelector('.message-action-button[data-action="edit"]');
  if (editButton instanceof HTMLButtonElement) {
    editButton.disabled = !canEditMessage(container) || body.classList.contains('is-editing');
  }
}

function syncBubbleMeta(container, role, text, options = {}){
  if (!(container instanceof HTMLElement)) return {};
  const previous = container.__kivrioMessageMeta || {};
  const next = {
    ...previous,
    role: String(role || previous.role || '').toLowerCase(),
    text: String(text ?? previous.text ?? ''),
    attachments: Object.prototype.hasOwnProperty.call(options, 'attachments')
      ? cloneAttachments(options.attachments)
      : cloneAttachments(previous.attachments),
    reasoningText: Object.prototype.hasOwnProperty.call(options, 'reasoningText')
      ? (options.reasoningText == null ? null : String(options.reasoningText))
      : (previous.reasoningText ?? null),
    model: Object.prototype.hasOwnProperty.call(options, 'model')
      ? (options.model == null ? null : String(options.model))
      : (previous.model ?? null),
    reasoningDurationMs: Object.prototype.hasOwnProperty.call(options, 'reasoningDurationMs')
      ? (Number(options.reasoningDurationMs || 0) || null)
      : (previous.reasoningDurationMs ?? null),
    messageId: Object.prototype.hasOwnProperty.call(options, 'messageId')
      ? (options.messageId ?? null)
      : (previous.messageId ?? null),
    conversationId: Object.prototype.hasOwnProperty.call(options, 'conversationId')
      ? (options.conversationId ? String(options.conversationId) : null)
      : (previous.conversationId ?? null),
    pyodideFinal: Object.prototype.hasOwnProperty.call(options, 'pyodideFinal')
      ? options.pyodideFinal !== false
      : (previous.pyodideFinal !== false),
  };

  container.__kivrioMessageMeta = next;
  container.dataset.role = next.role || '';
  if (next.messageId != null) {
    container.dataset.messageId = String(next.messageId);
  } else {
    delete container.dataset.messageId;
  }
  if (next.conversationId) {
    container.dataset.conversationId = next.conversationId;
  } else {
    delete container.dataset.conversationId;
  }
  refreshMessageActionState(container);
  return next;
}

function messageActionIcon(kind){
  if (kind === 'copy') {
    return ''
      + '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">'
      + '<rect x="9" y="9" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.7"/>'
      + '<path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'
      + '</svg>';
  }
  return ''
    + '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">'
    + '<path d="M4 15.5 15.2 4.3a2.1 2.1 0 0 1 3 0l1.5 1.5a2.1 2.1 0 0 1 0 3L8.5 20H4v-4.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>'
    + '<path d="m13.8 5.7 4.5 4.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'
    + '</svg>';
}

function flashActionLabel(button, nextLabel){
  if (!(button instanceof HTMLElement)) return;
  const original = button.dataset.originalLabel || button.dataset.label || '';
  if (!button.dataset.originalLabel) button.dataset.originalLabel = original;
  button.dataset.label = nextLabel;
  window.clearTimeout(button.__kivrioLabelTimer);
  button.__kivrioLabelTimer = window.setTimeout(() => {
    button.dataset.label = button.dataset.originalLabel || original;
  }, 1200);
}

let copyToastState = null;

function ensureCopyToast(){
  if (copyToastState?.element?.isConnected) return copyToastState;

  const element = document.createElement('div');
  element.className = 'copy-toast';
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  element.hidden = true;
  document.body.appendChild(element);

  copyToastState = {
    element,
    hideTimer: null,
    cleanupTimer: null,
  };
  return copyToastState;
}

function showCopyToast(message){
  const state = ensureCopyToast();
  const label = String(message || '').trim();
  if (!label) return;

  window.clearTimeout(state.hideTimer);
  window.clearTimeout(state.cleanupTimer);
  state.element.textContent = label;
  state.element.hidden = false;
  state.element.classList.remove('is-visible');

  window.requestAnimationFrame(() => {
    state.element.classList.add('is-visible');
  });

  state.hideTimer = window.setTimeout(() => {
    state.element.classList.remove('is-visible');
    state.cleanupTimer = window.setTimeout(() => {
      state.element.hidden = true;
    }, 220);
  }, 1500);
}

const MESSAGE_EDIT_MIN_WIDTH = 320;
const MESSAGE_EDIT_COMFORT_WIDTH = 42 * 16;
const MESSAGE_EDIT_VIEWPORT_MARGIN = 140;
let messageEditMeasureNode = null;

function resolveMessageEditMaxWidth(bubble){
  if (!(bubble instanceof HTMLElement)) return 0;
  const body = bubble.parentElement;
  const row = body?.parentElement;
  const bubbleWidth = Math.ceil(bubble.getBoundingClientRect().width || 0);
  const bodyWidth = Math.ceil(body?.getBoundingClientRect?.().width || 0);
  const rowWidth = Math.ceil(row?.getBoundingClientRect?.().width || 0);
  const viewportWidth = typeof window !== 'undefined'
    ? Math.max(0, Math.floor(window.innerWidth - MESSAGE_EDIT_VIEWPORT_MARGIN))
    : 0;
  const comfortWidth = Math.min(
    MESSAGE_EDIT_COMFORT_WIDTH,
    viewportWidth || MESSAGE_EDIT_COMFORT_WIDTH,
  );
  const availableWidth = Math.max(rowWidth, bodyWidth, bubbleWidth);
  if (comfortWidth > 0 && availableWidth > 0) return Math.min(comfortWidth, availableWidth);
  return comfortWidth || availableWidth;
}

function ensureMessageEditMeasureNode(){
  if (messageEditMeasureNode?.isConnected) return messageEditMeasureNode;
  const node = document.createElement('div');
  node.setAttribute('aria-hidden', 'true');
  node.style.position = 'fixed';
  node.style.left = '-9999px';
  node.style.top = '-9999px';
  node.style.visibility = 'hidden';
  node.style.pointerEvents = 'none';
  node.style.whiteSpace = 'pre';
  node.style.wordBreak = 'normal';
  node.style.overflowWrap = 'normal';
  document.body.appendChild(node);
  messageEditMeasureNode = node;
  return node;
}

function measureMessageEditLineWidth(textarea){
  if (!(textarea instanceof HTMLTextAreaElement)) return 0;

  const styles = window.getComputedStyle(textarea);
  const node = ensureMessageEditMeasureNode();
  const lines = String(textarea.value || '').split(/\r?\n/);
  const longestLine = lines.reduce((longest, line) => (
    line.length > longest.length ? line : longest
  ), '') || ' ';

  node.style.font = styles.font;
  node.style.fontKerning = styles.fontKerning;
  node.style.fontStretch = styles.fontStretch;
  node.style.fontVariant = styles.fontVariant;
  node.style.letterSpacing = styles.letterSpacing;
  node.style.textTransform = styles.textTransform;
  node.textContent = longestLine.replace(/ /g, '\u00A0');

  return Math.ceil(node.getBoundingClientRect().width);
}

function syncMessageEditorWidth(bubble, editor){
  if (!(bubble instanceof HTMLElement) || !editor?.shell || !editor.textarea) return;

  const body = bubble.parentElement;
  const availableWidth = Math.floor(
    Number(editor.maxWidth)
      || body?.getBoundingClientRect?.().width
      || bubble.getBoundingClientRect().width
      || 0
  );
  if (!availableWidth) return;

  const styles = window.getComputedStyle(editor.textarea);
  const horizontalInsets = [
    styles.paddingLeft,
    styles.paddingRight,
    styles.borderLeftWidth,
    styles.borderRightWidth,
  ].reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
  const contentWidth = measureMessageEditLineWidth(editor.textarea);
  const actionWidth = editor.actions instanceof HTMLElement ? editor.actions.scrollWidth : 0;
  const targetWidth = Math.min(
    availableWidth,
    Math.max(
      Math.min(MESSAGE_EDIT_MIN_WIDTH, availableWidth),
      contentWidth + horizontalInsets + 24,
      actionWidth + 32,
    ),
  );

  editor.shell.style.width = `${Math.ceil(targetWidth)}px`;
}

function bindMessageEditorAutoWidth(bubble, editor, initialMaxWidth = 0){
  if (!(bubble instanceof HTMLElement) || !editor?.textarea || !editor?.shell) {
    return () => {};
  }

  const body = bubble.parentElement;
  const row = body?.parentElement;
  const bubbleWidth = Math.ceil(initialMaxWidth || bubble.getBoundingClientRect().width || 0);
  editor.initialMaxWidth = bubbleWidth;
  editor.maxWidth = bubbleWidth;

  const sync = () => syncMessageEditorWidth(bubble, editor);
  const handleWindowResize = () => {
    const rowWidth = Math.ceil(row?.getBoundingClientRect?.().width || editor.initialMaxWidth || 0);
    const nextAvailableWidth = Math.min(editor.initialMaxWidth || rowWidth, rowWidth || editor.initialMaxWidth || 0);
    if (nextAvailableWidth > 0) {
      editor.maxWidth = nextAvailableWidth;
    }
    sync();
  };

  let resizeObserver = null;
  if (typeof window.ResizeObserver === 'function' && row instanceof HTMLElement) {
    resizeObserver = new window.ResizeObserver(() => {
      const rowWidth = Math.ceil(row.getBoundingClientRect().width || editor.initialMaxWidth || 0);
      const nextAvailableWidth = Math.min(editor.initialMaxWidth || rowWidth, rowWidth || editor.initialMaxWidth || 0);
      if (nextAvailableWidth > 0) {
        editor.maxWidth = nextAvailableWidth;
      }
      sync();
    });
    resizeObserver.observe(row);
  }

  editor.textarea.addEventListener('input', sync);
  window.addEventListener('resize', handleWindowResize);
  window.requestAnimationFrame(sync);

  return () => {
    editor.textarea.removeEventListener('input', sync);
    window.removeEventListener('resize', handleWindowResize);
    resizeObserver?.disconnect();
  };
}

let activeMessageEditor = null;

function finishMessageEditing(bubble){
  if (!(bubble instanceof HTMLElement)) return;
  const body = bubble.parentElement;
  if (body instanceof HTMLElement) body.classList.remove('is-editing');
  delete bubble.dataset.editing;
  if (activeMessageEditor?.bubble === bubble) {
    try { activeMessageEditor.cleanupAutoWidth?.(); } catch (_) {}
    activeMessageEditor = null;
  }
  refreshMessageActionState(bubble);
}

function restoreMessageBubble(bubble){
  if (!(bubble instanceof HTMLElement)) return;
  const meta = bubble.__kivrioMessageMeta || {};
  finishMessageEditing(bubble);
  updateBubbleContent(bubble, meta.role || 'user', meta.text || '', bubbleMetaToOptions(meta));
}

function cancelActiveMessageEdit(){
  if (!activeMessageEditor?.bubble) return;
  restoreMessageBubble(activeMessageEditor.bubble);
}

function createMessageEditor(initialText){
  const shell = document.createElement('div');
  shell.className = 'message-edit-shell';

  const textarea = document.createElement('textarea');
  textarea.className = 'message-edit-textarea';
  textarea.value = String(initialText || '');
  textarea.rows = Math.max(3, textarea.value.split(/\r?\n/).length || 1);
  textarea.setAttribute('aria-label', 'Modifier le message');

  const footer = document.createElement('div');
  footer.className = 'message-edit-footer';

  const status = document.createElement('div');
  status.className = 'message-edit-status';
  status.setAttribute('aria-live', 'polite');

  const actions = document.createElement('div');
  actions.className = 'message-edit-actions';

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'message-edit-button';
  cancelButton.textContent = 'Annuler';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'message-edit-button is-primary';
  saveButton.textContent = 'Enregistrer';

  actions.append(cancelButton, saveButton);
  footer.append(status, actions);
  shell.append(textarea, footer);

  return { shell, textarea, status, cancelButton, saveButton };
}

async function handleMessageEditSave(bubble, editor){
  if (!(bubble instanceof HTMLElement) || !editor) return;
  const meta = bubble.__kivrioMessageMeta || {};
  const nextText = String(editor.textarea.value || '').trim();
  const hasAttachments = Array.isArray(meta.attachments) && meta.attachments.length > 0;
  if (!nextText && !hasAttachments) {
    editor.status.textContent = 'Le message ne peut pas etre vide.';
    editor.textarea.focus();
    return;
  }

  if (nextText === String(meta.text || '').trim()) {
    restoreMessageBubble(bubble);
    return;
  }

  if (typeof window.kivrioSaveMessageEdit !== 'function') {
    editor.status.textContent = 'Modification indisponible.';
    return;
  }

  editor.saveButton.disabled = true;
  editor.cancelButton.disabled = true;
  editor.textarea.disabled = true;
  editor.status.textContent = 'Regeneration...';

  try {
    await window.kivrioSaveMessageEdit({
      conversationId: meta.conversationId,
      messageId: meta.messageId,
      content: nextText,
    });
    if (activeMessageEditor?.bubble === bubble) {
      try { activeMessageEditor.cleanupAutoWidth?.(); } catch (_) {}
      activeMessageEditor = null;
    }
  } catch (error) {
    editor.status.textContent = error?.message || 'Modification impossible.';
    editor.saveButton.disabled = false;
    editor.cancelButton.disabled = false;
    editor.textarea.disabled = false;
    editor.textarea.focus();
  }
}

function beginMessageEdit(bubble){
  if (!(bubble instanceof HTMLElement) || !canEditMessage(bubble)) return;
  if (activeMessageEditor?.bubble === bubble) return;
  cancelActiveMessageEdit();

  const meta = bubble.__kivrioMessageMeta || {};
  const body = bubble.parentElement;
  if (!(body instanceof HTMLElement)) return;
  const maxEditorWidth = resolveMessageEditMaxWidth(bubble);

  const editor = createMessageEditor(meta.text || '');
  body.classList.add('is-editing');
  bubble.dataset.editing = 'true';
  bubble.innerHTML = '';
  bubble.appendChild(editor.shell);
  appendMessageAttachments(bubble, meta.attachments || []);

  const cancel = () => restoreMessageBubble(bubble);
  const save = () => handleMessageEditSave(bubble, editor);

  editor.cancelButton.addEventListener('click', cancel);
  editor.saveButton.addEventListener('click', save);
  editor.textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      save();
    }
  });

  const cleanupAutoWidth = bindMessageEditorAutoWidth(bubble, editor, maxEditorWidth);
  activeMessageEditor = { bubble, cleanupAutoWidth };
  editor.textarea.focus();
  const length = editor.textarea.value.length;
  editor.textarea.setSelectionRange(length, length);
}

function createMessageActionButton(action, label, bubble){
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `message-action-button is-${action}`;
  button.dataset.action = action;
  button.dataset.label = label;
  button.dataset.originalLabel = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = messageActionIcon(action);

  if (action === 'copy') {
    button.addEventListener('click', async () => {
      const copyText = String(bubble?.dataset.copyText || '').trim();
      if (!copyText) return;
      try {
        await copyTextToClipboard(copyText);
        flashActionLabel(button, 'Copie');
        const role = String(bubble?.dataset.role || bubble?.__kivrioMessageMeta?.role || '').toLowerCase();
        showCopyToast(
          role === 'assistant'
            ? 'La r\u00E9ponse a \u00E9t\u00E9 copi\u00E9e'
            : 'Le message a \u00E9t\u00E9 copi\u00E9'
        );
      } catch (_) {
        flashActionLabel(button, 'Echec');
      }
    });
  } else if (action === 'edit') {
    button.addEventListener('click', () => {
      beginMessageEdit(bubble);
    });
  }

  return button;
}

function createMessageActions(role, bubble){
  if (!(bubble instanceof HTMLElement)) return null;
  if (role !== 'user' && role !== 'assistant') return null;

  const actions = document.createElement('div');
  actions.className = `message-actions ${role === 'assistant' ? 'is-persistent' : 'is-hover'}`;

  if (role === 'user') {
    actions.append(
      createMessageActionButton('edit', 'Modifier', bubble),
      createMessageActionButton('copy', 'Copier', bubble),
    );
  } else {
    actions.append(createMessageActionButton('copy', 'Copier', bubble));
  }

  refreshMessageActionState(bubble);
  return actions;
}

let imageViewerState = null;

function closeImageViewer(){
  const state = imageViewerState;
  if (!state?.overlay) return;
  state.overlay.hidden = true;
  state.image.removeAttribute('src');
  document.body.classList.remove('kivrio-image-viewer-open');
  if (state.activeTrigger instanceof HTMLElement) {
    state.activeTrigger.focus();
  }
  state.activeTrigger = null;
}

function ensureImageViewer(){
  if (imageViewerState?.overlay?.isConnected) return imageViewerState;

  const overlay = document.createElement('div');
  overlay.className = 'image-viewer-overlay';
  overlay.hidden = true;

  const frame = document.createElement('div');
  frame.className = 'image-viewer-frame';

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'image-viewer-close';
  closeButton.setAttribute('aria-label', 'Fermer l image');
  closeButton.innerHTML = ''
    + '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">'
    + '<path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
    + '</svg>';

  const image = document.createElement('img');
  image.className = 'image-viewer-image';
  image.alt = 'Graphique agrandi';

  closeButton.addEventListener('click', closeImageViewer);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeImageViewer();
  });

  frame.append(closeButton, image);
  overlay.appendChild(frame);
  document.body.appendChild(overlay);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.hidden) {
      event.preventDefault();
      closeImageViewer();
    }
  });

  imageViewerState = {
    overlay,
    frame,
    image,
    closeButton,
    activeTrigger: null,
  };
  return imageViewerState;
}

function openImageViewer(src, alt, trigger){
  if (!String(src || '').trim()) return;
  const state = ensureImageViewer();
  state.image.src = String(src || '');
  state.image.alt = String(alt || 'Graphique agrandi');
  state.activeTrigger = trigger instanceof HTMLElement ? trigger : null;
  state.overlay.hidden = false;
  document.body.classList.add('kivrio-image-viewer-open');
  state.closeButton.focus();
}

function normalizeTableCellText(value){
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stripWrappedMathDelimiters(value){
  let text = normalizeTableCellText(value);
  let changed = true;
  while (changed) {
    changed = false;
    if (text.startsWith('\\(') && text.endsWith('\\)')) {
      text = text.slice(2, -2).trim();
      changed = true;
    } else if (text.startsWith('\\[') && text.endsWith('\\]')) {
      text = text.slice(2, -2).trim();
      changed = true;
    } else if (text.startsWith('$$') && text.endsWith('$$')) {
      text = text.slice(2, -2).trim();
      changed = true;
    } else if (text.startsWith('$') && text.endsWith('$')) {
      text = text.slice(1, -1).trim();
      changed = true;
    }
  }
  return text;
}

function parseLatexTableBlock(inner){
  const match = String(inner || '').match(/\\begin\{(array|tabular)\}(\{[^}]*\})?([\s\S]*?)\\end\{\1\}/);
  if (!match) return null;
  const rows = match[3]
    .replace(/\\hline/g, '')
    .split(/\\\\/)
    .map(row => row.trim())
    .filter(Boolean)
    .map(row => row.split('&').map(cell => cell.trim()));
  return rows.length ? padTableRows(rows) : null;
}

function padTableRows(rows){
  const maxCols = Math.max(0, ...rows.map(row => row.length));
  return rows.map(row => {
    const next = row.slice();
    while (next.length < maxCols) next.push('');
    return next;
  });
}

function rowsToGfm(rows){
  if (!rows || !rows.length) return '';
  const paddedRows = padTableRows(rows);
  const header = paddedRows[0];
  const sep = Array(header.length).fill('---');
  return [
    `| ${header.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...paddedRows.slice(1).map(row => `| ${row.join(' | ')} |`)
  ].join('\n');
}

function transformLatexTables(source){
  if (!source) return '';
  const transformBlock = (match, inner) => {
    const rows = parseLatexTableBlock(inner);
    if (!rows) return match;
    return `\n${rowsToGfm(rows)}\n`;
  };

  return String(source)
    .replace(/\$\$([\s\S]*?)\$\$/g, transformBlock)
    .replace(/\\\[([\s\S]*?)\\\]/g, transformBlock);
}

// --- GFM tables → HTML ---
const RE_GFM_ROW = /^\s*\|.*\|\s*$/;
const RE_GFM_SEP = /^\s*\|?\s*:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)*\s*\|?\s*$/;

function splitCells(line){
  return line.trim().replace(/^\|/,'').replace(/\|$/,'')
    .split('|').map(c => c.trim());
}

function parseAlign(sepCells){
  // :--- left, :---: center, ---: right, --- default
  return sepCells.map(c => {
    const hasLeft = c.startsWith(':');
    const hasRight = c.endsWith(':');
    if(hasLeft && hasRight) return 'center';
    if(hasRight) return 'right';
    if(hasLeft) return 'left';
    return ''; // défaut (CSS)
  });
}

function buildTableHTML(headerCells, bodyRows, align){
  let html = '<table class="markdown-table"><thead><tr>';
  for(let i=0;i<headerCells.length;i++){
    const a = align[i] || '';
    const style = a ? ` style="text-align:${a}"` : '';
    html += `<th${style}>${escapeHtml(headerCells[i])}</th>`;
  }
  html += '</tr></thead><tbody>';
  for(const row of bodyRows){
    html += '<tr>';
    for(let i=0;i<headerCells.length;i++){
      const cell = row[i] ?? '';
      const a = align[i] || '';
      const style = a ? ` style="text-align:${a}"` : '';
      html += `<td${style}>${escapeHtml(cell)}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

function convertGfmTablesToHtml(text){
  const lines = text.split(/\r?\n/);
  const out = [];
  for(let i=0; i<lines.length; i++){
    const line = lines[i];
    // Détecte: header row + sep + (rows…)
    if(RE_GFM_ROW.test(line) && i+1 < lines.length && RE_GFM_SEP.test(lines[i+1])){
      const headerLine = line;
      const sepLine = lines[i+1];
      i += 2;
      const body = [];
      while(i < lines.length && RE_GFM_ROW.test(lines[i])){
        body.push(lines[i]);
        i++;
      }
      i--; // on est allé une ligne trop loin
      const headerCells = splitCells(headerLine);
      const sepCells = splitCells(sepLine);
      const align = parseAlign(sepCells);
      const bodyRows = body.map(splitCells);
      out.push(buildTableHTML(headerCells, bodyRows, align));
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

/**
 * Rendu Markdown "maison" :
 *  - Protège \\(...\\), \\[...\\], $$...$$ et ```...``` pour ne pas casser les maths/code.
 *  - Convertit uniquement ce qui nous intéresse (titres, listes, quotes, emphase, code inline, paragraphes).
 *  - Rend un conteneur `<div class="markdown-body">...</div>`.
 */
function renderMarkdown(src, options = {}){
  if(!src) return '';

  let s = String(src);
  const allowSpecializedHtml = options.allowSpecializedHtml === true || SPECIALIZED_HTML_ONLY_RE.test(s);
  
  // Oriente d'abord les tableaux LaTeX vers le rendu adapte

  // 2.1 Sauvegarde provisoire: maths (\(...\), \[...\], $$...$$) et fences ```...```
  const codeTokens = [];
  const mathTokens = [];
  const variationTableTokens = [];
  const systemSolveTokens = [];
  const equationSolveTokens = [];
  const derivativeTokens = [];
  const limitTokens = [];
  const integralTokens = [];
  const odeTokens = [];
  const saveCode = (token) => {
    const marker = `@@CODE_${codeTokens.length}@@`;
    codeTokens.push(token);
    return marker;
  };
  const saveMath = (token) => {
    const marker = `@@MATH_${mathTokens.length}@@`;
    mathTokens.push(token);
    return marker;
  };
  const saveVariationTable = (token) => {
    const marker = `@@VAR_TABLE_${variationTableTokens.length}@@`;
    variationTableTokens.push(token);
    return marker;
  };
  const saveSystemSolve = (token) => {
    const marker = `@@SYSTEM_SOLVE_${systemSolveTokens.length}@@`;
    systemSolveTokens.push(token);
    return marker;
  };
  const saveEquationSolve = (token) => {
    const marker = `@@EQ_SOLVE_${equationSolveTokens.length}@@`;
    equationSolveTokens.push(token);
    return marker;
  };
  const saveDerivative = (token) => {
    const marker = `@@DERIVATIVE_${derivativeTokens.length}@@`;
    derivativeTokens.push(token);
    return marker;
  };
  const saveLimit = (token) => {
    const marker = `@@LIMIT_${limitTokens.length}@@`;
    limitTokens.push(token);
    return marker;
  };
  const saveIntegral = (token) => {
    const marker = `@@INTEGRAL_${integralTokens.length}@@`;
    integralTokens.push(token);
    return marker;
  };
  const saveOde = (token) => {
    const marker = `@@ODE_${odeTokens.length}@@`;
    odeTokens.push(token);
    return marker;
  };

  // Maths déjà normalisées: \(...\), \[...\]
  // Par sécurité: $$...$$ (au cas où un texte non-normalisé arrive ici)

  // Fences de code
  s = s.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_, info, body) => {
    const parsed = parseFenceInfo(info);
    if (['math', 'latex'].includes(parsed.lang)) {
      return `\\[${String(body || '').trim()}\\]`;
    }
    return saveCode({ type: 'fence', info, body });
  });

  // 2.2 Échapper le HTML restant
  if (allowSpecializedHtml) {
    s = saveEmbeddedVariationHtml(s, saveVariationTable);
    s = saveEmbeddedSystemHtml(s, saveSystemSolve);
    s = saveEmbeddedEquationHtml(s, saveEquationSolve);
    s = saveEmbeddedDerivativeHtml(s, saveDerivative);
    s = saveEmbeddedLimitHtml(s, saveLimit);
    s = saveEmbeddedIntegralHtml(s, saveIntegral);
    s = saveEmbeddedOdeHtml(s, saveOde);
  }
  s = transformLatexTables(s);
  s = normalizeLatex(s);
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, saveMath);
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, saveMath);
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, saveMath);
  s = escapeHtml(s);
  
  // Supprimer totalement les séparateurs Markdown (aucune ligne affichée)
  s = s.replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '');

  // 2.3 Titres (#, ##, ###) — tolère espaces en début de ligne
  s = s
    .replace(/^\s*######\s+(.+)$/gm, '<h6>$1</h6>')
    .replace(/^\s*#####\s+(.+)$/gm, '<h5>$1</h5>')
    .replace(/^\s*####\s+(.+)$/gm, '<h4>$1</h4>')
    .replace(/^\s*###\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^\s*##\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^\s*#\s+(.+)$/gm, '<h1>$1</h1>');

  // 2.4 Blockquotes
  s = s.replace(/^(?:\s*>\s.*\n?)+/gm, block => {
    const html = block.trim().split(/\n/).map(l => l.replace(/^\s*>\s?/, '')).join('<br>');
    return `<blockquote>${html}</blockquote>`;
  });

  // 2.5 Listes à puces (-, * , +)
  s = s.replace(
    /(?:^(?:\s*[-*+]\s+.+)\n?)+/gm,
    block => {
      const items = block.trim().split(/\n/).map(l => l.replace(/^\s*[-*+]\s+/, '').trim());
      return `<ul>${items.map(it => `<li>${it}</li>`).join('')}</ul>`;
    }
  );
  
  s = convertGfmTablesToHtml(s); // 2.6bis Tables GFM → HTML

  // 2.6 Gras / italique / code inline
  s = s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>');
		
  // 2.7 Paragraphes : regrouper ce qui n'est pas déjà un bloc HTML connu
  const BLOCK_START = /^(<h\d|<ul>|<pre>|<blockquote>|<table|<thead|<tbody|<tr|@@(?:CODE|MATH|VAR_TABLE|SYSTEM_SOLVE|EQ_SOLVE|DERIVATIVE|LIMIT|INTEGRAL|ODE)_)/;
  s = s
    .split(/\n{2,}/)
    .map(chunk => {
      const t = chunk.trim();
      if (!t) return '';
      return BLOCK_START.test(t) ? t : `<p>${t.replace(/\n/g,'<br>')}</p>`;
    })
    .join('\n');

  // 2.8 Réinsertion des tokens (maths + fences)
  s = s.replace(/@@MATH_(\d+)@@/g, (_, i)=> restoreMathToken(mathTokens[Number(i)]));
  s = s.replace(/@@CODE_(\d+)@@/g, (_, i)=> restoreCodeToken(codeTokens[Number(i)]));
  s = s.replace(/@@VAR_TABLE_(\d+)@@/g, (_, i)=> restoreVariationTableToken(variationTableTokens[Number(i)]));
  s = s.replace(/@@SYSTEM_SOLVE_(\d+)@@/g, (_, i)=> restoreSystemSolveToken(systemSolveTokens[Number(i)]));
  s = s.replace(/@@EQ_SOLVE_(\d+)@@/g, (_, i)=> restoreEquationSolveToken(equationSolveTokens[Number(i)]));
  s = s.replace(/@@DERIVATIVE_(\d+)@@/g, (_, i)=> restoreDerivativeToken(derivativeTokens[Number(i)]));
  s = s.replace(/@@LIMIT_(\d+)@@/g, (_, i)=> restoreLimitToken(limitTokens[Number(i)]));
  s = s.replace(/@@INTEGRAL_(\d+)@@/g, (_, i)=> restoreIntegralToken(integralTokens[Number(i)]));
  s = s.replace(/@@ODE_(\d+)@@/g, (_, i)=> restoreOdeToken(odeTokens[Number(i)]));

  return `<div class="markdown-body">${s}</div>`;
}

function splitLegacyThinkTaggedText(text){
  const raw = String(text || '');
  const pattern = /<think>([\s\S]*?)(?:<\/think>|$)/gi;
  const reasoningParts = [];
  const answerParts = [];
  let match;
  let cursor = 0;
  let hasReasoning = false;

  while ((match = pattern.exec(raw)) !== null) {
    hasReasoning = true;
    const start = match.index;
    answerParts.push(raw.slice(cursor, start));
    reasoningParts.push(match[1] || '');
    cursor = pattern.lastIndex;
    if (!match[0].toLowerCase().includes('</think>')) break;
  }

  if (!hasReasoning) {
    return {
      reasoningText: '',
      answerText: raw,
    };
  }

  answerParts.push(raw.slice(cursor));
  const reasoningText = reasoningParts.join('\n\n').trim();
  return {
    reasoningText,
    answerText: answerParts.join('').replace(/^\s+/, ''),
  };
}

function resolveAssistantDisplayPayload(text, options = {}){
  const explicitAnswerText = options.answerText == null ? String(text || '') : String(options.answerText);
  const explicitReasoningText = options.reasoningText == null ? '' : String(options.reasoningText).trim();
  if (explicitReasoningText) {
    return {
      answerText: explicitAnswerText,
      reasoningText: explicitReasoningText,
      hasReasoning: true,
    };
  }

  const legacy = splitLegacyThinkTaggedText(explicitAnswerText);
  return {
    answerText: legacy.answerText,
    reasoningText: legacy.reasoningText,
    hasReasoning: !!legacy.reasoningText,
  };
}

function formatReasoningDuration(durationMs){
  const ms = Number(durationMs || 0);
  if (!Number.isFinite(ms) || ms <= 0) return '';

  let totalSeconds = Math.max(1, Math.round(ms / 1000));
  const parts = [];

  if (totalSeconds >= 3600) {
    const hours = Math.floor(totalSeconds / 3600);
    totalSeconds -= hours * 3600;
    parts.push(`${hours} heure${hours > 1 ? 's' : ''}`);
  }

  if (totalSeconds >= 60) {
    const minutes = Math.floor(totalSeconds / 60);
    totalSeconds -= minutes * 60;
    parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
  }

  if (totalSeconds > 0 || parts.length === 0) {
    parts.push(`${totalSeconds} seconde${totalSeconds > 1 ? 's' : ''}`);
  }

  return `en ${parts.join(' ')}`;
}

function renderMarkdownBlock(container, text, options = {}){
  const content = String(text || '').trim();
  if (!content) return false;
  container.innerHTML = renderMarkdown(content, options);
  return true;
}

function toggleReasoningPanel(button, panel, expanded){
  const next = Boolean(expanded);
  button.setAttribute('aria-expanded', next ? 'true' : 'false');
  panel.hidden = !next;
}

function renderMathBlocks(container){
  if (!window.kivrioRenderMath) return;
  const targets = [...container.querySelectorAll('.markdown-body')];
  if (targets.length === 0 && container.childElementCount === 0 && container.textContent.trim()) {
    targets.push(container);
  }
  for (const target of targets) {
    try { window.kivrioRenderMath(target); } catch (e) { console.warn('kivrioRenderMath error:', e); }
  }
}

function setPyodideCodeExpanded(codeBody, closeButton, openButton, expanded){
  const isExpanded = Boolean(expanded);
  codeBody.hidden = !isExpanded;
  closeButton.hidden = !isExpanded;
  openButton.hidden = isExpanded;
}

function appendOutputSection(container, labelText, value, className){
  const content = String(value || '').trim();
  if (!content) return;

  const section = document.createElement('div');
  section.className = `pyodide-output-section ${className}`.trim();

  const label = document.createElement('div');
  label.className = 'pyodide-output-label';
  label.textContent = labelText;

  const pre = document.createElement('pre');
  pre.className = 'pyodide-output-text';
  pre.textContent = content;

  section.append(label, pre);
  container.appendChild(section);
}

function renderPyodideResult(resultCard, result){
  resultCard.classList.remove('is-loading', 'is-error');
  resultCard.innerHTML = '';

  const resultBody = document.createElement('div');
  resultBody.className = 'pyodide-result-body';

  const title = document.createElement('div');
  title.className = 'pyodide-result-title';
  title.textContent = 'Resultat';
  resultBody.appendChild(title);

  const images = Array.isArray(result.images) ? result.images.filter(Boolean) : [];
  if (images.length) {
    const gallery = document.createElement('div');
    gallery.className = 'pyodide-image-gallery';
    for (const image of images) {
      const figure = document.createElement('figure');
      figure.className = 'pyodide-image-frame';
      figure.tabIndex = 0;
      figure.setAttribute('role', 'button');
      figure.setAttribute('aria-label', 'Ouvrir le graphique en grand');
      const img = document.createElement('img');
      img.src = image.dataUrl || '';
      img.alt = 'Sortie matplotlib';
      figure.addEventListener('click', () => openImageViewer(img.src, img.alt, figure));
      figure.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openImageViewer(img.src, img.alt, figure);
        }
      });
      figure.appendChild(img);
      gallery.appendChild(figure);
    }
    resultBody.appendChild(gallery);
  }

  appendOutputSection(resultBody, 'Sortie', result.stdout, 'is-stdout');
  appendOutputSection(resultBody, 'Avertissements', result.stderr, 'is-stderr');
  appendOutputSection(resultBody, 'Erreur', result.error, 'is-error');

  if (!images.length && !String(result.stdout || '').trim() && !String(result.stderr || '').trim() && !String(result.error || '').trim()) {
    const empty = document.createElement('div');
    empty.className = 'pyodide-output-empty';
    empty.textContent = 'Execution terminee sans resultat visible.';
    resultBody.appendChild(empty);
  }

  if (result.status === 'error' || String(result.error || '').trim()) {
    resultCard.classList.add('is-error');
  }

  resultCard.appendChild(resultBody);
  renderMathBlocks(resultCard);
}

async function hydratePyodideBlock(pre){
  const lang = pre.dataset.codeLang || '';
  const code = pre.querySelector('code')?.textContent || pre.textContent || '';
  if (!isHydratablePythonFence(lang, code)) return;
  if (pre.closest('.pyodide-inline-block')) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'pyodide-inline-block';

  const codeCard = document.createElement('div');
  codeCard.className = 'pyodide-code-card';

  const header = document.createElement('div');
  header.className = 'pyodide-code-header';

  const langLabel = document.createElement('span');
  langLabel.className = 'pyodide-code-lang';
  langLabel.textContent = lang || 'python';

  const actions = document.createElement('div');
  actions.className = 'pyodide-code-actions';

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'pyodide-code-action';
  closeButton.textContent = 'Fermer';

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'pyodide-code-action';
  openButton.textContent = 'Ouvrir';

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'pyodide-code-action';
  copyButton.textContent = 'Copier';

  const codeBody = document.createElement('div');
  codeBody.className = 'pyodide-code-body';

  const resultCard = document.createElement('div');
  resultCard.className = 'pyodide-result-card is-loading';
  resultCard.innerHTML = '<div class="pyodide-result-loading">Execution Pyodide en cours...</div>';

  closeButton.addEventListener('click', () => setPyodideCodeExpanded(codeBody, closeButton, openButton, false));
  openButton.addEventListener('click', () => setPyodideCodeExpanded(codeBody, closeButton, openButton, true));
  copyButton.addEventListener('click', async () => {
    const original = copyButton.textContent;
    try {
      await copyTextToClipboard(code);
      copyButton.textContent = 'Copie';
    } catch (_) {
      copyButton.textContent = 'Echec copie';
    }
    window.setTimeout(() => {
      copyButton.textContent = original;
    }, 1200);
  });

  actions.append(closeButton, openButton, copyButton);
  header.append(langLabel, actions);

  const parent = pre.parentNode;
  if (!parent) return;

  parent.replaceChild(wrapper, pre);
  codeBody.appendChild(pre);
  codeCard.append(header, codeBody);
  wrapper.append(codeCard, resultCard);
  setPyodideCodeExpanded(codeBody, closeButton, openButton, true);

  try {
    const result = await runPython(code);
    renderPyodideResult(resultCard, result);
  } catch (error) {
    renderPyodideResult(resultCard, {
      status: 'error',
      stdout: '',
      stderr: '',
      error: error?.message || 'Execution Pyodide impossible.',
      images: [],
    });
  }
}

function hydratePyodideBlocks(container){
  const blocks = [...container.querySelectorAll('pre.kivrio-fenced-code[data-code-lang]')];
  for (const block of blocks) {
    hydratePyodideBlock(block);
  }
}

export function updateBubbleContent(container, role, text, options = {}){
  if (!(container instanceof HTMLElement)) return;

  const preservedExpanded = container.dataset.reasoningExpanded === 'true';
  const meta = syncBubbleMeta(container, role, text, options);
  container.innerHTML = '';
  delete container.dataset.reasoningExpanded;

  if (role === 'assistant') {
    const payload = resolveAssistantDisplayPayload(text, options);
    container.dataset.copyText = payload.answerText || '';
    if (payload.hasReasoning) {
      const group = document.createElement('div');
      group.className = 'assistant-response';

      const reasoningWrap = document.createElement('div');
      reasoningWrap.className = 'assistant-reasoning';

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'assistant-reasoning-toggle';

      const label = document.createElement('span');
      label.className = 'assistant-reasoning-label';
      const durationLabel = formatReasoningDuration(options.reasoningDurationMs);
      label.textContent = durationLabel
        ? `Raisonnement du modele ${durationLabel}`
        : 'Raisonnement du modele';

      const chevron = document.createElement('span');
      chevron.className = 'assistant-reasoning-chevron';

      toggle.append(label, chevron);

      const panel = document.createElement('div');
      panel.className = 'assistant-reasoning-panel';
      renderMarkdownBlock(panel, payload.reasoningText, { allowSpecializedHtml: false });

      toggle.addEventListener('click', () => {
        const next = toggle.getAttribute('aria-expanded') !== 'true';
        container.dataset.reasoningExpanded = next ? 'true' : 'false';
        toggleReasoningPanel(toggle, panel, next);
      });

      toggleReasoningPanel(toggle, panel, preservedExpanded);
      container.dataset.reasoningExpanded = preservedExpanded ? 'true' : 'false';
      reasoningWrap.append(toggle, panel);
      group.appendChild(reasoningWrap);

      const answerWrap = document.createElement('div');
      answerWrap.className = 'assistant-answer';
      if (renderMarkdownBlock(answerWrap, payload.answerText, { allowSpecializedHtml: options.allowSpecializedHtml === true })) {
        if (options.pyodideFinal !== false) hydratePyodideBlocks(answerWrap);
        group.appendChild(answerWrap);
      }

      container.appendChild(group);
      appendMessageAttachments(container, options.attachments || []);
      renderMathBlocks(container);
      refreshMessageActionState(container);
      return;
    }

    if (renderMarkdownBlock(container, payload.answerText, { allowSpecializedHtml: options.allowSpecializedHtml === true })) {
      if (options.pyodideFinal !== false) hydratePyodideBlocks(container);
      appendMessageAttachments(container, options.attachments || []);
      renderMathBlocks(container);
      refreshMessageActionState(container);
      return;
    }
  }

  const hasText = !!String(text || '').trim();
  container.dataset.copyText = String(text || '');
  if (hasText) {
    container.innerHTML = renderMarkdown(text);
  }
  appendMessageAttachments(container, meta.attachments || []);
  renderMathBlocks(container);
  refreshMessageActionState(container);
}

/* -----------------------------------------------------------
 * 3) Montage / nettoyage du journal
 * ----------------------------------------------------------- */
export function ensureLog(){
  let log = qs('#chat-log');
  if(!log){
    log = document.createElement('div');
    log.id = 'chat-log';
    log.className = 'chat-log';

    const center = qs('.center');
    if(center){
      center.appendChild(log);
    }else{
      document.body.appendChild(log);
    }
  }
  return log;
}

function formatBytes(bytes){
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} o`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} Ko`;
  return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} Mo`;
}

function attachmentLabel(name){
  const parts = String(name || '').split('.');
  return (parts.length > 1 ? parts.at(-1) : 'FILE').slice(0, 4).toUpperCase();
}

function appendMessageAttachments(container, attachments){
  if(!Array.isArray(attachments) || attachments.length === 0) return;

  const wrap = document.createElement('div');
  wrap.className = 'message-attachments';

  for(const attachment of attachments){
    const href = attachment.url || attachment.previewUrl || '';
    const card = document.createElement(href ? 'a' : 'div');
    card.className = 'attachment-card';
    if(href){
      card.href = href;
      card.target = '_blank';
      card.rel = 'noreferrer';
    }

    const preview = document.createElement('div');
    preview.className = 'attachment-preview';
    if(attachment.isImage && (attachment.previewUrl || attachment.url)){
      preview.classList.add('is-image');
      const img = new Image();
      img.src = attachment.previewUrl || attachment.url;
      img.alt = attachment.filename || 'Piece jointe';
      preview.appendChild(img);
    }else{
      preview.classList.add('is-file');
      const label = document.createElement('span');
      label.textContent = attachmentLabel(attachment.filename);
      preview.appendChild(label);
    }

    const meta = document.createElement('div');
    meta.className = 'attachment-meta';

    const name = document.createElement('div');
    name.className = 'attachment-name';
    name.textContent = attachment.filename || 'Piece jointe';

    const kind = document.createElement('div');
    kind.className = 'attachment-kind';
    kind.textContent = attachment.isImage ? 'Image jointe' : (attachment.mimeType || 'Fichier joint');

    const detail = document.createElement('div');
    detail.className = 'attachment-detail';
    detail.textContent = formatBytes(attachment.sizeBytes || 0);

    meta.append(name, kind, detail);
    card.append(preview, meta);
    wrap.appendChild(card);
  }

  container.appendChild(wrap);
}

/* -----------------------------------------------------------
 * 4) Rendu d'un message (user/assistant)
 * ----------------------------------------------------------- */
export function renderMsg(role, text, options = {}){
  const log = ensureLog();

  const row = document.createElement('div');
  row.className = 'msg ' + (role === 'user' ? 'user' : 'assistant');

  const r = document.createElement('div');
  r.className = 'role';
  const assistantModel = String(options.model || '').trim();
  r.textContent = (role === 'user' ? 'Vous' : (assistantModel || 'Modele inconnu'));

  const b = document.createElement('div');
  b.className = 'bubble';

  updateBubbleContent(b, role, text, options);
  const body = document.createElement('div');
  body.className = 'message-body';
  body.appendChild(b);

  const actions = createMessageActions(role, b);
  if (actions) body.appendChild(actions);

  row.append(r, body);
  log.appendChild(row);
  row.scrollIntoView({ block: 'end' });

  return b;
}

export function bindMessageRecord(bubble, record){
  if (!(bubble instanceof HTMLElement) || !record) return;
  syncBubbleMeta(
    bubble,
    record.role || bubble.dataset.role || 'user',
    record.content ?? bubble.__kivrioMessageMeta?.text ?? '',
    {
      attachments: record.attachments,
      reasoningText: record.reasoningText ?? record.reasoning_text ?? null,
      model: record.model ?? null,
      reasoningDurationMs: record.reasoningDurationMs ?? record.reasoning_duration_ms ?? null,
      messageId: record.id ?? record.messageId ?? record.message_id ?? null,
      conversationId: record.conversationId ?? record.conversation_id ?? null,
    },
  );
}

/* -----------------------------------------------------------
 * 5) Outils
 * ----------------------------------------------------------- */
export function clearChat(){
  cancelActiveMessageEdit();
  const log = qs('#chat-log');
  if (log) log.innerHTML = '';
  try{ window.kivrioClearPendingUploads?.(); }catch(_){ }
  const ta = qs('#composer-input');
  if (ta){ ta.value = ''; ta.focus(); }
}

export { renderMarkdown };
