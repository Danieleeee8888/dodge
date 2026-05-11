export function formatStatsPlaytime(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function appendProfileStatsKpiCard(container, label, value, opts = {}) {
  const article = document.createElement('article');
  article.className = 'profile-stats-kpi';
  if (opts.wide) article.classList.add('profile-stats-kpi--wide');
  const h = document.createElement('h4');
  h.textContent = label;
  const p = document.createElement('p');
  p.textContent = String(value);
  article.append(h, p);
  container.appendChild(article);
}

export function renderProfileStatsKpiGrid(container, stats) {
  if (!container) return;
  container.replaceChildren();
  const totalGames = Math.floor(Number(stats?.total_games || 0));
  const totalPlay = Number(stats?.total_playtime_seconds || 0);
  const deathsTri = Math.floor(Number(stats?.deaths_by_triangle || 0));
  const deathsSq = Math.floor(Number(stats?.deaths_by_square || 0));

  appendProfileStatsKpiCard(container, 'Partite giocate', totalGames);
  appendProfileStatsKpiCard(container, 'Tempo totale', formatStatsPlaytime(totalPlay));
  appendProfileStatsKpiCard(container, 'Morti triangoli', deathsTri);
  appendProfileStatsKpiCard(container, 'Morti quadrati', deathsSq);
}
