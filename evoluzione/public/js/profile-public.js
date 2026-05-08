import { applyGameViewportChromeVars } from './viewport-ui-scale.js';

function bindViewportUiSync() {
  const run = () => {
    applyGameViewportChromeVars();
  };
  run();
  window.addEventListener('resize', run);
  window.addEventListener('orientationchange', () => {
    setTimeout(run, 120);
  });
  window.addEventListener('pageshow', () => {
    requestAnimationFrame(run);
    requestAnimationFrame(() => requestAnimationFrame(run));
    setTimeout(run, 48);
    setTimeout(run, 160);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', run);
    window.visualViewport.addEventListener('scroll', run);
  }
}

bindViewportUiSync();

function fmt(ms) {
  const totalMs = Math.max(0, Math.floor(Number(ms) || 0));
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(millis).padStart(3, '0')}`;
}

function formatHhmmss(totalSeconds) {
  const t = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hh = Math.floor(t / 3600);
  const mm = Math.floor((t % 3600) / 60);
  const ss = t % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

const PUBLIC_PREMI = [
  ['has_red_plus', 'Rosso Plus'],
  ['has_red_premium', 'Rosso Premium'],
  ['has_blue_plus', 'Blu Plus'],
  ['has_blue_premium', 'Blu Premium'],
  ['has_yellow_plus', 'Giallo Plus'],
  ['has_yellow_premium', 'Giallo Premium'],
  ['has_green_plus', 'Verde Plus'],
  ['has_green_premium', 'Verde Premium'],
  ['has_purple_plus', 'Viola Plus'],
  ['has_purple_premium', 'Viola Premium'],
];

function renderPublicRewards(rewards) {
  const grid = document.getElementById('public-rewards-grid');
  if (!grid) return;
  const r = rewards || {};
  grid.innerHTML = PUBLIC_PREMI.map(([key, label]) => {
    const on = !!r[key];
    const cls = on ? 'profile-reward-item profile-reward-item--owned' : 'profile-reward-item profile-reward-item--locked';
    return `<div class="${cls}" aria-disabled="${!on}">${label}</div>`;
  }).join('');
}

function getUserIdFromUrl() {
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  if (pathParts[0] === 'profile' && pathParts[1]) return decodeURIComponent(pathParts[1]);
  const q = new URLSearchParams(window.location.search);
  return q.get('userId') || '';
}

async function loadPublicProfile() {
  const userId = getUserIdFromUrl();
  const msg = document.getElementById('public-profile-msg');
  if (!userId) {
    if (msg) msg.textContent = 'Profilo non valido.';
    return;
  }
  try {
    const response = await fetch(`/api/player/stats/${encodeURIComponent(userId)}`);
    if (!response.ok) {
      if (msg) msg.textContent = 'Profilo non disponibile.';
      return;
    }
    const payload = await response.json();
    const user = payload?.user || {};
    const stats = payload?.stats || {};
    document.getElementById('public-profile-name').textContent = user.displayName || user.username || 'Giocatore';
    document.getElementById('public-best').textContent = `Tempo migliore: ${fmt(Math.floor(Number(stats.best_time_seconds || 0) * 1000))}`;
    document.getElementById('public-total-games').textContent = `Partite giocate: ${Math.floor(Number(stats.total_games || 0))}`;
    document.getElementById('public-total-playtime').textContent = `Tempo totale di gioco: ${formatHhmmss(stats.total_playtime_seconds || 0)}`;
    document.getElementById('public-red').textContent = String(Math.floor(Number(stats?.collected?.red || 0)));
    document.getElementById('public-blue').textContent = String(Math.floor(Number(stats?.collected?.blue || 0)));
    document.getElementById('public-yellow').textContent = String(Math.floor(Number(stats?.collected?.yellow || 0)));
    document.getElementById('public-green').textContent = String(Math.floor(Number(stats?.collected?.green || 0)));
    document.getElementById('public-purple').textContent = String(Math.floor(Number(stats?.collected?.purple || 0)));
    renderPublicRewards(stats?.rewards || {});
  } catch (_) {
    if (msg) msg.textContent = 'Errore di rete.';
  }
}

document.getElementById('btn-public-back')?.addEventListener('click', () => {
  window.location.href = '/index.html';
});

loadPublicProfile();
