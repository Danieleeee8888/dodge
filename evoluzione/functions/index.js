const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const {onRequest} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");

admin.initializeApp();
setGlobalOptions({region: "europe-west1", maxInstances: 10});

const db = admin.firestore();
const app = express();
app.use(cors({origin: true}));
app.use(express.json({limit: "1mb"}));

const ADMIN_EMAIL = "danielet88@gmail.com";
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function nowTs() {
  return admin.firestore.FieldValue.serverTimestamp();
}

function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parsePositiveInt(v, fallback) {
  const n = Number.parseInt(String(v || ""), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function toIsoDatePart(d = new Date()) {
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function hhmmss(totalSeconds) {
  const s = Math.max(0, Math.floor(safeNum(totalSeconds, 0)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, "\"\"")}"`;
  return s;
}

function csvFromRows(headers, rows) {
  const lines = [headers.map(csvEscape).join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  });
  return "\uFEFF" + lines.join("\r\n");
}

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({error: "missing_token"});
    const decoded = await admin.auth().verifyIdToken(match[1], true);
    req.user = decoded;
    req.uid = decoded.uid;
    next();
  } catch (e) {
    logger.warn("auth error", e);
    return res.status(401).json({error: "invalid_token"});
  }
}

async function getUserRole(uid) {
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) return "user";
  const data = snap.data() || {};
  return String(data.role || "user");
}

async function requireAdmin(req, res, next) {
  try {
    const role = await getUserRole(req.uid);
    const email = String(req.user.email || "").toLowerCase();
    if (role !== "admin" || email !== ADMIN_EMAIL) {
      return res.status(403).json({error: "forbidden"});
    }
    next();
  } catch (e) {
    logger.error("requireAdmin failed", e);
    return res.status(500).json({error: "internal_error"});
  }
}

function publicStatsShape(statsDoc) {
  const d = statsDoc || {};
  return {
    best_time_seconds: safeNum(d.best_time_seconds, 0),
    total_games: safeNum(d.total_games, 0),
    total_playtime_seconds: safeNum(d.total_playtime_seconds, 0),
    total_playtime_hhmmss: hhmmss(d.total_playtime_seconds),
    collected: {
      red: safeNum(d.red_collected, 0),
      blue: safeNum(d.blue_collected, 0),
      yellow: safeNum(d.yellow_collected, 0),
      green: safeNum(d.green_collected, 0),
      purple: safeNum(d.purple_collected, 0),
    },
    rewards: {
      has_red_plus: !!d.has_red_plus,
      has_red_premium: !!d.has_red_premium,
      has_blue_plus: !!d.has_blue_plus,
      has_blue_premium: !!d.has_blue_premium,
      has_yellow_plus: !!d.has_yellow_plus,
      has_yellow_premium: !!d.has_yellow_premium,
      has_green_plus: !!d.has_green_plus,
      has_green_premium: !!d.has_green_premium,
      has_purple_plus: !!d.has_purple_plus,
      has_purple_premium: !!d.has_purple_premium,
    },
  };
}

/** Ordine colonne stabile per export CSV giocatori (UTF-8 BOM). */
function playerStatsExportHeaders() {
  return [
    "user_id",
    "username",
    "email",
    "created_at",
    "last_login",
    "role",
    "total_games",
    "total_playtime_seconds",
    "best_time_seconds",
    "deaths_by_triangle",
    "deaths_by_square",
    "red_collected",
    "blue_collected",
    "yellow_collected",
    "green_collected",
    "purple_collected",
    "extra_lives_used",
    "shields_consumed",
    "whites_killed_by_yellow",
    "runs_over_60s",
    "runs_over_90s",
    "runs_over_120s",
    "runs_over_150s",
    "runs_over_180s",
    "current_streak_over_60s",
    "current_streak_over_90s",
    "current_streak_over_120s",
    "current_streak_over_150s",
    "has_red_plus",
    "has_red_premium",
    "has_blue_plus",
    "has_blue_premium",
    "has_yellow_plus",
    "has_yellow_premium",
    "has_green_plus",
    "has_green_premium",
    "has_purple_plus",
    "has_purple_premium",
    "premi_usati_count",
    "updated_at",
  ];
}

function statsIso(ts) {
  try {
    if (!ts) return "";
    if (typeof ts.toDate === "function") return ts.toDate().toISOString();
    return "";
  } catch (_) {
    return "";
  }
}

async function upsertPlayerStatsIfMissing(uid) {
  const ref = db.collection("player_stats").doc(uid);
  const snap = await ref.get();
  if (snap.exists) return;
  await ref.set({
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
    updated_at: nowTs(),
  }, {merge: true});
}

app.get("/api/player/stats", requireAuth, async (req, res) => {
  try {
    await upsertPlayerStatsIfMissing(req.uid);
    const snap = await db.collection("player_stats").doc(req.uid).get();
    return res.json({ok: true, uid: req.uid, stats: snap.data() || {}});
  } catch (e) {
    logger.error("GET /api/player/stats", e);
    return res.status(500).json({error: "internal_error"});
  }
});

app.get("/api/player/stats/:userId", async (req, res) => {
  try {
    const userId = String(req.params.userId || "");
    if (!userId) return res.status(400).json({error: "missing_user_id"});
    const [userSnap, statsSnap] = await Promise.all([
      db.collection("users").doc(userId).get(),
      db.collection("player_stats").doc(userId).get(),
    ]);
    if (!userSnap.exists) return res.status(404).json({error: "not_found"});
    const u = userSnap.data() || {};
    const stats = publicStatsShape(statsSnap.exists ? statsSnap.data() : {});
    return res.json({
      ok: true,
      user: {
        id: userId,
        username: u.username || "",
        displayName: u.displayName || u.username || "",
      },
      stats,
    });
  } catch (e) {
    logger.error("GET /api/player/stats/:userId", e);
    return res.status(500).json({error: "internal_error"});
  }
});

app.post("/api/game/end", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const duration = Math.max(0, safeNum(body.duration_seconds, 0));
    const levelReached = Math.max(0, Math.floor(safeNum(body.level_reached, 0)));
    const whitesAtDeath = Math.max(0, Math.floor(safeNum(body.whites_on_screen_at_death, 0)));
    const deathCause = body.death_cause === "square" ? "square" : "triangle";
    const bonusActive = body.bonus_active == null ? null : String(body.bonus_active);
    const collected = body.bonuses_collected || {};
    const extraLivesUsed = Math.max(0, Math.floor(safeNum(body.extra_lives_used, 0)));
    const shieldsConsumed = Math.max(0, Math.floor(safeNum(body.shields_consumed, 0)));
    const whitesKilled = Math.max(0, Math.floor(safeNum(body.whites_killed_by_yellow, 0)));

    const uid = req.uid;
    const userRef = db.collection("users").doc(uid);
    const statsRef = db.collection("player_stats").doc(uid);
    const recentRef = db.collection("recent_games").doc();
    let shouldUpdateLeaderboard = false;
    let userBestMs = 0;
    let displayName = "";

    await db.runTransaction(async (tx) => {
      const [userSnap, statsSnap] = await Promise.all([tx.get(userRef), tx.get(statsRef)]);
      if (!userSnap.exists) throw new Error("no_profile");
      const user = userSnap.data() || {};
      const s = statsSnap.exists ? (statsSnap.data() || {}) : {};
      displayName = String(user.displayName || user.username || "Player").slice(0, 24);

      const next = {
        user_id: uid,
        total_games: safeNum(s.total_games, 0) + 1,
        total_playtime_seconds: safeNum(s.total_playtime_seconds, 0) + duration,
        best_time_seconds: Math.max(safeNum(s.best_time_seconds, 0), duration),
        deaths_by_triangle: safeNum(s.deaths_by_triangle, 0) + (deathCause === "triangle" ? 1 : 0),
        deaths_by_square: safeNum(s.deaths_by_square, 0) + (deathCause === "square" ? 1 : 0),
        red_collected: safeNum(s.red_collected, 0) + Math.max(0, Math.floor(safeNum(collected.red, 0))),
        blue_collected: safeNum(s.blue_collected, 0) + Math.max(0, Math.floor(safeNum(collected.blue, 0))),
        yellow_collected: safeNum(s.yellow_collected, 0) + Math.max(0, Math.floor(safeNum(collected.yellow, 0))),
        green_collected: safeNum(s.green_collected, 0) + Math.max(0, Math.floor(safeNum(collected.green, 0))),
        purple_collected: safeNum(s.purple_collected, 0) + Math.max(0, Math.floor(safeNum(collected.purple, 0))),
        extra_lives_used: safeNum(s.extra_lives_used, 0) + extraLivesUsed,
        shields_consumed: safeNum(s.shields_consumed, 0) + shieldsConsumed,
        whites_killed_by_yellow: safeNum(s.whites_killed_by_yellow, 0) + whitesKilled,
        runs_over_60s: safeNum(s.runs_over_60s, 0) + (duration >= 60 ? 1 : 0),
        runs_over_90s: safeNum(s.runs_over_90s, 0) + (duration >= 90 ? 1 : 0),
        runs_over_120s: safeNum(s.runs_over_120s, 0) + (duration >= 120 ? 1 : 0),
        runs_over_150s: safeNum(s.runs_over_150s, 0) + (duration >= 150 ? 1 : 0),
        runs_over_180s: safeNum(s.runs_over_180s, 0) + (duration >= 180 ? 1 : 0),
        current_streak_over_60s: duration >= 60 ? safeNum(s.current_streak_over_60s, 0) + 1 : 0,
        current_streak_over_90s: duration >= 90 ? safeNum(s.current_streak_over_90s, 0) + 1 : 0,
        current_streak_over_120s: duration >= 120 ? safeNum(s.current_streak_over_120s, 0) + 1 : 0,
        current_streak_over_150s: duration >= 150 ? safeNum(s.current_streak_over_150s, 0) + 1 : 0,
        updated_at: nowTs(),
      };
      tx.set(statsRef, next, {merge: true});
      tx.set(recentRef, {
        user_id: uid,
        duration_seconds: duration,
        level_reached: levelReached,
        whites_on_screen_at_death: whitesAtDeath,
        death_cause: deathCause,
        bonus_active: bonusActive,
        played_at: nowTs(),
      });

      userBestMs = safeNum(user.bestTime, 0);
      const newBestMs = Math.max(userBestMs, Math.floor(duration * 1000));
      if (newBestMs > userBestMs) {
        shouldUpdateLeaderboard = true;
        tx.set(userRef, {
          bestTime: newBestMs,
          gamesPlayed: safeNum(user.gamesPlayed, 0) + 1,
          lastSeen: nowTs(),
        }, {merge: true});
      } else {
        tx.set(userRef, {
          gamesPlayed: safeNum(user.gamesPlayed, 0) + 1,
          lastSeen: nowTs(),
        }, {merge: true});
      }
    });

    const runMs = Math.floor(duration * 1000);
    await db.collection("scores").add({
      uid,
      displayName,
      ms: runMs,
      createdAt: nowTs(),
    });

    let inTop10Result = false;
    if (shouldUpdateLeaderboard) {
      const lbSnap = await db.collection("leaderboard").orderBy("ms", "desc").limit(10).get();
      const rows = lbSnap.docs.map((d) => ({id: d.id, ...d.data()}));
      const myEntry = rows.find((r) => r.uid === uid || r.id === uid);
      const worstMs = rows.length > 0 ? rows[rows.length - 1].ms : 0;
      const inTop10 = rows.length < 10 || myEntry !== undefined || runMs > worstMs;
      if (inTop10) {
        await db.collection("leaderboard").doc(uid).set({
          uid,
          displayName,
          ms: runMs,
          updatedAt: nowTs(),
        }, {merge: true});
        inTop10Result = true;
      }
    }

    const overflow = await db.collection("recent_games")
        .where("user_id", "==", uid)
        .orderBy("played_at", "desc")
        .offset(50)
        .limit(200)
        .get();
    if (!overflow.empty) {
      const batch = db.batch();
      overflow.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }

    return res.json({ok: true, improved: shouldUpdateLeaderboard, inTop10: inTop10Result});
  } catch (e) {
    logger.error("POST /api/game/end", e);
    if (String(e.message || "") === "no_profile") {
      return res.status(404).json({error: "no_profile"});
    }
    return res.status(500).json({error: "internal_error"});
  }
});

app.get("/api/admin/overview", requireAuth, requireAdmin, async (req, res) => {
  try {
    const now = Date.now();
    const dayAgo = admin.firestore.Timestamp.fromMillis(now - 24 * 3600 * 1000);
    const weekAgo = admin.firestore.Timestamp.fromMillis(now - 7 * 24 * 3600 * 1000);

    const [usersSnap, recent24hSnap, recent7dSnap, recentAllSnap, leaderboardSnap, statsSnap] = await Promise.all([
      db.collection("users").get(),
      db.collection("recent_games").where("played_at", ">=", dayAgo).get(),
      db.collection("recent_games").where("played_at", ">=", weekAgo).get(),
      db.collection("recent_games").get(),
      db.collection("leaderboard").orderBy("ms", "desc").limit(10).get(),
      db.collection("player_stats").get(),
    ]);

    const verifiedFlags = await Promise.all(usersSnap.docs.map(async (d) => {
      try {
        const au = await admin.auth().getUser(d.id);
        return au.emailVerified === true;
      } catch (_) {
        return false;
      }
    }));
    const verified = verifiedFlags.filter(Boolean).length;

    /** Giocatori con tempo migliore (secondi) ≥ soglia — utile per calibrare missioni. */
    const distPlayers = {over60: 0, over90: 0, over120: 0, over150: 0, over180: 0, over210: 0};
    statsSnap.docs.forEach((d) => {
      const best = safeNum(d.data()?.best_time_seconds, 0);
      if (best >= 60) distPlayers.over60 += 1;
      if (best >= 90) distPlayers.over90 += 1;
      if (best >= 120) distPlayers.over120 += 1;
      if (best >= 150) distPlayers.over150 += 1;
      if (best >= 180) distPlayers.over180 += 1;
      if (best >= 210) distPlayers.over210 += 1;
    });

    let sum7 = 0;
    recent7dSnap.docs.forEach((d) => {
      sum7 += safeNum(d.data()?.duration_seconds, 0);
    });

    const top10 = leaderboardSnap.docs.map((d) => d.data());
    return res.json({
      ok: true,
      totals: {
        users_total: usersSnap.size,
        users_verified: verified,
        games_last_24h: recent24hSnap.size,
        games_last_7d: recent7dSnap.size,
        games_total: recentAllSnap.size,
      },
      avg_run_seconds_last_7d: recent7dSnap.size ? (sum7 / recent7dSnap.size) : 0,
      duration_distribution: distPlayers,
      top10,
    });
  } catch (e) {
    logger.error("GET /api/admin/overview", e);
    return res.status(500).json({error: "internal_error"});
  }
});

/**
 * Migrazione una tantum: allinea role su users e totali base su player_stats
 * da storico `scores` + campi users (gamesPlayed, bestTime ms).
 * Idempotente: usa Math.max con valori già presenti su player_stats.
 */
app.post("/api/admin/backfill-stats-from-history", requireAuth, requireAdmin, async (req, res) => {
  try {
    const [usersSnap, scoresSnap, statsSnapAll] = await Promise.all([
      db.collection("users").get(),
      db.collection("scores").get(),
      db.collection("player_stats").get(),
    ]);
    const statsByUid = new Map(statsSnapAll.docs.map((d) => [d.id, d.data() || {}]));

    const byUid = new Map();
    usersSnap.docs.forEach((d) => {
      const data = d.data() || {};
      byUid.set(d.id, {
        uid: d.id,
        email: String(data.email || "").trim().toLowerCase(),
        gamesPlayed: safeNum(data.gamesPlayed, 0),
        bestTimeMs: safeNum(data.bestTime, 0),
        scoreCount: 0,
        scoreMsTotal: 0,
        scoreBestMs: 0,
      });
    });

    scoresSnap.docs.forEach((d) => {
      const row = d.data() || {};
      const uid = String(row.uid || "").trim();
      if (!uid || !byUid.has(uid)) return;
      const ms = safeNum(row.ms, 0);
      if (ms <= 0) return;
      const item = byUid.get(uid);
      item.scoreCount += 1;
      item.scoreMsTotal += ms;
      if (ms > item.scoreBestMs) item.scoreBestMs = ms;
    });

    let batch = db.batch();
    let ops = 0;
    const flush = async () => {
      if (ops === 0) return;
      await batch.commit();
      batch = db.batch();
      ops = 0;
    };

    for (const u of byUid.values()) {
      const role = u.email === ADMIN_EMAIL ? "admin" : "user";
      const computedGames = Math.max(u.scoreCount, u.gamesPlayed);
      const computedPlaytimeSec = u.scoreMsTotal / 1000;
      const computedBestMs = Math.max(u.bestTimeMs, u.scoreBestMs);
      const computedBestSec = computedBestMs / 1000;

      const existing = statsByUid.get(u.uid) || {};
      const merged = {
        ...existing,
        user_id: u.uid,
        total_games: Math.max(safeNum(existing.total_games, 0), computedGames),
        total_playtime_seconds: Math.max(safeNum(existing.total_playtime_seconds, 0), computedPlaytimeSec),
        best_time_seconds: Math.max(safeNum(existing.best_time_seconds, 0), computedBestSec),
        updated_at: nowTs(),
      };

      batch.set(db.collection("player_stats").doc(u.uid), merged, {merge: true});
      batch.set(db.collection("users").doc(u.uid), {role}, {merge: true});
      ops += 2;
      if (ops >= 400) await flush();
    }
    await flush();

    return res.json({
      ok: true,
      users: usersSnap.size,
      scores_documents: scoresSnap.size,
      player_stats_updated: byUid.size,
    });
  } catch (e) {
    logger.error("POST /api/admin/backfill-stats-from-history", e);
    return res.status(500).json({error: "internal_error"});
  }
});

app.get("/api/admin/players", requireAuth, requireAdmin, async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, DEFAULT_PAGE);
    const limit = Math.min(parsePositiveInt(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT);
    const sort = String(req.query.sort || "best_time");
    const q = String(req.query.q || "").trim().toLowerCase();

    const [usersSnap, statsSnap] = await Promise.all([
      db.collection("users").get(),
      db.collection("player_stats").get(),
    ]);
    const statsByUid = new Map(statsSnap.docs.map((d) => [d.id, d.data() || {}]));
    let rows = usersSnap.docs.map((d) => {
      const u = d.data() || {};
      const st = statsByUid.get(d.id) || {};
      const rewardsCount = [
        "has_red_plus", "has_red_premium", "has_blue_plus", "has_blue_premium",
        "has_yellow_plus", "has_yellow_premium", "has_green_plus", "has_green_premium",
        "has_purple_plus", "has_purple_premium",
      ].reduce((acc, key) => acc + (st[key] ? 1 : 0), 0);
      return {
        id: d.id,
        username: u.username || "",
        email: u.email || "",
        best_time: safeNum(st.best_time_seconds, 0),
        total_games: safeNum(st.total_games, 0),
        total_playtime_seconds: safeNum(st.total_playtime_seconds, 0),
        total_playtime_hhmmss: hhmmss(st.total_playtime_seconds),
        last_login: u.lastSeen || null,
        role: u.role || "user",
        rewards_unlocked_count: rewardsCount,
      };
    });

    if (q) {
      rows = rows.filter((r) =>
        String(r.username).toLowerCase().includes(q) ||
        String(r.email).toLowerCase().includes(q),
      );
    }

    const sortMap = {
      username: (a, b) => String(a.username).localeCompare(String(b.username)),
      email: (a, b) => String(a.email).localeCompare(String(b.email)),
      best_time: (a, b) => b.best_time - a.best_time,
      total_games: (a, b) => b.total_games - a.total_games,
      total_playtime: (a, b) => b.total_playtime_seconds - a.total_playtime_seconds,
      last_login: (a, b) => (b.last_login?.toMillis?.() || 0) - (a.last_login?.toMillis?.() || 0),
      role: (a, b) => String(a.role).localeCompare(String(b.role)),
    };
    rows.sort(sortMap[sort] || sortMap.best_time);

    const total = rows.length;
    const start = (page - 1) * limit;
    const pageRows = rows.slice(start, start + limit);
    return res.json({ok: true, page, limit, total, rows: pageRows});
  } catch (e) {
    logger.error("GET /api/admin/players", e);
    return res.status(500).json({error: "internal_error"});
  }
});

app.get("/api/admin/players/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const [userSnap, statsSnap, gamesSnap] = await Promise.all([
      db.collection("users").doc(id).get(),
      db.collection("player_stats").doc(id).get(),
      db.collection("recent_games").where("user_id", "==", id).orderBy("played_at", "desc").limit(20).get(),
    ]);
    if (!userSnap.exists) return res.status(404).json({error: "not_found"});
    return res.json({
      ok: true,
      user: {id, ...(userSnap.data() || {})},
      stats: statsSnap.exists ? statsSnap.data() : {},
      recent_games: gamesSnap.docs.map((d) => ({id: d.id, ...(d.data() || {})})),
    });
  } catch (e) {
    logger.error("GET /api/admin/players/:id", e);
    return res.status(500).json({error: "internal_error"});
  }
});

app.get("/api/admin/export", requireAuth, requireAdmin, async (req, res) => {
  try {
    const type = String(req.query.type || "");
    if (type === "players") {
      const [usersSnap, statsSnap] = await Promise.all([
        db.collection("users").get(),
        db.collection("player_stats").get(),
      ]);
      const statsByUid = new Map(statsSnap.docs.map((d) => [d.id, d.data() || {}]));
      const headers = playerStatsExportHeaders();
      const rows = usersSnap.docs.map((d) => {
        const u = d.data() || {};
        const st = statsByUid.get(d.id) || {};
        return {
          user_id: d.id,
          username: u.username || "",
          email: u.email || "",
          created_at: u.createdAt?.toDate?.()?.toISOString?.() || "",
          last_login: u.lastSeen?.toDate?.()?.toISOString?.() || "",
          role: u.role || "user",
          total_games: safeNum(st.total_games, 0),
          total_playtime_seconds: safeNum(st.total_playtime_seconds, 0),
          best_time_seconds: safeNum(st.best_time_seconds, 0),
          deaths_by_triangle: safeNum(st.deaths_by_triangle, 0),
          deaths_by_square: safeNum(st.deaths_by_square, 0),
          red_collected: safeNum(st.red_collected, 0),
          blue_collected: safeNum(st.blue_collected, 0),
          yellow_collected: safeNum(st.yellow_collected, 0),
          green_collected: safeNum(st.green_collected, 0),
          purple_collected: safeNum(st.purple_collected, 0),
          extra_lives_used: safeNum(st.extra_lives_used, 0),
          shields_consumed: safeNum(st.shields_consumed, 0),
          whites_killed_by_yellow: safeNum(st.whites_killed_by_yellow, 0),
          runs_over_60s: safeNum(st.runs_over_60s, 0),
          runs_over_90s: safeNum(st.runs_over_90s, 0),
          runs_over_120s: safeNum(st.runs_over_120s, 0),
          runs_over_150s: safeNum(st.runs_over_150s, 0),
          runs_over_180s: safeNum(st.runs_over_180s, 0),
          current_streak_over_60s: safeNum(st.current_streak_over_60s, 0),
          current_streak_over_90s: safeNum(st.current_streak_over_90s, 0),
          current_streak_over_120s: safeNum(st.current_streak_over_120s, 0),
          current_streak_over_150s: safeNum(st.current_streak_over_150s, 0),
          has_red_plus: !!st.has_red_plus,
          has_red_premium: !!st.has_red_premium,
          has_blue_plus: !!st.has_blue_plus,
          has_blue_premium: !!st.has_blue_premium,
          has_yellow_plus: !!st.has_yellow_plus,
          has_yellow_premium: !!st.has_yellow_premium,
          has_green_plus: !!st.has_green_plus,
          has_green_premium: !!st.has_green_premium,
          has_purple_plus: !!st.has_purple_plus,
          has_purple_premium: !!st.has_purple_premium,
          premi_usati_count: safeNum(st.premi_usati_count, 0),
          updated_at: statsIso(st.updated_at),
        };
      });
      const csv = csvFromRows(headers, rows);
      const filename = `players_stats_${toIsoDatePart()}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.status(200).send(csv);
    }

    if (type === "games") {
      const daysRaw = String(req.query.days || "7").toLowerCase();
      let days = 7;
      let gamesQ = db.collection("recent_games").orderBy("played_at", "desc");
      if (daysRaw !== "all") {
        days = parsePositiveInt(daysRaw, 7);
        const start = admin.firestore.Timestamp.fromMillis(Date.now() - days * 24 * 3600 * 1000);
        gamesQ = gamesQ.where("played_at", ">=", start);
      } else {
        days = 0;
      }
      const [gamesSnap, usersSnap] = await Promise.all([gamesQ.get(), db.collection("users").get()]);
      const userById = new Map(usersSnap.docs.map((d) => [d.id, d.data() || {}]));
      const rows = gamesSnap.docs.map((d) => {
        const g = d.data() || {};
        const u = userById.get(g.user_id) || {};
        return {
          played_at: g.played_at?.toDate?.()?.toISOString?.() || "",
          username: u.displayName || u.username || "",
          user_id: g.user_id || "",
          duration_seconds: safeNum(g.duration_seconds, 0),
          level_reached: safeNum(g.level_reached, 0),
          whites_on_screen_at_death: safeNum(g.whites_on_screen_at_death, 0),
          death_cause: g.death_cause || "",
          bonus_active: g.bonus_active || "",
        };
      });
      const headers = ["played_at", "username", "user_id", "duration_seconds", "level_reached", "whites_on_screen_at_death", "death_cause", "bonus_active"];
      const csv = csvFromRows(headers, rows);
      const suffix = daysRaw === "all" ? "all" : `${days}days`;
      const filename = `games_last${suffix}_${toIsoDatePart()}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.status(200).send(csv);
    }

    return res.status(400).json({error: "invalid_type"});
  } catch (e) {
    logger.error("GET /api/admin/export", e);
    return res.status(500).json({error: "internal_error"});
  }
});

app.get("/health", (_req, res) => res.json({ok: true}));

exports.api = onRequest({invoker: "public"}, app);
