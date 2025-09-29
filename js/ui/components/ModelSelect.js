import { listModels } from '../../net/ollama.js';
import { getModel, setModel } from '../../store/settings.js';

/** Met à jour l'étiquette visible du modèle courant */
function setLabel(modelName) {
  const el = document.querySelector('#model-label');
  if (el) el.textContent = modelName || '(modèle)';
}

/** Monte et prépare le sélecteur de modèles */
export async function mountModelSelect(){
  const el = document.querySelector('#model-select');
  if (!el) return;

  // État "chargement"
  el.disabled = true;
  el.setAttribute('aria-busy', 'true');
  el.innerHTML = '<option>Chargement…</option>';

  try {
    const models = await listModels();
    if (!Array.isArray(models) || models.length === 0) {
      el.innerHTML = '<option value="">(Aucun modèle trouvé)</option>';
      return; // on reste désactivé
    }

    // Remplit la liste
    el.innerHTML = models.map(m => `<option value="${m}">${m}</option>`).join('');

    // Sélectionne le modèle courant si possible
    const current = getModel();
    el.value = (current && models.includes(current)) ? current : models[0];

    // Persiste + met à jour l'étiquette
    setModel(el.value);
    setLabel(el.value);

    // Prêt à l'emploi
    el.disabled = false;
  } catch (e) {
    console.error('ModelSelect load error:', e);
    el.innerHTML = '<option value="">(Ollama indisponible)</option>';
    el.disabled = true;
  } finally {
    el.removeAttribute('aria-busy');
  }

  // Changement manuel
  el.addEventListener('change', (ev) => {
    const m = ev.target?.value;
    if (!m) return;
    setModel(m);
    setLabel(m);
  });

  // Raccourci focus Alt+M (ignoré si désactivé)
  document.addEventListener('keydown', (ev) => {
    if (ev.altKey && (ev.key === 'm' || ev.key === 'M')) {
      ev.preventDefault();
      if (!el.disabled) el.focus();
    }
  });
}
