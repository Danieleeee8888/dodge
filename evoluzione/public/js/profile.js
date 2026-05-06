import { db } from './firebase-init.js';
import {
  doc, getDoc, setDoc, updateDoc, runTransaction, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

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
    tx.set(nameRef, { uid, claimedAt: now });
    tx.set(userRef, {
      username,
      usernameLower: username.toLowerCase(),
      displayName: username,
      email,
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
  const lbSnap = await getDoc(lbRef);
  if (lbSnap.exists()) {
    await updateDoc(lbRef, { displayName: name, updatedAt: serverTimestamp() });
  }
}

export async function getProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? snap.data() : null;
}

export async function updateLastSeen(uid) {
  await updateDoc(doc(db, 'users', uid), { lastSeen: serverTimestamp() }).catch(() => {});
}
