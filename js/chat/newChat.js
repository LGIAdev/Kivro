import { qs, qsa } from '../core/dom.js';
import { clearChat } from './render.js';
import { Store } from '../store/conversations.js';

function doNewChat(e){
  if(e) e.preventDefault();
  const anyText = qsa('#composer-input').some(t=>t.value.trim().length>0);
  const anyMsgs = !!document.querySelector('#chat-log');
  if((anyText || anyMsgs) && !confirm('Démarrer une nouvelle conversation ? Le contenu actuel sera effacé.')) return;
  if(Store.clearCurrent) Store.clearCurrent();
  clearChat();
  // history will re-render on next message
}

export function wireNewChat(){
  const btn = qs('#new-chat');
  if(btn){
    btn.addEventListener('click', doNewChat);
    btn.addEventListener('keydown', ev=>{ if(ev.key==='Enter' || ev.key===' ') doNewChat(ev); });
  }
  document.addEventListener('keydown', (ev)=>{
    if(ev.altKey && (ev.key==='n' || ev.key==='N')){ ev.preventDefault(); doNewChat(ev); }
  });
}
