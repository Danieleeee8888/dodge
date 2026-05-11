import { db } from './firebase-init.js';
import {
  doc, getDoc, setDoc, updateDoc, runTransaction, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const ADMIN_EMAIL = 'danielet88@gmail.com';

export async function usernameExists(username) {
  const snap = await getDoc(doc(db, 'usernames', username.toLowerCase()));
  return snap.exists();
}

export async function claimUsername(username, uid, email) {
  const userRef = doc(db, 'users', uid);
  const nameRef = doc(db, 'usernames', username.toLowerCase());

  await runTransaction(db, async (tx) => {
    const nameSnap = await tx.get(nameRef);
    if (nameSnap.exists()) {
      const err = new Error('USERNAME_TAKEN');
      err.code = 'USERNAME_TAKEN';
      throw err;
    }
    const now = serverTimestamp();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const role = normalizedEmail === ADMIN_EMAIL ? 'admin' : 'user';
    tx.set(nameRef, { uid, claimedAt: now });
    tx.set(userRef, {
      username,
      usernameLower: username.toLowerCase(),
      displayName: username,
      email,
      role,
      createdAt: now,
      lastSeen: now,
      gamesPlayed: 0,
      bestTime: 0,
    });
  });
}

/** Nome mostrato in classifica / menu; se manca (utenti vecchi) = username. */
export function resolveDisplayName(data) {
  if (!data) return '···';
  const d = String(data.displayName || data.username || '').trim();
  return d || '···';
}

export function normalizeDisplayNameInput(raw) {
  return String(raw || '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .replace(/\s{2,}/g, ' ')
    .slice(0, 24);
}

export function validateDisplayNameInput(raw) {
  const s = normalizeDisplayNameInput(raw);
  if (s.length < 1) return { ok: false, error: 'Inserisci un nome (max 24 caratteri).' };
  if (s.length > 24) return { ok: false, error: 'Massimo 24 caratteri.' };
  if (/[<>]/.test(s)) return { ok: false, error: 'Il nome non può contenere < o >.' };
  return { ok: true, value: s };
}

export async function updateDisplayName(uid, displayName) {
  const v = validateDisplayNameInput(displayName);
  if (!v.ok) {
    const err = new Error(v.error);
    err.code = 'INVALID_DISPLAY_NAME';
    throw err;
  }
  const name = v.value;
  await updateDoc(doc(db, 'users', uid), { displayName: name });
  const lbRef = doc(db, 'leaderboard', uid);
  const lbPureRef = doc(db, 'leaderboard_pure', uid);
  const [lbSnap, lbPureSnap] = await Promise.all([getDoc(lbRef), getDoc(lbPureRef)]);
  const patch = { displayName: name, updatedAt: serverTimestamp() };
  await Promise.all([
    lbSnap.exists() ? updateDoc(lbRef, patch).catch(() => {}) : Promise.resolve(),
    lbPureSnap.exists() ? updateDoc(lbPureRef, patch).catch(() => {}) : Promise.resolve(),
  ]);
}

export async function getProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? snap.data() : null;
}

export async function updateLastSeen(uid) {
  await updateDoc(doc(db, 'users', uid), { lastSeen: serverTimestamp() }).catch(() => {});
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

/**
 * Crea il profilo Firestore per un utente Google se non esiste.
 * Genera automaticamente un username dall'email; ritenta fino a 40 volte con suffissi random.
 * Lanciata sia al primo login Google (auth.js) sia al caricamento del gioco (game-engine.js)
 * come recovery per profili orfani.
 */
export async function ensureProfileForUser(user) {
  if (!user) return;
  const existing = await getProfile(user.uid).catch(() => null);
  if (existing) return;

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
