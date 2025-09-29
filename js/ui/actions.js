import { qs } from '../core/dom.js';
import { sendCurrent, readBase, readModel, ping } from '../net/ollama.js';

export function wireSendAction(){
  const ta = qs('#composer-input'); const btn = qs('#send-btn');
  if(ta){ ta.addEventListener('keydown', (e)=>{ if(e.key==='Enter' && (e.ctrlKey || e.metaKey)){ e.preventDefault(); sendCurrent(); } }); }
  if(btn){ btn.addEventListener('click', (e)=>{ e.preventDefault(); sendCurrent(); }); }
}

export function mountStatusPill(){
  const label = document.querySelector('#model-label');
  if(!label) return;
  const pill = document.createElement('span'); pill.className='status-pill';
  const setPill = (ok, txt)=>{ pill.textContent=''; const dot=document.createElement('span'); dot.textContent='●'; dot.className = ok ? 'status-ok' : 'status-bad'; const t=document.createElement('span'); t.textContent = txt; pill.append(dot,t); };
  const refreshTitle = ()=>{ const base = readBase(); const model = readModel(); pill.title = `Base: ${base}\nModèle: ${model}\n(Cliquer pour modifier & ping)`; };
  const holder = document.createElement('span');
holder.style.display = 'inline-flex';
holder.style.alignItems = 'center';
holder.style.gap = '6px';
holder.style.whiteSpace = 'nowrap';
label.parentNode.insertBefore(holder, label);
holder.append(label, pill);
  setPill(false,'Non testé'); refreshTitle();
  pill.addEventListener('click', async ()=>{
    const base = prompt('Base Ollama (http://127.0.0.1:11434)', readBase()); if(base!=null) localStorage.setItem('ollamaBase', base);
    const model = prompt('Modèle', readModel()); if(model!=null) localStorage.setItem('ollamaModel', model);
    refreshTitle();
    try{ await ping(readBase()); setPill(true,'OK'); }catch(e){ setPill(false,'Échec'); alert('Ping échoué: '+(e?.message||e)); }
  });
  ping(readBase()).then(()=>setPill(true,'OK')).catch(()=>setPill(false,'Échec'));
}
// Active/désactive l’état visuel du chip Interpréteur
const chipPy = document.getElementById('chip-py');

if (chipPy) {
  chipPy.type = 'button'; // évite d'être 'submit' si dans un <form>
  if (!chipPy.hasAttribute('aria-pressed')) chipPy.setAttribute('aria-pressed', 'false');

  chipPy.addEventListener('click', () => {
    const next = chipPy.getAttribute('aria-pressed') !== 'true';
    chipPy.setAttribute('aria-pressed', String(next));
    chipPy.classList.toggle('is-active', next);
  });
}

