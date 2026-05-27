import { db } from './firebase-init.js';
import {
  collection, query, orderBy, limit, getDocs,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

/** Lunghezza classifica globale (generale e pura). */
export const LEADERBOARD_TOP_N = 15;

let _cacheGeneral = [];
let _cachePure = [];
let _cacheLevel = [];
let _cacheGeneralAt = 0;
let _cachePureAt = 0;
let _cacheLevelAt = 0;
const SCORE_MIN = 1;
const SCORE_MAX = 7200000;
/** Fallback legacy su `scores` se endpoint HTTP classifica non disponibile. */
const FALLBACK_SCAN_LIMIT = 300;
const LEADERBOARD_CACHE_TTL_MS = 60_000;
const USERNAME_UID_MAP_TTL_MS = 60_000;
const STORAGE_KEY = 'dodge_lb_cache_v1';

let _uidToClaimedUsername = null;
let _uidToClaimedUsernameAt = 0;
let _inflightUsernameMap = null;
const _inflightFetchByKey = new Map();

function nowMs() {
  return Date.now();
}

function readSessionStorageCache() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    _cacheGeneral = Array.isArray(parsed?.generalRows) ? parsed.generalRows : [];
    _cachePure = Array.isArray(parsed?.pureRows) ? parsed.pureRows : [];
    _cacheLevel = Array.isArray(parsed?.levelRows) ? parsed.levelRows : [];
    _cacheGeneralAt = Number.isFinite(parsed?.generalAt) ? parsed.generalAt : 0;
    _cachePureAt = Number.isFinite(parsed?.pureAt) ? parsed.pureAt : 0;
    _cacheLevelAt = Number.isFinite(parsed?.levelAt) ? parsed.levelAt : 0;
  } catch (_) {}
}

function writeSessionStorageCache() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      generalRows: _cacheGeneral,
      pureRows: _cachePure,
      levelRows: _cacheLevel,
      generalAt: _cacheGeneralAt,
      pureAt: _cachePureAt,
      levelAt: _cacheLevelAt,
    }));
  } catch (_) {}
}

function cacheTimestampForKind(kind) {
  if (kind === 'pure') return _cachePureAt;
  if (kind === 'level') return _cacheLevelAt;
  return _cacheGeneralAt;
}

function setCacheTimestampForKind(kind, ts) {
  if (kind === 'pure') _cachePureAt = ts;
  else if (kind === 'level') _cacheLevelAt = ts;
  else _cacheGeneralAt = ts;
}

function isKindCacheFresh(kind, ttlMs = LEADERBOARD_CACHE_TTL_MS) {
  const rows = getCachedLeaderboard(kind);
  const at = cacheTimestampForKind(kind);
  return Array.isArray(rows) && at > 0 && nowMs() - at < ttlMs;
}

export function hasFreshLeaderboardCaches(ttlMs = LEADERBOARD_CACHE_TTL_MS) {
  return isKindCacheFresh('general', ttlMs) &&
    isKindCacheFresh('pure', ttlMs) &&
    isKindCacheFresh('level', ttlMs);
}

readSessionStorageCache();

/**
 * Mappa uid → username scelto in registrazione.
 * Usiamo `usernames/{usernameLower}` (lettura pubblica): il doc id è lo slug normalizzato.
 */
async function getUidToClaimedUsernameMap() {
  const now = nowMs();
  if (_uidToClaimedUsername && now - _uidToClaimedUsernameAt < USERNAME_UID_MAP_TTL_MS) {
    return _uidToClaimedUsername;
  }
  if (_inflightUsernameMap) return _inflightUsernameMap;
  _inflightUsernameMap = getDocs(collection(db, 'usernames'))
    .then((snap) => {
      const map = new Map();
      snap.docs.forEach((d) => {
        const uid = d.data()?.uid;
        if (typeof uid === 'string' && uid) map.set(uid, d.id);
      });
      _uidToClaimedUsername = map;
      _uidToClaimedUsernameAt = nowMs();
      return map;
    })
    .finally(() => {
      _inflightUsernameMap = null;
    });
  return _inflightUsernameMap;
}

export function invalidateLeaderboardUsernameMap() {
  _uidToClaimedUsername = null;
  _uidToClaimedUsernameAt = 0;
  _inflightUsernameMap = null;
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
      const next = {
        ...row,
        id: row.id || uid,
        uid,
        displayName: row.displayName || row.username || '???',
        ms,
      };
      if (prev?.level != null && (next.level == null || next.level === '')) {
        next.level = prev.level;
      }
      bestByUid.set(uid, next);
    } else if (row.level != null && (prev.level == null || prev.level === '')) {
      bestByUid.set(uid, { ...prev, level: row.level });
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

function normalizeApiTimesRow(row) {
  return {
    id: String(row?.id || row?.uid || ''),
    uid: String(row?.uid || ''),
    displayName: String(row?.displayName || row?.username || '???').slice(0, 24),
    ms: Math.max(0, Math.floor(Number(row?.ms) || 0)),
    level: row?.level == null ? null : Math.max(1, Math.floor(Number(row.level) || 1)),
    prize_used: row?.prize_used ?? null,
  };
}

function updateCacheForKind(kind, rows) {
  if (kind === 'pure') _cachePure = rows;
  else if (kind === 'level') _cacheLevel = rows;
  else _cacheGeneral = rows;
  setCacheTimestampForKind(kind, nowMs());
  writeSessionStorageCache();
}

async function fetchLeaderboardTimesApi(kind = 'general', n = LEADERBOARD_TOP_N) {
  const resp = await fetch(`/api/leaderboard/times?kind=${encodeURIComponent(kind)}&n=${encodeURIComponent(String(n))}`, { credentials: 'omit' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  return rows.map(normalizeApiTimesRow).filter((r) => r.uid && isValidMs(r.ms)).slice(0, n);
}

/**
 * kind: 'general' | 'pure'
 * Path principale: endpoint HTTP backend cached.
 * Fallback: merge legacy da Firestore client (scores + usernames).
 */
export async function fetchLeaderboard(kind = 'general', n = LEADERBOARD_TOP_N, options = {}) {
  const force = !!options?.force;
  if (!force && isKindCacheFresh(kind)) {
    const rows = getCachedLeaderboard(kind);
    return rows.length > n ? rows.slice(0, n) : rows;
  }
  const inflightKey = `${kind}:${n}`;
  if (!force && _inflightFetchByKey.has(inflightKey)) {
    return _inflightFetchByKey.get(inflightKey);
  }
  const run = (async () => {
  if (kind === 'pure') {
    try {
      const rows = await fetchLeaderboardTimesApi('pure', n);
      updateCacheForKind('pure', rows);
      return _cachePure;
    } catch (e) {
      const uidToSlug = await getUidToClaimedUsernameMap().catch(() => new Map());
      _cachePure = await fetchLegacyScoresTopPure(n).catch(() => []);
      _cachePure = dedupeBestByUid(applyPublicDisplayNames(_cachePure, uidToSlug), n);
      setCacheTimestampForKind('pure', nowMs());
      writeSessionStorageCache();
      return _cachePure;
    }
  }

  try {
    const rows = await fetchLeaderboardTimesApi('general', n);
    updateCacheForKind('general', rows);
    return _cacheGeneral;
  } catch (e) {
    const uidToSlug = await getUidToClaimedUsernameMap().catch(() => new Map());
    _cacheGeneral = await fetchLegacyScoresTop(n).catch(() => []);
    _cacheGeneral = dedupeBestByUid(applyPublicDisplayNames(_cacheGeneral, uidToSlug), n);
    setCacheTimestampForKind('general', nowMs());
    writeSessionStorageCache();
    return _cacheGeneral;
  }
  })();
  _inflightFetchByKey.set(inflightKey, run);
  try {
    return await run;
  } finally {
    _inflightFetchByKey.delete(inflightKey);
  }
}

/**
 * Classifica per livello (TOP 15): legge dall'endpoint backend che fa già il sort cascade
 * level → best_streak 180/150/120/90/60 → bestTime (nascosto) → uid.
 * Risposta: { ok, rows: [{ uid, displayName, level, s60, s90, s120, s150, s180 }] }
 */
export async function fetchLeaderboardByLevel(options = {}) {
  const force = !!options?.force;
  if (!force && isKindCacheFresh('level')) return _cacheLevel;
  try {
    const resp = await fetch('/api/leaderboard/by-level', { credentials: 'omit' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    _cacheLevel = rows.map((r) => ({
      uid: String(r.uid || ''),
      displayName: String(r.displayName || '').slice(0, 24) || '???',
      level: Math.max(1, Math.floor(Number(r.level) || 1)),
      s60: Math.max(0, Math.floor(Number(r.s60) || 0)),
      s90: Math.max(0, Math.floor(Number(r.s90) || 0)),
      s120: Math.max(0, Math.floor(Number(r.s120) || 0)),
      s150: Math.max(0, Math.floor(Number(r.s150) || 0)),
      s180: Math.max(0, Math.floor(Number(r.s180) || 0)),
    })).filter((r) => r.uid);
    _cacheLevelAt = nowMs();
    writeSessionStorageCache();
    return _cacheLevel;
  } catch (e) {
    return _cacheLevel;
  }
}

export function getCachedLevelLeaderboard() {
  return _cacheLevel;
}

/** Compat: una volta caricate tutte le classifiche le cache sono aggiornate. */
export async function fetchBothLeaderboards(n = LEADERBOARD_TOP_N, options = {}) {
  const force = !!options?.force;
  if (!force && hasFreshLeaderboardCaches()) return;
  await Promise.all([
    fetchLeaderboard('general', n, options),
    fetchLeaderboard('pure', n, options),
    fetchLeaderboardByLevel(options),
  ]);
}

export function getCachedLeaderboard(kind = 'general') {
  if (kind === 'level') return _cacheLevel;
  return kind === 'pure' ? _cachePure : _cacheGeneral;
}

/** Aggiorna il livello in cache classifica (generale + pura + per-livello) per un uid. */
export function syncLeaderboardLevel(uid, level) {
  if (!uid) return;
  const lv = Math.max(1, Math.floor(Number(level) || 0));
  if (!Number.isFinite(lv) || lv < 1) return;
  for (const cache of [_cacheGeneral, _cachePure, _cacheLevel]) {
    const idx = cache.findIndex((r) => r.uid === uid);
    if (idx >= 0) cache[idx] = { ...cache[idx], level: lv };
  }
  writeSessionStorageCache();
}

/**
 * Aggiorna la cache della classifica generale in modo ottimistico;
 * se la run è pura (`prizeUsed` assente), aggiorna anche `_cachePure`.
 * prizeUsed: codice premio Plus (es. red_plus) o null se run pura.
 */
export function applyOptimisticScore(uid, displayName, ms, prizeUsed = null) {
  const t = Math.floor(ms);
  if (!isValidMs(t)) return;

  const row = { id: uid, uid, displayName, ms: t };
  if (prizeUsed) row.prize_used = prizeUsed;

  const idx = _cacheGeneral.findIndex(r => r.uid === uid);
  let improvedGeneral = false;
  if (idx >= 0) {
    if (t > _cacheGeneral[idx].ms) {
      improvedGeneral = true;
      const merged = { ..._cacheGeneral[idx], ...row };
      if (!prizeUsed) delete merged.prize_used;
      _cacheGeneral[idx] = merged;
    }
  } else {
    improvedGeneral = true;
    _cacheGeneral.push({ ...row });
  }
  if (improvedGeneral) {
    _cacheGeneral = _cacheGeneral.sort((a, b) => b.ms - a.ms).slice(0, LEADERBOARD_TOP_N);
    _cacheGeneralAt = nowMs();
  }

  if (!prizeUsed) {
    const idxP = _cachePure.findIndex(r => r.uid === uid);
    const rowP = { id: uid, uid, displayName, ms: t };
    let improvedPure = false;
    if (idxP >= 0) {
      if (t > _cachePure[idxP].ms) {
        improvedPure = true;
        const merged = { ..._cachePure[idxP], ...rowP };
        delete merged.prize_used;
        _cachePure[idxP] = merged;
      }
    } else {
      improvedPure = true;
      _cachePure.push(rowP);
    }
    if (improvedPure) {
      _cachePure = _cachePure.sort((a, b) => b.ms - a.ms).slice(0, LEADERBOARD_TOP_N);
      _cachePureAt = nowMs();
    }
  }
  writeSessionStorageCache();
}

