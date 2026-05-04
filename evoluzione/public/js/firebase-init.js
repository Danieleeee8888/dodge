import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
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
export const db = getFirestore(app);
export const rtdb = getDatabase(app);
