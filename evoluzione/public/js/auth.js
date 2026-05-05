import { auth } from './firebase-init.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  reload,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { usernameExists, claimUsername } from './profile.js';

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
    'USERNAME_TAKEN':               'Username già in uso. Scegline un altro.',
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
    if (!user.emailVerified) {
      document.getElementById('verify-email-placeholder').textContent = email;
      showView('verify');
      return;
    }
    window.location.href = '/index.html';
  } catch (err) {
    console.error('login:', err);
    setMsg('login', errText(err));
  } finally {
    setLoading('btn-login', false);
  }
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
  if (!user) { showView('login'); return; }
  await reload(user).catch(() => {});
  if (user.emailVerified) {
    window.location.href = '/index.html';
  } else {
    document.getElementById('verify-email-placeholder').textContent = user.email || '';
    showView('verify');
  }
});
