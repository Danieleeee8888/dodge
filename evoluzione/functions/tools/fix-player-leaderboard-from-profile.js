/**
 * Allinea classifica generale + pura al miglior tempo sul profilo (`users/{uid}.bestTime`).
 * Utile quando vecchi formati / merge hanno lasciato `leaderboard.ms` diverso dal profilo.
 *
 * Prerequisiti: credenziali Admin (GOOGLE_APPLICATION_CREDENTIALS o ADC).
 *
 * Dry-run (solo log):
 *   node tools/fix-player-leaderboard-from-profile.js bartolomeo
 *
 * Scrittura:
 *   node tools/fix-player-leaderboard-from-profile.js bartolomeo --apply
 * (`scores` con ms > users.bestTime vengono eliminati: il merge in app usa il max.)
 *
 * Per UID diretto (salta ricerca per nome):
 *   node tools/fix-player-leaderboard-from-profile.js --uid=XXXXXXXX --apply
 *
 * In alternativa (solo admin loggato in app): POST /api/admin/sync-leaderboard-from-user-profile
 * body JSON { "target_uid": "<uid>" }
 */

const admin = require("firebase-admin");

const PROJECT_ID = "dodge-84439";
const SCORE_MIN = 1;
const SCORE_MAX = 7200000;

function parseArgs(argv) {
  let needle = null;
  let uidDirect = null;
  let apply = false;
  for (const a of argv) {
    if (a === "--apply") apply = true;
    else if (a.startsWith("--uid=")) uidDirect = a.slice("--uid=".length).trim();
    else if (!a.startsWith("-")) needle = a;
  }
  return {needle, uidDirect, apply};
}

async function findUidsByDisplaySubstring(db, substring) {
  const sub = String(substring || "").trim().toLowerCase();
  if (!sub) return [];
  const byUid = new Map();

  const ingest = (snap, label) => {
    snap.docs.forEach((d) => {
      const data = d.data() || {};
      const id = typeof data.uid === "string" && data.uid ? data.uid : d.id;
      const dn = String(data.displayName || data.username || "").toLowerCase();
      if (!dn.includes(sub)) return;
      byUid.set(id, {
        uid: id,
        displayName: data.displayName || data.username || "",
        hitMs: data.ms,
        hitCollection: label,
      });
    });
  };

  const [lbSnap, pureSnap] = await Promise.all([
    db.collection("leaderboard").orderBy("ms", "desc").limit(500).get(),
    db.collection("leaderboard_pure").orderBy("ms", "desc").limit(500).get(),
  ]);
  ingest(lbSnap, "leaderboard");
  ingest(pureSnap, "leaderboard_pure");
  return [...byUid.values()];
}

async function syncUid(db, uid, apply) {
  const FieldValue = admin.firestore.FieldValue;
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) throw new Error(`users/${uid} non esiste`);

  const u = userSnap.data() || {};
  const displayName = String(u.displayName || u.username || "Player").slice(0, 24);
  const canonicalMs = Math.floor(Number(u.bestTime));

  if (!Number.isFinite(canonicalMs) || canonicalMs < SCORE_MIN || canonicalMs > SCORE_MAX) {
    throw new Error(`users.bestTime non valido: ${JSON.stringify(u.bestTime)}`);
  }

  const lbRef = db.collection("leaderboard").doc(uid);
  const pureRef = db.collection("leaderboard_pure").doc(uid);
  const statsRef = db.collection("player_stats").doc(uid);

  const [lbSnap, pureSnap, statsSnap] = await Promise.all([
    lbRef.get(),
    pureRef.get(),
    statsRef.get(),
  ]);

  console.log("\n---", uid, "---");
  console.log("Nome profilo:", displayName);
  console.log("users.bestTime (ms, canonicità):", canonicalMs);
  console.log("leaderboard attuale:", lbSnap.exists ? lbSnap.data() : "(assente)");
  console.log("leaderboard_pure attuale:", pureSnap.exists ? pureSnap.data() : "(assente)");
  if (statsSnap.exists) {
    console.log("player_stats.best_time_seconds attuale:", statsSnap.data()?.best_time_seconds);
  }

  const lbPayload = {
    uid,
    displayName,
    ms: canonicalMs,
    updatedAt: FieldValue.serverTimestamp(),
    prize_used: FieldValue.delete(),
  };

  const purePayload = {
    uid,
    displayName,
    ms: canonicalMs,
    updatedAt: FieldValue.serverTimestamp(),
  };

  const statsPayload = {
    best_time_seconds: canonicalMs / 1000,
    updated_at: FieldValue.serverTimestamp(),
  };

  if (!apply) {
    const scoresSnap = await db.collection("scores").where("uid", "==", uid).get();
    const wouldDelete = scoresSnap.docs.filter((doc) => {
      const ms = Math.floor(Number(doc.data().ms));
      return Number.isFinite(ms) && ms > canonicalMs;
    }).length;
    console.log("[dry-run] Verrebbero aggiornati leaderboard, leaderboard_pure" +
      (statsSnap.exists ? ", player_stats.best_time_seconds" : "") +
      ` con ms=${canonicalMs}; scores da eliminare (ms > best): ${wouldDelete}.`);
    return;
  }

  await lbRef.set(lbPayload, {merge: true});
  await pureRef.set(purePayload, {merge: true});
  await db.collection("users").doc(uid).set({
    bestTime_prize_used: FieldValue.delete(),
  }, {merge: true});
  if (statsSnap.exists) {
    await statsRef.set(statsPayload, {merge: true});
  }

  const scoresSnap = await db.collection("scores").where("uid", "==", uid).get();
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
    const ms = Math.floor(Number(doc.data().ms));
    if (Number.isFinite(ms) && ms > canonicalMs) {
      batch.delete(doc.ref);
      ops++;
      deletedScores++;
      if (ops >= 450) await flushScores();
    }
  }
  await flushScores();
  console.log("[apply] Aggiornato; scores eliminati con ms > canonical:", deletedScores);
}

async function main() {
  const {needle, uidDirect, apply} = parseArgs(process.argv.slice(2));

  if (!admin.apps.length) {
    admin.initializeApp({projectId: PROJECT_ID});
  }
  const db = admin.firestore();

  let uids = [];
  if (uidDirect) {
    uids = [uidDirect];
  } else if (needle) {
    const hits = await findUidsByDisplaySubstring(db, needle);
    if (hits.length === 0) {
      console.error("Nessun uid trovato in leaderboard/leaderboard_pure per nome:", needle);
      console.error("Usa --uid=<Firebase Auth uid> oppure amplia la ricerca nel console.");
      process.exit(1);
    }
    if (hits.length > 1) {
      console.error("Più utenti corrispondenti; specifica --uid=:");
      hits.forEach((h) => console.error(" ", h.uid, h.displayName, `(${h.hitCollection} ms=${h.hitMs})`));
      process.exit(1);
    }
    console.log("Match:", hits[0].displayName, hits[0].uid);
    uids = [hits[0].uid];
  } else {
    console.error("Uso: node tools/fix-player-leaderboard-from-profile.js <substringNome> [--apply]");
    console.error("     node tools/fix-player-leaderboard-from-profile.js --uid=XXX [--apply]");
    process.exit(1);
  }

  for (const uid of uids) {
    await syncUid(db, uid, apply);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
