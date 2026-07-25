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
import {
  getDriverTrackingSession,
  stopDriverOnlineTracking,
} from './driverLocationTracking';
import { stopDriverWorkSession } from './driverAvailabilityService';
import { getRobotDriverState, stopRobotDriver } from './robotDriverEngine';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function shortId(value) {
  const text = typeof value === 'string' ? value : '';
  if (!text) return null;
  return text.length <= 12 ? text : `${text.slice(0, 6)}…${text.slice(-4)}`;
}

function activeRideAccountChangeError(reason) {
  const error = new Error('Finalize ou cancele a corrida ativa antes de trocar de conta.');
  error.code = 'auth/active-ride-in-progress';
  error.reason = reason;
  return error;
}

async function readAuthenticatedDriverState() {
  const uid = auth.currentUser?.uid || null;
  if (!uid) return null;
  try {
    const snapshot = await getDoc(doc(db, 'drivers', uid));
    return snapshot.exists() ? { uid, ...snapshot.data() } : null;
  } catch (error) {
    console.warn('[AUTH_TRACKING_CLEANUP] remote driver read failed', {
      scope: 'auth_tracking_cleanup',
      event: 'remote_driver_read_failed',
      authenticatedUid: shortId(uid),
      reason: error?.code || error?.message || 'unknown',
      atMs: Date.now(),
    });
    return null;
  }
}

async function activeTrackingState() {
  const session = await getDriverTrackingSession();
  const robot = getRobotDriverState();
  const localRideId = session?.rideId || robot?.rideId || null;
  const localDriverId = session?.driverId || robot?.driverId || null;

  if (localRideId) {
    return {
      session,
      remoteDriver: null,
      hasActiveRide: true,
      activeRideId: localRideId,
      driverId: localDriverId,
      source: session?.rideId ? 'native_tracking_session' : 'robot_driver',
    };
  }

  // AsyncStorage can be removed by Android or by a previous failed transition.
  // Firestore remains authoritative for an already assigned ride.
  const remoteDriver = await readAuthenticatedDriverState();
  return {
    session,
    remoteDriver,
    hasActiveRide: Boolean(remoteDriver?.activeRideId),
    activeRideId: remoteDriver?.activeRideId || null,
    driverId: localDriverId || remoteDriver?.uid || null,
    source: remoteDriver?.activeRideId ? 'firestore_driver' : 'none',
  };
}

async function assertNoActiveRideAccountChange(reason) {
  const tracking = await activeTrackingState();
  if (!tracking.hasActiveRide) return tracking;
  console.warn('[AUTH_TRACKING_CLEANUP] account change blocked by active ride', {
    scope: 'auth_tracking_cleanup',
    event: 'account_change_blocked',
    reason,
    source: tracking.source,
    driverId: shortId(tracking.driverId),
    rideId: shortId(tracking.activeRideId),
    atMs: Date.now(),
  });
  throw activeRideAccountChangeError(reason);
}

async function clearLocalDriverTracking(reason) {
  const trackingSession = await getDriverTrackingSession();
  const robot = getRobotDriverState();
  const remoteDriver = await readAuthenticatedDriverState();
  console.log('[AUTH_TRACKING_CLEANUP] started', {
    scope: 'auth_tracking_cleanup',
    event: 'cleanup_started',
    reason,
    authenticatedUid: shortId(auth.currentUser?.uid),
    robotEnabled: Boolean(robot?.enabled),
    robotDriverId: shortId(robot?.driverId),
    robotRideId: shortId(robot?.rideId),
    trackingRideId: shortId(trackingSession?.rideId),
    localSessionId: shortId(trackingSession?.availabilitySessionId),
    remoteSessionId: shortId(remoteDriver?.availabilitySessionId),
    atMs: Date.now(),
  });

  try {
    if (robot?.enabled) {
      // Account cleanup must end with no native task. Do not briefly restore the
      // physical GPS when stopping the DEV simulator for sign-out/account switch.
      await stopRobotDriver({ restoreRealTracking: false });
    }
  } catch (error) {
    console.warn('[AUTH_TRACKING_CLEANUP] robot stop failed', {
      scope: 'auth_tracking_cleanup',
      event: 'robot_stop_failed',
      reason,
      code: error?.code,
      message: error?.message,
      atMs: Date.now(),
    });
  }

  try {
    // Invalidate the local session before revoking it remotely so queued native
    // points cannot publish after sign-out or account switching.
    await stopDriverOnlineTracking();
  } catch (error) {
    console.warn('[AUTH_TRACKING_CLEANUP] native stop failed', {
      scope: 'auth_tracking_cleanup',
      event: 'native_stop_failed',
      reason,
      code: error?.code,
      message: error?.message,
      atMs: Date.now(),
    });
  }

  const remoteSessionId = trackingSession?.availabilitySessionId
    || remoteDriver?.availabilitySessionId
    || null;
  const authenticatedUid = auth.currentUser?.uid || null;
  const sessionOwnerMatches = !trackingSession?.driverId
    || trackingSession.driverId === authenticatedUid;

  if (remoteSessionId && authenticatedUid && sessionOwnerMatches && !remoteDriver?.activeRideId) {
    try {
      await stopDriverWorkSession(remoteSessionId);
    } catch (error) {
      // The short server lease still removes a disconnected ghost driver. Account
      // changes must not be blocked solely by a temporary network failure.
      console.warn('[AUTH_TRACKING_CLEANUP] remote availability stop failed', {
        scope: 'auth_tracking_cleanup',
        event: 'remote_availability_stop_failed',
        reason,
        availabilitySessionId: shortId(remoteSessionId),
        code: error?.code,
        message: error?.message,
        atMs: Date.now(),
      });
    }
  }

  console.log('[AUTH_TRACKING_CLEANUP] completed', {
    scope: 'auth_tracking_cleanup',
    event: 'cleanup_completed',
    reason,
    authenticatedUid: shortId(auth.currentUser?.uid),
    atMs: Date.now(),
  });
}

async function clearAuthenticatedSession() {
  // Never abandon a passenger mid-ride by switching the authenticated account.
  await assertNoActiveRideAccountChange('sign_out');
  await clearLocalDriverTracking('sign_out');

  try {
    await disablePushNotifications();
  } catch (_error) {
    // Best effort — token cleanup must never block account switching.
  }
  await signOut(auth);
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

async function roleResult(user) {
  const account = await resolveAccountRole(user.uid);
  if (account.role === 'admin') return { user, role: 'admin' };
  if (account.role === 'driver') return { user, role: 'driver', driver: account.profile };
  if (account.role === 'passenger') return { user, role: 'passenger', passenger: account.profile };
  return { user, role: 'unknown' };
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
    await clearAuthenticatedSession();
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
    await clearAuthenticatedSession();
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
    await clearAuthenticatedSession();
  } else {
    // A native background task can remain after an earlier process/session even
    // when Firebase Auth is already signed out. Never replace an active ride.
    await assertNoActiveRideAccountChange('register_preflight');
    await clearLocalDriverTracking('register_preflight');
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
    availabilityStatus: 'offline',
    availabilitySessionId: null,
    availabilityUpdatedAt: serverTimestamp(),
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
// A same-driver reauthentication preserves an active ride and its tracking;
// switching to any other account remains blocked until the ride is terminal.
export async function loginUser(email, password) {
  const normalizedEmail = normalizeEmail(email);
  const tracking = await activeTrackingState();

  if (tracking.hasActiveRide) {
    const currentUid = auth.currentUser?.uid || null;
    const currentEmail = normalizeEmail(auth.currentUser?.email);
    if (
      (currentUid && currentUid !== tracking.driverId)
      || (currentEmail && currentEmail !== normalizedEmail)
    ) {
      throw activeRideAccountChangeError('login_preflight');
    }

    const credential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
    if (credential.user.uid !== tracking.driverId) {
      // Keep the local/remote ride ownership so the correct account can be entered next.
      // The wrong account is immediately signed out and never inherits the ride.
      await signOut(auth);
      throw activeRideAccountChangeError('login_uid_mismatch');
    }
    return roleResult(credential.user);
  }

  // No active ride: close the previous optional work session before replacing the
  // authenticated account. New login therefore starts unavailable by default.
  await clearLocalDriverTracking('login_preflight');
  const credential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
  return roleResult(credential.user);
}

export async function logoutUser() {
  await clearAuthenticatedSession();
}

export function getCurrentUser() {
  return auth.currentUser;
}
