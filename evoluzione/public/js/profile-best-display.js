/** Classi colore testo per PB ottenuto con un Premio Plus (palette allineata ai pallini bonus profilo). */
const PRIZE_TO_COLOR_CLASS = Object.freeze({
  red_plus: 'profile-best-time-plus--red',
  blue_plus: 'profile-best-time-plus--blue',
  yellow_plus: 'profile-best-time-plus--yellow',
  green_plus: 'profile-best-time-plus--green',
  purple_plus: 'profile-best-time-plus--purple',
});

/**
 * @param {HTMLElement | null} mainEl
 * @param {HTMLElement | null} pureRowEl
 * @param {{ generalMs: number, pureMs: number, prizeUsed?: string, fmt: (ms: number) => string }} opts
 */
export function fillProfileBestStatRows(mainEl, pureRowEl, opts) {
  const fmt = opts.fmt;
  const generalMs = Math.floor(Math.max(0, Number(opts.generalMs) || 0));
  const pureMs = Math.floor(Math.max(0, Number(opts.pureMs) || 0));
  const prizeUsed = opts.prizeUsed ? String(opts.prizeUsed).trim() : '';
  if (!mainEl) return;

  const prizeClass = prizeUsed && PRIZE_TO_COLOR_CLASS[prizeUsed] ? PRIZE_TO_COLOR_CLASS[prizeUsed] : '';

  const setMainPlain = (text) => {
    mainEl.textContent = text;
  };

  const setMainWithOptionalColoredTime = (labelPrefix, timeMs) => {
    mainEl.textContent = '';
    mainEl.appendChild(document.createTextNode(labelPrefix));
    const span = document.createElement('span');
    span.textContent = fmt(timeMs);
    if (prizeClass) span.className = prizeClass;
    mainEl.appendChild(span);
  };

  const hidePure = () => {
    if (pureRowEl) {
      pureRowEl.hidden = true;
      pureRowEl.textContent = '';
    }
  };

  const showPure = (text) => {
    if (pureRowEl) {
      pureRowEl.hidden = false;
      pureRowEl.textContent = text;
    }
  };

  if (generalMs < 1) {
    setMainPlain('Miglior tempo: —');
    hidePure();
    return;
  }

  if (pureMs >= 1 && generalMs === pureMs) {
    setMainPlain(`Miglior tempo: ${fmt(generalMs)}`);
    hidePure();
    return;
  }

  setMainWithOptionalColoredTime('Miglior tempo: ', generalMs);
  showPure(`Miglior tempo puro: ${pureMs >= 1 ? fmt(pureMs) : '—'}`);
}
