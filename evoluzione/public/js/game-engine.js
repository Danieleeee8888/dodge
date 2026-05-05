import {
  FIXED_GAME_W,
  FIXED_GAME_H,
  SLOW_DURATION_MS,
  SHIELD_DURATION_MS,
  CURSOR_LERP,
  SLOW_FACTOR,
  SLOW_OMEGA_FACTOR,
  AIM_CELL_PAD,
  AIM_SECTOR_INTERVAL_MS,
  SCREEN_MARGIN,
  PLAYER_BOUND_PAD,
  HAZARD_R,
  SPAWN_MIN_DIST,
  LEVEL_INTERVAL_MS,
  WHITE_START_TRIANGLES,
  WHITE_START_SQUARES,
  WHITE_ON_FIELD_MAX,
  BONUS_WALL_BOUNCES_MAX,
  RED_BONUS_FIRST_SPAWN_MS,
  RED_BONUS_SPAWN_EVERY_MS,
  BLUE_BONUS_FIRST_SPAWN_MS,
  BLUE_BONUS_SPAWN_EVERY_MS,
  YELLOW_BONUS_FIRST_SPAWN_MS,
  YELLOW_BONUS_SPAWN_EVERY_MS,
  GREEN_BONUS_FIRST_SPAWN_MS,
  GREEN_BONUS_SPAWN_EVERY_MS,
  PURPLE_BONUS_FIRST_SPAWN_MS,
  PURPLE_BONUS_SPAWN_EVERY_MS,
  GREEN_MODE_DURATION_MS,
  INTRO_CD_MS,
} from './constants.js';
import { auth, authPersistenceReady } from './firebase-init.js';
import {
  onAuthStateChanged,
  reload,
  signOut,
  sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getProfile, resolveDisplayName, updateDisplayName } from './profile.js';
import {
  saveScore, fetchLeaderboard, getCachedLeaderboard, applyOptimisticScore,
  invalidateLeaderboardUsernameMap,
} from './leaderboard.js';

let currentUserId = null;
/** Username account (fisso, registrazione). */
let currentUsername = '???';
/** Nome in menu / classifica (modificabile in profilo). */
let currentDisplayName = '???';
let currentUserEmail = '';
const GUEST_MODE_KEY = 'dodge_guest_mode';
let guestModeEnabled = false;

function isGuestModeActive() {
  return guestModeEnabled || !currentUserId;
}

function hasPasswordProvider(user) {
  return !!user?.providerData?.some((p) => p?.providerId === 'password');
}

const canvas = document.getElementById('c');
const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
const dodgeShell = document.getElementById('dodgeShell');
const screen = document.getElementById('screen');
const shieldHud = document.getElementById('shield-hud');
const slowHud = document.getElementById('slow-hud');
const sfill = document.getElementById('sfill');
const bluefill = document.getElementById('bluefill');
const greenModeHud = document.getElementById('green-mode-hud');
const greenmodefill = document.getElementById('greenmodefill');
const hudEl = document.getElementById('hud');
const tEl = document.getElementById('t');
const lvEl = document.getElementById('lv');
const nbEl = document.getElementById('nb');
const homeCornerBtn = document.getElementById('homeCornerBtn');
const audioCornerBtn = document.getElementById('audioCornerBtn');
const pauseOverlay = document.getElementById('pauseOverlay');
let deferredInstallPrompt = null;
let installNudgeEl = null;

let W, H;

function safeLocalGet(key, def) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? def : v;
  } catch (e) { return def; }
}
function safeLocalSet(key, val) {
  try { localStorage.setItem(key, val); } catch (e) {}
}

function isIOSLike() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  try {
    if (navigator.maxTouchPoints > 1 && /MacIntel|Mac OS X/i.test(navigator.platform || '')) return true;
  } catch (e) {}
  return false;
}

function isAndroidLike() {
  return /Android/i.test(navigator.userAgent || '');
}

function isStandaloneLike() {
  const iosStandalone = !!(window.navigator && window.navigator.standalone);
  const mediaStandalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  return iosStandalone || mediaStandalone;
}

function dismissInstallNudge() {
  if (installNudgeEl && installNudgeEl.parentNode) installNudgeEl.parentNode.removeChild(installNudgeEl);
  installNudgeEl = null;
}

async function triggerNativeInstallPrompt() {
  if (!deferredInstallPrompt) return false;
  try {
    const p = deferredInstallPrompt;
    deferredInstallPrompt = null;
    await p.prompt();
    await p.userChoice.catch(() => null);
    return true;
  } catch (e) {
    return false;
  }
}

function buildInstallNudgeText() {
  const onIOS = isIOSLike();
  const onAndroid = isAndroidLike();
  if (onIOS) {
    return {
      title: 'Installa DODGE',
      body: 'Per avere il gioco come app a schermo pieno su iPhone/iPad: tocca Condividi e poi "Aggiungi a Home".',
      action: 'Ho capito',
      actionIsNativePrompt: false,
    };
  }
  if (onAndroid) {
    return {
      title: 'Installa DODGE',
      body: 'Consigliato: installa il gioco sulla Home per avvio diretto in modalit? app.',
      action: 'Installa ora',
      actionIsNativePrompt: true,
    };
  }
  return {
    title: 'Installa DODGE',
    body: 'Per la migliore esperienza, installa il gioco dalla voce "Installa app" del browser.',
    action: 'Continua',
    actionIsNativePrompt: false,
  };
}

function showInstallNudgeIfNeeded() {
  if (isStandaloneLike()) return;
  if (installNudgeEl) return;
  const onIOS = isIOSLike();
  const onAndroid = isAndroidLike();
  // Android: mostra il nudge solo quando il browser conferma installabilit?.
  if (onAndroid && !deferredInstallPrompt) return;
  // Altri browser non-iOS: evita falsi positivi senza segnale installabile.
  if (!onIOS && !onAndroid && !deferredInstallPrompt) return;

  const cfg = buildInstallNudgeText();
  const wrap = document.createElement('div');
  wrap.id = 'installNudge';
  wrap.innerHTML = `
    <div class="install-nudge__card" role="dialog" aria-modal="true" aria-label="Installa app">
      <h3 class="install-nudge__title">${cfg.title}</h3>
      <p class="install-nudge__text">${cfg.body}</p>
      <div class="install-nudge__actions">
        <button type="button" class="install-nudge__btn install-nudge__btn--primary">${cfg.action}</button>
        <button type="button" class="install-nudge__btn install-nudge__btn--ghost">Pi? tardi</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  installNudgeEl = wrap;

  const primary = wrap.querySelector('.install-nudge__btn--primary');
  const later = wrap.querySelector('.install-nudge__btn--ghost');
  if (primary) {
    primary.addEventListener('click', async () => {
      if (cfg.actionIsNativePrompt) await triggerNativeInstallPrompt();
      dismissInstallNudge();
    });
  }
  if (later) {
    later.addEventListener('click', () => dismissInstallNudge());
  }
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  showInstallNudgeIfNeeded();
});
window.addEventListener('appinstalled', () => {
  dismissInstallNudge();
});

/** Fullscreen ?vero? sul documento quando supportato dal browser. */
function isDocumentFullscreenUsable() {
  const root = document.documentElement;
  if (!root) return false;
  const canCall = !!(root.requestFullscreen || root.webkitRequestFullscreen);
  if (!canCall) return false;
  const d = document;
  if (d.fullscreenEnabled === false || d.webkitFullscreenEnabled === false) return false;
  return true;
}

function isPageFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

async function requestAppFullscreen() {
  if (isPageFullscreen()) return true;
  if (!isDocumentFullscreenUsable()) return false;
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req) return false;
  try {
    const p = req.call(el);
    if (p && typeof p.then === 'function') await p;
    return true;
  } catch (e) {
    return false;
  }
}

function setupFullscreenAutostart() {
  let satisfied = false;
  let attempts = 0;
  const maxAttempts = 6;

  const tryEnter = async () => {
    if (satisfied || attempts >= maxAttempts) return;
    attempts++;
    const ok = await requestAppFullscreen();
    if (ok || isPageFullscreen()) {
      satisfied = true;
      return;
    }
    // Alcuni browser richiedono gesture utente o ritardi brevi.
    if (attempts < maxAttempts) setTimeout(tryEnter, 450);
  };

  const onFullscreenChange = () => {
    if (isPageFullscreen()) {
      satisfied = true;
    } else if (!satisfied) {
      void tryEnter();
    }
    resize();
  };

  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  document.addEventListener('click', () => { void tryEnter(); }, { passive: true, capture: true });
  document.addEventListener('touchstart', () => { void tryEnter(); }, { passive: true, capture: true });
  document.addEventListener('keydown', () => { void tryEnter(); }, { passive: true, capture: true });
  void tryEnter();
}

/**
 * Pixel CSS disponibili per adattare il canvas. Usa sempre le dimensioni reali del viewport
 * (visualViewport se disponibile, altrimenti innerWidth/Height) per evitare che la shell
 * con max-width limiti la larghezza del canvas in modalit? non-fullscreen.
 */
function getViewportForCanvasScale() {
  const vv = window.visualViewport;
  if (vv && vv.width > 0 && vv.height > 0) {
    return { winW: vv.width, winH: vv.height, vx: vv.offsetLeft || 0, vy: vv.offsetTop || 0 };
  }
  return { winW: window.innerWidth, winH: window.innerHeight, vx: 0, vy: 0 };
}

/** Offset tra layout viewport e visual viewport (gesture Android, barre dinamiche). */
function syncVisualViewportInsetCssVars() {
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

function resize() {
  syncVisualViewportInsetCssVars();
  if (!canvas) return;
  const { winW, winH, vx, vy } = getViewportForCanvasScale();
  W = FIXED_GAME_W;
  H = FIXED_GAME_H;
  canvas.width = W;
  canvas.height = H;
  const scale = Math.min(winW / W, winH / H);
  const dispW = W * scale;
  const dispH = H * scale;
  canvas.style.width = dispW + 'px';
  canvas.style.height = dispH + 'px';
  canvas.style.left = vx + (winW - dispW) * 0.5 + 'px';
  canvas.style.top = vy + (winH - dispH) * 0.5 + 'px';
  document.documentElement.style.setProperty('--ui-scale', String(scale));
}
resize();
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => { setTimeout(resize, 120); });
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', resize);
  window.visualViewport.addEventListener('scroll', resize);
}

/** Safari iOS: blocca pinch-zoom a livello gesture (il viewport meta non basta sempre). */
function preventDefaultNonPassive(e) {
  e.preventDefault();
}
try {
  document.addEventListener('gesturestart', preventDefaultNonPassive, { passive: false });
  document.addEventListener('gesturechange', preventDefaultNonPassive, { passive: false });
  document.addEventListener('gestureend', preventDefaultNonPassive, { passive: false });
} catch (e) {}
/** Zoom tastiera/trackpad (Chrome: ctrl+rotellina). */
window.addEventListener('wheel', (e) => {
  if (e.ctrlKey) e.preventDefault();
}, { passive: false });

// GAME STATE
const START_GAME_GUARD_MS = 700;
let running = false;
let paused = false, pausedAt = 0;
let px = -999, py = -999;          // cursore visibile (segue tx/ty con lerp)
let tx = -999, ty = -999;          // cursore target (dito/mouse)
let fingerDown = false;
/** Dopo una morte, impedisce restart immediato accidentale. */
let startGameUnlockAt = 0;
/** Touch: ?telecomando? ? tx/ty = pos giocatore all?ancora + (dito - punto tocco), non sotto il dito. */
let touchAnchFx = 0, touchAnchFy = 0, touchAnchPx = 0, touchAnchPy = 0;
let balls = [], parts = [], sparkles = [];
let startTime, elapsed;
let level, baseTriangles, baseSquares, baseSpeed;
let shieldActive, shieldEnd, slowActive, slowEnd;
let greenModeActive = false, greenModeEnd = 0;
let hasExtraLife = 0;
/** Prossimo istante in cui pu? comparire il pallino viola (performance.now). */
let nextPurpleAt = 0;
/** Espansione gialla rapida sui bianchi tolti dal bonus giallo. */
let yellowPopAuras = [];
/** Nuvoletta verde al rimpicciolimento (stesso stile dell?espansione gialla). */
let greenPopAuras = [];
/** Testi tipo arcade (salita + fade). Coordinate spazio gioco. */
let floatingTexts = [];
let lastRed, lastBlue, lastYellow, lastGreen, lastLevelUp;
/** Primo rosso a 15s (solo una volta a partita). */
let firstRedSpawned = false;
let firstBlueSpawned = false;
let firstYellowSpawned = false;
let firstGreenSpawned = false;
let bgPhase, flash, flashCol;
/** Rettangolo (cella griglia 3?3) che i bianchi devono attraversare; aggiornato a intervalli in base al player. */
let aimSectorRect = { left: 0, right: 0, top: 0, bottom: 0 };
let aimSectorNextElapsed = 0;
/** Avvio partita: { phase: 0..2 ? numeri 3,2,1, phaseEnd: timestamp }. */
let introCountdown = null;
/** Conto alla rovescia dopo ?ripresa? da pausa (scena visibile dietro). */
let resumeCountdown = null;
/** Timeout UI game over: va cancellato se si riparte prima che scada. */
let deathUiTimeoutId = null;

const cdOverlayEl = document.getElementById('countdownOverlay');
const cdInnerEl = document.getElementById('cdInner');
const cdNumEl = document.getElementById('cdNum');

let audioEnabled = safeLocalGet('dodge_audio', '1') !== '0';

function renderRecordsInto(el) {
  if (!el) return;
  const rec = getCachedLeaderboard();
  let body = '<h2>TOP 10 GLOBALE</h2><ol>';
  if (rec.length === 0) body += '<li class="rec-empty">nessun record ancora</li>';
  else {
    rec.forEach((row, i) => {
      const clsTop = i === 0 ? 'rec-r1' : '';
      const cls = `rec-row${clsTop ? ' ' + clsTop : ''}`;
      const isMe = row.uid === currentUserId ? ' rec-row--me' : '';
      const tag = (row.displayName || row.username || '???').slice(0, 12);
      body += `<li class="${cls}${isMe}"><span class="rec-row-left"><span class="rec-rank">${i + 1}.</span><span class="rec-tag">${tag}</span></span><span class="rec-time">${fmt(row.ms)}</span></li>`;
    });
  }
  body += '</ol>';
  el.innerHTML = body;
}
function syncAudioCornerBtn() {
  if (!audioCornerBtn) return;
  audioCornerBtn.classList.toggle('audio-on', audioEnabled);
  audioCornerBtn.classList.toggle('audio-off', !audioEnabled);
  audioCornerBtn.setAttribute('aria-pressed', audioEnabled ? 'true' : 'false');
  audioCornerBtn.setAttribute('aria-label', audioEnabled ? 'Disattiva audio' : 'Attiva audio');
  audioCornerBtn.title = audioEnabled ? 'Audio attivo ? tocca per silenziare' : 'Audio spento ? tocca per attivare';
}
function bindAudioCornerBtn() {
  if (!audioCornerBtn || audioCornerBtn.dataset.bound === '1') return;
  audioCornerBtn.dataset.bound = '1';
  const toggle = (e) => {
    e.stopPropagation();
    audioEnabled = !audioEnabled;
    safeLocalSet('dodge_audio', audioEnabled ? '1' : '0');
    syncAudioCornerBtn();
  };
  audioCornerBtn.addEventListener('click', toggle);
}
/** menu: solo titolo; play: HUD gioco senza audio/tutto-schermo; gameover: statistiche + controlli angolo. */
function updateShellForPhase(phase) {
  if (hudEl) {
    if (phase === 'menu') hudEl.classList.add('hud--hidden');
    else hudEl.classList.remove('hud--hidden');
  }
  if (audioCornerBtn) {
    if (phase === 'playing') audioCornerBtn.classList.add('audio-corner--hidden');
    else audioCornerBtn.classList.remove('audio-corner--hidden');
  }
  if (homeCornerBtn && phase === 'playing') {
    homeCornerBtn.classList.add('home-corner--hidden');
  }
}
// -- NAVIGAZIONE HOME SCREEN --------------------------------------------------

function showScreenView(name) {
  document.querySelectorAll('#screen .screen-view').forEach(v => { v.hidden = true; });
  const view = document.getElementById('view-' + name);
  if (view) view.hidden = false;
  screen.classList.toggle('screen-death', name === 'death');
  screen.style.cursor = name === 'death' ? 'pointer' : 'default';
  screen.style.display = 'flex';
  if (homeCornerBtn) {
    homeCornerBtn.classList.toggle('home-corner--hidden', name !== 'death');
  }
}

function hideScreen() {
  screen.style.display = 'none';
  if (homeCornerBtn) homeCornerBtn.classList.add('home-corner--hidden');
}

async function setupProfileView() {
  const viewProfile = document.getElementById('view-profile');
  const usernameEl = document.getElementById('profile-info-username');
  const bestEl = document.getElementById('profile-info-best');
  const displayInput = document.getElementById('profile-display-name');
  const emailEl = document.getElementById('profile-info-email');
  const msgEl = document.getElementById('profile-msg');
  const guest = isGuestModeActive();

  viewProfile?.classList.toggle('view-profile--guest', guest);
  document.querySelector('.profile-guest-stack')?.setAttribute('aria-hidden', guest ? 'false' : 'true');
  document.querySelector('.profile-account-only')?.setAttribute('aria-hidden', guest ? 'true' : 'false');

  if (guest) {
    if (usernameEl) usernameEl.textContent = 'Ospite (offline)';
    if (emailEl) emailEl.textContent = '';
    if (bestEl) bestEl.textContent = 'Miglior tempo personale: ? (solo sul dispositivo in questa sessione)';
    if (displayInput) {
      displayInput.value = '';
      displayInput.disabled = true;
    }
    if (msgEl) msgEl.textContent = '';
    return;
  }

  if (!currentUserId) return;
  if (displayInput) displayInput.disabled = false;
  const profile = await getProfile(currentUserId).catch(() => null);
  if (usernameEl) usernameEl.textContent = profile?.username || currentUsername || '???';
  if (emailEl) emailEl.textContent = currentUserEmail;
  if (msgEl) msgEl.textContent = '';
  const best = profile?.bestTime || 0;
  if (bestEl) {
    bestEl.textContent = best > 0
      ? `Miglior tempo personale: ${fmt(best)}`
      : 'Miglior tempo personale: ?';
  }
  if (displayInput) {
    const d = resolveDisplayName(profile);
    displayInput.value = d === '???' ? '' : d;
  }
}

let _navBound = false;
function bindHomeNav() {
  if (_navBound) return;
  _navBound = true;

  // GIOCA
  document.getElementById('btn-play')?.addEventListener('click', e => {
    e.stopPropagation();
    startGame();
  });

  const openLeaderboard = (e) => {
    e.stopPropagation();
    const lbEl = document.getElementById('records-block-lb');
    renderRecordsInto(lbEl);
    showScreenView('leaderboard');
    fetchLeaderboard(10).then(() => renderRecordsInto(lbEl)).catch(() => {});
  };
  document.getElementById('btn-home-leaderboard')?.addEventListener('click', openLeaderboard);

  // COME SI GIOCA
  document.getElementById('btn-howto')?.addEventListener('click', e => {
    e.stopPropagation();
    showScreenView('howto');
  });

  document.getElementById('btn-home-profile')?.addEventListener('click', async e => {
    e.stopPropagation();
    await setupProfileView();
    showScreenView('profile');
  });

  document.getElementById('btn-profile-goto-auth')?.addEventListener('click', e => {
    e.stopPropagation();
    window.location.href = '/auth.html';
  });

  const btnSaveDisplay = document.getElementById('btn-save-display');
  if (btnSaveDisplay && btnSaveDisplay.dataset.bound !== '1') {
    btnSaveDisplay.dataset.bound = '1';
    btnSaveDisplay.addEventListener('click', async (e) => {
      e.stopPropagation();
      const msgEl = document.getElementById('profile-msg');
      const input = document.getElementById('profile-display-name');
      if (!input || !currentUserId) return;
      if (msgEl) msgEl.textContent = 'Salvataggio?';
      try {
        await updateDisplayName(currentUserId, input.value);
        const profile = await getProfile(currentUserId);
        currentDisplayName = resolveDisplayName(profile);
        invalidateLeaderboardUsernameMap();
        await fetchLeaderboard(10).catch(() => {});
        setupMenuUI();
        if (msgEl) msgEl.textContent = 'Nome visualizzato aggiornato.';
      } catch (err) {
        if (msgEl) msgEl.textContent = err?.message || 'Errore. Riprova.';
      }
    });
  }

  // ? HOME (tutti i pulsanti back)
  document.querySelectorAll('.js-back-home').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      showScreenView('home');
    });
  });

  document.getElementById('homeCornerBtn')?.addEventListener('click', e => {
    e.stopPropagation();
    showScreenView('home');
    updateShellForPhase('menu');
  });

  // RESET PASSWORD
  document.getElementById('btn-reset-pw')?.addEventListener('click', async e => {
    e.stopPropagation();
    const msgEl = document.getElementById('profile-msg');
    if (!msgEl) return;
    msgEl.textContent = 'Invio?';
    try {
      await sendPasswordResetEmail(auth, currentUserEmail);
      msgEl.textContent = 'Email inviata! Controlla la casella.';
    } catch (err) {
      msgEl.textContent = 'Errore. Riprova.';
    }
  });

  // ESCI (logout)
  document.getElementById('btn-logout')?.addEventListener('click', async e => {
    e.stopPropagation();
    await signOut(auth).catch(() => {});
    window.location.href = '/auth.html';
  });
}

function setupMenuUI() {
  const nameEl = document.getElementById('menuPlayerName');
  if (nameEl) nameEl.textContent = isGuestModeActive() ? 'OSPITE OFFLINE' : currentDisplayName;
  const recEl = document.getElementById('records-block');
  const lbEl = document.getElementById('records-block-lb');
  const lbBtn = document.getElementById('btn-home-leaderboard');
  const profileBtn = document.getElementById('btn-home-profile');
  if (isGuestModeActive()) {
    if (recEl) recEl.innerHTML = '';
    if (lbBtn) lbBtn.hidden = false;
    if (profileBtn) profileBtn.hidden = false;
    if (lbEl) renderRecordsInto(lbEl);
  } else {
    if (lbBtn) lbBtn.hidden = false;
    if (profileBtn) profileBtn.hidden = false;
    renderRecordsInto(recEl);
    renderRecordsInto(lbEl);
  }
}

// ===================== AUDIO ENGINE =====================
let audioCtx = null;
let masterGain = null, masterFilter = null;
let convolver = null, wetGain = null, dryGain = null;

let droneOsc = null, droneOsc2 = null, droneFilter = null, droneGainNode = null, droneStopTimer = null;
let padNodes = [], padGain = null;
let beatIntervalId = null, hihatIntervalId = null, arpIntervalId = null;

const KEY_ROOT = 110;
const PAD_INTERVALS = [0, 3, 7, 12];
const ARP_SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22];

function st2hz(rootHz, semis) { return rootHz * Math.pow(2, semis / 12); }

function makeReverbBuffer(ac, dur, decay) {
  const rate = ac.sampleRate;
  const len = Math.floor(rate * dur);
  const buf = ac.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}
function initAudio() {
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = new AC();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.5;
      masterFilter = audioCtx.createBiquadFilter();
      masterFilter.type = 'lowpass';
      masterFilter.frequency.value = 8000;
      masterFilter.Q.value = 0.4;
      convolver = audioCtx.createConvolver();
      convolver.buffer = makeReverbBuffer(audioCtx, 2.6, 2.4);
      wetGain = audioCtx.createGain(); wetGain.gain.value = 0.18;
      dryGain = audioCtx.createGain(); dryGain.gain.value = 0.92;
      masterFilter.connect(dryGain);
      masterFilter.connect(convolver);
      convolver.connect(wetGain);
      dryGain.connect(masterGain);
      wetGain.connect(masterGain);
      masterGain.connect(audioCtx.destination);
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  } catch (e) {
    audioCtx = null;
    masterGain = masterFilter = convolver = wetGain = dryGain = null;
  }
}
function resumeAudioIfSuspended() {
  if (!audioCtx || audioCtx.state !== 'suspended') return;
  audioCtx.resume().catch(() => {});
}
document.addEventListener('touchstart', resumeAudioIfSuspended, { passive: true, capture: true });
document.addEventListener('click', resumeAudioIfSuspended, { passive: true, capture: true });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (running && !paused) togglePause();
  } else {
    resize();
    resumeAudioIfSuspended();
  }
});
window.addEventListener('pageshow', (e) => {
  if (e.persisted) resize();
  resumeAudioIfSuspended();
});
function playTone(freq, dur, vol, type, delay, opts) {
  if (!audioEnabled || !audioCtx || !masterFilter) return;
  type = type || 'sine'; delay = delay || 0; opts = opts || {};
  const ac = audioCtx;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.sweepTo) osc.frequency.exponentialRampToValueAtTime(opts.sweepTo, t0 + (opts.sweepTime || dur * 0.6));
  const g = ac.createGain();
  osc.connect(g); g.connect(masterFilter);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + (opts.attack || 0.008));
  g.gain.exponentialRampToValueAtTime(0.001, t0 + Math.max(dur, 0.02));
  osc.start(t0); osc.stop(t0 + Math.max(dur, 0.02) + 0.08);
}
function playNoise(dur, vol, delay, opts) {
  if (!audioEnabled || !audioCtx || !masterFilter) return;
  delay = delay || 0; opts = opts || {};
  const ac = audioCtx;
  const t0 = ac.currentTime + delay;
  const n = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < n; i++) ch[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filt = ac.createBiquadFilter();
  filt.type = opts.filterType || 'highpass';
  filt.frequency.value = opts.cutoff || 4000;
  filt.Q.value = opts.q || 0.7;
  const g = ac.createGain();
  src.connect(filt); filt.connect(g); g.connect(masterFilter);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + Math.max(dur, 0.02));
  src.start(t0); src.stop(t0 + Math.max(dur, 0.02) + 0.05);
}
function playKick(vol, delay) {
  if (!audioEnabled || !audioCtx) return;
  delay = delay || 0;
  const ac = audioCtx;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(140, t0);
  osc.frequency.exponentialRampToValueAtTime(38, t0 + 0.12);
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.32);
  osc.connect(g); g.connect(masterFilter);
  osc.start(t0); osc.stop(t0 + 0.36);
  playNoise(0.02, vol * 0.45, delay, { filterType: 'bandpass', cutoff: 1800, q: 1.2 });
}
function playSnare(vol, delay) {
  if (!audioEnabled || !audioCtx) return;
  delay = delay || 0;
  playNoise(0.13, vol * 0.55, delay, { filterType: 'highpass', cutoff: 1500 });
  playTone(220, 0.08, vol * 0.18, 'triangle', delay, { sweepTo: 140, sweepTime: 0.06 });
}
function playHat(vol, delay, open) {
  if (!audioEnabled || !audioCtx) return;
  playNoise(open ? 0.12 : 0.025, vol, delay, { filterType: 'highpass', cutoff: 7500, q: 0.6 });
}
function killDroneNow() {
  if (droneStopTimer !== null) { clearTimeout(droneStopTimer); droneStopTimer = null; }
  [droneOsc, droneOsc2].forEach((o) => {
    if (!o) return;
    try { o.stop(0); } catch (e) {}
    try { o.disconnect(); } catch (e) {}
  });
  if (droneFilter) try { droneFilter.disconnect(); } catch (e) {}
  if (droneGainNode) try { droneGainNode.disconnect(); } catch (e) {}
  droneOsc = null; droneOsc2 = null; droneFilter = null; droneGainNode = null;
  padNodes.forEach((n) => {
    try { n.osc.stop(0); } catch (e) {}
    try { n.osc.disconnect(); } catch (e) {}
    try { n.gain.disconnect(); } catch (e) {}
  });
  padNodes = [];
  if (padGain) { try { padGain.disconnect(); } catch (e) {} padGain = null; }
}
function startDrone() {
  if (!audioEnabled || !audioCtx || !masterFilter) return;
  killDroneNow();
  const ac = audioCtx;
  const osc = ac.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 55;
  const osc2 = ac.createOscillator(); osc2.type = 'sawtooth'; osc2.frequency.value = 55.4;
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220; lp.Q.value = 1.8;
  const g = ac.createGain(); g.gain.value = 0;
  osc.connect(lp); osc2.connect(lp); lp.connect(g); g.connect(masterFilter);
  const now = ac.currentTime;
  g.gain.linearRampToValueAtTime(0.16, now + 1.5);
  osc.start(now); osc2.start(now);
  droneOsc = osc; droneOsc2 = osc2; droneFilter = lp; droneGainNode = g;

  padGain = ac.createGain(); padGain.gain.value = 0;
  padGain.connect(masterFilter);
  padGain.gain.linearRampToValueAtTime(0.06, now + 3.0);
  PAD_INTERVALS.forEach((semi, i) => {
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.value = st2hz(KEY_ROOT * 2, semi);
    o.detune.value = (i - 1.5) * 4;
    const vg = ac.createGain(); vg.gain.value = 0.22 / PAD_INTERVALS.length;
    o.connect(vg); vg.connect(padGain);
    o.start(now);
    padNodes.push({ osc: o, gain: vg });
  });
}
function updateAudio(lv) {
  if (!audioEnabled || !audioCtx) return;
  const t = audioCtx.currentTime;
  if (droneOsc && droneOsc2 && droneFilter && droneGainNode) {
    const f = 55 + lv * 4;
    droneOsc.frequency.setTargetAtTime(f, t, 0.2);
    droneOsc2.frequency.setTargetAtTime(f + 0.6, t, 0.2);
    droneFilter.frequency.setTargetAtTime(220 + lv * 35, t, 0.3);
    droneGainNode.gain.setTargetAtTime(Math.min(0.16 + lv * 0.012, 0.28), t, 0.3);
  }
  if (masterFilter) masterFilter.frequency.setTargetAtTime(Math.min(8000 + lv * 200, 14000), t, 0.5);
}
function startBeat(lv) {
  if (!audioEnabled || !audioCtx) return;
  if (beatIntervalId !== null) { clearInterval(beatIntervalId); beatIntervalId = null; }
  if (hihatIntervalId !== null) { clearInterval(hihatIntervalId); hihatIntervalId = null; }
  if (arpIntervalId !== null) { clearInterval(arpIntervalId); arpIntervalId = null; }
  const BPM = Math.min(92 + (lv - 1) * 8, 160);
  const beatMs = 60000 / BPM;
  const halfMs = beatMs / 2;
  const sixteenthMs = beatMs / 4;

  let beatIndex = 0;
  beatIntervalId = setInterval(() => {
    const step = beatIndex % 8;
    if (step === 0 || step === 4) playKick(0.6);
    if (step === 2 || step === 6) playSnare(0.32);
    if (step === 0) playTone(st2hz(KEY_ROOT, 0), 0.22, 0.18, 'sine');
    if (step === 4) playTone(st2hz(KEY_ROOT, 0), 0.16, 0.12, 'sine');
    if (step === 7) playTone(st2hz(KEY_ROOT, -2), 0.18, 0.14, 'sine');
    beatIndex++;
  }, halfMs);

  let hihatIndex = 0;
  hihatIntervalId = setInterval(() => {
    const open = hihatIndex % 4 === 3;
    const v = open ? 0.10 : (hihatIndex % 2 === 0 ? 0.13 : 0.07);
    playHat(v, 0, open);
    hihatIndex++;
  }, halfMs);

  if (lv >= 2) {
    let arpIndex = 0;
    const stepRate = lv >= 5 ? sixteenthMs : sixteenthMs * 2;
    const noteCount = Math.min(4 + lv, ARP_SCALE.length);
    arpIntervalId = setInterval(() => {
      const which = arpIndex % noteCount;
      const semi = ARP_SCALE[which] + 12;
      const f = st2hz(KEY_ROOT, semi);
      playTone(f, 0.18, 0.12, 'triangle', 0, { attack: 0.005 });
      if (arpIndex % 4 === 0 && lv >= 4) playTone(st2hz(KEY_ROOT, semi + 7), 0.22, 0.06, 'sine');
      arpIndex++;
    }, stepRate);
  }
}
function clearBeatOnly() {
  if (beatIntervalId !== null) { clearInterval(beatIntervalId); beatIntervalId = null; }
  if (hihatIntervalId !== null) { clearInterval(hihatIntervalId); hihatIntervalId = null; }
  if (arpIntervalId !== null) { clearInterval(arpIntervalId); arpIntervalId = null; }
}
function playSoundBonus(type) {
  if (type === 'red') {
    const notes = [0, 4, 7, 12, 16];
    notes.forEach((s, i) => {
      const f = st2hz(KEY_ROOT * 2, s);
      playTone(f, 0.22, 0.18, 'sine', i * 0.06);
      playTone(f * 2, 0.18, 0.05, 'triangle', i * 0.06);
    });
    playNoise(0.08, 0.08, 0, { filterType: 'highpass', cutoff: 6000 });
  } else if (type === 'blue') {
    const notes = [12, 7, 3, 0, -5];
    notes.forEach((s, i) => {
      const f = st2hz(KEY_ROOT * 2, s);
      playTone(f, 0.32, 0.16, 'sine', i * 0.08);
      playTone(f * 1.5, 0.22, 0.05, 'sine', i * 0.08 + 0.02);
    });
    playNoise(0.12, 0.06, 0, { filterType: 'lowpass', cutoff: 2000 });
  } else if (type === 'yellow') {
    const notes = [0, 2, 4, 7, 9, 12];
    notes.forEach((s, i) => {
      const f = st2hz(KEY_ROOT * 2, s);
      playTone(f, 0.26, 0.14, 'triangle', i * 0.045);
    });
    playNoise(0.06, 0.05, 0, { filterType: 'bandpass', cutoff: 2500, q: 0.6 });
  } else if (type === 'green') {
    [0, 5, 9, 12, 17].forEach((s, i) => {
      playTone(st2hz(KEY_ROOT * 2, s), 0.2, 0.14, 'sine', i * 0.055);
    });
    playNoise(0.05, 0.06, 0, { filterType: 'highpass', cutoff: 3500 });
  } else if (type === 'purple') {
    [3, 7, 10, 14, 19].forEach((s, i) => {
      playTone(st2hz(KEY_ROOT * 2, s), 0.24, 0.15, 'sine', i * 0.05);
      playTone(st2hz(KEY_ROOT * 2, s + 3), 0.16, 0.06, 'triangle', i * 0.05 + 0.02);
    });
    playNoise(0.07, 0.07, 0, { filterType: 'bandpass', cutoff: 3200, q: 0.8 });
  }
}
function playSoundDie() {
  playTone(220, 0.6, 0.45, 'sawtooth', 0, { sweepTo: 35, sweepTime: 0.5 });
  playTone(110, 0.9, 0.35, 'sine', 0.05, { sweepTo: 28, sweepTime: 0.7 });
  playNoise(0.7, 0.45, 0, { filterType: 'lowpass', cutoff: 4000 });
  playNoise(0.4, 0.25, 0, { filterType: 'highpass', cutoff: 8000 });
}
function stopMusic() {
  clearBeatOnly();
  if (!audioCtx) return;
  if (droneStopTimer !== null) { clearTimeout(droneStopTimer); droneStopTimer = null; }
  const ac = audioCtx;
  const t = ac.currentTime;
  if (droneGainNode) {
    droneGainNode.gain.cancelScheduledValues(t);
    const v = Math.max(0.0001, droneGainNode.gain.value);
    droneGainNode.gain.setValueAtTime(v, t);
    droneGainNode.gain.linearRampToValueAtTime(0, t + 1.5);
  }
  if (padGain) {
    padGain.gain.cancelScheduledValues(t);
    const v = Math.max(0.0001, padGain.gain.value);
    padGain.gain.setValueAtTime(v, t);
    padGain.gain.linearRampToValueAtTime(0, t + 1.5);
  }
  droneStopTimer = setTimeout(() => { droneStopTimer = null; killDroneNow(); }, 1700);
}
function pauseAllMusic() {
  clearBeatOnly();
  if (droneStopTimer !== null) { clearTimeout(droneStopTimer); droneStopTimer = null; }
  killDroneNow();
  if (masterGain && audioCtx) {
    const t = audioCtx.currentTime;
    masterGain.gain.cancelScheduledValues(t);
    masterGain.gain.setValueAtTime(0, t);
  }
}
function resumeMusicAfterPause() {
  if (!audioCtx || !masterGain) return;
  const t = audioCtx.currentTime;
  masterGain.gain.cancelScheduledValues(t);
  masterGain.gain.setValueAtTime(0.0001, t);
  masterGain.gain.linearRampToValueAtTime(0.5, t + 0.12);
  if (audioEnabled) {
    startDrone();
    startBeat(level);
    updateAudio(level);
  }
}
// ===================== END AUDIO =====================

function fmt(ms) {
  const totalMs = Math.max(0, Math.floor(Number(ms) || 0));
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(millis).padStart(3, '0')}`;
}
function rand(a,b){ return a+Math.random()*(b-a); }

// MOVEMENT + SHAPE ? bianchi: solo triangolo (retto) e quadrato (spirale); cerchi solo bonus.
function pickWhiteMovementBalanced() {
  let nS = 0, nSp = 0;
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    if (b.type !== 'white') continue;
    if (b.movement === 'straight') nS++;
    else if (b.movement === 'spiral') nSp++;
  }
  const min = Math.min(nS, nSp);
  const pick = [];
  if (nS === min) pick.push('straight');
  if (nSp === min) pick.push('spiral');
  return pick[Math.floor(Math.random() * pick.length)];
}

// Speed multiplier widens with level: salita pi? graduale (stesso intervallo livelli).
function getSpeedMul(type) {
  if (type === 'red' || type === 'blue' || type === 'yellow' || type === 'green' || type === 'purple') {
    return rand(0.95, 1.28 + level * 0.065);
  }
  const minSpd = Math.max(0.42, 0.70 - level * 0.018);
  const maxSpd = 1.00 + level * 0.11;
  return rand(minSpd, maxSpd);
}

function paddedGridCellBounds(col, row) {
  const cw = W / 3, ch = H / 3;
  const padX = Math.min(AIM_CELL_PAD, cw * 0.11);
  const padY = Math.min(AIM_CELL_PAD, ch * 0.11);
  return {
    left: col * cw + padX,
    right: (col + 1) * cw - padX,
    top: row * ch + padY,
    bottom: (row + 1) * ch - padY,
  };
}

/** Imposta aimSectorRect sulla cella 3?3 che contiene il cursore (fallback centro schermo). */
function syncAimSectorToPlayer() {
  let cx = px, cy = py;
  if (cx < -200 || cy < -200) {
    cx = W * 0.5;
    cy = H * 0.5;
  }
  let col = Math.floor(cx / (W / 3));
  let row = Math.floor(cy / (H / 3));
  col = Math.max(0, Math.min(2, col));
  row = Math.max(0, Math.min(2, row));
  aimSectorRect = paddedGridCellBounds(col, row);
}

function maybeRefreshAimSector(elapsed) {
  if (elapsed >= aimSectorNextElapsed) {
    syncAimSectorToPlayer();
    aimSectorNextElapsed = elapsed + AIM_SECTOR_INTERVAL_MS;
  }
}

function randomPointInAimSector() {
  const R = aimSectorRect;
  return { x: rand(R.left, R.right), y: rand(R.top, R.bottom) };
}
function pointInAimSector(px0, py0) {
  const R = aimSectorRect;
  return px0 >= R.left && px0 <= R.right && py0 >= R.top && py0 <= R.bottom;
}

/** Predice se il bianco entra nella cella di mira corrente nei primi frame. */
function whiteTrajectoryTouchesAimSector(b) {
  const samples = 100;
  const dtSim = 2;
  if (b.movement === 'straight') {
    let bx = b.x, by = b.y;
    for (let i = 0; i < samples; i++) {
      bx += b.vx * dtSim;
      by += b.vy * dtSim;
      if (pointInAimSector(bx, by)) return true;
      if (bx < -SCREEN_MARGIN - 100 || bx > W + SCREEN_MARGIN + 100 || by < -SCREEN_MARGIN - 100 || by > H + SCREEN_MARGIN + 100) break;
    }
    return false;
  }
  if (b.movement === 'spiral') {
    let cx = b.cx, cy = b.cy, ph = b.phase;
    for (let i = 0; i < samples; i++) {
      cx += b.cvx * dtSim;
      cy += b.cvy * dtSim;
      ph += b.omega * dtSim;
      const bx = cx + Math.cos(ph) * b.orbR;
      const by = cy + Math.sin(ph) * b.orbR;
      if (pointInAimSector(bx, by)) return true;
      if (cx < -SCREEN_MARGIN - 160 || cx > W + SCREEN_MARGIN + 160 || cy < -SCREEN_MARGIN - 160 || cy > H + SCREEN_MARGIN + 160) break;
    }
    return false;
  }
  return true;
}

function isBonusCircle(b) {
  return b.type === 'red' || b.type === 'blue' || b.type === 'yellow' || b.type === 'green' || b.type === 'purple';
}
/** Bonus: rimbalzano dentro lo schermo; ogni contatto bordo conta come rimbalzo (angoli possono +2 nello stesso frame). */
function clampBounceBonus(b) {
  const r = b.r + 1;
  for (let g = 0; g < 4; g++) {
    let n = 0;
    if (b.x < r) {
      b.x = r;
      b.vx = b.vx < 0 ? -b.vx : Math.max(b.vx, 0.08);
      n++;
    } else if (b.x > W - r) {
      b.x = W - r;
      b.vx = b.vx > 0 ? -b.vx : Math.min(b.vx, -0.08);
      n++;
    }
    if (b.y < r) {
      b.y = r;
      b.vy = b.vy < 0 ? -b.vy : Math.max(b.vy, 0.08);
      n++;
    } else if (b.y > H - r) {
      b.y = H - r;
      b.vy = b.vy > 0 ? -b.vy : Math.min(b.vy, -0.08);
      n++;
    }
    if (n === 0) break;
    b.bonusBounceCount = (b.bonusBounceCount || 0) + n;
  }
}

function spawnPositionCrowded(sx, sy) {
  const mdSq = SPAWN_MIN_DIST * SPAWN_MIN_DIST;
  for (let i = 0; i < balls.length; i++) {
    const o = balls[i];
    const dx = sx - o.x, dy = sy - o.y;
    if (dx * dx + dy * dy < mdSq) return true;
  }
  if (px > -200) {
    const dxp = sx - px, dyp = sy - py;
    const pr = SPAWN_MIN_DIST * 0.7;
    if (dxp * dxp + dyp * dyp < pr * pr) return true;
  }
  return false;
}

function restoreWhiteSpeedsAfterSlow() {
  balls.forEach((bb) => {
    if (bb.type !== 'white') return;
    bb.vx /= SLOW_FACTOR;
    bb.vy /= SLOW_FACTOR;
    if (bb.movement === 'spiral') {
      bb.cvx /= SLOW_FACTOR;
      bb.cvy /= SLOW_FACTOR;
      bb.omega /= SLOW_OMEGA_FACTOR;
    }
  });
}

/**
 * Toglie un terzo dei bianchi in campo, arrotondato per ECCESSO: ceil(n/3) da togliere.
 * Esempio: 14 bianchi ? toglie 5 ? restano 9. Al level-up (+1 tri +1 quad in quota) il target sale di 2 (es. 9?11).
 * Abbassa le quote target (tri / spirali) come i tipi effettivamente rimossi.
 */
function removeThirdOfWhites(withYellowFx) {
  const whites = balls.filter((b) => b.type === 'white');
  const n = whites.length;
  if (n < 1) return;
  const removeCount = Math.ceil(n / 3);
  if (removeCount <= 0) return;
  const shuffled = whites.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = t;
  }
  const victims = shuffled.slice(0, removeCount);
  let rT = 0, rS = 0;
  const t0 = performance.now();
  for (let k = 0; k < victims.length; k++) {
    if (victims[k].movement === 'spiral') rS++;
    else rT++;
    if (withYellowFx) {
      yellowPopAuras.push({ x: victims[k].x, y: victims[k].y, start: t0 });
      burst(victims[k].x, victims[k].y, '#fff4a8', 5);
      burst(victims[k].x, victims[k].y, '#e9c81a', 7);
    }
  }
  const removeSet = new Set(victims);
  for (let i = balls.length - 1; i >= 0; i--) {
    if (removeSet.has(balls[i])) balls.splice(i, 1);
  }
  baseTriangles = Math.max(WHITE_START_TRIANGLES, baseTriangles - rT);
  baseSquares = Math.max(WHITE_START_SQUARES, baseSquares - rS);
}

function applyGreenModeToWhite(b, enabled) {
  if (!b || b.type !== 'white') return;
  b.greenBubble = !!enabled;
  b.r = enabled ? HAZARD_R * 0.5 : HAZARD_R;
}

function applyGreenModeToWhites(enabled) {
  for (let i = 0; i < balls.length; i++) applyGreenModeToWhite(balls[i], enabled);
}

/** Lampeggio dopo il 3? contatto bordo, fino al 4? (poi il bonus sparisce). */
function bonusPickupBlinkMul(now, b) {
  if (!b || !isBonusCircle(b)) return 1;
  const c = b.bonusBounceCount || 0;
  if (c < BONUS_WALL_BOUNCES_MAX - 1) return 1;
  return 0.22 + 0.78 * (0.5 + 0.5 * Math.sin(now * 0.024));
}

const FLOAT_TEXT_LIFE_MS = 1650;

function spawnFloatingText(gx, gy, text, color) {
  floatingTexts.push({
    x: gx,
    y: gy,
    text,
    color,
    start: performance.now(),
    lifeMs: FLOAT_TEXT_LIFE_MS,
  });
}

function updateAndDrawFloatingTexts(now, dt) {
  const rise = 48 * dt;
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const ft = floatingTexts[i];
    const age = now - ft.start;
    if (age >= ft.lifeMs) {
      floatingTexts.splice(i, 1);
      continue;
    }
    ft.y -= rise;
    const u = age / ft.lifeMs;
    const alpha = (1 - u) * (1 - u);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.62)';
    ctx.fillStyle = ft.color;
    ctx.strokeText(ft.text, ft.x, ft.y);
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.restore();
  }
}

function constructWhiteBallOnce(opts) {
  opts = opts || {};
  const side = Math.floor(Math.random() * 4);
  let x, y;
  if (side === 0) { x = rand(0, W); y = -15; }
  else if (side === 1) { x = W + 15; y = rand(0, H); }
  else if (side === 2) { x = rand(0, W); y = H + 15; }
  else { x = -15; y = rand(0, H); }

  const movement = opts.movement || (opts.straight ? 'straight' : pickWhiteMovementBalanced());
  const pass = randomPointInAimSector();
  const aimX = pass.x, aimY = pass.y;

  const speedMul = getSpeedMul('white');
  const spd = baseSpeed * (slowActive ? SLOW_FACTOR : 1) * speedMul;

  const spread = opts.directAtPlayer ? 0 : rand(-0.11, 0.11);
  const ang = Math.atan2(aimY - y, aimX - x) + spread;
  let vx = Math.cos(ang) * spd;
  let vy = Math.sin(ang) * spd;

  const shape = movement === 'straight' ? 'triangle' : 'square';
  const b = {
    x, y, vx, vy, curv: 0, movement, shape, r: HAZARD_R, col: '#ffffff', type: 'white',
    trail: [],
    rotation: Math.random() * Math.PI * 2,
    rotSpeed: rand(-0.06, 0.06),
  };

  if (movement === 'spiral') {
    b.cvx = vx; b.cvy = vy;
    const spiralRMin = Math.max(46, Math.min(W, H) * 0.078);
    b.orbR = rand(spiralRMin, Math.max(spiralRMin + 24, 130));
    /* Tetto tangenziale pi? basso ai primi livelli (feedback: quadrati troppo veloci da subito); torna ~al vecchio 4.0 verso level 10. */
    const spiralTanMax = Math.min(4.0, 3.32 + level * 0.068);
    const tangentialSpeed = rand(1.2, spiralTanMax) * (1 + level * 0.04);
    b.omega = (tangentialSpeed / b.orbR) * (Math.random() < 0.5 ? -1 : 1);
    /* Come al pickup blu su spiral gi? in campo: senza questo, a fine slow omega viene divisa e risulta troppo alta ("scatto"). */
    if (slowActive) b.omega *= SLOW_OMEGA_FACTOR;
    b.phase = Math.random() * Math.PI * 2;
    // Il centro non pu? stare sul bordo con R grande: altrimenti il punto visibile nasce gi? nel campo.
    b.cx = x - Math.cos(b.phase) * b.orbR;
    b.cy = y - Math.sin(b.phase) * b.orbR;
    b.x = x;
    b.y = y;
    const advance = Math.hypot(b.cvx, b.cvy);
    const spinBoost = advance / Math.max(36, b.orbR * 0.5);
    b.rotSpeed = (Math.random() < 0.5 ? -1 : 1) * Math.min(
      0.26,
      Math.max(Math.abs(b.omega) * rand(1.55, 2.25), spinBoost * rand(1.0, 1.65)),
    );
  }

  if (greenModeActive) applyGreenModeToWhite(b, true);

  return b;
}

function spawnBall(type, opts) {
  opts = opts || {};

  if (type === 'white') {
    let b = constructWhiteBallOnce(opts);
    let att = 0;
    while (
      att < 56 &&
      (!whiteTrajectoryTouchesAimSector(b) || spawnPositionCrowded(b.x, b.y))
    ) {
      b = constructWhiteBallOnce(opts);
      att++;
    }
    balls.push(b);
    return;
  }

  let aimX = px, aimY = py;
  if (aimX < -200 || aimY < -200) { aimX = W / 2; aimY = H / 2; }

  let b = null;
  for (let att = 0; att < 40; att++) {
    const side = Math.floor(Math.random() * 4);
    let x, y;
    if (side === 0) { x = rand(0, W); y = -15; }
    else if (side === 1) { x = W + 15; y = rand(0, H); }
    else if (side === 2) { x = rand(0, W); y = H + 15; }
    else { x = -15; y = rand(0, H); }

    const movement = 'straight';
    const spread = rand(-0.18, 0.18);
    const ang = Math.atan2(aimY - y, aimX - x) + spread;

    const speedMul = getSpeedMul(type);
    const spd = baseSpeed * (slowActive ? SLOW_FACTOR : 1) * speedMul;
    let vx = Math.cos(ang) * spd;
    let vy = Math.sin(ang) * spd;

    const shape = 'circle';
    let col = '#e9c81a';
    if (type === 'red') col = '#ff4444';
    else if (type === 'blue') col = '#4488ff';
    else if (type === 'yellow') col = '#e9c81a';
    else if (type === 'green') col = '#34cc6e';
    else if (type === 'purple') col = '#a855f7';
    const r = HAZARD_R;

    b = {
      x, y, vx, vy, curv: 0, movement, shape, r, col, type,
      trail: [],
      rotation: 0,
      rotSpeed: rand(-0.06, 0.06),
      bonusBounceCount: 0,
    };

    b.pulse = Math.random() * Math.PI * 2;
    b.lastSparkle = 0;

    if (!spawnPositionCrowded(b.x, b.y)) break;
  }

  balls.push(b);
}

function burst(x,y,col,n){
  for(let i=0;i<n;i++){
    const a=Math.random()*Math.PI*2, s=rand(1,5);
    parts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,r:rand(1.5,4),alpha:1,col,life:rand(20,50)});
  }
}

/** Particelle azzurre su ogni bianco: rallentamento (blu) attivo o appena finito. */
function burstPufWhitesBlue() {
  for (let i = 0; i < balls.length; i++) {
    const wb = balls[i];
    if (wb.type !== 'white') continue;
    burst(wb.x, wb.y, '#c8ecff', 5);
    burst(wb.x, wb.y, '#4a9fff', 8);
  }
}

/** Particelle verdi su ogni bianco: modalit? verde on / off. */
function burstPufWhitesGreen() {
  for (let i = 0; i < balls.length; i++) {
    const wb = balls[i];
    if (wb.type !== 'white') continue;
    burst(wb.x, wb.y, '#d4ffe4', 6);
    burst(wb.x, wb.y, '#34cc6e', 9);
  }
}
function spawnSparkle(x, y, col) {
  const a = Math.random() * Math.PI * 2;
  const s = rand(0.3, 1.4);
  sparkles.push({
    x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
    r: rand(0.8, 2.2), life: rand(18, 36), maxLife: 36, col,
  });
}

function applyIntroCdVisual(n, col) {
  if (!cdNumEl || !cdInnerEl) return;
  cdNumEl.textContent = String(n);
  cdInnerEl.className = 'cd-inner cd-' + col;
  cdInnerEl.classList.remove('cd-popping');
  void cdInnerEl.offsetWidth;
  cdInnerEl.classList.add('cd-popping');
}

function finishIntroCountdown() {
  introCountdown = null;
  if (cdOverlayEl) {
    cdOverlayEl.classList.remove('show');
    cdOverlayEl.classList.remove('countdownOverlay--resume');
  }
  if (cdInnerEl) {
    cdInnerEl.className = 'cd-inner cd-r';
    cdInnerEl.classList.remove('cd-popping');
  }
  startTime = performance.now();
  elapsed = 0;
  nextPurpleAt = startTime + PURPLE_BONUS_FIRST_SPAWN_MS;
  lastRed = startTime;
  lastBlue = startTime;
  lastYellow = startTime;
  lastGreen = startTime;
  for (let i = 0; i < WHITE_START_TRIANGLES; i++) spawnBall('white', { movement: 'straight' });
  for (let i = 0; i < WHITE_START_SQUARES; i++) spawnBall('white', { movement: 'spiral' });
  setTimeout(() => {
    if (audioEnabled && running) {
      startDrone();
      startBeat(1);
    }
  }, 300);
}

function syncPowerHud(now) {
  if (shieldActive) {
    shieldHud.style.display = 'flex';
    sfill.style.height = Math.max(0, (shieldEnd - now) / SHIELD_DURATION_MS * 100) + '%';
  } else {
    shieldHud.style.display = 'none';
  }
  if (slowActive) {
    slowHud.style.display = 'flex';
    bluefill.style.height = Math.max(0, (slowEnd - now) / SLOW_DURATION_MS * 100) + '%';
  } else {
    slowHud.style.display = 'none';
  }
  if (greenModeHud && greenmodefill) {
    if (greenModeActive && now < greenModeEnd) {
      greenModeHud.style.display = 'block';
      greenmodefill.style.width = Math.max(0, (greenModeEnd - now) / GREEN_MODE_DURATION_MS * 100) + '%';
    } else {
      greenModeHud.style.display = 'none';
    }
  }
}

function startGame() {
  if (performance.now() < startGameUnlockAt) return;
  if (deathUiTimeoutId != null) {
    clearTimeout(deathUiTimeoutId);
    deathUiTimeoutId = null;
  }
  fingerDown = false;
  paused = false;
  if (pauseOverlay) pauseOverlay.style.display = 'none';
  screen.classList.remove('screen-death');
  screen.style.background = '';
  if (audioEnabled) initAudio();
  stopMusic();
  hideScreen();
  running = true;
  updateShellForPhase('playing');
  balls = []; parts = []; sparkles = [];
  floatingTexts = [];
  firstRedSpawned = false;
  firstBlueSpawned = false;
  firstYellowSpawned = false;
  firstGreenSpawned = false;
  level = 1;
  baseTriangles = WHITE_START_TRIANGLES;
  baseSquares = WHITE_START_SQUARES;
  baseSpeed = 2.2;
  shieldActive = false; slowActive = false;
  greenModeActive = false; greenModeEnd = 0;
  hasExtraLife = 0;
  yellowPopAuras = [];
  greenPopAuras = [];
  syncPowerHud(performance.now());
  lastLevelUp = 0;
  bgPhase = 0; flash = 0; flashCol = 'rgba(255,255,255,0.2)';
  const [cx, cy] = getPlayerSpawnXY();
  px = cx; py = cy; tx = cx; ty = cy;
  syncAimSectorToPlayer();
  aimSectorNextElapsed = 0;
  resumeCountdown = null;
  const t0 = performance.now();
  introCountdown = { phase: 0, phaseEnd: t0 + INTRO_CD_MS };
  if (cdOverlayEl) {
    cdOverlayEl.classList.remove('countdownOverlay--resume');
    cdOverlayEl.classList.add('show');
  }
  applyIntroCdVisual(3, 'r');
}

function die() {
  if (shieldActive) {
    shieldActive = false;
    syncPowerHud(performance.now());
    flash = 1; flashCol = 'rgba(255,68,68,0.5)';
    burst(px, py, '#ff4444', 24);
    return;
  }
  if (hasExtraLife > 0) {
    const consumedIndex = hasExtraLife - 1;
    hasExtraLife--;
    const now = performance.now();
    syncPowerHud(now);
    const sat = getExtraLifeSatelliteState(consumedIndex, now);
    const sx = sat.x;
    const sy = sat.y;
    flash = 0.72; flashCol = 'rgba(168,85,247,0.32)';
    burst(sx, sy, '#ffffff', 6);
    burst(sx, sy, '#ede0ff', 12);
    burst(sx, sy, '#c4a0ff', 16);
    burst(sx, sy, '#a855f7', 12);
    burst(sx, sy, '#6b21a8', 8);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
      spawnSparkle(sx + Math.cos(a) * (4 + Math.random() * 8), sy + Math.sin(a) * (4 + Math.random() * 8), i % 2 ? '#e9d5ff' : '#c084fc');
    }
    if (audioEnabled) playSoundBonus('purple');
    return;
  }
  if (audioEnabled) playSoundDie();
  shieldActive = false;
  slowActive = false;
  greenModeActive = false; greenModeEnd = 0;
  hasExtraLife = 0;
  syncPowerHud(performance.now());
  stopMusic();
  running = false;
  fingerDown = false;
  paused = false;
  resumeCountdown = null;
  if (pauseOverlay) pauseOverlay.style.display = 'none';
  if (cdOverlayEl) {
    cdOverlayEl.classList.remove('show');
    cdOverlayEl.classList.remove('countdownOverlay--resume');
  }
  const diedElapsed = elapsed;
  const diedLevel = level;
  const diedNb = balls.filter(b => b.type === 'white').length;
  burst(px,py,'#fff',40);
  startGameUnlockAt = performance.now() + START_GAME_GUARD_MS;
  if (deathUiTimeoutId != null) {
    clearTimeout(deathUiTimeoutId);
    deathUiTimeoutId = null;
  }
  deathUiTimeoutId = setTimeout(async () => {
    deathUiTimeoutId = null;
    if (running) return;
    tEl.textContent = fmt(diedElapsed);
    lvEl.textContent = String(diedLevel);
    nbEl.textContent = String(diedNb);
    updateShellForPhase('gameover');
    // Aggiorna testo tempo nel view-death pre-costruito
    const deathTimeEl = document.getElementById('death-time');
    if (deathTimeEl) deathTimeEl.textContent = `sopravvissuto ${fmt(diedElapsed)}`;
    const recEl = document.getElementById('records-block');
    showScreenView('death');

    if (!isGuestModeActive() && currentUserId) {
      const user = auth.currentUser;
      if (!user || !user.emailVerified) {
        // Email non verificata: mostra avviso, non tentare il salvataggio
        if (recEl) recEl.innerHTML = '<p class="rec-saving">verifica l\'email per salvare i record ? controlla anche lo spam</p>';
      } else {
        if (recEl) recEl.innerHTML = '<p class="rec-saving">salvataggio???</p>';
        applyOptimisticScore(currentUserId, currentDisplayName, diedElapsed);
        renderRecordsInto(recEl);
        const result = await saveScore(currentUserId, diedElapsed);
        if (!result || !result.ok) {
          const msg = result?.reason === 'permission'
            ? 'verifica l\'email per salvare i record'
            : 'errore di rete ? punteggio non salvato';
          if (recEl) recEl.innerHTML = `<p class="rec-saving">${msg}</p>`;
        } else {
          if (result.improved && result.inTop10) {
            const badge = document.createElement('p');
            badge.className = 'rec-saving rec-saving--highlight';
            badge.textContent = 'nuovo record in classifica!';
            if (recEl) recEl.insertAdjacentElement('afterbegin', badge);
          } else if (result.improved) {
            const badge = document.createElement('p');
            badge.className = 'rec-saving';
            badge.textContent = 'record personale!';
            if (recEl) recEl.insertAdjacentElement('afterbegin', badge);
          }
          renderRecordsInto(recEl);
        }
      }
    } else {
      if (recEl) recEl.innerHTML = '';
    }
    setupMenuUI();
  }, 600);
}

function togglePause() {
  if (!running) return;
  if (introCountdown) return;
  if (resumeCountdown) return;

  if (!paused) {
    paused = true;
    pausedAt = performance.now();
    if (pauseOverlay) pauseOverlay.style.display = 'flex';
    pauseAllMusic();
    return;
  }

  if (pauseOverlay) pauseOverlay.style.display = 'none';
  const t0 = performance.now();
  resumeCountdown = { phase: 0, phaseEnd: t0 + INTRO_CD_MS };
  if (cdOverlayEl) {
    cdOverlayEl.classList.add('show');
    cdOverlayEl.classList.add('countdownOverlay--resume');
  }
  applyIntroCdVisual(3, 'r');
}

// INPUT ? coordinate schermo ? area di gioco fissa (stesso bounding del canvas scalato)
function clientToGame(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const rw = Math.max(1e-6, r.width);
  const rh = Math.max(1e-6, r.height);
  let gx = (clientX - r.left) * (W / rw);
  let gy = (clientY - r.top) * (H / rh);
  gx = Math.max(0, Math.min(W, gx));
  gy = Math.max(0, Math.min(H, gy));
  return [gx, gy];
}
function getXY(e) {
  const t = e.touches ? e.touches[0] : e;
  return clientToGame(t.clientX, t.clientY);
}
/** Tiene il target giocatore dentro lo schermo (allineato al raggio visivo, non ~48px). */
function clampPlayerTarget(cx, cy) {
  const m = PLAYER_BOUND_PAD;
  return [
    Math.min(W - m, Math.max(m, cx)),
    Math.min(H - m, Math.max(m, cy)),
  ];
}
/** Spawn: centro orizzontale, circa un terzo dall?alto (zona alta del campo). */
function getPlayerSpawnXY() {
  return clampPlayerTarget(W * 0.5, H / 3);
}
function applyTouchRelativeTarget(fx, fy) {
  const nx = touchAnchPx + (fx - touchAnchFx);
  const ny = touchAnchPy + (fy - touchAnchFy);
  const [cx, cy] = clampPlayerTarget(nx, ny);
  tx = cx;
  ty = cy;
  /* Se il bordo ha ?tagliato? il movimento, l?ancora deve seguire il dito: altrimenti il delta
   * accumula slop oltre il limite e al ritorno dal bordo c?? ritardo. */
  const slip = 1e-4;
  if (Math.abs(nx - cx) > slip || Math.abs(ny - cy) > slip) {
    touchAnchFx = fx;
    touchAnchFy = fy;
    touchAnchPx = cx;
    touchAnchPy = cy;
  }
}
function isControlTarget(el) {
  if (!el) return false;
  if (el.id === 'audioCornerBtn' || (el.closest && el.closest('#audioCornerBtn'))) return true;
  if (el.id === 'homeCornerBtn' || (el.closest && el.closest('#homeCornerBtn'))) return true;
  // Blocca startGame se siamo sulla home screen (non death)
  if (screen && screen.style.display !== 'none' && !screen.classList.contains('screen-death')) return true;
  // Blocca i pulsanti js-no-start anche nel death screen (HOME, RIPROVA)
  if (el.closest && el.closest('.js-no-start')) return true;
  return false;
}

window.addEventListener('mousedown', e=>{
  if (isControlTarget(e.target)) return;
  if (!running && e.target.closest('.js-no-start')) return;
  if (running && paused && !resumeCountdown) return;
  const [x,y]=getXY(e);
  if(!running){ startGame(); }
  const [cx, cy] = clampPlayerTarget(x, y);
  // primo touch della partita: snap immediato
  if (px < -200) { px = cx; py = cy; }
  tx = cx; ty = cy;
  fingerDown = true;
});
window.addEventListener('mousemove', e=>{
  if (!fingerDown || paused) return;
  const [x, y] = getXY(e);
  const [cx, cy] = clampPlayerTarget(x, y);
  tx = cx; ty = cy;
});
window.addEventListener('mouseup', ()=>{ fingerDown=false; });

window.addEventListener('touchstart', e=>{
  if (isControlTarget(e.target)) return;
  if (running && e.touches.length >= 2) {
    e.preventDefault();
    togglePause();
    return;
  }
  if (running && paused && !resumeCountdown) {
    e.preventDefault();
    return;
  }
  if (!running && e.target.closest('.js-no-start')) return;
  e.preventDefault();
  const [x,y]=getXY(e);
  if(!running){ startGame(); }
  // primo touch: il giocatore parte al centro (mai sotto il dito); poi solo delta.
  if (px < -200) {
    const [sx, sy] = getPlayerSpawnXY();
    px = sx; py = sy;
    tx = sx; ty = sy;
  }
  touchAnchFx = x;
  touchAnchFy = y;
  touchAnchPx = px;
  touchAnchPy = py;
  applyTouchRelativeTarget(x, y);
  fingerDown=true;
},{passive:false});
window.addEventListener('touchmove', e=>{
  if (!running || paused) return;
  e.preventDefault();
  const [x,y] = getXY(e);
  applyTouchRelativeTarget(x, y);
},{passive:false});
function syncFingerDownFromTouches(e) {
  if (running) e.preventDefault();
  fingerDown = e.touches.length > 0;
}
window.addEventListener('touchend', syncFingerDownFromTouches, { passive: false });
window.addEventListener('touchcancel', syncFingerDownFromTouches, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  if (e.repeat) return;
  const el = e.target;
  if (el instanceof Element && el.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (!running) return;
  e.preventDefault();
  togglePause();
});

// SHAPE DRAWING
function drawShape(b, x, y, r, alpha) {
  ctx.globalAlpha = alpha == null ? 1 : alpha;
  ctx.fillStyle = b.col;
  if (b.shape === 'circle') {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  } else if (b.shape === 'triangle') {
    const ang = Math.atan2(b.vy, b.vx);
    const h = r * 1.45;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(h, 0);
    ctx.lineTo(-h * 0.65, h * 0.78);
    ctx.lineTo(-h * 0.65, -h * 0.78);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  } else if (b.shape === 'square') {
    const s = r * 1.05;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(b.rotation);
    ctx.fillRect(-s, -s, s * 2, s * 2);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

/** Raggio ?morso? del giocatore attorno a (px,py), come il vecchio hitR = b.r + 20 */
const PLAYER_HIT_R = 20;

function circleHitsPlayer(b, px, py) {
  const dx = b.x - px;
  const dy = b.y - py;
  const rs = b.r + PLAYER_HIT_R;
  return dx * dx + dy * dy < rs * rs;
}

function distSqPointSeg(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  let t = ab2 > 1e-12 ? (apx * abx + apy * aby) / ab2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * abx;
  const qy = ay + t * aby;
  const dx = px - qx;
  const dy = py - qy;
  return dx * dx + dy * dy;
}

function pointInTriangle(lx, ly, x0, y0, x1, y1, x2, y2) {
  function sign(px, py, ax, ay, bx, by) {
    return (px - bx) * (ay - by) - (ax - bx) * (py - by);
  }
  const d1 = sign(lx, ly, x0, y0, x1, y1);
  const d2 = sign(lx, ly, x1, y1, x2, y2);
  const d3 = sign(lx, ly, x2, y2, x0, y0);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/** Triangolo allineato come drawShape; disco giocatore raggio PLAYER_HIT_R */
function triangleHitsPlayer(b, px, py) {
  const r = b.r;
  const h = r * 1.45;
  const ang = Math.atan2(b.vy, b.vx);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const dx = px - b.x;
  const dy = py - b.y;
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;
  const x0 = h;
  const y0 = 0;
  const x1 = -h * 0.65;
  const y1 = h * 0.78;
  const x2 = -h * 0.65;
  const y2 = -h * 0.78;
  const pr2 = PLAYER_HIT_R * PLAYER_HIT_R;
  if (pointInTriangle(lx, ly, x0, y0, x1, y1, x2, y2)) return true;
  if (distSqPointSeg(lx, ly, x0, y0, x1, y1) < pr2) return true;
  if (distSqPointSeg(lx, ly, x1, y1, x2, y2) < pr2) return true;
  if (distSqPointSeg(lx, ly, x2, y2, x0, y0) < pr2) return true;
  return false;
}

function checkCollision(b, px, py) {
  if (b.shape === 'circle') return circleHitsPlayer(b, px, py);
  if (b.shape === 'triangle') return triangleHitsPlayer(b, px, py);
  /* quadrati: hitbox circolare sul centro come prima */
  return circleHitsPlayer(b, px, py);
}

// LOOP
let last=0;
function loop(now){
  requestAnimationFrame(loop);
  if (!ctx) return;
  const dt = Math.min((now-last)/16.67,3); last=now;

  ctx.fillStyle = '#000000';
  ctx.fillRect(0,0,W,H);

  if(!running){
    drawBg(now, 0);
    return;
  }

  if (introCountdown) {
    if (now >= introCountdown.phaseEnd) {
      introCountdown.phase++;
      if (introCountdown.phase >= 3) {
        finishIntroCountdown();
      } else {
        const n = 3 - introCountdown.phase;
        const col = introCountdown.phase === 1 ? 'b' : 'y';
        introCountdown.phaseEnd = now + INTRO_CD_MS;
        applyIntroCdVisual(n, col);
      }
    }
    drawBg(now, level);
    tEl.textContent = fmt(0);
    lvEl.textContent = '1';
    nbEl.textContent = '0';
    return;
  }

  if (resumeCountdown) {
    if (now >= resumeCountdown.phaseEnd) {
      resumeCountdown.phase++;
      if (resumeCountdown.phase >= 3) {
        const pauseDur = performance.now() - pausedAt;
        startTime += pauseDur;
        lastRed += pauseDur;
        lastBlue += pauseDur;
        lastYellow += pauseDur;
        lastGreen += pauseDur;
        if (shieldActive) shieldEnd += pauseDur;
        if (slowActive) slowEnd += pauseDur;
        if (greenModeActive) greenModeEnd += pauseDur;
        nextPurpleAt += pauseDur;
        yellowPopAuras.forEach((a) => { a.start += pauseDur; });
        greenPopAuras.forEach((a) => { a.start += pauseDur; });
        floatingTexts.forEach((ft) => { ft.start += pauseDur; });
        resumeCountdown = null;
        paused = false;
        if (cdOverlayEl) {
          cdOverlayEl.classList.remove('show');
          cdOverlayEl.classList.remove('countdownOverlay--resume');
        }
        last = 0;
        resumeMusicAfterPause();
      } else {
        const n = 3 - resumeCountdown.phase;
        const col = resumeCountdown.phase === 1 ? 'b' : 'y';
        resumeCountdown.phaseEnd = now + INTRO_CD_MS;
        applyIntroCdVisual(n, col);
      }
    }
    if (tx > -200) {
      const k = Math.min(1, CURSOR_LERP * dt);
      px += (tx - px) * k;
      py += (ty - py) * k;
    }
    drawBg(now, level);
    for (const b of balls) {
      if (b.type === 'red' || b.type === 'blue' || b.type === 'yellow' || b.type === 'green' || b.type === 'purple') drawBonusAura(b, now);
      const bonusA = isBonusCircle(b) ? bonusPickupBlinkMul(now, b) : 1;
      drawShape(b, b.x, b.y, b.r, bonusA);
    }
    updateAndDrawFloatingTexts(now, dt);
    drawPlayer(now);
    return;
  }

  if (paused) {
    drawBg(now, level);
    for (const b of balls) {
      if (b.type === 'red' || b.type === 'blue' || b.type === 'yellow' || b.type === 'green' || b.type === 'purple') drawBonusAura(b, now);
      const bonusA = isBonusCircle(b) ? bonusPickupBlinkMul(now, b) : 1;
      drawShape(b, b.x, b.y, b.r, bonusA);
    }
    updateAndDrawFloatingTexts(now, dt);
    drawPlayer(now);
    return;
  }

  elapsed = now - startTime;

  // cursor lerp ? traslazione anzich? teletrasporto
  if (tx > -200) {
    const k = Math.min(1, CURSOR_LERP * dt);
    px += (tx - px) * k;
    py += (ty - py) * k;
  }

  maybeRefreshAimSector(elapsed);

  // ogni 15s: +1 triangolo e +1 quadrato in quota (cap), livello su (audio)
  if (elapsed - lastLevelUp >= LEVEL_INTERVAL_MS) {
    lastLevelUp = elapsed;
    level++;
    if (baseTriangles + baseSquares < WHITE_ON_FIELD_MAX) {
      baseTriangles++;
      baseSquares++;
    }
    updateAudio(level);
    startBeat(level);
    flash = 0.5; flashCol = 'rgba(255,255,255,0.12)';
    if (audioEnabled) {
      [0, 4, 7, 12].forEach((s, i) => {
        playTone(st2hz(KEY_ROOT * 2, s), 0.22, 0.16, 'triangle', i * 0.05);
      });
    }
  }

  // spawn bonus ? tempi in `constants.js` (primo spawn / intervalli successivi)
  if (!firstRedSpawned && elapsed >= RED_BONUS_FIRST_SPAWN_MS) {
    firstRedSpawned = true;
    lastRed = now;
    spawnBall('red');
  } else if (firstRedSpawned && now - lastRed >= RED_BONUS_SPAWN_EVERY_MS) {
    lastRed = now;
    spawnBall('red');
  }
  if (!firstBlueSpawned && elapsed >= BLUE_BONUS_FIRST_SPAWN_MS) {
    firstBlueSpawned = true;
    lastBlue = now;
    spawnBall('blue');
  } else if (firstBlueSpawned && now - lastBlue >= BLUE_BONUS_SPAWN_EVERY_MS) {
    lastBlue = now;
    spawnBall('blue');
  }
  if (!firstYellowSpawned && elapsed >= YELLOW_BONUS_FIRST_SPAWN_MS) {
    firstYellowSpawned = true;
    lastYellow = now;
    spawnBall('yellow');
  } else if (firstYellowSpawned && now - lastYellow >= YELLOW_BONUS_SPAWN_EVERY_MS) {
    lastYellow = now;
    spawnBall('yellow');
  }
  if (!firstGreenSpawned && elapsed >= GREEN_BONUS_FIRST_SPAWN_MS) {
    firstGreenSpawned = true;
    lastGreen = now;
    spawnBall('green');
  } else if (firstGreenSpawned && now - lastGreen >= GREEN_BONUS_SPAWN_EVERY_MS) {
    lastGreen = now;
    spawnBall('green');
  }

  const purpleOnField = balls.some((b) => b.type === 'purple');
  if (hasExtraLife < 3 && !purpleOnField && now >= nextPurpleAt) {
    spawnBall('purple');
    nextPurpleAt = now + PURPLE_BONUS_SPAWN_EVERY_MS;
  }

  // timers
  if (shieldActive && now > shieldEnd) shieldActive = false;
  if (greenModeActive && now > greenModeEnd) {
    greenModeActive = false;
    applyGreenModeToWhites(false);
    burstPufWhitesGreen();
  }
  if (slowActive && now > slowEnd) {
    slowActive = false;
    restoreWhiteSpeedsAfterSlow();
    burstPufWhitesBlue();
  }
  syncPowerHud(now);

  bgPhase += 0.0003*(1+level*0.15)*dt;
  drawBg(now, level);

  // update + draw balls
  for(let i=balls.length-1;i>=0;i--){
    const b=balls[i];

    if (b.movement === 'spiral') {
      b.cx += b.cvx * dt;
      b.cy += b.cvy * dt;
      b.phase += b.omega * dt;
      const prevX = b.x, prevY = b.y;
      b.x = b.cx + Math.cos(b.phase) * b.orbR;
      b.y = b.cy + Math.sin(b.phase) * b.orbR;
      b.vx = (b.x - prevX) || b.cvx;
      b.vy = (b.y - prevY) || b.cvy;
    } else {
      // straight (triangoli bianchi, bonus rosso/blu) e altri
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (isBonusCircle(b)) clampBounceBonus(b);
    }

    if (isBonusCircle(b) && (b.bonusBounceCount || 0) >= BONUS_WALL_BOUNCES_MAX) {
      burst(b.x, b.y, '#ff4444', 14);
      burst(b.x, b.y, '#ff8888', 8);
      balls.splice(i, 1);
      continue;
    }

    b.rotation += b.rotSpeed * dt;

    b.trail.push({ x: b.x, y: b.y });
    if (b.trail.length > 7) b.trail.shift();

    if (b.type === 'red' || b.type === 'blue' || b.type === 'yellow' || b.type === 'green' || b.type === 'purple') {
      b.pulse += dt * 0.18;
      if (now - b.lastSparkle > 42) {
        spawnSparkle(b.x + rand(-b.r, b.r), b.y + rand(-b.r, b.r), b.col);
        b.lastSparkle = now;
      }
    }

    // Fuori schermo: respawn bianchi; i bonus cerchio rimbalzano e non vengono persi ai bordi.
    const cx = b.x, cy = b.y;
    if (!isBonusCircle(b)) {
      if (cx < -SCREEN_MARGIN || cx > W + SCREEN_MARGIN || cy < -SCREEN_MARGIN || cy > H + SCREEN_MARGIN) {
        balls.splice(i, 1);
        if (b.type === 'white') spawnBall('white', { movement: b.movement });
        continue;
      }
    }

    // collisione
    if(px>-200){
      if (checkCollision(b, px, py)) {
        if(b.type==='white'){ balls.splice(i,1); spawnBall('white', { movement: b.movement }); die(); continue; }
        if(b.type==='red'){
          shieldActive=true; shieldEnd=now+SHIELD_DURATION_MS;
          if (audioEnabled) playSoundBonus('red');
          spawnFloatingText(b.x, b.y, 'SCUDO', '#ff6b6b');
          burst(b.x,b.y,'#f44',22);
          flash=0.35; flashCol='rgba(255,68,68,0.18)';
          balls.splice(i,1);
          syncPowerHud(now);
          continue;
        }
        if(b.type==='blue'){
          const alreadySlow = slowActive;
          slowActive=true; slowEnd=now+SLOW_DURATION_MS;
          if (audioEnabled) playSoundBonus('blue');
          spawnFloatingText(b.x, b.y, 'RALLENTA', '#6eb3ff');
          if (!alreadySlow) {
            balls.forEach(bb=>{
              if(bb.type==='white'){
                bb.vx*=SLOW_FACTOR; bb.vy*=SLOW_FACTOR;
                if (bb.movement === 'spiral') {
                  bb.cvx*=SLOW_FACTOR; bb.cvy*=SLOW_FACTOR; bb.omega*=SLOW_OMEGA_FACTOR;
                }
              }
            });
            burstPufWhitesBlue();
          }
          burst(b.x,b.y,'#48f',22);
          flash=0.45; flashCol='rgba(68,136,255,0.28)';
          balls.splice(i,1);
          syncPowerHud(now);
          continue;
        }
        if(b.type==='yellow'){
          if (audioEnabled) playSoundBonus('yellow');
          spawnFloatingText(b.x, b.y, '- UN TERZO', '#f5e6a0');
          removeThirdOfWhites(true);
          burst(b.x,b.y,'#e9c81a',26);
          flash=0.4; flashCol='rgba(233,200,26,0.22)';
          // Non usare `i`: removeThirdOfWhites ha gi? mutato `balls`, l?indice del giallo ? cambiato.
          const yi = balls.indexOf(b);
          if (yi !== -1) balls.splice(yi, 1);
          continue;
        }
        if (b.type === 'purple') {
          hasExtraLife = Math.min(3, hasExtraLife + 1);
          if (audioEnabled) playSoundBonus('purple');
          spawnFloatingText(b.x, b.y, 'VITA IN PI?', '#e9d5ff');
          burst(b.x, b.y, '#e9d5ff', 24);
          burst(b.x, b.y, '#a855f7', 20);
          flash = 0.38; flashCol = 'rgba(168,85,247,0.22)';
          balls.splice(i, 1);
          syncPowerHud(now);
          continue;
        }
        if (b.type === 'green') {
          greenModeActive = true;
          greenModeEnd = now + GREEN_MODE_DURATION_MS;
          applyGreenModeToWhites(true);
          for (let wi = 0; wi < balls.length; wi++) {
            const wb = balls[wi];
            if (wb.type !== 'white') continue;
            greenPopAuras.push({ x: wb.x, y: wb.y, start: now });
          }
          burstPufWhitesGreen();
          if (audioEnabled) playSoundBonus('green');
          spawnFloatingText(b.x, b.y, 'RIMPICCIOLISCI', '#7af5a8');
          burst(b.x, b.y, '#34cc6e', 22);
          flash = 0.32; flashCol = 'rgba(52,200,110,0.22)';
          balls.splice(i, 1);
          syncPowerHud(now);
          continue;
        }
      }
    }

    if (b.type === 'red' || b.type === 'blue' || b.type === 'yellow' || b.type === 'green' || b.type === 'purple') drawBonusAura(b, now);

    const pickupBlink = isBonusCircle(b) ? bonusPickupBlinkMul(now, b) : 1;
    // trail
    for(let t=0;t<b.trail.length;t++){
      const tt = t / b.trail.length;
      ctx.globalAlpha = tt * 0.22 * pickupBlink;
      const tr = b.r * tt * 0.85;
      if (b.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(b.trail[t].x, b.trail[t].y, tr, 0, Math.PI * 2);
        ctx.fillStyle = b.col;
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(b.trail[t].x, b.trail[t].y, Math.max(1.5, tr * 0.6), 0, Math.PI * 2);
        ctx.fillStyle = b.col;
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    drawShape(b, b.x, b.y, b.r, pickupBlink);
  }

  let nTri = 0, nSqr = 0;
  for (let j = 0; j < balls.length; j++) {
    if (balls[j].type !== 'white') continue;
    if (balls[j].movement === 'spiral') nSqr++;
    else nTri++;
  }
  while (nTri < baseTriangles) {
    spawnBall('white', { movement: 'straight' });
    nTri++;
  }
  while (nSqr < baseSquares) {
    spawnBall('white', { movement: 'spiral' });
    nSqr++;
  }

  // sparkles
  for (let i = sparkles.length - 1; i >= 0; i--) {
    const sp = sparkles[i];
    sp.x += sp.vx * dt;
    sp.y += sp.vy * dt;
    sp.vx *= 0.96; sp.vy *= 0.96;
    sp.life -= dt;
    if (sp.life <= 0) { sparkles.splice(i, 1); continue; }
    ctx.globalAlpha = Math.max(0, sp.life / sp.maxLife);
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, sp.r, 0, Math.PI * 2);
    ctx.fillStyle = sp.col;
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // particles
  for(let i=parts.length-1;i>=0;i--){
    const p=parts[i];
    p.x+=p.vx*dt; p.y+=p.vy*dt;
    p.vx*=0.94; p.vy*=0.94;
    p.life-=dt; p.alpha=p.life/50;
    if(p.life<=0){parts.splice(i,1);continue;}
    ctx.globalAlpha=p.alpha;
    ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
    ctx.fillStyle=p.col; ctx.fill();
  }
  ctx.globalAlpha=1;

  updateAndDrawFloatingTexts(now, dt);

  drawPlayer(now);

  if(flash>0){
    ctx.fillStyle=flashCol;
    ctx.globalAlpha=flash;
    ctx.fillRect(0,0,W,H);
    ctx.globalAlpha=1;
    flash-=0.05*dt;
  }

  const yPopMax = 155;
  for (let yi = yellowPopAuras.length - 1; yi >= 0; yi--) {
    const a = yellowPopAuras[yi];
    const u = (now - a.start) / yPopMax;
    if (u >= 1) { yellowPopAuras.splice(yi, 1); continue; }
    const ease = 1 - u;
    ctx.save();
    ctx.globalAlpha = ease * 0.9;
    const R = 10 + u * 48;
    ctx.beginPath();
    ctx.arc(a.x, a.y, R, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 235, 120, ${0.62 * ease})`;
    ctx.lineWidth = 2.2 * (0.35 + ease * 0.65);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(a.x, a.y, R * 0.55, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 220, 60, ${0.35 * ease})`;
    ctx.lineWidth = 1.2 * ease;
    ctx.stroke();
    ctx.restore();
  }

  const gPopMax = 155;
  for (let gi = greenPopAuras.length - 1; gi >= 0; gi--) {
    const a = greenPopAuras[gi];
    const u = (now - a.start) / gPopMax;
    if (u >= 1) { greenPopAuras.splice(gi, 1); continue; }
    const ease = 1 - u;
    ctx.save();
    ctx.globalAlpha = ease * 0.9;
    const R = 10 + u * 48;
    ctx.beginPath();
    ctx.arc(a.x, a.y, R, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(160, 255, 205, ${0.62 * ease})`;
    ctx.lineWidth = 2.2 * (0.35 + ease * 0.65);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(a.x, a.y, R * 0.55, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(52, 220, 130, ${0.36 * ease})`;
    ctx.lineWidth = 1.2 * ease;
    ctx.stroke();
    ctx.restore();
  }

  tEl.textContent=fmt(elapsed);
  lvEl.textContent=level;
  nbEl.textContent=balls.filter(b=>b.type==='white').length;
}

function getExtraLifeSatelliteState(index, nowMs) {
  const rMain = 24;
  const orbitR = rMain + 16;
  const omega = 0.002 + index * 0.00075;
  const phase = 1.1 + index * 1.6;
  const ang = -nowMs * omega + phase;
  return {
    x: px + Math.cos(ang) * orbitR,
    y: py + Math.sin(ang) * orbitR,
    orbitR,
    size: 4,
  };
}

function drawPlayer(now) {
  if (!running || introCountdown || px <= -200) return;
  const pulse = 0.55 + 0.45 * Math.sin(now * 0.005);
  const rMain = 24;
  const dxT = tx - px, dyT = ty - py;
  const distSq = dxT * dxT + dyT * dyT;
  const velAng = Math.atan2(dyT, dxT);
  const velShow = tx > -200 && distSq > 28 * 28;

  ctx.save();
  ctx.translate(px, py);

  const gGlow = ctx.createRadialGradient(0, 0, 2, 0, 0, rMain + 28);
  gGlow.addColorStop(0, `rgba(255,255,255,${0.13 + 0.07 * pulse})`);
  gGlow.addColorStop(0.38, 'rgba(140,190,255,0.07)');
  gGlow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gGlow;
  ctx.beginPath();
  ctx.arc(0, 0, rMain + 28, 0, Math.PI * 2);
  ctx.fill();

  if (velShow) {
    const vm = Math.min(1.15, Math.sqrt(distSq) / 100);
    ctx.rotate(velAng);
    ctx.globalCompositeOperation = 'lighter';
    const rr = rMain + 30 * vm;
    const gg = ctx.createRadialGradient(0, 0, rMain * 0.3, 0, 0, rr);
    gg.addColorStop(0, `rgba(200,225,255,${0.22 * vm})`);
    gg.addColorStop(0.55, `rgba(140,190,255,${0.08 * vm})`);
    gg.addColorStop(1, 'rgba(80,140,255,0)');
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, rr, -0.4, 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.rotate(-velAng);
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1;
  const spin = now * 0.0001;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + spin;
    const major = i % 3 === 0;
    const r0 = rMain + 2;
    const r1 = rMain + (major ? 10 : 6);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    ctx.stroke();
  }

  if (shieldActive) {
    ctx.strokeStyle = `rgba(255,68,68,${0.62 + 0.28 * Math.sin(now * 0.008)})`;
  } else {
    ctx.strokeStyle = `rgba(255,255,255,${0.68 + 0.22 * pulse})`;
  }
  ctx.lineWidth = 2.25;
  ctx.beginPath();
  ctx.arc(0, 0, rMain, 0, Math.PI * 2);
  ctx.stroke();

  if (slowActive) {
    ctx.strokeStyle = `rgba(90,170,255,${0.82 + 0.12 * Math.sin(now * 0.006)})`;
    ctx.lineWidth = 1.45;
  } else {
    ctx.strokeStyle = 'rgba(130,180,255,0.38)';
    ctx.lineWidth = 1;
  }
  ctx.beginPath();
  ctx.arc(0, 0, rMain - 7, 0, Math.PI * 2);
  ctx.stroke();

  const cg = ctx.createRadialGradient(-4, -4, 0, 0, 0, 11);
  cg.addColorStop(0, '#ffffff');
  cg.addColorStop(0.55, '#c4dafb');
  cg.addColorStop(1, 'rgba(70,115,220,0.4)');
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.arc(0, 0, 9.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < hasExtraLife; i++) {
    const sat = getExtraLifeSatelliteState(i, now);
    const oxP = sat.x - px;
    const oyP = sat.y - py;
    const pr = sat.size;
    const pg = ctx.createRadialGradient(oxP - 1, oyP - 1, 0, oxP, oyP, pr);
    pg.addColorStop(0, '#f0e0ff');
    pg.addColorStop(0.5, '#b46cf0');
    pg.addColorStop(1, 'rgba(80,40,140,0.55)');
    ctx.beginPath();
    ctx.arc(oxP, oyP, pr, 0, Math.PI * 2);
    ctx.fillStyle = pg;
    ctx.fill();
    ctx.strokeStyle = `rgba(230,200,255,${0.78 + 0.14 * Math.sin(now * (0.009 + i * 0.0014))})`;
    ctx.lineWidth = 1.05;
    ctx.stroke();
  }

  ctx.restore();

  if (tx > -200 && distSq > 40 * 40) {
    ctx.beginPath();
    ctx.arc(tx, ty, 7, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(170,210,255,0.5)';
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(tx, ty, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fill();
  }
}

function drawBonusAura(b, now) {
  const blink = bonusPickupBlinkMul(now, b);
  const baseCol = b.type === 'red' ? '255,68,68' : b.type === 'blue' ? '68,136,255' : b.type === 'yellow' ? '233,200,26' : b.type === 'purple' ? '168,85,247' : '52,200,110';
  for (let k = 0; k < 3; k++) {
    const phase = (now * 0.0009 + k * 0.33) % 1;
    const rr = b.r + 6 + phase * 36;
    const a = (1 - phase) * 0.3 * blink;
    ctx.beginPath();
    ctx.arc(b.x, b.y, rr, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${baseCol},${a})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  const haloR = b.r + 13 + Math.sin(b.pulse) * 4;
  const grad = ctx.createRadialGradient(b.x, b.y, b.r * 0.4, b.x, b.y, haloR);
  grad.addColorStop(0, `rgba(${baseCol},${0.52 * blink})`);
  grad.addColorStop(1, `rgba(${baseCol},0)`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(b.x, b.y, haloR, 0, Math.PI * 2);
  ctx.fill();
}

function drawBg(now, lv){
  const intensity = Math.min((lv-1)*0.09, 0.65);
  if(intensity<0.01) return;
  ctx.strokeStyle=`rgba(200,215,255,${intensity*0.045})`;
  ctx.lineWidth=0.5;
  const cols=14, rows=9;
  for(let i=0;i<=cols;i++){
    const ox=Math.sin(bgPhase*3+i*0.4)*10*intensity;
    ctx.beginPath(); ctx.moveTo(i*(W/cols)+ox,0); ctx.lineTo(i*(W/cols)-ox,H); ctx.stroke();
  }
  for(let j=0;j<=rows;j++){
    const oy=Math.cos(bgPhase*2+j*0.6)*10*intensity;
    ctx.beginPath(); ctx.moveTo(0,j*(H/rows)+oy); ctx.lineTo(W,j*(H/rows)-oy); ctx.stroke();
  }
  const g=ctx.createRadialGradient(W/2,H/2,H*0.25,W/2,H/2,H*0.8);
  g.addColorStop(0,'rgba(0,0,0,0)');
  g.addColorStop(1,`rgba(0,0,0,${0.22+0.05*Math.sin(now*0.001*(1+lv*0.1))})`);
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
}

async function waitForAuthWarmup(timeoutMs = 1800) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (auth.currentUser) return auth.currentUser;
    await new Promise((r) => setTimeout(r, 80));
  }
  return auth.currentUser;
}
onAuthStateChanged(auth, async (user) => {
  await authPersistenceReady;
  const loader = document.getElementById('authLoading');
  guestModeEnabled = sessionStorage.getItem(GUEST_MODE_KEY) === '1';
  if (!user) {
    const warmedUser = await waitForAuthWarmup();
    if (warmedUser) {
      user = warmedUser;
    } else if (!guestModeEnabled) {
      window.location.href = '/auth.html';
      return;
    } else {
      currentUserId = null;
      currentUserEmail = '';
      currentUsername = 'ospite';
      currentDisplayName = 'OSPITE OFFLINE';
      await fetchLeaderboard(10).catch(() => {});
    }
  }

  if (user) {
    await reload(user).catch(() => {});
    if (!user.emailVerified && hasPasswordProvider(user)) { window.location.href = '/auth.html'; return; }
    sessionStorage.removeItem(GUEST_MODE_KEY);
    guestModeEnabled = false;
    currentUserId = user.uid;
    currentUserEmail = user.email || '';
    const profile = await getProfile(user.uid).catch(() => null);
    currentUsername = profile?.username || user.email || '???';
    currentDisplayName = resolveDisplayName(profile);
    await fetchLeaderboard(10).catch(() => {});
  }

  if (loader) {
    loader.style.display = 'none';
    loader.removeAttribute('aria-busy');
  }

  showInstallNudgeIfNeeded();
  setupFullscreenAutostart();
  syncAudioCornerBtn();
  bindAudioCornerBtn();
  bindHomeNav();
  setupMenuUI();
  updateShellForPhase('menu');
  showScreenView('home');

  if (ctx) requestAnimationFrame(loop);
});
