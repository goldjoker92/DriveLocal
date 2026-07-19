// Auth service — Firebase Auth (email/password) + driver/admin role resolution.
// Iteration 1A. No WhatsApp OTP, no Storage, no push notifications here.

import {
  createUserWithEmailAndPassword,
  deleteUser,
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
import { disablePushNotifications } from './notificationsService';

// Creates a Firebase Auth user, then a drivers/{uid} document in "draft" state.
// If Firestore rejects the profile creation, remove the just-created Auth user so
// the email is not left blocked by a half-created account.
// Returns the Firebase user.
export async function registerDriver(email, password) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  const user = credential.user;

  try {
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
  } catch (error) {
    try {
      await deleteUser(user);
    } catch (cleanupError) {
      console.error(
        '[AUTH_FLOW] failed to rollback incomplete driver account',
        cleanupError?.code || cleanupError?.message
      );
    }
    throw error;
  }

  return user;
}

// Creates a Firebase Auth user, then a passengers/{uid} document. Iteration 3A.
// Passengers are simple: no CPF, no documents, no vehicle. `role` is stored for
// convenience, but the source of truth is still collection membership.
export async function registerPassenger(email, password, profile) {
  const p = profile || {};
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  const user = credential.user;

  await setDoc(doc(db, 'passengers', user.uid), {
    uid: user.uid,
    email,
    fullName: p.fullName || '',
    whatsApp: p.whatsApp || '',
    role: 'passenger',
    serviceAreaId: SERVICE_AREA_HORIZONTE_CE_BR,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return user;
}

// Signs the user in, then resolves their role.
// Order matters: admins/{uid} first (highest privilege), then drivers/{uid},
// then passengers/{uid}, otherwise "unknown".
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

  // Passengers are not part of Iteration 1: the collection may not exist yet and
  // security rules can deny the read. Guard it so an unknown account never
  // red-screens — a denied/missing read simply falls through to "unknown".
  try {
    const passengerSnap = await getDoc(doc(db, 'passengers', user.uid));
    if (passengerSnap.exists()) {
      return { user, role: 'passenger' };
    }
  } catch (e) {
    console.log('[AUTH_FLOW] passenger lookup skipped:', e.code || e.message);
  }

  return { user, role: 'unknown' };
}

// Signs the current user out of Firebase Auth. Disables this device's push token
// first (best effort) so a signed-out device stops receiving notifications.
export async function logoutUser() {
  try {
    await disablePushNotifications();
  } catch (_e) {
    // best effort — never block logout
  }
  await signOut(auth);
}

// Returns the current Firebase Auth user (or null).
export function getCurrentUser() {
  return auth.currentUser;
}
