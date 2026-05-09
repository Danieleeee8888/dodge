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
  const statsRef = doc(db, 'player_stats', uid);

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
    tx.set(statsRef, {
      user_id: uid,
      total_games: 0,
      total_playtime_seconds: 0,
      best_time_seconds: 0,
      deaths_by_triangle: 0,
      deaths_by_square: 0,
      red_collected: 0,
      blue_collected: 0,
      yellow_collected: 0,
      green_collected: 0,
      purple_collected: 0,
      extra_lives_used: 0,
      shields_consumed: 0,
      whites_killed_by_yellow: 0,
      runs_over_60s: 0,
      runs_over_90s: 0,
      runs_over_120s: 0,
      runs_over_150s: 0,
      runs_over_180s: 0,
      current_streak_over_60s: 0,
      current_streak_over_90s: 0,
      current_streak_over_120s: 0,
      current_streak_over_150s: 0,
      has_red_plus: false,
      has_red_premium: false,
      has_blue_plus: false,
      has_blue_premium: false,
      has_yellow_plus: false,
      has_yellow_premium: false,
      has_green_plus: false,
      has_green_premium: false,
      has_purple_plus: false,
      has_purple_premium: false,
      premi_usati_count: 0,
      active_mission: null,
      mission_started_at: null,
      mission_progress: {},
      prizes: {
        red_plus: 0,
        blue_plus: 0,
        yellow_plus: 0,
        green_plus: 0,
        purple_plus: 0,
      },
      pending_run_prize: null,
      updated_at: now,
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
