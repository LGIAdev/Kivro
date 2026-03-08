import { runPython } from './features/py/loader.js';
document.querySelector('#chip-py')?.addEventListener('click', async ()=>{
  // Ouvre un mini éditeur/modale ou exécute un snippet de test
  const out = await runPython('print(2+2)');
  console.log('Py ▶', out);
});