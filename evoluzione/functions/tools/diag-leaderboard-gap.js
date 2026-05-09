/**
 * Diagnostica differenza classifica Generale vs Pura (Firestore produzione).
 *
 * Prerequisiti: credenziali Admin (es. variabile GOOGLE_APPLICATION_CREDENTIALS
 * verso un JSON service account del progetto, oppure `gcloud auth application-default login`
 * con progetto dodge-84439).
 *
 * Uso (da cartella functions): node tools/diag-leaderboard-gap.js [substringNome]
 * Esempio: node tools/diag-leaderboard-gap.js bartolomeo
 */

const admin = require("firebase-admin");

const PROJECT_ID = "dodge-84439";
const TOP_N = 15;
const LB_FETCH = 80;
const SCORE_SCAN = 2500;
const SCORE_MIN = 1;
const SCORE_MAX = 7200000;

function normalizeMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.floor(n);
}

function isValidMs(ms) {
  return ms >= SCORE_MIN && ms <= SCORE_MAX;
}

/** Allineato a public/js/leaderboard.js */
function isPureScoreRow(row) {
  const p = row?.prize_used;
  if (p == null || p === "") return true;
  if (p === false || p === 0) return true;
  return false;
}

function dedupeBestByUid(rows, n) {
  const bestByUid = new Map();
  rows.forEach((row) => {
    const uid = row?.uid;
    const ms = normalizeMs(row?.ms);
    if (!uid || !isValidMs(ms)) return;
    const prev = bestByUid.get(uid);
    if (!prev || ms > prev.ms) {
      bestByUid.set(uid, {...row, uid, ms});
    }
  });
  const sorted = Array.from(bestByUid.values()).sort((a, b) => b.ms - a.ms);
  return sorted.slice(0, n);
}

function rowLabel(row) {
  const name = String(row.displayName || row.username || "?").slice(0, 24);
  const base = `${name} | uid=${row.uid} | ms=${row.ms}`;
  if (!row || !Object.prototype.hasOwnProperty.call(row, "prize_used")) return base;
  const p = row.prize_used;
  if (p == null || p === "") return base;
  if (p === false || p === 0) return `${base} | prize_used=${JSON.stringify(p)} (legacy)`;
  return `${base} | prize_used=${JSON.stringify(p)}`;
}

async function main() {
  const nameNeedle = (process.argv[2] || "").trim().toLowerCase();

  if (!admin.apps.length) {
    admin.initializeApp({projectId: PROJECT_ID});
  }
  const db = admin.firestore();

  const [lbSnap, lbPureSnap, scSnap] = await Promise.all([
    db.collection("leaderboard").orderBy("ms", "desc").limit(LB_FETCH).get(),
    db.collection("leaderboard_pure").orderBy("ms", "desc").limit(LB_FETCH).get(),
    db.collection("scores").orderBy("ms", "desc").limit(SCORE_SCAN).get(),
  ]);

  const lbRows = lbSnap.docs.map((d) => ({id: d.id, ...d.data()}));
  const lbPureRows = lbPureSnap.docs.map((d) => ({id: d.id, ...d.data()}));
  const scRows = scSnap.docs.map((d) => ({id: d.id, ...d.data()}));

  const generalMerged = dedupeBestByUid([...lbRows, ...scRows], 9999);
  const generalTop = dedupeBestByUid(generalMerged, TOP_N);

  const pureScoreRows = scRows.filter(isPureScoreRow);
  const pureCombined = [...lbPureRows, ...pureScoreRows];
  const pureMerged = dedupeBestByUid(pureCombined, 9999);
  const pureTop = dedupeBestByUid(pureMerged, TOP_N);

  const genUids = new Set(generalTop.map((r) => r.uid));
  const pureUids = new Set(pureTop.map((r) => r.uid));

  console.log("\n=== TOP", TOP_N, "GENERALE (merge leaderboard + scores, dedupe) ===\n");
  generalTop.forEach((r, i) => console.log(`${i + 1}.`, rowLabel(r)));

  console.log("\n=== TOP", TOP_N, "PURA (merge leaderboard_pure + scores puri, dedupe) ===\n");
  pureTop.forEach((r, i) => console.log(`${i + 1}.`, rowLabel(r)));

  console.log("\n=== IN GENERALE MA NON IN PURA ===\n");
  for (const r of generalTop) {
    if (!pureUids.has(r.uid)) {
      console.log("-", rowLabel(r));
      const pureDoc = lbPureRows.find((x) => x.uid === r.uid);
      const fromLbPure = pureDoc ? `leaderboard_pure ms=${pureDoc.ms}` : "nessun doc leaderboard_pure";
      const userPureScores = pureScoreRows.filter((x) => x.uid === r.uid).slice(0, 5);
      console.log("  ", fromLbPure);
      if (userPureScores.length) {
        console.log("   migliori scores puri nello scan:", userPureScores.map((s) => s.ms).join(", "));
      } else {
        console.log("   nessuno score «puro» per questo uid tra le prime", SCORE_SCAN, "righe di scores (per ms globale)");
      }
    }
  }

  console.log("\n=== IN PURA MA NON IN GENERALE (inusuale) ===\n");
  for (const r of pureTop) {
    if (!genUids.has(r.uid)) console.log("-", rowLabel(r));
  }

  if (nameNeedle) {
    console.log("\n=== RICERCA NOME (leaderboard + leaderboard_pure + scan scores) ===\n");
    const hits = [];
    const scanAll = [...lbRows, ...lbPureRows, ...scRows];
    for (const row of scanAll) {
      const dn = String(row.displayName || row.username || "").toLowerCase();
      if (dn.includes(nameNeedle)) hits.push(row);
    }
    const byUid = new Map();
    for (const h of hits) {
      const prev = byUid.get(h.uid);
      const ms = normalizeMs(h.ms);
      if (!prev || ms > normalizeMs(prev.ms)) byUid.set(h.uid, {...h, ms});
    }
    if (byUid.size === 0) {
      console.log("Nessun match per:", nameNeedle);
    } else {
      for (const [uid, row] of byUid) {
        console.log("---", rowLabel(row), "---");
        const [lbDoc, pureLbDoc, userSnap] = await Promise.all([
          db.collection("leaderboard").doc(uid).get(),
          db.collection("leaderboard_pure").doc(uid).get(),
          db.collection("users").doc(uid).get(),
        ]);
        console.log("leaderboard/", uid, lbDoc.exists ? lbDoc.data() : "(manca)");
        console.log("leaderboard_pure/", uid, pureLbDoc.exists ? pureLbDoc.data() : "(manca)");
        console.log("users.bestTime", userSnap.exists ? userSnap.data()?.bestTime : "(manca)");

        const anomaly = [];
        const lbData = lbDoc.exists ? lbDoc.data() : {};
        const p = lbData.prize_used;
        if (p === false || p === 0) {
          anomaly.push(`leaderboard prize_used legacy ${JSON.stringify(p)} (non è codice Plus; prima era fuori dalla pura)`);
        } else if (typeof p === "string" && p.trim() !== "") {
          anomaly.push(`leaderboard ha prize_used=${JSON.stringify(p)} → PB generale con Plus`);
        }
        if (!pureLbDoc.exists) anomaly.push("leaderboard_pure assente (mai aggiornato da API / utente solo legacy)");
        const badPureField = scRows.filter((s) => s.uid === uid && !isPureScoreRow(s));
        if (badPureField.length) {
          anomaly.push(
              `scores con prize_used valorizzato (prime ${SCORE_SCAN} righe): ` +
              `${badPureField.slice(0, 3).map((s) => JSON.stringify(s.prize_used)).join("; ")}`,
          );
        }
        const pureForUid = pureScoreRows.filter((s) => s.uid === uid);
        const bestPureScan = pureForUid.length ? Math.max(...pureForUid.map((s) => normalizeMs(s.ms))) : null;
        console.log(
            "miglior ms tra scores puri nello scan:",
            bestPureScan != null ? bestPureScan : "(nessuno nello scan)",
        );
        if (anomaly.length) console.log("note:", anomaly.join(" | "));
      }
    }
  }

  console.log("\n=== LEGACY: prize_used «strani» nello scan scores (non null né stringa vuota) ===\n");
  const weird = scRows.filter((r) => {
    const p = r.prize_used;
    if (p == null || p === "") return false;
    return typeof p !== "string";
  }).slice(0, 15);
  if (weird.length === 0) {
    console.log("(nessuno)");
  } else {
    weird.forEach((r) => console.log(rowLabel(r), "→ tipo", typeof r.prize_used));
  }

  const falseyNonPure = scRows.filter((r) => r.prize_used === false || r.prize_used === 0).slice(0, 20);
  console.log("\n=== LEGACY: scores con prize_used false o 0 (prima del fix client contavano come «non puri») ===\n");
  if (falseyNonPure.length === 0) {
    console.log("(nessuno nello scan)");
  } else {
    falseyNonPure.forEach((r) => console.log(rowLabel(r)));
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
