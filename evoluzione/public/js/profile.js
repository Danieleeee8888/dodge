import { db } from './firebase-init.js';
import {
  doc, getDoc, setDoc, updateDoc, runTransaction, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export async function usernameExists(username) {
  const snap = await getDoc(doc(db, 'usernames', username.toLowerCase()));
  return snap.exists();
}

export async function claimUsername(username, uid, email) {
  const userRef = doc(db, 'users', uid);
  const nameRef = doc(db, 'usernames', username.toLowerCase());

  await runTransaction(db, async (tx) => {
    const nameSnap = await tx.get(nameRef);
    if (nameSnap.exists()) {
      const err = new Error('USERNAME_TAKEN');
      err.code = 'USERNAME_TAKEN';
      throw err;
    }
    const now = serverTimestamp();
    tx.set(nameRef, { uid, claimedAt: now });
    tx.set(userRef, {
      username,
      usernameLower: username.toLowerCase(),
      email,
      createdAt: now,
      lastSeen: now,
      gamesPlayed: 0,
      bestTime: 0,
    });
  });
}

export async function getProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? snap.data() : null;
}

export async function updateLastSeen(uid) {
  await updateDoc(doc(db, 'users', uid), { lastSeen: serverTimestamp() }).catch(() => {});
}
