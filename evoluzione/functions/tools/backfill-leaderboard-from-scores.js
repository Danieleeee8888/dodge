/**
 * Backfill leaderboard e leaderboard_pure partendo dallo storico `scores`.
 *
 * Uso (da cartella functions):
 *   node tools/backfill-leaderboard-from-scores.js --apply
 *   node tools/backfill-leaderboard-from-scores.js --apply --project dodge-84439
 *
 * Senza --apply esegue solo dry-run.
 */

const admin = require("firebase-admin");

const APPLY = process.argv.includes("--apply");
const projectArgIdx = process.argv.indexOf("--project");
const PROJECT_ID = projectArgIdx > -1 ? String(process.argv[projectArgIdx + 1] || "") : "dodge-84439";
const SCORE_MIN = 1;
const SCORE_MAX = 7_200_000;
const READ_PAGE = 1000;
const WRITE_BATCH = 400;

function normalizeMs(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.floor(n);
}

function isValidMs(ms) {
  return ms >= SCORE_MIN && ms <= SCORE_MAX;
}

function isPureScoreRow(row) {
  const p = row?.prize_used;
  if (p == null || p === "") return true;
  if (p === false || p === 0) return true;
  return false;
}

function pickDisplayName(row) {
  return String(row?.displayName || row?.username || "???").slice(0, 24);
}

async function scanScores(db) {
  const bestGeneral = new Map();
  const bestPure = new Map();
  let scanned = 0;
  let cursor = null;

  while (true) {
    let q = db.collection("scores")
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(READ_PAGE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    scanned += snap.size;
    snap.docs.forEach((doc) => {
      const row = doc.data() || {};
      const uid = String(row.uid || "");
      const ms = normalizeMs(row.ms);
      if (!uid || !isValidMs(ms)) return;
      const candidate = {
        uid,
        ms,
        displayName: pickDisplayName(row),
      };

      const gPrev = bestGeneral.get(uid);
      if (!gPrev || candidate.ms > gPrev.ms) bestGeneral.set(uid, candidate);

      if (isPureScoreRow(row)) {
        const pPrev = bestPure.get(uid);
        if (!pPrev || candidate.ms > pPrev.ms) bestPure.set(uid, candidate);
      }
    });
    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < READ_PAGE) break;
  }

  return {bestGeneral, bestPure, scanned};
}

async function writeMap(db, colName, sourceMap) {
  const entries = Array.from(sourceMap.values());
  let written = 0;
  for (let i = 0; i < entries.length; i += WRITE_BATCH) {
    const chunk = entries.slice(i, i + WRITE_BATCH);
    const batch = db.batch();
    chunk.forEach((row) => {
      const ref = db.collection(colName).doc(row.uid);
      batch.set(ref, {
        uid: row.uid,
        displayName: row.displayName,
        ms: row.ms,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
    });
    await batch.commit();
    written += chunk.length;
  }
  return written;
}

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp({projectId: PROJECT_ID});
  }
  const db = admin.firestore();

  console.log(`[backfill] project=${PROJECT_ID} mode=${APPLY ? "apply" : "dry-run"}`);
  const {bestGeneral, bestPure, scanned} = await scanScores(db);
  console.log(`[backfill] scanned scores docs: ${scanned}`);
  console.log(`[backfill] unique users (general): ${bestGeneral.size}`);
  console.log(`[backfill] unique users (pure): ${bestPure.size}`);

  if (!APPLY) {
    console.log("[backfill] dry-run complete. Add --apply to write leaderboard docs.");
    return;
  }

  const writtenGeneral = await writeMap(db, "leaderboard", bestGeneral);
  const writtenPure = await writeMap(db, "leaderboard_pure", bestPure);
  console.log(`[backfill] written leaderboard docs: ${writtenGeneral}`);
  console.log(`[backfill] written leaderboard_pure docs: ${writtenPure}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("[backfill] failed:", e);
  process.exit(1);
});
