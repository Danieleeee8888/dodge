/**
 * Imposta ms canonico ovunque per un giocatore (come POST admin sync + force_ms).
 *
 * Uso:
 *   node tools/set-canonical-best-ms.js bartolomeo 118156 --apply
 *   node tools/set-canonical-best-ms.js --uid=<UID> 118156 --apply
 *
 * 118156 ms = 01:58:156 (formato gioco mm:ss:000).
 */

const admin = require("firebase-admin");

const PROJECT_ID = "dodge-84439";
const SCORE_MIN = 1;
const SCORE_MAX = 7200000;
const LB_SCAN = 500;

function safeNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

async function findUidByNameSubstring(db, substring) {
  const sub = String(substring || "").trim().toLowerCase();
  if (!sub) return null;
  const byUid = new Map();
  const ingest = (snap) => {
    snap.docs.forEach((d) => {
      const data = d.data() || {};
      const id = typeof data.uid === "string" && data.uid ? data.uid : d.id;
      const dn = String(data.displayName || data.username || "").toLowerCase();
      if (!dn.includes(sub)) return;
      byUid.set(id, {uid: id, displayName: data.displayName || data.username});
    });
  };
  const [lbSnap, pureSnap] = await Promise.all([
    db.collection("leaderboard").orderBy("ms", "desc").limit(LB_SCAN).get(),
    db.collection("leaderboard_pure").orderBy("ms", "desc").limit(LB_SCAN).get(),
  ]);
  ingest(lbSnap);
  ingest(pureSnap);
  const arr = [...byUid.values()];
  if (arr.length !== 1) return {error: arr.length === 0 ? "no_match" : "ambiguous", arr};
  return {uid: arr[0].uid, displayName: arr[0].displayName};
}

async function applyCanonical(db, targetUid, canonicalMs) {
  const FieldValue = admin.firestore.FieldValue;
  const userSnap = await db.collection("users").doc(targetUid).get();
  if (!userSnap.exists) throw new Error("users doc missing");
  const u = userSnap.data() || {};
  const displayName = String(u.displayName || u.username || "Player").slice(0, 24);

  await db.collection("users").doc(targetUid).set({bestTime: canonicalMs}, {merge: true});

  await db.collection("leaderboard").doc(targetUid).set({
    uid: targetUid,
    displayName,
    ms: canonicalMs,
    updatedAt: FieldValue.serverTimestamp(),
    prize_used: FieldValue.delete(),
  }, {merge: true});

  await db.collection("leaderboard_pure").doc(targetUid).set({
    uid: targetUid,
    displayName,
    ms: canonicalMs,
    updatedAt: FieldValue.serverTimestamp(),
  }, {merge: true});

  const statsRef = db.collection("player_stats").doc(targetUid);
  const statsSnap = await statsRef.get();
  if (statsSnap.exists) {
    await statsRef.set({
      best_time_seconds: canonicalMs / 1000,
      updated_at: FieldValue.serverTimestamp(),
    }, {merge: true});
  }

  const scoresSnap = await db.collection("scores").where("uid", "==", targetUid).get();
  let deletedScores = 0;
  let batch = db.batch();
  let ops = 0;
  const flush = async () => {
    if (ops === 0) return;
    await batch.commit();
    batch = db.batch();
    ops = 0;
  };
  for (const doc of scoresSnap.docs) {
    const ms = Math.floor(safeNum(doc.data().ms, 0));
    if (ms > canonicalMs) {
      batch.delete(doc.ref);
      ops++;
      deletedScores++;
      if (ops >= 450) await flush();
    }
  }
  await flush();

  return {displayName, deletedScores};
}

function parseArgs(argv) {
  let uid = null;
  let needle = null;
  let ms = null;
  let apply = false;
  const rest = [];
  for (const a of argv) {
    if (a === "--apply") apply = true;
    else if (a.startsWith("--uid=")) uid = a.slice("--uid=".length).trim();
    else rest.push(a);
  }
  if (!uid && rest[0] && !/^\d+$/.test(rest[0])) needle = rest.shift();
  if (rest[0] && /^\d+$/.test(rest[0])) ms = parseInt(rest[0], 10);
  return {uid, needle, ms, apply};
}

async function main() {
  const {uid, needle, ms, apply} = parseArgs(process.argv.slice(2));

  if (ms == null || !Number.isFinite(ms)) {
    console.error("Uso: node tools/set-canonical-best-ms.js <nome> <ms> [--apply]");
    console.error("     node tools/set-canonical-best-ms.js --uid=<UID> <ms> [--apply]");
    process.exit(1);
  }

  if (ms < SCORE_MIN || ms > SCORE_MAX) {
    console.error("ms fuori range:", ms);
    process.exit(1);
  }

  if (!admin.apps.length) admin.initializeApp({projectId: PROJECT_ID});
  const db = admin.firestore();

  let targetUid = uid;
  if (!targetUid) {
    const hit = await findUidByNameSubstring(db, needle || "");
    if (hit.error === "no_match") {
      console.error("Nessun giocatore trovato per:", needle);
      process.exit(1);
    }
    if (hit.error === "ambiguous") {
      console.error("Più risultati; usa --uid=");
      hit.arr.forEach((x) => console.error(" ", x.uid, x.displayName));
      process.exit(1);
    }
    targetUid = hit.uid;
    console.log("Match:", hit.displayName, targetUid);
  }

  if (!apply) {
    console.log("[dry-run] Imposterei bestTime/leaderboard/pure/stats e rimuoverei scores con ms >", ms);
    process.exit(0);
  }

  const out = await applyCanonical(db, targetUid, ms);
  console.log("[apply] OK", targetUid, ms, "ms; score eliminati:", out.deletedScores);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
