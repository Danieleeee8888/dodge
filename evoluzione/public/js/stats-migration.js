import { db } from './firebase-init.js';
import {
  collection,
  doc,
  getDocs,
  writeBatch,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const ADMIN_EMAIL = 'danielet88@gmail.com';
const BATCH_LIMIT = 400;

function emptyStats(uid) {
  return {
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
    current_streak_over_180s: 0,
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
    updated_at: serverTimestamp(),
  };
}

function msToSeconds(value) {
  const ms = Number(value || 0);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return ms / 1000;
}

async function commitInChunks(writes) {
  for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
    const slice = writes.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);
    slice.forEach((w) => w(batch));
    await batch.commit();
  }
}

/**
 * Backfill Fase 1:
 * - crea/aggiorna `player_stats/{uid}` dagli storici `scores`
 * - allinea `users/{uid}.role` ('admin' solo per danielet88@gmail.com)
 *
 * Esempio da console (utente admin loggato):
 *   import('/js/stats-migration.js').then(m => m.runPhase1StatsMigration())
 */
export async function runPhase1StatsMigration() {
  const [usersSnap, scoresSnap] = await Promise.all([
    getDocs(collection(db, 'users')),
    getDocs(collection(db, 'scores')),
  ]);

  const byUid = new Map();
  usersSnap.docs.forEach((d) => {
    byUid.set(d.id, {
      uid: d.id,
      email: String(d.data()?.email || '').trim().toLowerCase(),
      gamesPlayed: Number(d.data()?.gamesPlayed || 0),
      bestTimeMs: Number(d.data()?.bestTime || 0),
      scoreCount: 0,
      scoreMsTotal: 0,
    });
  });

  scoresSnap.docs.forEach((d) => {
    const row = d.data() || {};
    const uid = String(row.uid || '').trim();
    if (!uid || !byUid.has(uid)) return;
    const ms = Number(row.ms || 0);
    if (!Number.isFinite(ms) || ms <= 0) return;
    const item = byUid.get(uid);
    item.scoreCount += 1;
    item.scoreMsTotal += ms;
    if (ms > item.bestTimeMs) item.bestTimeMs = ms;
  });

  const writes = [];
  byUid.forEach((u) => {
    const role = u.email === ADMIN_EMAIL ? 'admin' : 'user';
    const stats = emptyStats(u.uid);
    stats.total_games = Math.max(u.scoreCount, u.gamesPlayed);
    stats.total_playtime_seconds = msToSeconds(u.scoreMsTotal);
    stats.best_time_seconds = msToSeconds(u.bestTimeMs);

    const userRef = doc(db, 'users', u.uid);
    const statsRef = doc(db, 'player_stats', u.uid);
    writes.push((batch) => batch.set(statsRef, stats, { merge: true }));
    writes.push((batch) => batch.set(userRef, { role }, { merge: true }));
  });

  await commitInChunks(writes);
  return {
    users: usersSnap.size,
    scores: scoresSnap.size,
    migratedStats: byUid.size,
  };
}

