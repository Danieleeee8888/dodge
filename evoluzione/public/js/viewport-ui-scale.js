import { FIXED_GAME_W, FIXED_GAME_H } from './constants.js';

/**
 * Pixel CSS disponibili per adattare il canvas / scala UI. Allineato a game-engine.js.
 */
export function getViewportForCanvasScale() {
  const vv = window.visualViewport;
  if (vv && vv.width > 0 && vv.height > 0) {
    return { winW: vv.width, winH: vv.height, vx: vv.offsetLeft || 0, vy: vv.offsetTop || 0 };
  }
  return { winW: window.innerWidth, winH: window.innerHeight, vx: 0, vy: 0 };
}

/** Offset tra layout viewport e visual viewport (barre dinamiche, Chrome Android). */
export function syncVisualViewportInsetCssVars() {
  const vv = window.visualViewport;
  let gapBottom = 0;
  let gapTop = 0;
  if (vv && vv.width > 0 && vv.height > 0) {
    gapBottom = Math.max(0, window.innerHeight - vv.offsetTop - vv.height);
    gapTop = Math.max(0, vv.offsetTop);
  }
  document.documentElement.style.setProperty('--vv-layout-gap-bottom', `${gapBottom}px`);
  document.documentElement.style.setProperty('--vv-layout-gap-top', `${gapTop}px`);
}

/**
 * Aggiorna --vv-layout-gap-* e --ui-scale come sul resize del gioco (cerchi ⌂, padding basso).
 * Usare su pagine senza canvas (profilo pubblico, admin dock).
 */
export function applyGameViewportChromeVars() {
  syncVisualViewportInsetCssVars();
  const vp = getViewportForCanvasScale();
  const scale = Math.min(vp.winW / FIXED_GAME_W, vp.winH / FIXED_GAME_H);
  document.documentElement.style.setProperty('--ui-scale', String(scale));
  return { ...vp, scale };
}
