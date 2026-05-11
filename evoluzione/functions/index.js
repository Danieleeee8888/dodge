const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const {onRequest} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");

admin.initializeApp({
  databaseURL: "https://dodge-84439-default-rtdb.europe-west1.firebasedatabase.app",
});
setGlobalOptions({region: "europe-west1", maxInstances: 10});

const db = admin.firestore();
const app = express();
app.use(cors({origin: true}));
app.use(express.json({limit: "1mb"}));

const ADMIN_EMAIL = "danielet88@gmail.com";
const LEADERBOARD_TOP_N = 15;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const PLUS_LAUNCH_GIFT_FIELD = "plus_launch_gift_2026_05";

const missionsPackage = require("./missions-config.json");
const MISSION_WINDOW_MS = Number(missionsPackage.MISSION_WINDOW_MS) > 0
  ? Number(missionsPackage.MISSION_WINDOW_MS)
  : 86400000;
const MISSION_PRIZE_AWARD_EACH_COMPLETE = Number(missionsPackage.MISSION_PRIZE_AWARD_EACH_COMPLETE) >= 1
  ? Math.floor(Number(missionsPackage.MISSION_PRIZE_AWARD_EACH_COMPLETE))
  : 3;
const MISSION_RULES = missionsPackage.missions && typeof missionsPackage.missions === "object"
  ? missionsPackage.missions
  : {};
const PRIZE_CODES = Object.keys(MISSION_RULES);

function fillMissionDescTemplate(m) {
  const tpl = String(m.description_template || "");
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (m[k] != null ? String(m[k]) : `{${k}}`));
}

function buildMissionCatalog() {
  const out = {};
  for (const code of Object.keys(MISSION_RULES)) {
    const m = MISSION_RULES[code];
    out[code] = {
      title: m.title,
      description: fillMissionDescTemplate(m),
      reward_label: m.reward_label,
    };
  }
  return out;
}

const MISSION_CATALOG = buildMissionCatalog();

function missionRuleCfg(code) {
  return MISSION_RULES[code];
}

function emptyPrizes() {
  const o = {};
  for (const k of PRIZE_CODES) o[k] = 0;
  return o;
}

function normalizePrizesObject(raw) {
  const base = emptyPrizes();
  if (!raw || typeof raw !== "object") return base;
  for (const k of Object.keys(base)) {
    base[k] = Math.max(0, Math.min(10, Math.floor(safeNum(raw[k], 0))));
  }
  return base;
}

function initialMissionProgress(code) {
  const cfg = missionRuleCfg(code);
  if (!cfg) return {qualifying_runs: 0, target_runs: 10};
  if (cfg.rule === "yellow_kill_counter") {
    const tgt = Number(cfg.counter_target);
    return {counter: 0, target: Number.isFinite(tgt) && tgt > 0 ? tgt : 100};
  }
  const tr = Number(cfg.target_runs);
  return {qualifying_runs: 0, target_runs: Number.isFinite(tr) && tr > 0 ? tr : 10};
}

function missionStartedToMillis(st) {
  try {
    if (!st || typeof st.toMillis !== "function") return null;
    return st.toMillis();
  } catch (_) {
    return null;
  }
}

function shouldExpireMission(s, nowMs) {
  if (!s || !s.active_mission) return false;
  const startMs = missionStartedToMillis(s.mission_started_at);
  if (startMs == null) return false;
  return nowMs - startMs > MISSION_WINDOW_MS;
}

function missionClearPatch() {
  return {active_mission: null, mission_started_at: null, mission_progress: {}};
}

function defaultMissionPlayerStatsFields() {
  return {
    active_mission: null,
    mission_started_at: null,
    mission_progress: {},
    prizes: emptyPrizes(),
    pending_run_prize: null,
  };
}

function nowTs() {
  return admin.firestore.FieldValue.serverTimestamp();
}

function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Millisecondi da `createdAt` su un documento `scores` (timestamp Firestore o compat). */
function scoreCreatedAtMillis(data) {
  try {
    const ca = data?.createdAt ?? data?.created_at;
    if (!ca) return null;
    if (typeof ca.toMillis === "function") return ca.toMillis();
    const sec = ca.seconds ?? ca._seconds;
    if (sec != null) return Number(sec) * 1000;
  } catch (_) {}
  return null;
}

const RUN_ID_REGEX = /^[a-zA-Z0-9-]{1,64}$/;

/**
 * Estrae e valida `run_id` da un body request.
 * - assente/vuoto → {ok:true, value:null} (fase di transizione: client vecchi senza run_id)
 * - presente e con formato valido → {ok:true, value:'<run_id>'}
 * - presente ma formato invalido → {ok:false}
 */
function parseRunId(raw) {
  if (raw == null || raw === "") return {ok: true, value: null};
  const s = String(raw);
  if (!RUN_ID_REGEX.test(s)) return {ok: false};
  return {ok: true, value: s};
}

function capCollected(val) {
  return Math.min(Math.max(0, Math.floor(safeNum(val, 0))), 30);
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

/** Miglior tempo globale / puro / codice Plus sul PB (solo lettura profilo). */
async function profileBestFieldsForUid(uid, cachedUserDocData = undefined) {
  let u;
  let pureSnap;
  if (cachedUserDocData !== undefined) {
    u = cachedUserDocData || {};
    pureSnap = await db.collection("leaderboard_pure").doc(uid).get();
  } else {
    const [userSnap, pSnap] = await Promise.all([
      db.collection("users").doc(uid).get(),
      db.collection("leaderboard_pure").doc(uid).get(),
    ]);
    pureSnap = pSnap;
    u = userSnap.exists ? userSnap.data() || {} : {};
  }
  const generalMs = Math.floor(safeNum(u.bestTime, 0));
  const pureMs = pureSnap.exists ? Math.floor(safeNum(pureSnap.data().ms, 0)) : 0;
  const rawPrize = u.bestTime_prize_used;
  const ps = rawPrize == null ? "" : String(rawPrize).trim();
  const prizeOk = ps && PRIZE_CODES.includes(ps);
  return {
    best_general_ms: generalMs,
    best_pure_ms: pureMs,
    best_general_prize_used: prizeOk ? ps : "",
  };
}

function publicSurvivalThresholdFields(statsDoc) {
  const d = statsDoc || {};
  const out = {};
  for (const sec of [60, 90, 120, 150, 180]) {
    out[`runs_over_${sec}s`] = safeNum(d[`runs_over_${sec}s`], 0);
    out[`current_streak_over_${sec}s`] = safeNum(d[`current_streak_over_${sec}s`], 0);
    out[`best_streak_over_${sec}s`] = safeNum(d[`best_streak_over_${sec}s`], 0);
  }
  return out;
}

function publicStatsShape(statsDoc) {
  const d = statsDoc || {};
  return {
    best_time_seconds: safeNum(d.best_time_seconds, 0),
    total_games: safeNum(d.total_games, 0),
    total_playtime_seconds: safeNum(d.total_playtime_seconds, 0),
    total_playtime_hhmmss: hhmmss(d.total_playtime_seconds),
    deaths_by_triangle: safeNum(d.deaths_by_triangle, 0),
    deaths_by_square: safeNum(d.deaths_by_square, 0),
    ...publicSurvivalThresholdFields(d),
    collected: {
      red: safeNum(d.red_collected, 0),
      blue: safeNum(d.blue_collected, 0),
      yellow: safeNum(d.yellow_collected, 0),
      green: safeNum(d.green_collected, 0),
      purple: safeNum(d.purple_collected, 0),
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
    "current_streak_over_180s",
    "best_streak_over_60s",
    "best_streak_over_90s",
    "best_streak_over_120s",
    "best_streak_over_150s",
    "best_streak_over_180s",
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

function normalizeRecentGameRow(docId, row) {
  const x = row || {};
  const playedAt = statsIso(x.played_at || x.playedAt || x.created_at || x.createdAt);
  const bonusRaw = x.bonus_active ?? x.bonusActive ?? x.prize_used ?? x.prizeUsed ?? null;
  const bonus = bonusRaw == null ? "" : String(bonusRaw).trim();
  return {
    id: docId,
    user_id: x.user_id || x.userId || "",
    duration_seconds: safeNum(x.duration_seconds ?? x.durationSeconds, 0),
    level_reached: Math.floor(safeNum(x.level_reached ?? x.levelReached, 0)),
    whites_on_screen_at_death: Math.floor(safeNum(x.whites_on_screen_at_death ?? x.whitesOnScreenAtDeath, 0)),
    death_cause: x.death_cause === "square" ? "square" : "triangle",
    bonus_active: bonus,
    prize_used: x.prize_used == null ? "" : String(x.prize_used).trim(),
    played_at: playedAt,
  };
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
    current_streak_over_180s: 0,
    best_streak_over_60s: 0,
    best_streak_over_90s: 0,
    best_streak_over_120s: 0,
    best_streak_over_150s: 0,
    best_streak_over_180s: 0,
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
    ...defaultMissionPlayerStatsFields(),
    updated_at: nowTs(),
  }, {merge: true});
}

app.get("/api/player/stats", requireAuth, async (req, res) => {
  try {
    await upsertPlayerStatsIfMissing(req.uid);
    const uid = req.uid;
    const [snap, bests, recentSnap] = await Promise.all([
      db.collection("player_stats").doc(uid).get(),
      profileBestFieldsForUid(uid),
      db.collection("recent_games")
          .where("user_id", "==", uid)
          .orderBy("played_at", "desc")
          .limit(10)
          .get(),
    ]);
    const base = snap.exists ? snap.data() || {} : {};
    const recent_games = recentSnap.docs.map((d) => {
      const x = d.data() || {};
      const pu = x.prize_used;
      const prizeUsed = pu == null || pu === "" ? null : String(pu).trim();
      return {
        id: d.id,
        duration_seconds: safeNum(x.duration_seconds, 0),
        level_reached: Math.floor(safeNum(x.level_reached, 0)),
        death_cause: x.death_cause === "square" ? "square" : "triangle",
        prize_used: prizeUsed,
        played_at: statsIso(x.played_at),
      };
    });
    return res.json({ok: true, uid, stats: {...base, ...bests}, recent_games});
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
    const bests = await profileBestFieldsForUid(userId, u);
    Object.assign(stats, bests);
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

app.get("/api/prizes", requireAuth, async (req, res) => {
  try {
    await upsertPlayerStatsIfMissing(req.uid);
    const snap = await db.collection("player_stats").doc(req.uid).get();
    const s = snap.data() || {};
    return res.json({ok: true, prizes: normalizePrizesObject(s.prizes)});
  } catch (e) {
    logger.error("GET /api/prizes", e);
    return res.status(500).json({error: "internal_error"});
  }
});

app.get("/api/missions/current", requireAuth, async (req, res) => {
  try {
    await upsertPlayerStatsIfMissing(req.uid);
    const ref = db.collection("player_stats").doc(req.uid);
    const snap = await ref.get();
    const s0 = snap.data() || {};
    const nowMs = Date.now();
    if (shouldExpireMission(s0, nowMs)) {
      await ref.set({...missionClearPatch(), updated_at: nowTs()}, {merge: true});
      return res.json({ok: true, active: null});
    }
    const code = s0.active_mission;
    if (!code || !MISSION_CATALOG[code]) {
      return res.json({ok: true, active: null});
    }
    const meta = MISSION_CATALOG[code];
    const cfg = missionRuleCfg(code);
    const prog = s0.mission_progress || {};
    const startMs = missionStartedToMillis(s0.mission_started_at) || nowMs;
    const remainingMs = Math.max(0, MISSION_WINDOW_MS - (nowMs - startMs));
    let progressLabel = "";
    let progressCurrent = 0;
    let progressTarget = 0;
    if (cfg && cfg.rule === "yellow_kill_counter") {
      progressCurrent = safeNum(prog.counter, 0);
      progressTarget = safeNum(prog.target, safeNum(cfg.counter_target, 100));
      progressLabel = `${progressCurrent}/${progressTarget}`;
    } else {
      progressCurrent = safeNum(prog.qualifying_runs, 0);
      progressTarget = safeNum(prog.target_runs, safeNum(cfg && cfg.target_runs, 10));
      progressLabel = `${progressCurrent}/${progressTarget}`;
    }
    return res.json({
      ok: true,
      active: {
        code,
        title: meta.title,
        description: meta.description,
        reward_label: meta.reward_label,
        progress: {...prog},
        progress_label: progressLabel,
        remaining_ms: remainingMs,
        remaining_hhmmss: hhmmss(remainingMs / 1000),
      },
    });
  } catch (e) {
    logger.error("GET /api/missions/current", e);
    return res.status(500).json({error: "internal_error"});
  }
});

app.post("/api/missions/activate", requireAuth, async (req, res) => {
  try {
    const code = String((req.body || {}).mission_code || "").trim();
    if (!MISSION_CATALOG[code]) {
      return res.status(400).json({error: "invalid_mission_code"});
    }
    const uid = req.uid;
    const statsRef = db.collection("player_stats").doc(uid);
    await db.runTransaction(async (tx) => {
      const statsSnap = await tx.get(statsRef);
      const s = statsSnap.exists ? (statsSnap.data() || {}) : {};
      const nowMs = Date.now();
      let base = {...s};
      if (shouldExpireMission(base, nowMs)) {
        base = {...base, ...missionClearPatch()};
      }
      if (base.active_mission) {
        const err = new Error("mission_slot_busy");
        err.code = "mission_slot_busy";
        throw err;
      }
      const prizes = normalizePrizesObject(base.prizes);
      if (safeNum(prizes[code], 0) >= 10) {
        const err = new Error("prize_cap");
        err.code = "prize_cap";
        throw err;
      }
      tx.set(statsRef, {
        user_id: uid,
        active_mission: code,
        mission_started_at: admin.firestore.Timestamp.now(),
        mission_progress: initialMissionProgress(code),
        prizes,
        updated_at: nowTs(),
      }, {merge: true});
    });
    const snap = await statsRef.get();
    const s = snap.data() || {};
    const startMs = missionStartedToMillis(s.mission_started_at) || Date.now();
    const expiresAtMs = startMs + MISSION_WINDOW_MS;
    return res.json({
      ok: true,
      mission: {
        code,
        started_at_ms: startMs,
        expires_at_ms: expiresAtMs,
      },
    });
  } catch (e) {
    if (e.code === "mission_slot_busy") {
      return res.status(409).json({error: "mission_slot_busy"});
    }
    if (e.code === "prize_cap") {
      return res.status(409).json({error: "prize_cap"});
    }
    logger.error("POST /api/missions/activate", e);
    return res.status(500).json({error: "internal_error"});
  }
});

app.post("/api/missions/cancel", requireAuth, async (req, res) => {
  try {
    const uid = req.uid;
    const statsRef = db.collection("player_stats").doc(uid);
    await statsRef.set({
      ...missionClearPatch(),
      user_id: uid,
      updated_at: nowTs(),
    }, {merge: true});
    return res.json({ok: true});
  } catch (e) {
    logger.error("POST /api/missions/cancel", e);
    return res.status(500).json({error: "internal_error"});
  }
});

app.post("/api/game/start", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const raw = body.prize_code;
    let prizeCode = null;
    if (raw != null && raw !== "") {
      const p = String(raw).trim();
      if (!PRIZE_CODES.includes(p)) {
        return res.status(400).json({error: "invalid_prize_code"});
      }
      prizeCode = p;
    }
    const runIdParsed = parseRunId(body.run_id);
    if (!runIdParsed.ok) return res.status(400).json({error: "invalid_run_id"});
    const runId = runIdParsed.value;
    if (runId == null) return res.status(400).json({error: "run_id_required"});

    const uid = req.uid;
    const statsRef = db.collection("player_stats").doc(uid);
    await db.runTransaction(async (tx) => {
      const statsSnap = await tx.get(statsRef);
      const s = statsSnap.exists ? (statsSnap.data() || {}) : {};
      const prizes = normalizePrizesObject(s.prizes);
      if (prizeCode != null && safeNum(prizes[prizeCode], 0) < 1) {
        const err = new Error("insufficient_prizes");
        err.code = "insufficient_prizes";
        throw err;
      }
      tx.set(statsRef, {
        user_id: uid,
        prizes,
        pending_run_prize: prizeCode,
        pending_run_id: runId,
        game_started_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: nowTs(),
      }, {merge: true});
    });
    return res.json({ok: true, prize_code: prizeCode});
  } catch (e) {
    if (e.code === "insufficient_prizes") {
      return res.status(409).json({error: "insufficient_prizes"});
    }
    logger.error("POST /api/game/start", e);
    return res.status(500).json({error: "internal_error"});
  }
});

app.post("/api/game/end", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const runIdParsed = parseRunId(body.run_id);
    if (!runIdParsed.ok) return res.status(400).json({error: "invalid_run_id"});
    const runId = runIdParsed.value;
    if (runId == null) return res.status(400).json({error: "run_id_required"});

    const duration = Math.max(0, safeNum(body.duration_seconds, 0));
    const levelReached = Math.max(0, Math.floor(safeNum(body.level_reached, 0)));
    const whitesAtDeath = Math.max(0, Math.floor(safeNum(body.whites_on_screen_at_death, 0)));
    const deathCause = body.death_cause === "square" ? "square" : "triangle";
    const bonusActive = body.bonus_active == null ? null : String(body.bonus_active);
    const collected = body.bonuses_collected || {};
    const extraLivesUsed = Math.min(Math.max(0, Math.floor(safeNum(body.extra_lives_used, 0))), 20);
    const shieldsConsumed = Math.min(Math.max(0, Math.floor(safeNum(body.shields_consumed, 0))), 20);
    const whitesKilled = Math.min(Math.max(0, Math.floor(safeNum(body.whites_killed_by_yellow, 0))), 150);
    const greenSkipped = Math.min(Math.max(0, Math.floor(safeNum(body.green_skipped_this_run, 0))), 15);
    const maxExtraLivesSim = Math.min(Math.max(0, Math.floor(safeNum(body.max_extra_lives_simultaneous_this_run, 0))), 5);

    const uid = req.uid;
    const userRef = db.collection("users").doc(uid);
    const statsRef = db.collection("player_stats").doc(uid);
    const recentRef = db.collection("recent_games").doc();
    let shouldUpdateLeaderboard = false;
    let displayName = "";
    /** Impostato nella transaction: premio Plus effettivo per questa run (per score/classifica generale). */
    let prizeUsedForLeaderboards = null;
    let inTop15Result = false;
    /** @type {{ mission_warning?: string, mission_completed?: boolean }} */
    const responseExtra = {};

    await db.runTransaction(async (tx) => {
      const [userSnap, statsSnap] = await Promise.all([tx.get(userRef), tx.get(statsRef)]);
      if (!userSnap.exists) throw new Error("no_profile");
      const user = userSnap.data() || {};
      const s0 = statsSnap.exists ? (statsSnap.data() || {}) : {};
      displayName = String(user.displayName || user.username || "Player").slice(0, 24);

      // Idempotenza + accoppiamento con la run aperta da game/start.
      if (s0.last_completed_run_id && String(s0.last_completed_run_id) === runId) {
        const err = new Error("duplicate");
        err.code = "duplicate";
        throw err;
      }
      if (!s0.pending_run_id || String(s0.pending_run_id) !== runId) {
        const err = new Error("run_id_mismatch");
        err.code = "run_id_mismatch";
        throw err;
      }

      const gameStartedAt = s0.game_started_at;
      if (gameStartedAt) {
        const startMs = gameStartedAt.toMillis();
        const elapsedSeconds = (Date.now() - startMs) / 1000;
        const maxAllowed = elapsedSeconds * 1.15 + 5;
        if (duration > maxAllowed) {
          const err = new Error("invalid_duration");
          err.code = "invalid_duration";
          throw err;
        }
      }

      const nowMs = Date.now();
      const expired = shouldExpireMission(s0, nowMs);
      const hadActiveMission = !!s0.active_mission && !expired;

      let prizeUsedEffective = null;
      const pend = s0.pending_run_prize;
      if (pend != null && pend !== "") {
        const p = String(pend);
        if (PRIZE_CODES.includes(p)) prizeUsedEffective = p;
      }

      const clientPrize = body.prize_used == null || body.prize_used === "" ? null : String(body.prize_used);
      if (clientPrize && prizeUsedEffective && clientPrize !== prizeUsedEffective) {
        logger.warn("POST /api/game/end prize mismatch", {uid, clientPrize, prizeUsedEffective});
      }

      prizeUsedForLeaderboards = prizeUsedEffective;

      const prevCurStreak60 = safeNum(s0.current_streak_over_60s, 0);
      const prevCurStreak90 = safeNum(s0.current_streak_over_90s, 0);
      const prevCurStreak120 = safeNum(s0.current_streak_over_120s, 0);
      const prevCurStreak150 = safeNum(s0.current_streak_over_150s, 0);
      const prevCurStreak180 = safeNum(s0.current_streak_over_180s, 0);
      const nextCurStreak60 = duration >= 60 ? prevCurStreak60 + 1 : 0;
      const nextCurStreak90 = duration >= 90 ? prevCurStreak90 + 1 : 0;
      const nextCurStreak120 = duration >= 120 ? prevCurStreak120 + 1 : 0;
      const nextCurStreak150 = duration >= 150 ? prevCurStreak150 + 1 : 0;
      const nextCurStreak180 = duration >= 180 ? prevCurStreak180 + 1 : 0;
      const nextBestStreak60 = Math.max(safeNum(s0.best_streak_over_60s, 0), duration >= 60 ? nextCurStreak60 : prevCurStreak60);
      const nextBestStreak90 = Math.max(safeNum(s0.best_streak_over_90s, 0), duration >= 90 ? nextCurStreak90 : prevCurStreak90);
      const nextBestStreak120 = Math.max(safeNum(s0.best_streak_over_120s, 0), duration >= 120 ? nextCurStreak120 : prevCurStreak120);
      const nextBestStreak150 = Math.max(safeNum(s0.best_streak_over_150s, 0), duration >= 150 ? nextCurStreak150 : prevCurStreak150);
      const nextBestStreak180 = Math.max(safeNum(s0.best_streak_over_180s, 0), duration >= 180 ? nextCurStreak180 : prevCurStreak180);

      const next = {
        user_id: uid,
        total_games: safeNum(s0.total_games, 0) + 1,
        total_playtime_seconds: safeNum(s0.total_playtime_seconds, 0) + duration,
        best_time_seconds: Math.max(safeNum(s0.best_time_seconds, 0), duration),
        deaths_by_triangle: safeNum(s0.deaths_by_triangle, 0) + (deathCause === "triangle" ? 1 : 0),
        deaths_by_square: safeNum(s0.deaths_by_square, 0) + (deathCause === "square" ? 1 : 0),
        red_collected: safeNum(s0.red_collected, 0) + capCollected(collected.red),
        blue_collected: safeNum(s0.blue_collected, 0) + capCollected(collected.blue),
        yellow_collected: safeNum(s0.yellow_collected, 0) + capCollected(collected.yellow),
        green_collected: safeNum(s0.green_collected, 0) + capCollected(collected.green),
        purple_collected: safeNum(s0.purple_collected, 0) + capCollected(collected.purple),
        extra_lives_used: safeNum(s0.extra_lives_used, 0) + extraLivesUsed,
        shields_consumed: safeNum(s0.shields_consumed, 0) + shieldsConsumed,
        whites_killed_by_yellow: safeNum(s0.whites_killed_by_yellow, 0) + whitesKilled,
        runs_over_60s: safeNum(s0.runs_over_60s, 0) + (duration >= 60 ? 1 : 0),
        runs_over_90s: safeNum(s0.runs_over_90s, 0) + (duration >= 90 ? 1 : 0),
        runs_over_120s: safeNum(s0.runs_over_120s, 0) + (duration >= 120 ? 1 : 0),
        runs_over_150s: safeNum(s0.runs_over_150s, 0) + (duration >= 150 ? 1 : 0),
        runs_over_180s: safeNum(s0.runs_over_180s, 0) + (duration >= 180 ? 1 : 0),
        current_streak_over_60s: nextCurStreak60,
        current_streak_over_90s: nextCurStreak90,
        current_streak_over_120s: nextCurStreak120,
        current_streak_over_150s: nextCurStreak150,
        current_streak_over_180s: nextCurStreak180,
        best_streak_over_60s: nextBestStreak60,
        best_streak_over_90s: nextBestStreak90,
        best_streak_over_120s: nextBestStreak120,
        best_streak_over_150s: nextBestStreak150,
        best_streak_over_180s: nextBestStreak180,
        game_started_at: null,
        updated_at: nowTs(),
      };

      next.last_completed_run_id = runId;
      next.pending_run_id = null;

      if (expired) Object.assign(next, missionClearPatch());

      const prizesBase = normalizePrizesObject(s0.prizes);

      if (prizeUsedEffective) {
        const prizes = {...prizesBase};
        prizes[prizeUsedEffective] = Math.max(0, prizes[prizeUsedEffective] - 1);
        next.prizes = prizes;
        next.pending_run_prize = null;
      } else {
        if (pend != null && pend !== "") next.pending_run_prize = null;
        if (hadActiveMission) {
          const code = String(s0.active_mission);
          if (!MISSION_CATALOG[code]) {
            Object.assign(next, missionClearPatch());
          } else {
          const cfg = missionRuleCfg(code);
          const prog = {...(s0.mission_progress || {})};
          let qualified = false;
          if (cfg && cfg.rule === "bonus_collected") {
            const col = String(cfg.bonus_color || "");
            qualified = capCollected(collected[col]) >= safeNum(cfg.min_same_run, 1);
          } else if (cfg && cfg.rule === "green_skipped") {
            qualified = greenSkipped >= safeNum(cfg.min_same_run, 1);
          } else if (cfg && cfg.rule === "max_extra_lives_simultaneous") {
            qualified = maxExtraLivesSim >= safeNum(cfg.min_same_run, 1);
          } else if (cfg && cfg.rule === "yellow_kill_counter") {
            prog.target = safeNum(cfg.counter_target, 100);
            prog.counter = safeNum(prog.counter, 0) + whitesKilled;
            qualified = false;
          }
          if (cfg && cfg.rule !== "yellow_kill_counter" && qualified) {
            prog.qualifying_runs = safeNum(prog.qualifying_runs, 0) + 1;
            prog.target_runs = safeNum(cfg.target_runs, 10);
          }
          let completed = false;
          if (cfg && cfg.rule === "yellow_kill_counter") {
            completed = safeNum(prog.counter, 0) >= safeNum(cfg.counter_target, 100);
          } else if (cfg) {
            completed = safeNum(prog.qualifying_runs, 0) >= safeNum(cfg.target_runs, 10);
          }
          if (completed) {
            const cur = prizesBase[code] != null ? safeNum(prizesBase[code], 0) : 0;
            const room = Math.max(0, 10 - cur);
            const award = Math.min(MISSION_PRIZE_AWARD_EACH_COMPLETE, room);
            if (award < MISSION_PRIZE_AWARD_EACH_COMPLETE) responseExtra.mission_warning = "partial_award_cap";
            const prizes = {...prizesBase};
            prizes[code] = Math.min(10, cur + award);
            next.prizes = prizes;
            Object.assign(next, missionClearPatch());
            responseExtra.mission_completed = true;
          } else {
            next.mission_progress = prog;
          }
          }
        }
      }

      const userBestMs = safeNum(user.bestTime, 0);
      const runMsTx = Math.floor(duration * 1000);
      const newBestMs = Math.max(userBestMs, runMsTx);
      shouldUpdateLeaderboard = newBestMs > userBestMs;

      const pureLbRef = db.collection("leaderboard_pure").doc(uid);
      let pureLbSnap = null;
      if (!prizeUsedEffective) {
        pureLbSnap = await tx.get(pureLbRef);
      }

      const lbQuery = db.collection("leaderboard").orderBy("ms", "desc").limit(LEADERBOARD_TOP_N);
      const lbSnap = await tx.get(lbQuery);

      const rows = lbSnap.docs.map((d) => ({id: d.id, ...d.data()}));
      const myEntry = rows.find((r) => r.uid === uid || r.id === uid);
      const worstMs = rows.length > 0 ? rows[rows.length - 1].ms : 0;
      const inTop15 = rows.length < LEADERBOARD_TOP_N || myEntry !== undefined || runMsTx > worstMs;

      const scoreRef = db.collection("scores").doc();
      const scorePayload = {
        uid,
        displayName,
        ms: runMsTx,
        createdAt: nowTs(),
      };
      if (prizeUsedForLeaderboards) {
        scorePayload.prize_used = prizeUsedForLeaderboards;
      }

      const lbRow = {
        uid,
        displayName,
        ms: runMsTx,
        updatedAt: nowTs(),
        prize_used: prizeUsedForLeaderboards
          ? prizeUsedForLeaderboards
          : admin.firestore.FieldValue.delete(),
      };

      tx.set(statsRef, next, {merge: true});
      tx.set(recentRef, {
        user_id: uid,
        duration_seconds: duration,
        level_reached: levelReached,
        whites_on_screen_at_death: whitesAtDeath,
        death_cause: deathCause,
        bonus_active: bonusActive,
        prize_used: prizeUsedEffective,
        played_at: nowTs(),
      });

      if (newBestMs > userBestMs) {
        const userPbPatch = {
          bestTime: newBestMs,
          gamesPlayed: safeNum(user.gamesPlayed, 0) + 1,
          lastSeen: nowTs(),
        };
        if (prizeUsedForLeaderboards && PRIZE_CODES.includes(String(prizeUsedForLeaderboards))) {
          userPbPatch.bestTime_prize_used = String(prizeUsedForLeaderboards);
        } else {
          userPbPatch.bestTime_prize_used = admin.firestore.FieldValue.delete();
        }
        tx.set(userRef, userPbPatch, {merge: true});
      } else {
        tx.set(userRef, {
          gamesPlayed: safeNum(user.gamesPlayed, 0) + 1,
          lastSeen: nowTs(),
        }, {merge: true});
      }

      // Classifica «pura»: solo run senza Premio Plus attivo.
      if (!prizeUsedEffective && pureLbSnap) {
        const pureBestMs = pureLbSnap.exists ? safeNum(pureLbSnap.data().ms, 0) : 0;
        if (runMsTx > pureBestMs) {
          tx.set(pureLbRef, {
            uid,
            displayName,
            ms: runMsTx,
            updatedAt: nowTs(),
          }, {merge: true});
        }
      }

      tx.set(scoreRef, scorePayload);

      if (shouldUpdateLeaderboard && inTop15) {
        tx.set(db.collection("leaderboard").doc(uid), lbRow, {merge: true});
        inTop15Result = true;
      }
    });

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

    return res.json({
      ok: true,
      improved: shouldUpdateLeaderboard,
      inTop15: inTop15Result,
      inTop10: inTop15Result,
      ...responseExtra,
    });
  } catch (e) {
    if (e.code === "duplicate") {
      return res.json({ok: true, duplicate: true});
    }
    if (e.code === "run_id_mismatch") {
      return res.status(409).json({error: "run_id_mismatch"});
    }
    if (e.code === "invalid_duration") {
      return res.status(400).json({error: "invalid_duration"});
    }
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
    const dayAgoMs = now - 24 * 3600 * 1000;
    const weekAgoMs = now - 7 * 24 * 3600 * 1000;

    const scoresSnap = await db.collection("scores").get();

    /** Archivio partite: una voce per documento `scores` con `ms` > 0. */
    const distGames = {over60: 0, over90: 0, over120: 0, over150: 0, over180: 0, over210: 0};
    let gamesTotal = 0;
    let sum24 = 0;
    let count24 = 0;
    let sum7 = 0;
    let count7 = 0;

    scoresSnap.docs.forEach((d) => {
      const data = d.data() || {};
      const ms = safeNum(data.ms, 0);
      if (ms <= 0) return;
      gamesTotal += 1;
      const duration = ms / 1000;
      if (duration >= 60) distGames.over60 += 1;
      if (duration >= 90) distGames.over90 += 1;
      if (duration >= 120) distGames.over120 += 1;
      if (duration >= 150) distGames.over150 += 1;
      if (duration >= 180) distGames.over180 += 1;
      if (duration >= 210) distGames.over210 += 1;

      const t = scoreCreatedAtMillis(data);
      if (t == null) return;
      if (t >= dayAgoMs) {
        count24 += 1;
        sum24 += duration;
      }
      if (t >= weekAgoMs) {
        count7 += 1;
        sum7 += duration;
      }
    });

    return res.json({
      ok: true,
      totals: {
        games_last_24h: count24,
        playtime_last_24h_seconds: Math.round(sum24),
        games_last_7d: count7,
        playtime_last_7d_seconds: Math.round(sum7),
        games_total: gamesTotal,
      },
      avg_run_seconds_last_7d: count7 ? (sum7 / count7) : 0,
      games_duration_distribution: distGames,
    });
  } catch (e) {
    logger.error("GET /api/admin/overview", e);
    return res.status(500).json({error: "internal_error"});
  }
});

/**
 * Genera uno username unico da email (server-side, usa Admin SDK).
 * Stesso algoritmo di ensureProfileForUser nel client.
 */
async function adminAutoUsername(email) {
  const base = String(email || "player")
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "player";
  const baseNorm = base.length < 3 ? (base + "player").slice(0, 12) : base.slice(0, 20);
  for (let i = 0; i < 40; i++) {
    const suffix = i === 0 ? "" : `_${Math.floor(100 + Math.random() * 9000)}`;
    const maxBaseLen = Math.max(3, 20 - suffix.length);
    const candidate = (baseNorm.slice(0, maxBaseLen) + suffix).slice(0, 20);
    const nameSnap = await db.collection("usernames").doc(candidate).get();
    if (!nameSnap.exists) return candidate;
  }
  throw new Error("USERNAME_EXHAUSTED");
}

/**
 * Crea profilo Firestore (users + usernames + player_stats) per un utente orfano.
 * Usa Admin SDK: bypassa le client rules (scrittura backend).
 * Ritorna { already_exists: true } se il profilo esiste già (idempotente).
 */
async function adminCreateOrphanProfile(uid, email) {
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (userSnap.exists) return {already_exists: true};

  const username = await adminAutoUsername(email);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const role = normalizedEmail === ADMIN_EMAIL ? "admin" : "user";

  const batch = db.batch();
  batch.set(db.collection("usernames").doc(username), {uid, claimedAt: now});
  batch.set(userRef, {
    username,
    usernameLower: username,
    displayName: username,
    email: email || "",
    role,
    createdAt: now,
    lastSeen: now,
    gamesPlayed: 0,
    bestTime: 0,
  });
  const statsRef = db.collection("player_stats").doc(uid);
  const statsSnap = await statsRef.get();
  if (!statsSnap.exists) {
    batch.set(statsRef, {
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
      best_streak_over_60s: 0,
      best_streak_over_90s: 0,
      best_streak_over_120s: 0,
      best_streak_over_150s: 0,
      best_streak_over_180s: 0,
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
      ...defaultMissionPlayerStatsFields(),
      prizes: emptyPrizes(),
      updated_at: nowTs(),
    });
  }
  await batch.commit();
  return {username, role, player_stats_created: !statsSnap.exists};
}

/**
 * Solo admin: scansiona Firebase Auth e trova utenti senza documento users/{uid}.
 * dry_run=true (default) → solo report; dry_run=false → crea i profili mancanti.
 */
app.post("/api/admin/scan-fix-orphaned-users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const dryRun = req.body.dry_run !== false;

    const authUsers = [];
    let pageToken;
    do {
      const result = await admin.auth().listUsers(1000, pageToken);
      authUsers.push(...result.users);
      pageToken = result.pageToken;
    } while (pageToken);

    const usersSnap = await db.collection("users").get();
    const existingUids = new Set(usersSnap.docs.map((d) => d.id));
    const orphaned = authUsers.filter((u) => !existingUids.has(u.uid));

    if (dryRun) {
      return res.json({
        ok: true,
        dry_run: true,
        total_auth_users: authUsers.length,
        total_firestore_users: usersSnap.size,
        orphaned_count: orphaned.length,
        orphaned: orphaned.map((u) => ({
          uid: u.uid,
          email: u.email || null,
          display_name: u.displayName || null,
          providers: (u.providerData || []).map((p) => p.providerId),
          created_at: u.metadata?.creationTime || null,
        })),
      });
    }

    const results = [];
    for (const authUser of orphaned) {
      try {
        const outcome = await adminCreateOrphanProfile(authUser.uid, authUser.email || "");
        results.push({uid: authUser.uid, email: authUser.email || null, ok: true, ...outcome});
      } catch (err) {
        results.push({uid: authUser.uid, email: authUser.email || null, ok: false, error: String(err.message)});
      }
    }

    return res.json({
      ok: true,
      dry_run: false,
      total_auth_users: authUsers.length,
      total_firestore_users: usersSnap.size,
      orphaned_found: orphaned.length,
      fixed: results.filter((r) => r.ok && !r.already_exists).length,
      already_existed: results.filter((r) => r.ok && r.already_exists).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (e) {
    logger.error("POST /api/admin/scan-fix-orphaned-users", e);
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

/**
 * Idempotente: aggiunge campi missioni/premi mancanti su ogni player_stats.
 */
app.post("/api/admin/migrate-missions-fields", requireAuth, requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection("player_stats").get();
    const def = defaultMissionPlayerStatsFields();
    let batch = db.batch();
    let ops = 0;
    let patched = 0;
    const flush = async () => {
      if (ops === 0) return;
      await batch.commit();
      batch = db.batch();
      ops = 0;
    };
    for (const docSnap of snap.docs) {
      const data = docSnap.data() || {};
      const patch = {};
      if (!("active_mission" in data)) patch.active_mission = def.active_mission;
      if (!("mission_started_at" in data)) patch.mission_started_at = def.mission_started_at;
      if (!("mission_progress" in data)) patch.mission_progress = def.mission_progress;
      if (!("pending_run_prize" in data)) patch.pending_run_prize = def.pending_run_prize;
      if (!("prizes" in data)) {
        patch.prizes = def.prizes;
      } else {
        const merged = normalizePrizesObject(data.prizes);
        let need = false;
        for (const k of Object.keys(emptyPrizes())) {
          if (!(k in (data.prizes || {}))) need = true;
        }
        if (need) patch.prizes = merged;
      }
      if (Object.keys(patch).length > 0) {
        patch.updated_at = nowTs();
        batch.set(docSnap.ref, patch, {merge: true});
        ops += 1;
        patched += 1;
        if (ops >= 400) await flush();
      }
    }
    await flush();
    return res.json({
      ok: true,
      player_stats_total: snap.size,
      player_stats_patched: patched,
    });
  } catch (e) {
    logger.error("POST /api/admin/migrate-missions-fields", e);
    return res.status(500).json({error: "internal_error"});
  }
});

/**
 * Solo admin: tempo canonico ms per target_uid — aggiorna users.bestTime (se force_ms),
 * leaderboard + leaderboard_pure, player_stats.best_time_seconds se esiste,
 * rimuove scores con ms maggiore (merge client = max).
 * Body: { target_uid, force_ms? } — senza force_ms usa users.bestTime come prima.
 */
app.post("/api/admin/sync-leaderboard-from-user-profile", requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const targetUid = String(body.target_uid || "").trim();
    if (!targetUid) return res.status(400).json({error: "missing_target_uid"});

    const userSnap = await db.collection("users").doc(targetUid).get();
    if (!userSnap.exists) return res.status(404).json({error: "no_profile"});

    const u = userSnap.data() || {};
    const displayName = String(u.displayName || u.username || "Player").slice(0, 24);

    let canonicalMs;
    let usedForceMs = false;
    if (body.force_ms != null && body.force_ms !== "") {
      canonicalMs = Math.floor(safeNum(body.force_ms, 0));
      usedForceMs = true;
    } else {
      canonicalMs = Math.floor(safeNum(u.bestTime, 0));
    }

    if (canonicalMs < 1 || canonicalMs > 7200000) {
      return res.status(400).json({
        error: usedForceMs ? "invalid_force_ms" : "invalid_bestTime",
        bestTime: u.bestTime,
      });
    }

    if (usedForceMs) {
      await db.collection("users").doc(targetUid).set({
        bestTime: canonicalMs,
        bestTime_prize_used: admin.firestore.FieldValue.delete(),
      }, {merge: true});
    } else {
      await db.collection("users").doc(targetUid).set({
        bestTime_prize_used: admin.firestore.FieldValue.delete(),
      }, {merge: true});
    }

    const lbRow = {
      uid: targetUid,
      displayName,
      ms: canonicalMs,
      updatedAt: nowTs(),
      prize_used: admin.firestore.FieldValue.delete(),
    };

    await db.collection("leaderboard").doc(targetUid).set(lbRow, {merge: true});
    await db.collection("leaderboard_pure").doc(targetUid).set({
      uid: targetUid,
      displayName,
      ms: canonicalMs,
      updatedAt: nowTs(),
    }, {merge: true});

    const statsRef = db.collection("player_stats").doc(targetUid);
    const statsSnap = await statsRef.get();
    let playerStatsUpdated = false;
    if (statsSnap.exists) {
      await statsRef.set({
        best_time_seconds: canonicalMs / 1000,
        updated_at: nowTs(),
      }, {merge: true});
      playerStatsUpdated = true;
    }

    const scoresSnap = await db.collection("scores").where("uid", "==", targetUid).get();
    let deletedScores = 0;
    let batch = db.batch();
    let ops = 0;
    const flushScores = async () => {
      if (ops === 0) return;
      await batch.commit();
      batch = db.batch();
      ops = 0;
    };
    for (const doc of scoresSnap.docs) {
      const ms = safeNum(doc.data().ms, 0);
      if (ms > canonicalMs) {
        batch.delete(doc.ref);
        ops++;
        deletedScores++;
        if (ops >= 450) await flushScores();
      }
    }
    await flushScores();

    logger.info("sync-leaderboard-from-user-profile", {
      admin_uid: req.uid,
      target_uid: targetUid,
      canonical_ms: canonicalMs,
      deleted_scores: deletedScores,
      force_ms: usedForceMs,
    });

    return res.json({
      ok: true,
      uid: targetUid,
      ms: canonicalMs,
      displayName,
      player_stats_updated: playerStatsUpdated,
      deleted_scores: deletedScores,
      forced_ms: usedForceMs,
    });
  } catch (e) {
    logger.error("POST /api/admin/sync-leaderboard-from-user-profile", e);
    return res.status(500).json({error: "internal_error"});
  }
});

/**
 * Solo admin: imposta sul proprio `player_stats` tutti i premi Plus a 10/10 (test in gioco / picker).
 * Nota: con 10/10 su un colore non puoi attivare la missione di quel colore (cap) finché non consumi premi.
 */
app.post("/api/admin/grant-self-test-plus-prizes", requireAuth, requireAdmin, async (req, res) => {
  try {
    const uid = req.uid;
    await upsertPlayerStatsIfMissing(uid);
    const full = {red_plus: 10, blue_plus: 10, yellow_plus: 10, green_plus: 10, purple_plus: 10};
    const prizes = normalizePrizesObject(full);
    await db.collection("player_stats").doc(uid).set({
      user_id: uid,
      prizes,
      updated_at: nowTs(),
    }, {merge: true});
    return res.json({ok: true, prizes});
  } catch (e) {
    logger.error("POST /api/admin/grant-self-test-plus-prizes", e);
    return res.status(500).json({error: "internal_error"});
  }
});

/**
 * Solo admin: regalo lancio Missioni/Premi Plus.
 * Idempotente: ogni utente riceve +1 per colore una sola volta.
 */
app.post("/api/admin/grant-plus-launch-gift", requireAuth, requireAdmin, async (req, res) => {
  try {
    const usersSnap = await db.collection("users").get();
    let batch = db.batch();
    let ops = 0;
    let granted = 0;
    let skipped = 0;
    const flush = async () => {
      if (ops === 0) return;
      await batch.commit();
      batch = db.batch();
      ops = 0;
    };

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      const statsRef = db.collection("player_stats").doc(uid);
      const statsSnap = await statsRef.get();
      const stats = statsSnap.exists ? (statsSnap.data() || {}) : {};
      if (stats[PLUS_LAUNCH_GIFT_FIELD] === true) {
        skipped += 1;
        continue;
      }

      const prizes = normalizePrizesObject(stats.prizes);
      for (const code of PRIZE_CODES) {
        prizes[code] = Math.min(10, safeNum(prizes[code], 0) + 1);
      }
      batch.set(statsRef, {
        user_id: uid,
        prizes,
        [PLUS_LAUNCH_GIFT_FIELD]: true,
        updated_at: nowTs(),
      }, {merge: true});
      ops += 1;
      granted += 1;
      if (ops >= 400) await flush();
    }
    await flush();

    return res.json({
      ok: true,
      users_total: usersSnap.size,
      gift_granted: granted,
      already_had_gift: skipped,
      gift_field: PLUS_LAUNCH_GIFT_FIELD,
    });
  } catch (e) {
    logger.error("POST /api/admin/grant-plus-launch-gift", e);
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
      recent_games: gamesSnap.docs.map((d) => normalizeRecentGameRow(d.id, d.data())),
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
          current_streak_over_180s: safeNum(st.current_streak_over_180s, 0),
          best_streak_over_60s: safeNum(st.best_streak_over_60s, 0),
          best_streak_over_90s: safeNum(st.best_streak_over_90s, 0),
          best_streak_over_120s: safeNum(st.best_streak_over_120s, 0),
          best_streak_over_150s: safeNum(st.best_streak_over_150s, 0),
          best_streak_over_180s: safeNum(st.best_streak_over_180s, 0),
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
          prize_used: g.prize_used == null ? "" : String(g.prize_used),
        };
      });
      const headers = ["played_at", "username", "user_id", "duration_seconds", "level_reached", "whites_on_screen_at_death", "death_cause", "bonus_active", "prize_used"];
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
