import { db } from './firebase-init.js';
import {
  collection, addDoc, query, orderBy, limit,
  getDocs, serverTimestamp, doc, getDoc, updateDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

let _cache = [];

function mergePendingIntoCache(uid, username, ms) {
  const row = { id: '_pending_', uid, username, ms };
  const base = _cache.filter(r => !(r.id === '_pending_' && r.uid === uid));
  _cache = [...base, row].sort((a, b) => (b.ms || 0) - (a.ms || 0)).slice(0, 10);
}

export async function fetchLeaderboard(n = 10) {
  const q = query(collection(db, 'scores'), orderBy('ms', 'desc'), limit(n));
  const snap = await getDocs(q);
  _cache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return _cache;
}

export function getCachedLeaderboard() {
  return _cache;
}

/** Mostra subito il nuovo punteggio in classifica (prima che finisca `saveScore`). */
export function applyOptimisticScore(uid, username, ms) {
  const t = Math.floor(ms);
  if (t <= 0 || t > 7200000) return;
  mergePendingIntoCache(uid, username, t);
}

export async function saveScore(uid, username, ms) {
  const t = Math.floor(ms);
  if (t <= 0 || t > 7200000) return;
  await addDoc(collection(db, 'scores'), {
    uid, username, ms: t, createdAt: serverTimestamp(),
  });
  const userRef = doc(db, 'users', uid);
  const snap = await getDoc(userRef);
  const userPromise = snap.exists()
    ? (async () => {
      const d = snap.data();
      const updates = { gamesPlayed: (d.gamesPlayed || 0) + 1 };
      if (t > (d.bestTime || 0)) updates.bestTime = t;
      await updateDoc(userRef, updates);
    })()
    : Promise.resolve();
  await Promise.all([userPromise, fetchLeaderboard(10)]);
}
