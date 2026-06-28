import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCjOL8bIjXIvWqdnda5vpdBuCHIaM-liBg",
  authDomain: "drivelocal-dev.firebaseapp.com",
  projectId: "drivelocal-dev",
  storageBucket: "drivelocal-dev.firebasestorage.app",
  messagingSenderId: "539625523844",
  appId: "1:539625523844:web:00fcd2e9af3432f00090d1"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;
