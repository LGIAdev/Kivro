import { qs } from '../core/dom.js';
import { renderMsg, clearChat } from '../chat/render.js';

const K_CONVS = 'mpai.convs.v1';
const K_CUR = 'mpai.current.v1';

export const Store = {
  load(){ try{ return JSON.parse(localStorage.getItem(K_CONVS)||'[]'); }catch(e){ return []; } },
  save(arr){ try{ localStorage.setItem(K_CONVS, JSON.stringify(arr)); }catch(e){} },
  currentId(){ try{ return localStorage.getItem(K_CUR); }catch(e){ return null; } },
  setCurrent(id){ try{ localStorage.setItem(K_CUR, id); }catch(e){} },
  clearCurrent(){ try{ localStorage.removeItem(K_CUR); }catch(e){} },
  create(title){
    const now = Date.now();
    const c = { id:'c'+now.toString(36)+Math.random().toString(36).slice(2,7), title:title||'Nouvelle conversation', createdAt:now, updatedAt:now, messages:[] };
    const arr = this.load(); arr.unshift(c); this.save(arr); this.setCurrent(c.id); return c;
  },
  get(id){ return this.load().find(x=>x.id===id); },
  addMsg(id, role, content){
    const arr = this.load(); const c = arr.find(x=>x.id===id); if(!c) return;
    c.messages.push({role, content}); c.updatedAt = Date.now(); this.save(arr);
  },
  renameIfDefault(id, title){
    const arr = this.load(); const c = arr.find(x=>x.id===id); if(!c) return;
    if(!c.title || /^Nouvelle conversation/i.test(c.title)){
      c.title = title; c.updatedAt = Date.now(); this.save(arr);
    }
  }
};

function groupLabel(ts){
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 86400000;
  if(ts >= startToday) return "Aujourd'hui";
  if(ts >= startYesterday) return 'Hier';
  return 'Jours précédents';
}

export function fmtTitle(s){ s=(s||'').replace(/\s+/g,' ').trim(); return s? s.slice(0,64) : 'Nouvelle conversation'; }

export function mountHistory(){
  const cont = qs('#history'); if(!cont) return;
  const render = () => {
    cont.innerHTML = '';
    const convs = Store.load().filter(c => (c.messages||[]).length>0).sort((a,b)=>b.updatedAt-a.updatedAt);
    const groups = {"Aujourd'hui":[], "Hier":[], "Jours précédents":[]};
    for(const c of convs){ groups[groupLabel(c.updatedAt)].push(c); }
    for(const label of ["Aujourd'hui","Hier","Jours précédents"]){
      const arr = groups[label]; if(arr.length===0) continue;
      const head = document.createElement('div'); head.className='side-title'; head.textContent=label; cont.appendChild(head);
      for(const c of arr){
        const a = document.createElement('a'); a.className='conv'; a.href='#'; a.dataset.id=c.id;
        if(Store.currentId()===c.id) a.classList.add('selected');
        a.innerHTML = '<svg class="ico" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M5 6h14M5 18h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> '+(c.title||'Nouvelle conversation');
        a.addEventListener('click', (e)=>{
          e.preventDefault();
          Store.setCurrent(c.id);
          clearChat();
          for(const m of (c.messages||[])) renderMsg(m.role, m.content);
          render();
        });
        cont.appendChild(a);
      }
    }
    if(convs.length===0){
      const head = document.createElement('div'); head.className='side-title'; head.textContent="Aujourd'hui"; cont.appendChild(head);
      const empty = document.createElement('div'); empty.style.color='var(--muted)'; empty.style.padding='6px 12px'; empty.style.fontSize='.9rem'; empty.textContent='Aucune conversation';
      cont.appendChild(empty);
    }
  };
  render();
}
