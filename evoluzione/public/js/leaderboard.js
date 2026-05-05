import { db } from './firebase-init.js';
import { resolveDisplayName } from './profile.js';
import {
  collection, addDoc, doc, setDoc, getDoc, updateDoc, query, orderBy, limit,
  getDocs, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

let _cache = [];
const SCORE_MIN = 1;
const SCORE_MAX = 7200000;
const FALLBACK_SCAN_LIMIT = 300;
const USERNAME_UID_MAP_TTL_MS = 60_000;

let _uidToClaimedUsername = null;
let _uidToClaimedUsernameAt = 0;

/**
 * Mappa uid → username scelto in registrazione.
 * Usiamo `usernames/{usernameLower}` (lettura pubblica): il doc id è lo slug normalizzato.
 */
async function getUidToClaimedUsernameMap() {
  const now = Date.now();
  if (_uidToClaimedUsername && now - _uidToClaimedUsernameAt < USERNAME_UID_MAP_TTL_MS) {
    return _uidToClaimedUsername;
  }
  const snap = await getDocs(collection(db, 'usernames'));
  const map = new Map();
  snap.docs.forEach((d) => {
    const uid = d.data()?.uid;
    if (typeof uid === 'string' && uid) map.set(uid, d.id);
  });
  _uidToClaimedUsername = map;
  _uidToClaimedUsernameAt = now;
  return map;
}

export function invalidateLeaderboardUsernameMap() {
  _uidToClaimedUsername = null;
  _uidToClaimedUsernameAt = 0;
}

/** Nome in classifica: displayName sul doc, altrimenti legacy `username`, altrimenti slug registrazione. */
function applyPublicDisplayNames(rows, uidToSlug) {
  return rows.map((row) => {
    const fromDoc = String(row.displayName || '').trim();
    const legacy = String(row.username || '').trim();
    const reg = uidToSlug.get(row.uid);
    const displayName = (fromDoc || legacy || reg || '???').slice(0, 24);
    return { ...row, displayName };
  });
}

function normalizeMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.floor(n);
}

function isValidMs(ms) {
  return ms >= SCORE_MIN && ms <= SCORE_MAX;
}

function dedupeBestByUid(rows, n = 10) {
  const bestByUid = new Map();
  rows.forEach((row) => {
    const uid = row?.uid;
    const ms = normalizeMs(row?.ms);
    if (!uid || !isValidMs(ms)) return;
    const prev = bestByUid.get(uid);
    if (!prev || ms > prev.ms) {
      bestByUid.set(uid, {
        ...row,
        id: row.id || uid,
        uid,
        displayName: row.displayName || row.username || '???',
        ms,
      });
    }
  });
  const sorted = Array.from(bestByUid.values()).sort((a, b) => b.ms - a.ms);
  return n >= sorted.length ? sorted : sorted.slice(0, n);
}

async function fetchLegacyScoresTop(n = 10) {
  const q = query(collection(db, 'scores'), orderBy('ms', 'desc'), limit(Math.max(n, FALLBACK_SCAN_LIMIT)));
  const snap = await getDocs(q);
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return dedupeBestByUid(rows, n);
}

/**
 * Unisce leaderboard + storico scores (best per uid), poi risolve il nome visualizzato.
 */
export async function fetchLeaderboard(n = 10) {
  const uidToSlug = await getUidToClaimedUsernameMap().catch(() => new Map());
  try {
    const lbLimit = Math.max(n, 50);
    const [lbSnap, scSnap] = await Promise.all([
      getDocs(query(collection(db, 'leaderboard'), orderBy('ms', 'desc'), limit(lbLimit))),
      getDocs(query(collection(db, 'scores'), orderBy('ms', 'desc'), limit(FALLBACK_SCAN_LIMIT))),
    ]);
    const combined = [
      ...lbSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      ...scSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    ];
    if (combined.length === 0) {
      _cache = [];
      return _cache;
    }
    const merged = dedupeBestByUid(combined, 9999);
    _cache = dedupeBestByUid(applyPublicDisplayNames(merged, uidToSlug), n);
    return _cache;
  } catch (e) {
    _cache = await fetchLegacyScoresTop(n).catch(() => []);
    _cache = dedupeBestByUid(applyPublicDisplayNames(_cache, uidToSlug), n);
    return _cache;
  }
}

export function getCachedLeaderboard() {
  return _cache;
}

/**
 * Aggiorna la cache locale in modo ottimistico (prima che la scrittura su Firestore finisca).
 * Sostituisce l'entry esistente dell'utente se il nuovo tempo è migliore, altrimenti non fa nulla.
 */
export function applyOptimisticScore(uid, displayName, ms) {
  const t = Math.floor(ms);
  if (!isValidMs(t)) return;
  const idx = _cache.findIndex(r => r.uid === uid);
  if (idx >= 0) {
    if (t <= _cache[idx].ms) return;
    _cache[idx] = { ..._cache[idx], ms: t, displayName };
  } else {
    _cache.push({ id: uid, uid, displayName, ms: t });
  }
  _cache = _cache.sort((a, b) => b.ms - a.ms).slice(0, 10);
}

/**
 * Salva il punteggio seguendo questa logica:
 *   1. Se non batte il record personale → aggiorna solo gamesPlayed, fine.
 *   2. Se batte il record personale → aggiorna bestTime in users/{uid}.
 *   3. Controlla se il nuovo tempo entra nei top 10.
 *   4. Se entra → setDoc su leaderboard/{uid} (sovrascrive eventuale entry precedente).
 *
 * Ritorna { ok, improved, inTop10, reason? }
 */
export async function saveScore(uid, ms) {
  const t = Math.floor(ms);
  if (!isValidMs(t)) return { ok: false, reason: 'invalid' };

  try {
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return { ok: false, reason: 'no_profile' };

    const data = userSnap.data();
    const displayNameRaw = resolveDisplayName(data);
    const displayName = String(displayNameRaw).trim().slice(0, 24);
    if (displayName.length < 1) return { ok: false, reason: 'no_profile' };

    const currentBest = data.bestTime || 0;
    const improved = t > currentBest;

    const updates = { gamesPlayed: (data.gamesPlayed || 0) + 1 };
    if (improved) updates.bestTime = t;
    await updateDoc(userRef, updates);
    // Manteniamo lo storico completo: protegge dai reset e permette ricostruzione classifica.
    await addDoc(collection(db, 'scores'), {
      uid, displayName, ms: t, createdAt: serverTimestamp(),
    });

    if (!improved) return { ok: true, improved: false };

    // Nuovo record personale — controlla se entra in top 10
    const lb = await fetchLeaderboard(10);
    const myEntry = lb.find(r => r.uid === uid);
    const worstMs = lb.length > 0 ? lb[lb.length - 1].ms : 0;
    const inTop10 = lb.length < 10 || myEntry !== undefined || t > worstMs;

    if (!inTop10) return { ok: true, improved: true, inTop10: false };

    // Scrivi / sostituisci la entry in classifica
    try {
      await setDoc(doc(db, 'leaderboard', uid), {
        uid, displayName, ms: t, updatedAt: serverTimestamp(),
      });
    } catch (e) {
      // Se la write su `leaderboard` fallisce, la classifica resta ricostruibile da `scores`.
    }
    await fetchLeaderboard(10);
    return { ok: true, improved: true, inTop10: true };

  } catch (e) {
    const reason = e.code === 'permission-denied' ? 'permission' : 'network';
    return { ok: false, reason };
  }
}
