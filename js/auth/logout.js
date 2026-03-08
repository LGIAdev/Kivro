import { mountHistory, Store } from '../store/conversations.js';

const OVERLAY_ID = 'kivro-login-overlay';

function ensureOverlay() {
  let overlay = document.getElementById(OVERLAY_ID);
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'modal-overlay';
  overlay.style.display = 'grid';
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.zIndex = '9999';
  overlay.style.background = 'rgba(3, 8, 20, 0.86)';
  overlay.innerHTML = ''
    + '<div class="login-splash" role="document">'
    + '  <div class="login-card">'
    + '    <div class="login-brand">Kivro</div>'
    + '    <div class="login-title">Connectez-vous a Kivro</div>'
    + '    <a href="#" id="login-btn" class="login-btn" role="button" aria-label="Connexion">Connexion</a>'
    + '  </div>'
    + '</div>';

  document.body.appendChild(overlay);
  return overlay;
}

export function renderLoginSplash() {
  const overlay = ensureOverlay();
  overlay.style.display = 'grid';

  const btn = document.getElementById('login-btn');
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      overlay.style.display = 'none';
      try { await mountHistory(); } catch (_) {}
    });
  }
}

export function shouldShowLoggedOutSplash() {
  return false;
}

export function wireLogout() {
  const le = document.getElementById('logout-entry');
  if (!le) return;

  const doLogout = (e) => {
    if (e) e.preventDefault();
    try { Store.clearCurrent(); } catch (_) {}
    renderLoginSplash();
  };

  le.addEventListener('click', doLogout);
  le.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      doLogout(e);
    }
  });
}
