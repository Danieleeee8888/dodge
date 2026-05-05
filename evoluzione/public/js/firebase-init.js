import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  indexedDBLocalPersistence,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

const firebaseConfig = {
  apiKey: "AIzaSyCSIqgAmqQnch2Dt1MVTdlFMja8tyWJx_g",
  authDomain: "dodge-84439.firebaseapp.com",
  databaseURL: "https://dodge-84439-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "dodge-84439",
  storageBucket: "dodge-84439.firebasestorage.app",
  messagingSenderId: "242454732601",
  appId: "1:242454732601:web:b577f49305ec966b8d52e8"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

/* Persistenza forzata: indexedDB se disponibile, altrimenti localStorage. Evita perdita
 * sessione Google su browser dove l'inizializzazione in `getAuth` non riesce subito. */
export const authPersistenceReady = setPersistence(auth, indexedDBLocalPersistence)
  .catch(() => setPersistence(auth, browserLocalPersistence))
  .catch(() => setPersistence(auth, browserSessionPersistence))
  .catch(() => null);

export const db = getFirestore(app);
export const rtdb = getDatabase(app);
