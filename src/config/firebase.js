import { initializeApp, getApp, getApps } from "firebase/app";
import {
  initializeAuth,
  getAuth,
  getReactNativePersistence,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";

const firebaseConfig = {
  apiKey: "AIzaSyCjOL8bIjXIvWqdnda5vpdBuCHIaM-liBg",
  authDomain: "drivelocal-dev.firebaseapp.com",
  projectId: "drivelocal-dev",
  storageBucket: "drivelocal-dev.firebasestorage.app",
  messagingSenderId: "539625523844",
  appId: "1:539625523844:web:00fcd2e9af3432f00090d1"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

const appStorage = ReactNativeAsyncStorage;

let auth;

try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(appStorage),
  });
} catch (error) {
  auth = getAuth(app);
}

const db = getFirestore(app);
const storage = getStorage(app);

export { app, auth, db, storage };