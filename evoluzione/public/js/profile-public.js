import { applyGameViewportChromeVars } from './viewport-ui-scale.js';
import { renderProfileBestCard } from './profile-best-display.js';
import { renderProfileStatsKpiGrid } from './profile-kpi-display.js';
import { renderProfileSurvivalThresholdStats } from './profile-threshold-display.js';

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

function publicThresholdElements() {
  return {
    legend: document.getElementById('public-profile-threshold-legend'),
    runsOver: document.getElementById('public-profile-runs-over-grid'),
    streaks: document.getElementById('public-profile-streaks-grid'),
    bestStreaks: document.getElementById('public-profile-best-streaks-grid'),
  };
}

function getUserIdFromUrl() {
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  if (pathParts[0] === 'profile' && pathParts[1]) return decodeURIComponent(pathParts[1]);
  const q = new URLSearchParams(window.location.search);
  return q.get('userId') || '';
}

function renderPublicProfileStats(stats) {
  const data = stats && typeof stats === 'object' ? stats : {};
  renderProfileBestCard(document.getElementById('public-profile-stats-best-card'), {
    generalMs: Math.floor(Number(data.best_general_ms || 0)),
    pureMs: Math.floor(Number(data.best_pure_ms || 0)),
    prizeUsed: String(data.best_general_prize_used || '').trim(),
    fmt,
  });
  renderProfileStatsKpiGrid(document.getElementById('public-profile-stats-grid'), data);
  renderProfileSurvivalThresholdStats(data, publicThresholdElements());
  document.getElementById('public-red').textContent = String(Math.floor(Number(data?.collected?.red || 0)));
  document.getElementById('public-blue').textContent = String(Math.floor(Number(data?.collected?.blue || 0)));
  document.getElementById('public-yellow').textContent = String(Math.floor(Number(data?.collected?.yellow || 0)));
  document.getElementById('public-green').textContent = String(Math.floor(Number(data?.collected?.green || 0)));
  document.getElementById('public-purple').textContent = String(Math.floor(Number(data?.collected?.purple || 0)));
}

async function loadPublicProfile() {
  const userId = getUserIdFromUrl();
  const msg = document.getElementById('public-profile-msg');
  if (!userId) {
    if (msg) msg.textContent = 'Profilo non valido.';
    renderPublicProfileStats({});
    return;
  }
  try {
    const response = await fetch(`/api/player/stats/${encodeURIComponent(userId)}`);
    if (!response.ok) {
      if (msg) msg.textContent = 'Profilo non disponibile.';
      renderPublicProfileStats({});
      return;
    }
    const payload = await response.json();
    const user = payload?.user || {};
    const stats = payload?.stats || {};
    document.getElementById('public-profile-name').textContent = user.displayName || user.username || 'Giocatore';
    renderPublicProfileStats(stats);
  } catch (_) {
    if (msg) msg.textContent = 'Errore di rete.';
    renderPublicProfileStats({});
  }
}

document.getElementById('btn-public-back')?.addEventListener('click', () => {
  window.location.href = '/';
});

loadPublicProfile();
