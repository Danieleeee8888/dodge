import { auth, authPersistenceReady } from './firebase-init.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  reload,
  GoogleAuthProvider,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { usernameExists, claimUsername, getProfile } from './profile.js';

const GUEST_MODE_KEY = 'dodge_guest_mode';
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
const redirectSignInPromise = authPersistenceReady
  .then(() => getRedirectResult(auth))
  .catch(() => null);

// ── viste ──────────────────────────────────────────────────────────────────
const $v = {
  login:    document.getElementById('view-login'),
  register: document.getElementById('view-register'),
  verify:   document.getElementById('view-verify'),
  reset:    document.getElementById('view-reset'),
};

function showView(name) {
  Object.entries($v).forEach(([k, el]) => { el.style.display = k === name ? 'flex' : 'none'; });
  clearMsgs();
}

// ── messaggi ───────────────────────────────────────────────────────────────
const msgMap = { login: 'login-error', register: 'reg-error', verify: 'verify-msg', reset: 'reset-msg' };

function clearMsgs() {
  Object.values(msgMap).forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = ''; el.style.display = 'none'; }
  });
}

function setMsg(view, text, type = 'error') {
  const el = document.getElementById(msgMap[view]);
  if (!el) return;
  el.textContent = text;
  el.className = `form-msg form-msg--${type}`;
  el.style.display = 'block';
}

// ── loading bottoni ────────────────────────────────────────────────────────
function setLoading(id, on) {
  const btn = document.getElementById(id);
  if (!btn) return;
  if (on) { btn._t = btn.textContent; btn.textContent = '···'; }
  else { btn.textContent = btn._t || btn.textContent; }
  btn.disabled = on;
}

// ── messaggi di errore in italiano ────────────────────────────────────────
function errText(err) {
  const map = {
    'auth/email-already-in-use':    'Questa email è già registrata.',
    'auth/invalid-email':           'Indirizzo email non valido.',
    'auth/user-not-found':          'Nessun account con questa email.',
    'auth/wrong-password':          'Password errata.',
    'auth/invalid-credential':      'Email o password errati.',
    'auth/too-many-requests':       'Troppi tentativi. Riprova tra qualche minuto.',
    'auth/network-request-failed':  'Errore di rete. Controlla la connessione.',
    'auth/weak-password':           'Password troppo debole (minimo 8 caratteri).',
    'auth/user-disabled':           'Account disabilitato.',
    'auth/popup-closed-by-user':    'Accesso Google annullato.',
    'auth/popup-blocked':           'Popup bloccato dal browser. Riprova o abilita i popup.',
    'auth/cancelled-popup-request': 'Accesso Google annullato.',
    'auth/account-exists-with-different-credential': 'Questa email è già associata a un altro metodo di accesso.',
    'USERNAME_TAKEN':               'Username già in uso. Scegline un altro.',
    'GOOGLE_SESSION_NOT_READY':    'Accesso Google riuscito ma sessione non pronta. Riprova tra un secondo.',
  };
  return map[err.code] || map[err.message] || 'Errore imprevisto. Riprova.';
}

// ── validazione username ───────────────────────────────────────────────────
function validateUsername(u) {
  if (!u || u.length < 3)  return 'Username troppo corto (min 3 caratteri).';
  if (u.length > 20)        return 'Username troppo lungo (max 20 caratteri).';
  if (!/^[a-zA-Z0-9_]+$/.test(u)) return 'Username: solo lettere, numeri e _.';
  return null;
}

function hasPasswordProvider(user) {
  return !!user?.providerData?.some((p) => p?.providerId === 'password');
}

function isVerifiedOrGoogle(user) {
  return !!(user?.emailVerified || !hasPasswordProvider(user));
}

function normalizeGoogleUsername(raw) {
  const cleaned = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  let base = cleaned || 'player';
  if (base.length < 3) base = (base + 'player').slice(0, 12);
  return base.slice(0, 20);
}

async function ensureGoogleProfile(user) {
  if (!user) return;
  const profile = await getProfile(user.uid).catch(() => null);
  if (profile) return;

  const emailLocal = String(user.email || '').split('@')[0];
  const base = normalizeGoogleUsername(emailLocal || user.displayName || 'player');

  for (let i = 0; i < 40; i++) {
    const suffix = i === 0 ? '' : `_${Math.floor(100 + Math.random() * 9000)}`;
    const maxBaseLen = Math.max(3, 20 - suffix.length);
    const candidate = (base.slice(0, maxBaseLen) + suffix).slice(0, 20);
    if (await usernameExists(candidate)) continue;
    try {
      await claimUsername(candidate, user.uid, user.email || '');
      return;
    } catch (err) {
      if (err?.code === 'USERNAME_TAKEN') continue;
      throw err;
    }
  }
  throw new Error('USERNAME_TAKEN');
}

async function completeGoogleSignIn(user) {
  try {
    await ensureGoogleProfile(user);
  } catch (err) {
    // Non bloccare l'accesso al gioco se il bootstrap profilo fallisce:
    // il profilo può essere completato in un secondo momento.
    console.warn('google-profile-bootstrap:', err);
  }
  sessionStorage.removeItem(GUEST_MODE_KEY);
  window.location.href = '/index.html';
}

function shouldUseRedirectForGoogle() {
  const ua = navigator.userAgent || '';
  return /Android|iPhone|iPad|iPod/i.test(ua);
}

async function waitForStableAuthUser(timeoutMs = 1800) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (auth.currentUser) return auth.currentUser;
    await new Promise((r) => setTimeout(r, 80));
  }
  return auth.currentUser;
}
// ── REGISTRAZIONE ──────────────────────────────────────────────────────────
document.getElementById('form-register').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('reg-username').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const pw       = document.getElementById('reg-password').value;
  const pw2      = document.getElementById('reg-confirm').value;

  const usErr = validateUsername(username);
  if (usErr)          { setMsg('register', usErr); return; }
  if (!email)         { setMsg('register', 'Inserisci la tua email.'); return; }
  if (pw.length < 8)  { setMsg('register', 'Password: minimo 8 caratteri.'); return; }
  if (pw !== pw2)     { setMsg('register', 'Le password non coincidono.'); return; }

  setLoading('btn-register', true);
  try {
    if (await usernameExists(username)) {
      setMsg('register', 'Username già in uso. Scegline un altro.');
      return;
    }
    const { user } = await createUserWithEmailAndPassword(auth, email, pw);
    await claimUsername(username, user.uid, email);
    await sendEmailVerification(user);
    document.getElementById('verify-email-placeholder').textContent = email;
    showView('verify');
    setMsg('verify', 'Email inviata! Se non la trovi entro qualche minuto, controlla la cartella Spam.', 'success');
  } catch (err) {
    console.error('register:', err);
    setMsg('register', errText(err));
  } finally {
    setLoading('btn-register', false);
  }
});

// ── LOGIN ──────────────────────────────────────────────────────────────────
document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const pw    = document.getElementById('login-password').value;
  if (!email || !pw) { setMsg('login', 'Inserisci email e password.'); return; }

  setLoading('btn-login', true);
  try {
    const { user } = await signInWithEmailAndPassword(auth, email, pw);
    await reload(user);
    if (!isVerifiedOrGoogle(user)) {
      document.getElementById('verify-email-placeholder').textContent = email;
      showView('verify');
      return;
    }
    sessionStorage.removeItem(GUEST_MODE_KEY);
    window.location.href = '/index.html';
  } catch (err) {
    console.error('login:', err);
    setMsg('login', errText(err));
  } finally {
    setLoading('btn-login', false);
  }
});

document.getElementById('btn-google-login')?.addEventListener('click', async () => {
  setLoading('btn-google-login', true);
  try {
    await authPersistenceReady;
    if (shouldUseRedirectForGoogle()) {
      sessionStorage.removeItem(GUEST_MODE_KEY);
      await signInWithRedirect(auth, googleProvider);
      return;
    }
    const { user } = await signInWithPopup(auth, googleProvider);
    const stableUser = (await waitForStableAuthUser()) || user;
    if (!stableUser) {
      throw new Error('GOOGLE_SESSION_NOT_READY');
    }
    await completeGoogleSignIn(stableUser);
  } catch (err) {
    console.error('google-login:', err);
    setMsg('login', errText(err));
  } finally {
    setLoading('btn-google-login', false);
  }
});

document.getElementById('btn-offline-play')?.addEventListener('click', () => {
  sessionStorage.setItem(GUEST_MODE_KEY, '1');
  window.location.href = '/index.html';
});

// ── RESET PASSWORD ─────────────────────────────────────────────────────────
document.getElementById('form-reset').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('reset-email').value.trim();
  if (!email) { setMsg('reset', 'Inserisci la tua email.'); return; }

  setLoading('btn-reset', true);
  try {
    await sendPasswordResetEmail(auth, email);
    setMsg('reset', 'Email inviata! Controlla la casella e anche la cartella Spam.', 'success');
  } catch (err) {
    setMsg('reset', errText(err));
  } finally {
    setLoading('btn-reset', false);
  }
});

// ── VERIFICA: "Ho verificato, entra" ──────────────────────────────────────
document.getElementById('btn-verified').addEventListener('click', async () => {
  const user = auth.currentUser;
  if (!user) { showView('login'); return; }
  setLoading('btn-verified', true);
  try {
    await reload(user);
    if (user.emailVerified) {
      window.location.href = '/index.html';
    } else {
      setMsg('verify', 'Email non ancora verificata. Cerca nella casella e nella cartella Spam, poi clicca il link.');
    }
  } catch {
    setMsg('verify', 'Errore di rete. Riprova.');
  } finally {
    setLoading('btn-verified', false);
  }
});

// ── VERIFICA: reinvia email ────────────────────────────────────────────────
document.getElementById('btn-resend').addEventListener('click', async () => {
  const user = auth.currentUser;
  if (!user) { setMsg('verify', 'Sessione scaduta. Torna al login.'); return; }
  setLoading('btn-resend', true);
  try {
    await sendEmailVerification(user);
    setMsg('verify', 'Email reinviata! Se non arriva entro qualche minuto, controlla la cartella Spam.', 'success');
  } catch {
    setMsg('verify', 'Non è stato possibile reinviare. Riprova più tardi.');
  } finally {
    setLoading('btn-resend', false);
  }
});

// ── NAVIGAZIONE ────────────────────────────────────────────────────────────
[
  ['to-register',            () => showView('register')],
  ['to-login-from-register', () => showView('login')],
  ['to-reset',               () => showView('reset')],
  ['to-login-from-reset',    () => showView('login')],
  ['to-login-from-verify',   async () => {
    if (auth.currentUser) await signOut(auth).catch(() => {});
    showView('login');
  }],
].forEach(([id, fn]) => {
  document.getElementById(id)?.addEventListener('click', (e) => { e.preventDefault(); fn(); });
});

// ── STATO AUTH: se già loggato e verificato → vai al gioco ────────────────
onAuthStateChanged(auth, async (user) => {
  await authPersistenceReady;
  const redirectResult = await redirectSignInPromise;
  if (redirectResult?.user) {
    try {
      await completeGoogleSignIn(redirectResult.user);
      return;
    } catch (err) {
      setMsg('login', errText(err));
      showView('login');
      return;
    }
  }
  if (!user) { showView('login'); return; }
  await reload(user).catch(() => {});
  if (isVerifiedOrGoogle(user)) {
    if (!hasPasswordProvider(user)) {
      try {
        await completeGoogleSignIn(user);
      } catch (err) {
        setMsg('login', errText(err));
        showView('login');
      }
      return;
    }
    sessionStorage.removeItem(GUEST_MODE_KEY);
    window.location.href = '/index.html';
  } else {
    document.getElementById('verify-email-placeholder').textContent = user.email || '';
    showView('verify');
  }
});
