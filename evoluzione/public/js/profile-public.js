import { applyGameViewportChromeVars } from './viewport-ui-scale.js';
import { fillProfileBestStatRows } from './profile-best-display.js';

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

const COLLECTED_BONUS_KEYS = ['red', 'blue', 'yellow', 'green', 'purple'];

/** Somma storica dei bonus colorati raccolti (stessi contatori della griglia sopra). */
function bonusesCollectedTotal(collected) {
  const c = collected && typeof collected === 'object' ? collected : {};
  let sum = 0;
  for (const k of COLLECTED_BONUS_KEYS) {
    sum += Math.max(0, Math.floor(Number(c[k] || 0)));
  }
  return sum;
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
    fillProfileBestStatRows(
      document.getElementById('profile-best-main'),
      document.getElementById('profile-best-pure'),
      {
        generalMs: Math.floor(Number(stats.best_general_ms || 0)),
        pureMs: Math.floor(Number(stats.best_pure_ms || 0)),
        prizeUsed: String(stats.best_general_prize_used || '').trim(),
        fmt,
      },
    );
    document.getElementById('public-total-games').textContent = `Partite giocate: ${Math.floor(Number(stats.total_games || 0))}`;
    document.getElementById('public-total-playtime').textContent = `Tempo totale di gioco: ${formatHhmmss(stats.total_playtime_seconds || 0)}`;
    document.getElementById('public-red').textContent = String(Math.floor(Number(stats?.collected?.red || 0)));
    document.getElementById('public-blue').textContent = String(Math.floor(Number(stats?.collected?.blue || 0)));
    document.getElementById('public-yellow').textContent = String(Math.floor(Number(stats?.collected?.yellow || 0)));
    document.getElementById('public-green').textContent = String(Math.floor(Number(stats?.collected?.green || 0)));
    document.getElementById('public-purple').textContent = String(Math.floor(Number(stats?.collected?.purple || 0)));
    const bonusTotalEl = document.getElementById('public-bonus-total');
    if (bonusTotalEl) {
      bonusTotalEl.textContent = `Bonus presi (totale): ${bonusesCollectedTotal(stats?.collected)}`;
    }
  } catch (_) {
    if (msg) msg.textContent = 'Errore di rete.';
  }
}

document.getElementById('btn-public-back')?.addEventListener('click', () => {
  window.location.href = '/index.html';
});

loadPublicProfile();
