export const PROFILE_SURVIVAL_THRESHOLDS = [
  { seconds: 60, label: '≥ 1:00', tone: 'red' },
  { seconds: 90, label: '≥ 1:30', tone: 'blue' },
  { seconds: 120, label: '≥ 2:00', tone: 'yellow' },
  { seconds: 150, label: '≥ 2:30', tone: 'green' },
  { seconds: 180, label: '≥ 3:00', tone: 'purple' },
];

export function renderProfileThresholdLegend(container) {
  if (!container) return;
  container.replaceChildren();
  const spacer = document.createElement('span');
  spacer.className = 'profile-threshold-legend-spacer';
  spacer.setAttribute('aria-hidden', 'true');
  container.appendChild(spacer);
  for (const threshold of PROFILE_SURVIVAL_THRESHOLDS) {
    const item = document.createElement('div');
    item.className = `profile-threshold-legend-item profile-color-stat--${threshold.tone}`;
    const label = document.createElement('span');
    label.className = 'profile-threshold-legend-label';
    label.textContent = threshold.label;
    item.append(label);
    container.appendChild(item);
  }
}

export function renderProfileThresholdStatGrid(container, stats, fieldPrefix) {
  if (!container) return;
  container.replaceChildren();
  for (const threshold of PROFILE_SURVIVAL_THRESHOLDS) {
    const tile = document.createElement('div');
    tile.className = `profile-color-stat profile-threshold-stat profile-color-stat--${threshold.tone}`;
    tile.setAttribute('aria-label', threshold.label);
    const value = document.createElement('span');
    value.className = 'profile-threshold-value';
    const key = `${fieldPrefix}_${threshold.seconds}s`;
    value.textContent = String(Math.floor(Number(stats?.[key] || 0)));
    tile.append(value);
    container.appendChild(tile);
  }
}

export function renderProfileSurvivalThresholdStats(stats, elements) {
  renderProfileThresholdLegend(elements.legend);
  renderProfileThresholdStatGrid(elements.runsOver, stats, 'runs_over');
  renderProfileThresholdStatGrid(elements.streaks, stats, 'current_streak_over');
  renderProfileThresholdStatGrid(elements.bestStreaks, stats, 'best_streak_over');
}
