import { qs } from '../core/dom.js';
import { renderMsg } from '../chat/render.js';

let pyodide = null; let loading = false;
async function ensurePyodide(){
  if(pyodide || loading) return pyodide;
  loading = true;
  // Utilisez localhost/HTTP(S) pour charger WASM. CDN par défaut; placez localement si voulu.
  const url = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js';
  await import(/* @vite-ignore */ url).then(async (mod)=>{
    pyodide = await window.loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/' });
  });
  loading = false; return pyodide;
}

export function wirePyodide(){
  const chip = qs('#chip-py'); if(!chip) return;
  chip.addEventListener('click', async ()=>{
    const code = prompt('Interpréteur de code Python (Pyodide) — entrez du code:', 'print("Bonjour MathPy AI")');
    if(code==null) return;
    const out = renderMsg('assistant', '⏳ Chargement Pyodide…');
    try{
      const py = await ensurePyodide();
      out.textContent = 'Exécution…';
      const result = py.runPython(code);
      out.textContent = (result===undefined? '✔️ Terminé.' : String(result));
    }catch(err){ out.textContent = 'Erreur Pyodide: ' + (err?.message || String(err)); }
  });
}
