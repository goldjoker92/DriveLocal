// Auth service — Firebase Auth (email/password) + driver/admin role resolution.
// Iteration 1A. No WhatsApp OTP, no Storage, no push notifications here.

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { SERVICE_AREA_HORIZONTE_CE_BR } from '../constants/serviceAreaIds';

// Creates a Firebase Auth user, then a drivers/{uid} document in "draft" state.
// Returns the Firebase user.
export async function registerDriver(email, password) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  const user = credential.user;

  await setDoc(doc(db, 'drivers', user.uid), {
    uid: user.uid,
    email,
    verificationStatus: 'draft',
    profileStatus: 'incomplete',
    vehicleStatus: 'incomplete',
    documentsStatus: 'missing',
    selfieStatus: 'missing',
    duplicateCheckStatus: 'clear',
    serviceAreaId: SERVICE_AREA_HORIZONTE_CE_BR,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return user;
}

// Signs the user in, then resolves their role.
// Order: admins/{uid} first, then drivers/{uid}, otherwise "unknown".
// Returns { user, role, driver? }.
export async function loginUser(email, password) {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const user = credential.user;

  const adminSnap = await getDoc(doc(db, 'admins', user.uid));
  if (adminSnap.exists()) {
    return { user, role: 'admin' };
  }

  const driverSnap = await getDoc(doc(db, 'drivers', user.uid));
  if (driverSnap.exists()) {
    return { user, role: 'driver', driver: driverSnap.data() };
  }

  return { user, role: 'unknown' };
}

// Signs the current user out of Firebase Auth.
export async function logoutUser() {
  await signOut(auth);
}

// Returns the current Firebase Auth user (or null).
export function getCurrentUser() {
  return auth.currentUser;
}
