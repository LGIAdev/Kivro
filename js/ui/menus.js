import { qs } from '../core/dom.js';

export function wireUserMenu(){
  const user = qs('#user-entry'); const menu = qs('#user-menu');
  if(!user || !menu) return;
  const toggle = (e)=>{ if(e) e.preventDefault(); const isOpen = menu.classList.toggle('open'); menu.setAttribute('aria-hidden', isOpen?'false':'true'); };
  user.style.cursor = 'pointer';
  user.addEventListener('click', toggle);
  user.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' '){ toggle(e); } });
  document.addEventListener('click', (e)=>{ if(menu && !menu.contains(e.target) && !user.contains(e.target)){ menu.classList.remove('open'); menu.setAttribute('aria-hidden','true'); } });
}

export function wireSettingsModal(){
  const se = qs('#settings-entry'); const sm = qs('#settings-modal');
  if(!se || !sm) return;
  const open = (e)=>{ if(e) e.preventDefault(); sm.style.display='flex'; };
  se.addEventListener('click', open);
  se.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' '){ open(e); } });
  sm.addEventListener('click', (e)=>{ if(e.target===sm) sm.style.display='none'; });
}

export function wirePromptModal(){
  const pe = qs('#prompt-entry'); const pm = qs('#prompt-modal'); const pt = qs('#prompt-text'); const ps = qs('#prompt-save');
  if(!pe || !pm || !pt || !ps) return;
  const open = (e)=>{ if(e) e.preventDefault(); pm.style.display='flex'; try{ pt.value = localStorage.getItem('systemPrompt') || ''; }catch(_){} };
  const save = (e)=>{ if(e) e.preventDefault(); try{ localStorage.setItem('systemPrompt', pt.value||''); }catch(_){} pm.style.display = 'none'; };
  pe.addEventListener('click', open);
  pe.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' '){ open(e); } });
  ps.addEventListener('click', save);
  pm.addEventListener('click', (e)=>{ if(e.target===pm) pm.style.display='none'; });
}
