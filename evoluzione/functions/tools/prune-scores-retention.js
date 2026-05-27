/**
 * Pulizia storica `scores` per retention globale su createdAt.
 *
 * Uso (da cartella functions):
 *   node tools/prune-scores-retention.js --days 120 --apply
 *   node tools/prune-scores-retention.js --days 90 --project dodge-84439 --apply
 *
 * Senza --apply esegue solo dry-run.
 */

const admin = require("firebase-admin");

const APPLY = process.argv.includes("--apply");
const daysIdx = process.argv.indexOf("--days");
const RETENTION_DAYS = daysIdx > -1 ? Math.max(1, Math.floor(Number(process.argv[daysIdx + 1] || 120))) : 120;
const projectArgIdx = process.argv.indexOf("--project");
const PROJECT_ID = projectArgIdx > -1 ? String(process.argv[projectArgIdx + 1] || "") : "dodge-84439";
const PAGE_SIZE = 400;

function cutoffDate(days) {
  const nowMs = Date.now();
  return new Date(nowMs - days * 24 * 60 * 60 * 1000);
}

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp({projectId: PROJECT_ID});
  }
  const db = admin.firestore();
  const cutoff = cutoffDate(RETENTION_DAYS);

  console.log(`[prune-scores] project=${PROJECT_ID} mode=${APPLY ? "apply" : "dry-run"}`);
  console.log(`[prune-scores] retaining last ${RETENTION_DAYS} days, cutoff=${cutoff.toISOString()}`);

  let totalMatched = 0;
  let totalDeleted = 0;
  let cursor = null;

  while (true) {
    let q = db.collection("scores")
        .where("createdAt", "<", cutoff)
        .orderBy("createdAt", "asc")
        .limit(PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);

    const snap = await q.get();
    if (snap.empty) break;
    totalMatched += snap.size;
    cursor = snap.docs[snap.docs.length - 1];

    if (APPLY) {
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      totalDeleted += snap.size;
      console.log(`[prune-scores] deleted ${totalDeleted}/${totalMatched}`);
    } else {
      console.log(`[prune-scores] dry matched so far: ${totalMatched}`);
    }

    if (snap.size < PAGE_SIZE) break;
  }

  console.log(`[prune-scores] matched docs: ${totalMatched}`);
  if (APPLY) {
    console.log(`[prune-scores] deleted docs: ${totalDeleted}`);
  } else {
    console.log("[prune-scores] dry-run complete. Add --apply to delete.");
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("[prune-scores] failed:", e);
  process.exit(1);
});
