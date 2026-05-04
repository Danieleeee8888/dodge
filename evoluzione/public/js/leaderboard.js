import { db } from './firebase-init.js';
import {
  collection, addDoc, query, orderBy, limit,
  getDocs, serverTimestamp, doc, getDoc, updateDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

let _cache = [];

export async function fetchLeaderboard(n = 10) {
  const q = query(collection(db, 'scores'), orderBy('ms', 'desc'), limit(n));
  const snap = await getDocs(q);
  _cache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return _cache;
}

export function getCachedLeaderboard() {
  return _cache;
}

export async function saveScore(uid, username, ms) {
  const t = Math.floor(ms);
  if (t <= 0 || t > 7200000) return;
  await addDoc(collection(db, 'scores'), {
    uid, username, ms: t, createdAt: serverTimestamp(),
  });
  const userRef = doc(db, 'users', uid);
  const snap = await getDoc(userRef);
  if (snap.exists()) {
    const d = snap.data();
    const updates = { gamesPlayed: (d.gamesPlayed || 0) + 1 };
    if (t > (d.bestTime || 0)) updates.bestTime = t;
    await updateDoc(userRef, updates);
  }
  await fetchLeaderboard(10);
}
