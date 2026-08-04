// Auth service — Firebase Auth (email/password) + driver/admin role resolution.
// Registration is idempotent and non-destructive: Firebase Auth is the durable
// account identity, while a missing Firestore role profile is retried/repaired.

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  getDocFromServer,
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

const PROFILE_WRITE_RETRY_DELAYS_MS = Object.freeze([0, 350, 1000]);
const registrationOperations = new Map();
let authFlowSequence = 0;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function shortId(value) {
  const text = typeof value === 'string' ? value : '';
  if (!text) return null;
  return text.length <= 12 ? text : `${text.slice(0, 6)}…${text.slice(-4)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextAuthFlowId(requestedRole) {
  authFlowSequence += 1;
  return `${requestedRole}-${Date.now().toString(36)}-${authFlowSequence.toString(36)}`;
}

function authFlowTrace(level, flow, stage, details = {}) {
  const payload = {
    scope: 'account_registration',
    flowId: flow?.flowId || 'unknown',
    requestedRole: flow?.requestedRole || 'unknown',
    stage,
    projectId: auth?.app?.options?.projectId || 'unknown',
    atMs: Date.now(),
    ...details,
  };

  if (level === 'error') {
    console.error('[AUTH_FLOW]', payload);
    return;
  }
  if (level === 'warn') {
    console.warn('[AUTH_FLOW]', payload);
    return;
  }
  console.log('[AUTH_FLOW]', payload);
}

function activeRideAccountChangeError(reason) {
  const error = new Error('Finalize ou cancele a corrida ativa antes de trocar de conta.');
  error.code = 'auth/active-ride-in-progress';
  error.reason = reason;
  return error;
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

function authSessionMismatchError(expectedUid) {
  const error = new Error('Firebase Auth session changed during account registration.');
  error.code = 'auth/registration-session-mismatch';
  error.expectedUidPresent = Boolean(expectedUid);
  return error;
}

function profileProvisioningError(cause, user, requestedRole, flowId) {
  const error = new Error(
    'Firebase Auth succeeded, but the role profile could not be confirmed after retries.'
  );
  error.code = 'auth/profile-provisioning-failed';
  error.originalCode = cause?.code || cause?.name || 'unknown';
  error.recoverable = true;
  error.requestedRole = requestedRole;
  error.flowId = flowId;
  error.authAccountPreserved = Boolean(user?.uid);
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

async function refreshRegistrationAuth(user, flow, attempt, reason) {
  if (!user?.uid || auth.currentUser?.uid !== user.uid) {
    authFlowTrace('error', flow, 'auth_session_mismatch', {
      expectedUid: shortId(user?.uid),
      actualUid: shortId(auth.currentUser?.uid),
      attempt,
      reason,
    });
    throw authSessionMismatchError(user?.uid);
  }

  authFlowTrace('log', flow, 'auth_token_refresh_started', {
    uid: shortId(user.uid),
    attempt,
    reason,
  });
  await user.getIdToken(true);

  if (auth.currentUser?.uid !== user.uid) {
    authFlowTrace('error', flow, 'auth_session_changed_after_refresh', {
      expectedUid: shortId(user.uid),
      actualUid: shortId(auth.currentUser?.uid),
      attempt,
      reason,
    });
    throw authSessionMismatchError(user.uid);
  }

  authFlowTrace('log', flow, 'auth_token_refresh_succeeded', {
    uid: shortId(user.uid),
    attempt,
    reason,
  });
}

async function confirmRoleProfileFromServer(user, collectionName, flow, attempt) {
  try {
    const snapshot = await getDocFromServer(doc(db, collectionName, user.uid));
    if (!snapshot.exists()) {
      authFlowTrace('warn', flow, 'profile_server_check_missing', {
        uid: shortId(user.uid),
        collectionName,
        attempt,
      });
      return null;
    }

    const profile = snapshot.data() || {};
    if (profile.uid !== user.uid) {
      authFlowTrace('error', flow, 'profile_server_check_uid_mismatch', {
        uid: shortId(user.uid),
        storedUid: shortId(profile.uid),
        collectionName,
        attempt,
      });
      return null;
    }

    authFlowTrace('log', flow, 'profile_server_check_confirmed', {
      uid: shortId(user.uid),
      collectionName,
      attempt,
    });
    return profile;
  } catch (error) {
    authFlowTrace('warn', flow, 'profile_server_check_failed', {
      uid: shortId(user.uid),
      collectionName,
      attempt,
      code: error?.code || error?.name || 'unknown',
    });
    return null;
  }
}

async function writeRoleProfile({
  user,
  collectionName,
  requestedRole,
  buildProfile,
  normalizedEmail,
  flow,
}) {
  const profile = buildProfile(user, normalizedEmail);
  const profileRef = doc(db, collectionName, user.uid);
  let lastError = null;

  for (let index = 0; index < PROFILE_WRITE_RETRY_DELAYS_MS.length; index += 1) {
    const attempt = index + 1;
    const retryDelayMs = PROFILE_WRITE_RETRY_DELAYS_MS[index];

    if (retryDelayMs > 0) {
      authFlowTrace('warn', flow, 'profile_write_retry_scheduled', {
        uid: shortId(user.uid),
        collectionName,
        attempt,
        retryDelayMs,
        previousCode: lastError?.code || lastError?.name || 'unknown',
      });
      await sleep(retryDelayMs);
    }

    try {
      await refreshRegistrationAuth(
        user,
        flow,
        attempt,
        attempt === 1 ? 'initial_profile_write' : 'profile_write_retry'
      );

      authFlowTrace('log', flow, 'profile_write_started', {
        uid: shortId(user.uid),
        collectionName,
        attempt,
      });

      // merge:true makes this operation idempotent and prevents a retry from
      // erasing fields already completed by a parallel/recovered registration.
      await setDoc(profileRef, profile, { merge: true });

      authFlowTrace('log', flow, 'profile_write_succeeded', {
        uid: shortId(user.uid),
        collectionName,
        attempt,
      });
      return profile;
    } catch (error) {
      if (error?.code === 'auth/registration-session-mismatch') {
        throw error;
      }

      lastError = error;
      authFlowTrace('warn', flow, 'profile_write_attempt_failed', {
        uid: shortId(user.uid),
        collectionName,
        attempt,
        code: error?.code || error?.name || 'unknown',
      });

      // A concurrent or ambiguously acknowledged write may already exist on the
      // server. Confirm the authoritative document before retrying or surfacing
      // any error. Never delete Firebase Auth as compensation.
      const confirmedProfile = await confirmRoleProfileFromServer(
        user,
        collectionName,
        flow,
        attempt
      );
      if (confirmedProfile) {
        authFlowTrace('log', flow, 'profile_write_reconciled', {
          uid: shortId(user.uid),
          collectionName,
          attempt,
        });
        return confirmedProfile;
      }
    }
  }

  authFlowTrace('error', flow, 'profile_provisioning_failed', {
    uid: shortId(user.uid),
    collectionName,
    attempts: PROFILE_WRITE_RETRY_DELAYS_MS.length,
    code: lastError?.code || lastError?.name || 'unknown',
    authAccountPreserved: true,
  });
  throw profileProvisioningError(lastError, user, requestedRole, flow.flowId);
}

async function recoverAuthenticatedAccount({
  user,
  normalizedEmail,
  collectionName,
  requestedRole,
  buildProfile,
  flow,
  source,
}) {
  await refreshRegistrationAuth(user, flow, 0, source);
  const account = await resolveAccountRole(user.uid);

  authFlowTrace('log', flow, 'account_role_resolved', {
    uid: shortId(user.uid),
    accountRole: account.role,
    source,
  });

  if (account.role === requestedRole) {
    return {
      user,
      role: requestedRole,
      profile: account.profile,
      accountState: 'existing',
      flowId: flow.flowId,
    };
  }

  if (account.role !== 'unknown') {
    // Do not leave the device silently authenticated as the wrong account type.
    await clearAuthenticatedSession();
    throw accountRoleConflict(account.role, requestedRole);
  }

  const profile = await writeRoleProfile({
    user,
    collectionName,
    requestedRole,
    buildProfile,
    normalizedEmail,
    flow,
  });
  return {
    user,
    role: requestedRole,
    profile,
    accountState: 'recovered',
    flowId: flow.flowId,
  };
}

async function recoverExistingAccount({
  email,
  password,
  collectionName,
  requestedRole,
  buildProfile,
  flow,
}) {
  // The email already exists in Firebase Auth. Authenticate it with the password
  // entered by the user instead of leaving the registration screen blocked.
  authFlowTrace('log', flow, 'existing_auth_signin_started');
  const credential = await signInWithEmailAndPassword(auth, email, password);
  authFlowTrace('log', flow, 'existing_auth_signin_succeeded', {
    uid: shortId(credential.user.uid),
  });

  return recoverAuthenticatedAccount({
    user: credential.user,
    normalizedEmail: email,
    collectionName,
    requestedRole,
    buildProfile,
    flow,
    source: 'existing_email_signin',
  });
}

async function recoverCurrentAuthenticatedAccount({
  normalizedEmail,
  password,
  collectionName,
  requestedRole,
  buildProfile,
  flow,
}) {
  const currentUser = auth.currentUser;
  if (!currentUser) return null;
  if (normalizeEmail(currentUser.email) !== normalizedEmail) return null;

  authFlowTrace('log', flow, 'matching_auth_session_reauthentication_started', {
    uid: shortId(currentUser.uid),
  });
  const credential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
  authFlowTrace('log', flow, 'matching_auth_session_reauthentication_succeeded', {
    uid: shortId(credential.user.uid),
  });

  return recoverAuthenticatedAccount({
    user: credential.user,
    normalizedEmail,
    collectionName,
    requestedRole,
    buildProfile,
    flow,
    source: 'matching_current_session',
  });
}

async function createAccountWithProfileInternal({
  normalizedEmail,
  password,
  collectionName,
  requestedRole,
  buildProfile,
  flow,
}) {
  const currentAccountResult = await recoverCurrentAuthenticatedAccount({
    normalizedEmail,
    password,
    collectionName,
    requestedRole,
    buildProfile,
    flow,
  });
  if (currentAccountResult) return currentAccountResult;

  // Registration may be opened while another test account is still signed in.
  // Clean only a different account. A matching account is repaired above without
  // signing out or generating another UID.
  if (auth.currentUser) {
    authFlowTrace('log', flow, 'different_auth_session_cleanup_started', {
      uid: shortId(auth.currentUser.uid),
    });
    await clearAuthenticatedSession();
    authFlowTrace('log', flow, 'different_auth_session_cleanup_succeeded');
  } else {
    // A native background task can remain after an earlier process/session even
    // when Firebase Auth is already signed out. Never replace an active ride.
    await assertNoActiveRideAccountChange('register_preflight');
    await clearLocalDriverTracking('register_preflight');
  }

  let credential;
  try {
    authFlowTrace('log', flow, 'new_auth_create_started');
    credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
    authFlowTrace('log', flow, 'new_auth_create_succeeded', {
      uid: shortId(credential.user.uid),
    });
  } catch (error) {
    if (error?.code !== 'auth/email-already-in-use') {
      authFlowTrace('error', flow, 'new_auth_create_failed', {
        code: error?.code || error?.name || 'unknown',
      });
      throw error;
    }

    authFlowTrace('warn', flow, 'new_auth_email_already_exists');
    return recoverExistingAccount({
      email: normalizedEmail,
      password,
      collectionName,
      requestedRole,
      buildProfile,
      flow,
    });
  }

  const user = credential.user;
  const profile = await writeRoleProfile({
    user,
    collectionName,
    requestedRole,
    buildProfile,
    normalizedEmail,
    flow,
  });

  return {
    user,
    role: requestedRole,
    profile,
    accountState: 'created',
    flowId: flow.flowId,
  };
}

async function createAccountWithProfile({
  email,
  password,
  collectionName,
  requestedRole,
  buildProfile,
}) {
  const normalizedEmail = normalizeEmail(email);
  const flow = {
    flowId: nextAuthFlowId(requestedRole),
    requestedRole,
  };

  const inFlight = registrationOperations.get(normalizedEmail);
  if (inFlight) {
    if (inFlight.requestedRole !== requestedRole) {
      authFlowTrace('warn', flow, 'registration_role_collision_blocked', {
        activeRole: inFlight.requestedRole,
      });
      throw accountRoleConflict(inFlight.requestedRole, requestedRole);
    }

    authFlowTrace('log', flow, 'registration_duplicate_joined', {
      joinedFlowId: inFlight.flowId,
    });
    return inFlight.promise;
  }

  authFlowTrace('log', flow, 'registration_started', {
    collectionName,
  });

  const operation = createAccountWithProfileInternal({
    normalizedEmail,
    password,
    collectionName,
    requestedRole,
    buildProfile,
    flow,
  })
    .then((result) => {
      authFlowTrace('log', flow, 'registration_completed', {
        uid: shortId(result.user?.uid),
        accountState: result.accountState || 'unknown',
      });
      return result;
    })
    .catch((error) => {
      authFlowTrace('error', flow, 'registration_failed', {
        uid: shortId(auth.currentUser?.uid),
        code: error?.code || error?.name || 'unknown',
        originalCode: error?.originalCode || null,
        authAccountPreserved: error?.code === 'auth/profile-provisioning-failed',
      });
      throw error;
    })
    .finally(() => {
      const activeOperation = registrationOperations.get(normalizedEmail);
      if (activeOperation?.flowId === flow.flowId) {
        registrationOperations.delete(normalizedEmail);
      }
      authFlowTrace('log', flow, 'registration_finished');
    });

  registrationOperations.set(normalizedEmail, {
    requestedRole,
    flowId: flow.flowId,
    promise: operation,
  });
  return operation;
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
