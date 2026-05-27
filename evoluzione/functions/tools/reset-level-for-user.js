/**
 * Reset livello per un utente specifico (baseline sullo stato attuale).
 *
 * Uso:
 *   node tools/reset-level-for-user.js --uid=<UID> --apply
 *   node tools/reset-level-for-user.js --email=<email> --apply
 *
 * Effetto:
 * - player_stats.level = 1
 * - player_stats.level_rules_version = 2
 * - level_base_best_streak_over_* = best_streak_over_* correnti
 * - leaderboard / leaderboard_pure level = 1 (se presenti)
 */

const admin = require("firebase-admin");

const PROJECT_ID = "dodge-84439";

function parseArgs(argv) {
  let uid = null;
  let email = null;
  let apply = false;
  for (const a of argv) {
    if (a === "--apply") apply = true;
    else if (a.startsWith("--uid=")) uid = a.slice("--uid=".length).trim();
    else if (a.startsWith("--email=")) email = a.slice("--email=".length).trim().toLowerCase();
  }
  return {uid, email, apply};
}

function safeNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

async function resolveUid(db, uid, email) {
  if (uid) return uid;
  if (!email) throw new Error("missing_target");
  const snap = await db.collection("users").where("email", "==", email).limit(2).get();
  if (snap.empty) throw new Error(`email_not_found:${email}`);
  if (snap.size > 1) throw new Error(`email_ambiguous:${email}`);
  return snap.docs[0].id;
}

async function applyReset(db, uid) {
  const FieldValue = admin.firestore.FieldValue;
  const statsRef = db.collection("player_stats").doc(uid);
  const statsSnap = await statsRef.get();
  if (!statsSnap.exists) throw new Error("player_stats_missing");
  const st = statsSnap.data() || {};

  const base60 = Math.max(0, Math.floor(safeNum(st.best_streak_over_60s, 0)));
  const base90 = Math.max(0, Math.floor(safeNum(st.best_streak_over_90s, 0)));
  const base120 = Math.max(0, Math.floor(safeNum(st.best_streak_over_120s, 0)));
  const base150 = Math.max(0, Math.floor(safeNum(st.best_streak_over_150s, 0)));
  const base180 = Math.max(0, Math.floor(safeNum(st.best_streak_over_180s, 0)));

  await statsRef.set({
    level: 1,
    level_rules_version: 2,
    level_base_best_streak_over_60s: base60,
    level_base_best_streak_over_90s: base90,
    level_base_best_streak_over_120s: base120,
    level_base_best_streak_over_150s: base150,
    level_base_best_streak_over_180s: base180,
    updated_at: FieldValue.serverTimestamp(),
  }, {merge: true});

  await Promise.all([
    db.collection("leaderboard").doc(uid).set({level: 1, updatedAt: FieldValue.serverTimestamp()}, {merge: true}),
    db.collection("leaderboard_pure").doc(uid).set({level: 1, updatedAt: FieldValue.serverTimestamp()}, {merge: true}),
  ]);
}

async function main() {
  const {uid, email, apply} = parseArgs(process.argv.slice(2));
  if (!uid && !email) {
    console.error("Uso: node tools/reset-level-for-user.js --uid=<UID> [--apply]");
    console.error("  oppure: node tools/reset-level-for-user.js --email=<email> [--apply]");
    process.exit(1);
  }

  if (!admin.apps.length) admin.initializeApp({projectId: PROJECT_ID});
  const db = admin.firestore();
  const targetUid = await resolveUid(db, uid, email);
  console.log("Target UID:", targetUid);

  if (!apply) {
    console.log("[dry-run] Imposterei level=1 + baseline strike + level=1 su leaderboard.");
    process.exit(0);
  }

  await applyReset(db, targetUid);
  console.log("[apply] reset livello completato per", targetUid);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});

