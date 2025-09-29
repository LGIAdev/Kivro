export function wireLogout(){
  const le = document.getElementById('logout-entry'); if(!le) return;
  const renderLoginSplash = ()=>{
    document.body.innerHTML = ''
      + '<div class="login-splash" role="document">'
      + '  <div class="login-card">'
      + '    <div class="login-brand">Kivro</div>'
      + '    <div class="login-title">Connectez-vous à Kivro</div>'
      + '    <a href="#" id="login-btn" class="login-btn" role="button" aria-label="Connexion">Connexion</a>'
      + '  </div>'
      + '</div>';
    const btn = document.getElementById('login-btn');
    if(btn){ btn.addEventListener('click', (ev)=>{ ev.preventDefault(); location.reload(); }); }
  };
  const doLogout = (e)=>{
    if(e) e.preventDefault();
    try{ localStorage.clear(); }catch(_){ }
    try{ sessionStorage.clear(); }catch(_){ }
    if('caches' in window){ caches.keys().then(keys=>Promise.all(keys.map(k=>caches.delete(k)))).catch(()=>{}); }
    if('serviceWorker' in navigator){ navigator.serviceWorker.getRegistrations().then(regs=>regs.forEach(r=>r.unregister())).catch(()=>{}); }
    renderLoginSplash();
  };
  le.addEventListener('click', doLogout);
  le.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' '){ doLogout(e); } });
}
