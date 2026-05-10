import { applyGameViewportChromeVars } from './viewport-ui-scale.js';
import { auth, authPersistenceReady } from './firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getProfile } from './profile.js';

/** Attende il primo snapshot Auth (sessione ripristinata), poi verifica solo `users.role` (UX). */
async function ensureAdminUserOrRedirect() {
  await authPersistenceReady;
  const user = await new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (u) => {
      unsub();
      resolve(u);
    });
  });
  if (!user) {
    window.location.replace('/');
    return null;
  }
  const profile = await getProfile(user.uid).catch(() => null);
  if (String(profile?.role || 'user') !== 'admin') {
    window.location.replace('/');
    return null;
  }
  return user;
}

function revealAdminShell() {
  document.documentElement.removeAttribute('data-admin-gate');
  document.getElementById('admin-auth-blocking')?.remove();
}

/** Pixel / Chrome mobile: 100dvh spesso non coincide col viewport visibile (barra URL). */
function syncAdminViewportHeight() {
  const vv = window.visualViewport;
  const h = vv && vv.height > 0 ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty('--admin-vvh', `${Math.max(1, Math.round(h))}px`);
  applyGameViewportChromeVars();
}

syncAdminViewportHeight();
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', syncAdminViewportHeight);
  window.visualViewport.addEventListener('scroll', syncAdminViewportHeight);
}
window.addEventListener('resize', syncAdminViewportHeight);
window.addEventListener('orientationchange', () => {
  setTimeout(syncAdminViewportHeight, 200);
});
requestAnimationFrame(() => {
  syncAdminViewportHeight();
  requestAnimationFrame(syncAdminViewportHeight);
});

const msgEl = document.getElementById('admin-msg');
const state = {
  token: '',
  playersPage: 1,
  playersLimit: 50,
};

function setMsg(text) {
  if (msgEl) msgEl.textContent = text || '';
}

function fmtDate(ts) {
  try {
    if (!ts) return '-';
    if (typeof ts === 'string') {
      const d = new Date(ts);
      if (Number.isFinite(d.getTime())) return d.toLocaleString('it-IT');
      return ts;
    }
    if (typeof ts === 'number') return new Date(ts).toLocaleString('it-IT');
    const sec = ts.seconds ?? ts._seconds;
    if (sec != null) return new Date(Number(sec) * 1000).toLocaleString('it-IT');
    if (typeof ts.toDate === 'function') return ts.toDate().toLocaleString('it-IT');
    return '-';
  } catch (_) {
    return '-';
  }
}

function pickRecentGameBonus(g) {
  const raw = g?.bonus_active ?? g?.bonusActive ?? g?.prize_used ?? g?.prizeUsed ?? null;
  const out = raw == null ? '' : String(raw).trim();
  return out || '-';
}

function fmtMs(ms) {
  const totalMs = Math.max(0, Math.floor(Number(ms) || 0));
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(millis).padStart(3, '0')}`;
}

function fmtHhmmss(sec) {
  const t = Math.max(0, Math.floor(Number(sec) || 0));
  const hh = Math.floor(t / 3600);
  const mm = Math.floor((t % 3600) / 60);
  const ss = t % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

async function apiGet(path) {
  const r = await fetch(path, {
    headers: { Authorization: `Bearer ${state.token}` },
  });
  if (!r.ok) throw new Error(`HTTP_${r.status}`);
  return r.json();
}

async function apiPost(path, body = {}) {
  const r = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${state.token}`,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HTTP_${r.status}`);
  return r.json();
}

async function apiDownload(path) {
  const r = await fetch(path, {
    headers: { Authorization: `Bearer ${state.token}` },
  });
  if (!r.ok) throw new Error(`HTTP_${r.status}`);
  const blob = await r.blob();
  const cd = r.headers.get('Content-Disposition') || '';
  const match = cd.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : 'export.csv';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function currentAdminRoute() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'admin') return { view: 'overview' };
  if (!parts[1]) return { view: 'overview' };
  if (parts[1] === 'players' && parts[2]) return { view: 'player-detail', id: parts[2] };
  if (parts[1] === 'players') return { view: 'players' };
  return { view: 'overview' };
}

function showSection(view) {
  document.getElementById('admin-section-overview').hidden = view !== 'overview';
  document.getElementById('admin-section-players').hidden = view !== 'players';
  document.getElementById('admin-section-player-detail').hidden = view !== 'player-detail';
}

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Conteggio soglia + percentuale sul totale partite archivio (`scores`). */
function fmtThresholdCountWithPct(count, gamesTotal) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const tot = Math.max(0, Math.floor(Number(gamesTotal) || 0));
  if (tot <= 0) return `${n} (—)`;
  const pct = Math.round((n / tot) * 100);
  return `${n} (${pct}%)`;
}

function fmtStatCell(val) {
  if (val == null) return '';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object') {
    const sec = val.seconds != null ? val.seconds : val._seconds;
    if (sec != null) {
      try {
        return new Date(sec * 1000).toISOString();
      } catch (_) {
        return '';
      }
    }
  }
  try {
    return JSON.stringify(val);
  } catch (_) {
    return String(val);
  }
}

async function loadOverview() {
  const data = await apiGet('/api/admin/overview');
  const kpi = data?.totals || {};
  const avg = Number(data?.avg_run_seconds_last_7d || 0);
  const grid = document.getElementById('admin-kpi-grid');
  grid.innerHTML = [
    ['Partite totali (archivio)', kpi.games_total ?? 0],
    ['Partite ultime 24h', kpi.games_last_24h ?? 0],
    ['Tempo giocato 24h', fmtHhmmss(kpi.playtime_last_24h_seconds || 0)],
    ['Partite ultimi 7 giorni', kpi.games_last_7d ?? 0],
    ['Tempo giocato 7 giorni', fmtHhmmss(kpi.playtime_last_7d_seconds || 0)],
    ['Tempo medio run (7gg)', `${avg.toFixed(1)}s`],
  ].map(([k, v]) => `<article class="admin-kpi"><h4>${escapeHtml(k)}</h4><p>${escapeHtml(v)}</p></article>`).join('');

  const gamesDist = data?.games_duration_distribution || {};
  const gamesTotal = Number(kpi.games_total) || 0;
  document.getElementById('admin-games-distribution').innerHTML = [
    ['≥60s', gamesDist.over60 || 0],
    ['≥90s', gamesDist.over90 || 0],
    ['≥120s', gamesDist.over120 || 0],
    ['≥150s', gamesDist.over150 || 0],
    ['≥180s', gamesDist.over180 || 0],
    ['≥210s', gamesDist.over210 || 0],
  ].map(([k, v]) =>
    `<p class="admin-list-row"><span>${escapeHtml(k)}</span><strong>${escapeHtml(fmtThresholdCountWithPct(v, gamesTotal))}</strong></p>`).join('');
}

async function loadPlayers() {
  const q = encodeURIComponent(document.getElementById('admin-search').value.trim());
  const sort = encodeURIComponent(document.getElementById('admin-sort').value);
  const data = await apiGet(`/api/admin/players?page=${state.playersPage}&limit=${state.playersLimit}&sort=${sort}&q=${q}`);
  const rows = data?.rows || [];
  const wrap = document.getElementById('admin-players-table');
  const head = `
    <tr>
      <th>Username</th><th>Email</th><th>Best time</th><th>Partite</th>
      <th>Tempo totale</th><th>Ultimo accesso</th><th>Premi</th><th>Ruolo</th>
    </tr>`;
  const body = rows.map((r) => `
    <tr data-player-id="${escapeHtml(r.id)}">
      <td>${escapeHtml(r.username)}</td>
      <td>${escapeHtml(r.email)}</td>
      <td>${fmtMs(Math.floor(Number(r.best_time || 0) * 1000))}</td>
      <td>${escapeHtml(r.total_games)}</td>
      <td>${escapeHtml(r.total_playtime_hhmmss || fmtHhmmss(r.total_playtime_seconds || 0))}</td>
      <td>${escapeHtml(fmtDate(r.last_login))}</td>
      <td>${escapeHtml(r.rewards_unlocked_count)}</td>
      <td>${escapeHtml(r.role)}</td>
    </tr>`).join('');
  wrap.innerHTML = `<table class="admin-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  wrap.querySelectorAll('tr[data-player-id]').forEach((tr) => {
    tr.addEventListener('click', () => {
      const id = tr.getAttribute('data-player-id');
      window.history.pushState({}, '', `/admin/players/${encodeURIComponent(id)}`);
      void routeLoad();
    });
  });
  const start = (data.page - 1) * data.limit + 1;
  const end = Math.min(data.page * data.limit, data.total);
  document.getElementById('admin-players-pagination').textContent =
    `Mostrati ${data.total ? start : 0}-${data.total ? end : 0} di ${data.total}`;
}

const REWARD_LABELS = [
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

async function loadPlayerDetail(id) {
  const data = await apiGet(`/api/admin/players/${encodeURIComponent(id)}`);
  const u = data?.user || {};
  const s = data?.stats || {};
  const ownedRewards = REWARD_LABELS.filter(([key]) => s[key]).map(([, lab]) => lab).join(', ') || 'Nessuno';
  const statsRows = Object.keys(s).sort().map((key) => `
    <tr><td>${escapeHtml(key)}</td><td>${escapeHtml(fmtStatCell(s[key]))}</td></tr>`).join('');
  const detail = document.getElementById('admin-player-detail');
  detail.innerHTML = `
    <h3 class="admin-panel-title">Giocatore: ${escapeHtml(u.displayName || u.username || id)}</h3>
    <p class="admin-list-row"><span>UID</span><strong>${escapeHtml(id)}</strong></p>
    <p class="admin-list-row"><span>users.bestTime</span><strong>${escapeHtml(fmtMs(u.bestTime))} <span class="profile-info--dim">(${escapeHtml(String(Math.floor(Number(u.bestTime) || 0)))} ms)</span></strong></p>
    <p class="admin-list-row"><span>Email</span><strong>${escapeHtml(u.email || '-')}</strong></p>
    <p class="admin-list-row"><span>Ruolo</span><strong>${escapeHtml(u.role || 'user')}</strong></p>
    <p class="admin-list-row"><span>Premi posseduti</span><strong>${escapeHtml(ownedRewards)}</strong></p>
    <p class="admin-list-row"><span>Streak 60/90/120/150</span><strong>${escapeHtml(`${s.current_streak_over_60s || 0}/${s.current_streak_over_90s || 0}/${s.current_streak_over_120s || 0}/${s.current_streak_over_150s || 0}`)}</strong></p>
    <p class="profile-info profile-info--dim admin-panel-hint">Allinea profilo + classifiche; puoi forzare i ms (aggiorna anche <code>users.bestTime</code>). Rimuove gli <code>scores</code> con tempo più alto.</p>
    <button id="btn-admin-sync-lb-from-profile" class="home-btn home-btn--compact js-no-start" type="button">Allinea classifiche / profilo</button>
    <h4 class="admin-subtitle">Tutte le statistiche (Firestore)</h4>
    <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Campo</th><th>Valore</th></tr></thead><tbody>${statsRows}</tbody></table></div>
  `;
  document.getElementById('btn-admin-sync-lb-from-profile')?.addEventListener('click', async () => {
    const rawMs = window.prompt(
      'Ms canonico (vuoto = usa solo il bestTime già sul profilo).\nEsempio 118156 = 01:58:156',
      '',
    );
    if (rawMs === null) return;
    const body = {target_uid: id};
    let labelMs;
    const trimmed = String(rawMs).trim();
    if (trimmed !== '') {
      const n = parseInt(trimmed, 10);
      if (!Number.isFinite(n) || n < 1) {
        setMsg('Ms non valido.');
        return;
      }
      body.force_ms = n;
      labelMs = n;
    } else {
      const bestMs = Math.floor(Number(u.bestTime) || 0);
      if (!bestMs) {
        setMsg('bestTime sul profilo è 0: inserisci i ms nel prompt oppure aggiorna il profilo.');
        return;
      }
      labelMs = bestMs;
    }
    if (!window.confirm(`Allineare profilo e classifiche a ${fmtMs(labelMs)} (${labelMs} ms)? Verranno eliminati gli score con tempo maggiore.`)) return;
    setMsg('');
    try {
      const out = await apiPost('/api/admin/sync-leaderboard-from-user-profile', body);
      if (out?.ok) {
        setMsg(`OK: tempo canonico ${out.ms} ms${out.forced_ms ? ' (forzato)' : ''}. Score rimossi: ${out.deleted_scores ?? 0}. Ricarico dati…`);
        await loadPlayerDetail(id);
      } else setMsg('Risposta imprevista.');
    } catch (e) {
      const code = String(e.message || '');
      if (code === 'HTTP_403') setMsg('Accesso negato.');
      else if (code.startsWith('HTTP_')) setMsg(`Errore API (${code.replace('HTTP_', '')}).`);
      else setMsg('Errore di rete.');
    }
  });
  const games = data?.recent_games || [];
  const body = games.map((g) => `
    <tr>
      <td>${escapeHtml(fmtDate(g.played_at))}</td>
      <td>${escapeHtml(Number(g.duration_seconds || 0).toFixed(1))}s</td>
      <td>${escapeHtml(g.level_reached || 0)}</td>
      <td>${escapeHtml(g.death_cause || '-')}</td>
      <td>${escapeHtml(pickRecentGameBonus(g))}</td>
    </tr>`).join('');
  document.getElementById('admin-player-recent-games').innerHTML =
    `<table class="admin-table"><thead><tr><th>Data</th><th>Tempo</th><th>Livello</th><th>Morte</th><th>Bonus</th></tr></thead><tbody>${body}</tbody></table>`;
}

async function routeLoad() {
  const route = currentAdminRoute();
  showSection(route.view);
  setMsg('');
  try {
    if (route.view === 'overview') await loadOverview();
    if (route.view === 'players') await loadPlayers();
    if (route.view === 'player-detail') await loadPlayerDetail(route.id);
  } catch (e) {
    const code = String(e.message || '');
    if (code === 'HTTP_403') setMsg('Accesso negato: account non admin.');
    else if (code === 'HTTP_404') setMsg('Risorsa non trovata.');
    else if (code.startsWith('HTTP_')) setMsg(`Errore API (${code.replace('HTTP_', '')}).`);
    else setMsg('Errore di rete o backend non disponibile.');
  }
}

const OPEN_SCREEN_KEY = 'dodge_open_screen';

function bindEvents() {
  document.getElementById('btn-admin-dock-home')?.addEventListener('click', () => {
    sessionStorage.removeItem(OPEN_SCREEN_KEY);
    window.location.href = '/index.html';
  });
  document.getElementById('btn-admin-dock-profile')?.addEventListener('click', () => {
    sessionStorage.setItem(OPEN_SCREEN_KEY, 'profile');
    window.location.href = '/index.html';
  });
  document.getElementById('btn-admin-open-players')?.addEventListener('click', () => {
    window.history.pushState({}, '', '/admin/players');
    void routeLoad();
  });
  document.getElementById('btn-admin-search')?.addEventListener('click', async () => {
    state.playersPage = 1;
    await loadPlayers();
  });
  document.getElementById('btn-admin-refresh-players')?.addEventListener('click', async () => {
    await loadPlayers();
  });
  document.getElementById('btn-export-players')?.addEventListener('click', async () => {
    try {
      await apiDownload('/api/admin/export?type=players');
    } catch (_) {
      setMsg('Export players non disponibile.');
    }
  });
  document.getElementById('btn-export-games')?.addEventListener('click', async () => {
    try {
      const days = encodeURIComponent(document.getElementById('export-games-days').value || '7');
      await apiDownload(`/api/admin/export?type=games&days=${days}`);
    } catch (_) {
      setMsg('Export games non disponibile.');
    }
  });
  document.getElementById('btn-admin-grant-plus-prizes')?.addEventListener('click', async () => {
    setMsg('');
    try {
      const data = await apiPost('/api/admin/grant-self-test-plus-prizes', {});
      const p = data?.prizes || {};
      setMsg(`Premi Plus aggiornati: ro ${p.red_plus ?? '?'} · bl ${p.blue_plus ?? '?'} · gi ${p.yellow_plus ?? '?'} · ve ${p.green_plus ?? '?'} · vi ${p.purple_plus ?? '?'}.`);
    } catch (e) {
      const code = String(e.message || '');
      if (code === 'HTTP_403') setMsg('Accesso negato.');
      else if (code.startsWith('HTTP_')) setMsg(`Errore API (${code.replace('HTTP_', '')}).`);
      else setMsg('Errore di rete.');
    }
  });
  document.getElementById('btn-admin-grant-plus-launch-all')?.addEventListener('click', async () => {
    setMsg('');
    if (!window.confirm('Concedere a tutti gli account registrati +1 Premio Plus per ogni colore (tetto 10 per colore)? Chi ha già ricevuto il «regalo lancio» viene saltato.')) return;
    try {
      const data = await apiPost('/api/admin/grant-plus-launch-gift', {});
      const g = data?.gift_granted ?? '?';
      const s = data?.already_had_gift ?? '?';
      const t = data?.users_total ?? '?';
      setMsg(`Regalo lancio: aggiornati ${g} utenti; già con regalo ${s}; utenti totali in lista ${t}.`);
    } catch (e) {
      const code = String(e.message || '');
      if (code === 'HTTP_403') setMsg('Accesso negato.');
      else if (code.startsWith('HTTP_')) setMsg(`Errore API (${code.replace('HTTP_', '')}).`);
      else setMsg('Errore di rete.');
    }
  });
  window.addEventListener('popstate', () => {
    void routeLoad();
  });
}

async function bootstrap() {
  const user = await ensureAdminUserOrRedirect();
  if (!user) return;

  revealAdminShell();
  state.token = await user.getIdToken();
  syncAdminViewportHeight();
  bindEvents();
  await routeLoad();
}

bootstrap();
