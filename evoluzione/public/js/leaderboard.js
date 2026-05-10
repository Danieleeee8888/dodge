import { db, auth } from './firebase-init.js';
import { resolveDisplayName } from './profile.js';
import {
  collection, doc, getDoc, updateDoc, query, orderBy, limit, getDocs, deleteField,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

/** Lunghezza classifica globale (generale e pura). */
export const LEADERBOARD_TOP_N = 15;

let _cacheGeneral = [];
let _cachePure = [];
const SCORE_MIN = 1;
const SCORE_MAX = 7200000;
/** Partite recenti in `scores`: serve coprire abbastanza righe perché molte run Plus in cima non escludano dal merge i migliori tempi puri. */
const FALLBACK_SCAN_LIMIT = 2500;
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

/**
 * Run senza Premio Plus (campo assente o vuoto = pura).
 * Legacy: alcuni client salvavano «nessun premio» come boolean false o 0; non sono codici Plus.
 */
export function isPureScoreRow(row) {
  const p = row?.prize_used;
  if (p == null || p === '') return true;
  if (p === false || p === 0) return true;
  return false;
}

function dedupeBestByUid(rows, n = LEADERBOARD_TOP_N) {
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

async function fetchLegacyScoresTop(n = LEADERBOARD_TOP_N) {
  const q = query(collection(db, 'scores'), orderBy('ms', 'desc'), limit(Math.max(n, FALLBACK_SCAN_LIMIT)));
  const snap = await getDocs(q);
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return dedupeBestByUid(rows, n);
}

async function fetchLegacyScoresTopPure(n = LEADERBOARD_TOP_N) {
  const q = query(collection(db, 'scores'), orderBy('ms', 'desc'), limit(FALLBACK_SCAN_LIMIT));
  const snap = await getDocs(q);
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(isPureScoreRow);
  return dedupeBestByUid(rows, n);
}

/**
 * kind: 'general' | 'pure'
 * Unisce leaderboard (+ storico scores filtrato per pura) e risolve il nome visualizzato.
 */
export async function fetchLeaderboard(kind = 'general', n = LEADERBOARD_TOP_N) {
  const uidToSlug = await getUidToClaimedUsernameMap().catch(() => new Map());
  const lbLimit = Math.max(n, 60);

  if (kind === 'pure') {
    try {
      const [lbPureSnap, scSnap] = await Promise.all([
        getDocs(query(collection(db, 'leaderboard_pure'), orderBy('ms', 'desc'), limit(lbLimit))),
        getDocs(query(collection(db, 'scores'), orderBy('ms', 'desc'), limit(FALLBACK_SCAN_LIMIT))),
      ]);
      const pureScoreRows = scSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter(isPureScoreRow);
      const combined = [
        ...lbPureSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        ...pureScoreRows,
      ];
      if (combined.length === 0) {
        _cachePure = [];
        return _cachePure;
      }
      const merged = dedupeBestByUid(combined, 9999);
      _cachePure = dedupeBestByUid(applyPublicDisplayNames(merged, uidToSlug), n);
      return _cachePure;
    } catch (e) {
      _cachePure = await fetchLegacyScoresTopPure(n).catch(() => []);
      _cachePure = dedupeBestByUid(applyPublicDisplayNames(_cachePure, uidToSlug), n);
      return _cachePure;
    }
  }

  try {
    const [lbSnap, scSnap] = await Promise.all([
      getDocs(query(collection(db, 'leaderboard'), orderBy('ms', 'desc'), limit(lbLimit))),
      getDocs(query(collection(db, 'scores'), orderBy('ms', 'desc'), limit(FALLBACK_SCAN_LIMIT))),
    ]);
    const combined = [
      ...lbSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      ...scSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    ];
    if (combined.length === 0) {
      _cacheGeneral = [];
      return _cacheGeneral;
    }
    const merged = dedupeBestByUid(combined, 9999);
    _cacheGeneral = dedupeBestByUid(applyPublicDisplayNames(merged, uidToSlug), n);
    return _cacheGeneral;
  } catch (e) {
    _cacheGeneral = await fetchLegacyScoresTop(n).catch(() => []);
    _cacheGeneral = dedupeBestByUid(applyPublicDisplayNames(_cacheGeneral, uidToSlug), n);
    return _cacheGeneral;
  }
}

/** Compat: una volta caricate entrambe le classifiche le cache sono aggiornate. */
export async function fetchBothLeaderboards(n = LEADERBOARD_TOP_N) {
  await Promise.all([
    fetchLeaderboard('general', n),
    fetchLeaderboard('pure', n),
  ]);
}

export function getCachedLeaderboard(kind = 'general') {
  return kind === 'pure' ? _cachePure : _cacheGeneral;
}

/**
 * Aggiorna la cache della classifica generale in modo ottimistico.
 * prizeUsed: codice premio Plus (es. red_plus) o null se run pura.
 */
export function applyOptimisticScore(uid, displayName, ms, prizeUsed = null) {
  const t = Math.floor(ms);
  if (!isValidMs(t)) return;
  const idx = _cacheGeneral.findIndex(r => r.uid === uid);
  const row = { id: uid, uid, displayName, ms: t };
  if (prizeUsed) row.prize_used = prizeUsed;
  if (idx >= 0) {
    if (t <= _cacheGeneral[idx].ms) return;
    const merged = { ..._cacheGeneral[idx], ...row };
    if (!prizeUsed) delete merged.prize_used;
    _cacheGeneral[idx] = merged;
  } else {
    _cacheGeneral.push(row);
  }
  _cacheGeneral = _cacheGeneral.sort((a, b) => b.ms - a.ms).slice(0, LEADERBOARD_TOP_N);
}

async function publishBestFromProfileWithRetry(maxAttempts = 4) {
  const user = auth.currentUser;
  if (!user) return { ok: false, reason: 'no_auth' };
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/game/publish-best-from-profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: '{}',
      });
      const payload = await res.json().catch(() => ({}));
      if (res.ok && payload.ok) {
        return {
          ok: true,
          inTop15: !!(payload.inTop15 ?? payload.inTop10),
        };
      }
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  return { ok: false, reason: 'publish_failed' };
}

/**
 * Fallback se `/api/game/end` fallisce: aggiorna il profilo e pubblica su classifica via API backend.
 * `runPrizeUsed`: codice Premio Plus della run (come `pending_run_prize`), altrimenti null per run pura.
 */
export async function saveScore(uid, ms, runPrizeUsed = null) {
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
    if (improved) {
      updates.bestTime = t;
      const p = runPrizeUsed == null || runPrizeUsed === ''
        ? null
        : String(runPrizeUsed).trim();
      if (p) updates.bestTime_prize_used = p;
      else updates.bestTime_prize_used = deleteField();
    }
    await updateDoc(userRef, updates);

    if (!improved) return { ok: true, improved: false };

    const pub = await publishBestFromProfileWithRetry();
    await fetchBothLeaderboards().catch(() => {});
    if (!pub.ok) {
      return { ok: false, improved: true, reason: pub.reason || 'publish_failed' };
    }

    return {
      ok: true,
      improved: true,
      inTop15: !!pub.inTop15,
      inTop10: !!pub.inTop15,
    };

  } catch (e) {
    const reason = e.code === 'permission-denied' ? 'permission' : 'network';
    return { ok: false, reason };
  }
}
