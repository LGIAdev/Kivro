// js/chat/render.js
// Rendu des messages (Markdown + LaTeX) pour Kivro
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
  return `<pre class="kivro-fenced-code" data-code-lang="${escapeHtmlAttr(parsed.lang)}" data-code-info="${escapeHtmlAttr(parsed.raw)}"><code>${escapeHtml(source)}</code></pre>`;
}

function restoreMathToken(token){
  return typeof token === 'string' ? token : '';
}

function restoreCodeToken(token){
  if (token && token.type === 'fence') return renderCodeFence(token.info, token.body);
  return '';
}

function isPythonFenceLanguage(lang){
  return ['python', 'py', 'pyodide'].includes(String(lang || '').toLowerCase());
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

// LaTeX array/tabular → Markdown GFM (texte)
function latexArrayToGfm(s){
  if(!s) return '';
  // Traite \[...\] ou $$...$$
  return String(s)
    // $$...$$ → GFM
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, inner) => toGfmIfArray(inner))
    // \[...\] → GFM
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, inner) => toGfmIfArray(inner));

  function toGfmIfArray(inner){
    const m = inner.match(/\\begin\{(array|tabular)\}(\{[^}]*\})?([\s\S]*?)\\end\{\1\}/);
    if(!m) return `\n\\[${inner}\\]\n`; // pas un tableau → on restitue tel quel
    const body = m[3]
      .replace(/\\hline/g,'')      // ignore \hline
      .trim();

    // Lignes LaTeX séparées par "\\"
    const rows = body.split(/\\\\/).map(r => r.trim()).filter(Boolean);
    const parsed = rows.map(r => r.split('&').map(c => c.trim()));

    const maxCols = Math.max(...parsed.map(r => r.length));
    parsed.forEach(r => { while(r.length < maxCols) r.push(''); });

    const header = parsed[0];
    const sep = Array(maxCols).fill('---');
    const bodyRows = parsed.slice(1);

    const gfm = [
      `| ${header.join(' | ')} |`,
      `| ${sep.join(' | ')} |`,
      ...bodyRows.map(r => `| ${r.join(' | ')} |`)
    ].join('\n');

    return `\n${gfm}\n`; // retourne **du texte** GFM
  }
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
  let html = '<table class="var-table markdown-table"><thead><tr>';
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
function renderMarkdown(src){
  if(!src) return '';

  let s = String(src);
  
  // Convertit d’abord les tableaux LaTeX en GFM (texte)

  // 2.1 Sauvegarde provisoire: maths (\(...\), \[...\], $$...$$) et fences ```...```
  const codeTokens = [];
  const mathTokens = [];
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
  s = latexArrayToGfm(s);
  s = normalizeLatex(s);
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, saveMath);
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, saveMath);
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, saveMath);
  s = escapeHtml(s);
  
  // Supprimer totalement les séparateurs Markdown (aucune ligne affichée)
  s = s.replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '');

  // 2.3 Titres (#, ##, ###) — tolère espaces en début de ligne
  s = s
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
  const BLOCK_START = /^(<h\d|<ul>|<pre>|<blockquote>|<table|<thead|<tbody|<tr|@@(?:CODE|MATH)_)/;
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

function renderMarkdownBlock(container, text){
  const content = String(text || '').trim();
  if (!content) return false;
  container.innerHTML = renderMarkdown(content);
  return true;
}

function toggleReasoningPanel(button, panel, expanded){
  const next = Boolean(expanded);
  button.setAttribute('aria-expanded', next ? 'true' : 'false');
  panel.hidden = !next;
}

function renderMathBlocks(container){
  if (!window.kivroRenderMath) return;
  const targets = [...container.querySelectorAll('.markdown-body')];
  if (targets.length === 0 && container.childElementCount === 0 && container.textContent.trim()) {
    targets.push(container);
  }
  for (const target of targets) {
    try { window.kivroRenderMath(target); } catch (e) { console.warn('kivroRenderMath error:', e); }
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
      const img = document.createElement('img');
      img.src = image.dataUrl || '';
      img.alt = 'Sortie matplotlib';
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
  if (!isPythonFenceLanguage(lang)) return;
  if (pre.closest('.pyodide-inline-block')) return;

  const code = pre.querySelector('code')?.textContent || pre.textContent || '';
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
  const blocks = [...container.querySelectorAll('pre.kivro-fenced-code[data-code-lang]')];
  for (const block of blocks) {
    hydratePyodideBlock(block);
  }
}

export function updateBubbleContent(container, role, text, options = {}){
  if (!(container instanceof HTMLElement)) return;

  const preservedExpanded = container.dataset.reasoningExpanded === 'true';
  container.innerHTML = '';
  delete container.dataset.reasoningExpanded;

  if (role === 'assistant') {
    const payload = resolveAssistantDisplayPayload(text, options);
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
      renderMarkdownBlock(panel, payload.reasoningText);

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
      if (renderMarkdownBlock(answerWrap, payload.answerText)) {
        if (options.pyodideFinal !== false) hydratePyodideBlocks(answerWrap);
        group.appendChild(answerWrap);
      }

      container.appendChild(group);
      appendMessageAttachments(container, options.attachments || []);
      renderMathBlocks(container);
      return;
    }

    if (renderMarkdownBlock(container, payload.answerText)) {
      if (options.pyodideFinal !== false) hydratePyodideBlocks(container);
      appendMessageAttachments(container, options.attachments || []);
      renderMathBlocks(container);
      return;
    }
  }

  const hasText = !!String(text || '').trim();
  if (hasText) {
    container.innerHTML = renderMarkdown(text);
  }
  appendMessageAttachments(container, options.attachments || []);
  renderMathBlocks(container);
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
      const img = new Image();
      img.src = attachment.previewUrl || attachment.url;
      img.alt = attachment.filename || 'Piece jointe';
      preview.appendChild(img);
    }else{
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

  row.append(r, b);
  log.appendChild(row);
  row.scrollIntoView({ block: 'end' });

  return b;
}

/* -----------------------------------------------------------
 * 5) Outils
 * ----------------------------------------------------------- */
export function clearChat(){
  const log = qs('#chat-log');
  if (log) log.innerHTML = '';
  try{ window.kivroClearPendingUploads?.(); }catch(_){ }
  const ta = qs('#composer-input');
  if (ta){ ta.value = ''; ta.focus(); }
}

export { renderMarkdown };
