// Auth service — Firebase Auth (email/password) + driver/admin role resolution.
// Account creation is idempotent: an existing email with the correct password is
// signed in and its missing Firestore role profile is repaired when safe.

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

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function accountRoleConflict(existingRole, requestedRole) {
  const error = new Error(
    `This email is already linked to a ${existingRole} account and cannot be registered as ${requestedRole}.`
  );
  error.code = 'auth/account-role-conflict';
  error.existingRole = existingRole;
  error.requestedRole = requestedRole;
  return error;
}

async function resolveAccountRole(uid) {
  const adminSnap = await getDoc(doc(db, 'admins', uid));
  if (adminSnap.exists()) {
    return { role: 'admin', profile: adminSnap.data() };
  }

  const driverSnap = await getDoc(doc(db, 'drivers', uid));
  if (driverSnap.exists()) {
    return { role: 'driver', profile: driverSnap.data() };
  }

  const passengerSnap = await getDoc(doc(db, 'passengers', uid));
  if (passengerSnap.exists()) {
    return { role: 'passenger', profile: passengerSnap.data() };
  }

  return { role: 'unknown', profile: null };
}

async function writeRoleProfile(user, collectionName, buildProfile, normalizedEmail) {
  const profile = buildProfile(user, normalizedEmail);
  await setDoc(doc(db, collectionName, user.uid), profile);
  return profile;
}

async function recoverExistingAccount({
  email,
  password,
  collectionName,
  requestedRole,
  buildProfile,
}) {
  // The email already exists in Firebase Auth. Authenticate it with the password
  // entered by the user instead of leaving the registration screen blocked.
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const user = credential.user;
  const account = await resolveAccountRole(user.uid);

  if (account.role === requestedRole) {
    return {
      user,
      role: requestedRole,
      profile: account.profile,
      accountState: 'existing',
    };
  }

  if (account.role !== 'unknown') {
    // Do not leave the device silently authenticated as the wrong account type.
    await signOut(auth);
    throw accountRoleConflict(account.role, requestedRole);
  }

  // Legacy/orphan account: Auth exists but no Firestore role profile was ever
  // created. Repair it now using the same validated initial profile as a new user.
  try {
    const profile = await writeRoleProfile(user, collectionName, buildProfile, email);
    return {
      user,
      role: requestedRole,
      profile,
      accountState: 'recovered',
    };
  } catch (error) {
    // Keep the Auth account intact, but leave no misleading signed-in session.
    await signOut(auth);
    throw error;
  }
}

async function createAccountWithProfile({
  email,
  password,
  collectionName,
  requestedRole,
  buildProfile,
}) {
  const normalizedEmail = normalizeEmail(email);
  let credential;

  // Registration may be opened while another test account is still signed in.
  // Start from a clean session so a failed attempt never keeps a stale user active.
  if (auth.currentUser) {
    await signOut(auth);
  }

  try {
    credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
  } catch (error) {
    if (error?.code !== 'auth/email-already-in-use') {
      throw error;
    }

    return recoverExistingAccount({
      email: normalizedEmail,
      password,
      collectionName,
      requestedRole,
      buildProfile,
    });
  }

  const user = credential.user;

  try {
    const profile = await writeRoleProfile(
      user,
      collectionName,
      buildProfile,
      normalizedEmail
    );
    return {
      user,
      role: requestedRole,
      profile,
      accountState: 'created',
    };
  } catch (error) {
    // Firebase Auth succeeds before Firestore. Roll back only a genuinely new
    // Auth user. Existing accounts are never deleted by the recovery path.
    try {
      await deleteUser(user);
    } catch (rollbackError) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn(
          '[AUTH_FLOW] profile creation failed and Auth rollback also failed',
          rollbackError?.code || rollbackError?.message || 'unknown'
        );
      }
    }
    throw error;
  }
}

function buildInitialDriverProfile(user, email) {
  return {
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
  };
}

export async function registerDriver(email, password) {
  return createAccountWithProfile({
    email,
    password,
    collectionName: 'drivers',
    requestedRole: 'driver',
    buildProfile: buildInitialDriverProfile,
  });
}

export async function registerPassenger(email, password, profile) {
  const passenger = profile || {};
  return createAccountWithProfile({
    email,
    password,
    collectionName: 'passengers',
    requestedRole: 'passenger',
    buildProfile: (user, normalizedEmail) => ({
      uid: user.uid,
      email: normalizedEmail,
      fullName: passenger.fullName || '',
      whatsApp: passenger.whatsApp || '',
      role: 'passenger',
      serviceAreaId: SERVICE_AREA_HORIZONTE_CE_BR,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  });
}

// Signs the user in, then resolves their role.
// Returns { user, role, driver?, passenger? }.
export async function loginUser(email, password) {
  const normalizedEmail = normalizeEmail(email);
  const credential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
  const user = credential.user;
  const account = await resolveAccountRole(user.uid);

  if (account.role === 'admin') {
    return { user, role: 'admin' };
  }
  if (account.role === 'driver') {
    return { user, role: 'driver', driver: account.profile };
  }
  if (account.role === 'passenger') {
    return { user, role: 'passenger', passenger: account.profile };
  }

  return { user, role: 'unknown' };
}

export async function logoutUser() {
  try {
    await disablePushNotifications();
  } catch (_error) {
    // Best effort — notification cleanup must never block logout.
  }
  await signOut(auth);
}

export function getCurrentUser() {
  return auth.currentUser;
}
