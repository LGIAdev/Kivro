import { qs } from '../core/dom.js';
import { renderMsg } from '../chat/render.js';

export function wireUploads(){
  const fileInput = qs('#file-input'); const addBtn = qs('#add-btn'); const modal = qs('#add-modal');
  if(!fileInput || !addBtn || !modal) return;

  // Ouvrir le sélecteur en cliquant sur la carte
  modal.addEventListener('click', (e)=>{ if(e.target===modal) modal.style.display='none'; });
  modal.querySelector('.modal-card')?.addEventListener('click', ()=>{ fileInput.click(); });
  addBtn.addEventListener('click', (e)=>{ e.preventDefault(); modal.style.display='flex'; modal.setAttribute('aria-hidden','false'); });

  fileInput.addEventListener('change', ()=>{
    const files = Array.from(fileInput.files||[]);
    if(files.length===0) return;
    modal.style.display='none';
    for(const f of files){
      const info = `${f.name} (${f.type||'type inconnu'}, ${Math.round(f.size/1024)} Ko)`;
      const bubble = renderMsg('user', `Fichier sélectionné : ${info}`);
      if(f.type.startsWith('image/')){
        const url = URL.createObjectURL(f);
        const img = new Image(); img.src = url; img.style.maxWidth='360px'; img.style.display='block'; img.style.marginTop='8px';
        bubble.appendChild(img);
      }
    }
    fileInput.value = '';
  });
}
