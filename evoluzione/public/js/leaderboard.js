import { db } from './firebase-init.js';
import {
  collection, doc, setDoc, getDoc, updateDoc, query, orderBy, limit,
  getDocs, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

let _cache = [];

export async function fetchLeaderboard(n = 10) {
  const q = query(collection(db, 'leaderboard'), orderBy('ms', 'desc'), limit(n));
  const snap = await getDocs(q);
  _cache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return _cache;
}

export function getCachedLeaderboard() {
  return _cache;
}

/**
 * Aggiorna la cache locale in modo ottimistico (prima che la scrittura su Firestore finisca).
 * Sostituisce l'entry esistente dell'utente se il nuovo tempo è migliore, altrimenti non fa nulla.
 */
export function applyOptimisticScore(uid, username, ms) {
  const t = Math.floor(ms);
  if (t <= 0 || t > 7200000) return;
  const idx = _cache.findIndex(r => r.uid === uid);
  if (idx >= 0) {
    if (t <= _cache[idx].ms) return;
    _cache[idx] = { ..._cache[idx], ms: t };
  } else {
    _cache.push({ id: uid, uid, username, ms: t });
  }
  _cache = _cache.sort((a, b) => b.ms - a.ms).slice(0, 10);
}

/**
 * Salva il punteggio seguendo questa logica:
 *   1. Se non batte il record personale → aggiorna solo gamesPlayed, fine.
 *   2. Se batte il record personale → aggiorna bestTime in users/{uid}.
 *   3. Controlla se il nuovo tempo entra nei top 10.
 *   4. Se entra → setDoc su leaderboard/{uid} (sovrascrive eventuale entry precedente).
 *
 * Ritorna { ok, improved, inTop10, reason? }
 */
export async function saveScore(uid, username, ms) {
  const t = Math.floor(ms);
  if (t <= 0 || t > 7200000) return { ok: false, reason: 'invalid' };

  try {
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return { ok: false, reason: 'no_profile' };

    const data = userSnap.data();
    const currentBest = data.bestTime || 0;
    const improved = t > currentBest;

    const updates = { gamesPlayed: (data.gamesPlayed || 0) + 1 };
    if (improved) updates.bestTime = t;
    await updateDoc(userRef, updates);

    if (!improved) return { ok: true, improved: false };

    // Nuovo record personale — controlla se entra in top 10
    const lb = await fetchLeaderboard(10);
    const myEntry = lb.find(r => r.uid === uid);
    const worstMs = lb.length > 0 ? lb[lb.length - 1].ms : 0;
    const inTop10 = lb.length < 10 || myEntry !== undefined || t > worstMs;

    if (!inTop10) return { ok: true, improved: true, inTop10: false };

    // Scrivi / sostituisci la entry in classifica
    await setDoc(doc(db, 'leaderboard', uid), {
      uid, username, ms: t, updatedAt: serverTimestamp(),
    });
    await fetchLeaderboard(10);
    return { ok: true, improved: true, inTop10: true };

  } catch (e) {
    const reason = e.code === 'permission-denied' ? 'permission' : 'network';
    return { ok: false, reason };
  }
}
