'use strict';

// End-to-end Firebase PROD smoke test for closed-test releases.
//
// It proves that a brand-new email/password user can be created through the
// same public Auth API used by the Android app, then writes and reads the exact
// Firestore role profile under production security rules. Temporary profiles
// and Auth users are removed with the protected PROD service account.
//
// Required environment variables:
//   GOOGLE_SERVICES_JSON=/secure/path/google-services.prod.json
//   GOOGLE_APPLICATION_CREDENTIALS=/secure/path/service-account.prod.json
//   ANDROID_APP_SIGNING_SHA1=<Google Play app-signing SHA-1>
//   PROD_AUTH_SMOKE_EMAIL_TEMPLATE=qa+drivelocal-{{RUN_ID}}@example.com
//   PROD_AUTH_SMOKE_PASSWORD=<strong test password>
//   CONFIRM_PRODUCTION_AUTH_SMOKE=DRIVELOCAL_PRODUCTION
//
// Optional:
//   PROD_AUTH_SMOKE_ROLES=passenger,driver

const { loadFirebaseBuildConfig } = require('../build/firebaseBuildConfig');
const { getServiceAccountAccessToken } = require('./googleServiceAccountAuth');

const REQUIRED_CONFIRMATION = 'DRIVELOCAL_PRODUCTION';
const EXPECTED_PROJECT_ID = 'drivelocal-prod';
const ANDROID_PACKAGE = 'com.drivelocal.app';
const DEFAULT_ROLES = Object.freeze(['passenger', 'driver']);

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function normalizeSha1(value) {
  const normalized = String(value || '').replace(/:/g, '').trim().toUpperCase();
  if (!/^[A-F0-9]{40}$/.test(normalized)) {
    throw new Error('ANDROID_APP_SIGNING_SHA1 must be a valid SHA-1 fingerprint');
  }
  return normalized;
}

function assertSafeConfiguration() {
  if (process.env.CONFIRM_PRODUCTION_AUTH_SMOKE !== REQUIRED_CONFIRMATION) {
    throw new Error(
      `production smoke requires CONFIRM_PRODUCTION_AUTH_SMOKE=${REQUIRED_CONFIRMATION}`
    );
  }

  const emailTemplate = required('PROD_AUTH_SMOKE_EMAIL_TEMPLATE');
  if (!emailTemplate.includes('{{RUN_ID}}')) {
    throw new Error('PROD_AUTH_SMOKE_EMAIL_TEMPLATE must contain {{RUN_ID}}');
  }

  const password = required('PROD_AUTH_SMOKE_PASSWORD');
  if (password.length < 12) {
    throw new Error('PROD_AUTH_SMOKE_PASSWORD must contain at least 12 characters');
  }

  const roles = String(process.env.PROD_AUTH_SMOKE_ROLES || DEFAULT_ROLES.join(','))
    .split(',')
    .map((role) => role.trim())
    .filter(Boolean);

  if (!roles.length || roles.some((role) => !DEFAULT_ROLES.includes(role))) {
    throw new Error('PROD_AUTH_SMOKE_ROLES may contain only passenger and driver');
  }

  return {
    emailTemplate,
    password,
    roles,
    androidSigningSha1: normalizeSha1(required('ANDROID_APP_SIGNING_SHA1')),
  };
}

async function readJsonResponse(response) {
  const text = await response.text();
  let body = {};
  if (text) {
    try { body = JSON.parse(text); } catch (_error) { body = { raw: text.slice(0, 200) }; }
  }
  if (!response.ok) {
    const apiMessage = body?.error?.message || body?.error?.status || `HTTP_${response.status}`;
    const error = new Error(apiMessage);
    error.status = response.status;
    error.apiMessage = apiMessage;
    throw error;
  }
  return body;
}

async function firebaseSignUp({ apiKey, email, password, androidSigningSha1 }) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-android-package': ANDROID_PACKAGE,
        'x-android-cert': androidSigningSha1,
      },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  return readJsonResponse(response);
}

function stringValue(value) {
  return { stringValue: String(value) };
}

function nullValue() {
  return { nullValue: null };
}

function roleProfile(role, uid, email) {
  if (role === 'passenger') {
    return {
      fields: {
        uid: stringValue(uid),
        email: stringValue(email),
        fullName: stringValue('Closed Test Smoke'),
        whatsApp: stringValue('00000000000'),
        role: stringValue('passenger'),
        serviceAreaId: stringValue('HORIZONTE_CE_BR'),
      },
      serverTimestampFields: ['createdAt', 'updatedAt'],
    };
  }

  return {
    fields: {
      uid: stringValue(uid),
      email: stringValue(email),
      verificationStatus: stringValue('draft'),
      profileStatus: stringValue('incomplete'),
      vehicleStatus: stringValue('incomplete'),
      documentsStatus: stringValue('missing'),
      selfieStatus: stringValue('missing'),
      duplicateCheckStatus: stringValue('clear'),
      serviceAreaId: stringValue('HORIZONTE_CE_BR'),
      availabilityStatus: stringValue('offline'),
      availabilitySessionId: nullValue(),
    },
    serverTimestampFields: ['availabilityUpdatedAt', 'createdAt', 'updatedAt'],
  };
}

function documentName(projectId, collectionName, uid) {
  return `projects/${projectId}/databases/(default)/documents/${collectionName}/${uid}`;
}

function documentUrl(projectId, collectionName, uid) {
  return `https://firestore.googleapis.com/v1/${documentName(projectId, collectionName, uid)}`;
}

function commitUrl(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}`
    + '/databases/(default)/documents:commit';
}

async function createProfileUnderRules({ projectId, collectionName, uid, idToken, role, email }) {
  const profile = roleProfile(role, uid, email);
  const response = await fetch(commitUrl(projectId), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${idToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      writes: [{
        update: {
          name: documentName(projectId, collectionName, uid),
          fields: profile.fields,
        },
        currentDocument: { exists: false },
        updateTransforms: profile.serverTimestampFields.map((fieldPath) => ({
          fieldPath,
          setToServerValue: 'REQUEST_TIME',
        })),
      }],
    }),
  });
  return readJsonResponse(response);
}

async function readProfileUnderRules({ projectId, collectionName, uid, idToken }) {
  return readJsonResponse(await fetch(documentUrl(projectId, collectionName, uid), {
    headers: { authorization: `Bearer ${idToken}` },
  }));
}

async function deleteProfileAsAdmin({ projectId, collectionName, uid, accessToken }) {
  const response = await fetch(documentUrl(projectId, collectionName, uid), {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'x-goog-user-project': projectId,
    },
  });
  if (response.status === 404) return;
  await readJsonResponse(response);
}

async function deleteAuthUserAsAdmin({ projectId, uid, accessToken }) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts:delete`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        'x-goog-user-project': projectId,
      },
      body: JSON.stringify({ localId: uid }),
    }
  );
  await readJsonResponse(response);
}

function sanitizedApiError(error) {
  const message = String(error?.apiMessage || error?.message || 'unknown');
  if (message.includes('OPERATION_NOT_ALLOWED')) return 'EMAIL_PASSWORD_PROVIDER_DISABLED';
  if (message.includes('API_KEY_INVALID')) return 'INVALID_PRODUCTION_API_KEY';
  if (message.includes('API_KEY_ANDROID_APP_BLOCKED')) return 'ANDROID_KEY_RESTRICTION_MISMATCH';
  if (message.includes('EMAIL_EXISTS')) return 'SMOKE_EMAIL_ALREADY_EXISTS';
  if (message.includes('PERMISSION_DENIED')) return 'FIRESTORE_PERMISSION_DENIED';
  return message.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '[email-redacted]').slice(0, 180);
}

async function runRoleSmoke({
  role,
  email,
  password,
  firebaseConfig,
  androidSigningSha1,
  adminAccessToken,
}) {
  const projectId = firebaseConfig.projectId;
  const collectionName = role === 'passenger' ? 'passengers' : 'drivers';
  let idToken = null;
  let uid = null;
  let profileCreated = false;
  let primaryError = null;
  const cleanupErrors = [];

  console.log(`[PROD_AUTH_SMOKE] role=${role} stage=auth_create started`);

  try {
    const authResult = await firebaseSignUp({
      apiKey: firebaseConfig.apiKey,
      email,
      password,
      androidSigningSha1,
    });

    idToken = authResult.idToken;
    uid = authResult.localId;
    if (!idToken || !uid) throw new Error('AUTH_RESPONSE_MISSING_TOKEN_OR_UID');
    console.log(`[PROD_AUTH_SMOKE] role=${role} stage=auth_create OK`);

    console.log(`[PROD_AUTH_SMOKE] role=${role} stage=profile_write started`);
    await createProfileUnderRules({ projectId, collectionName, uid, idToken, role, email });
    profileCreated = true;
    console.log(`[PROD_AUTH_SMOKE] role=${role} stage=profile_write OK`);

    console.log(`[PROD_AUTH_SMOKE] role=${role} stage=profile_read started`);
    const readBack = await readProfileUnderRules({ projectId, collectionName, uid, idToken });
    if (!readBack?.fields?.uid || readBack.fields.uid.stringValue !== uid) {
      throw new Error('PROFILE_READBACK_UID_MISMATCH');
    }
    console.log(`[PROD_AUTH_SMOKE] role=${role} stage=profile_read OK`);
  } catch (error) {
    primaryError = error;
  } finally {
    if (uid && profileCreated) {
      try {
        await deleteProfileAsAdmin({ projectId, collectionName, uid, accessToken: adminAccessToken });
        console.log(`[PROD_AUTH_SMOKE] role=${role} stage=profile_cleanup OK`);
      } catch (error) {
        cleanupErrors.push(`PROFILE_CLEANUP_${sanitizedApiError(error)}`);
      }
    }

    if (uid) {
      try {
        await deleteAuthUserAsAdmin({ projectId, uid, accessToken: adminAccessToken });
        console.log(`[PROD_AUTH_SMOKE] role=${role} stage=auth_cleanup OK`);
      } catch (error) {
        cleanupErrors.push(`AUTH_CLEANUP_${sanitizedApiError(error)}`);
      }
    }
  }

  if (primaryError) throw primaryError;
  if (cleanupErrors.length) throw new Error(cleanupErrors.join(','));
}

async function main() {
  const { emailTemplate, password, roles, androidSigningSha1 } = assertSafeConfiguration();
  const build = loadFirebaseBuildConfig({
    env: { ...process.env, APP_ENV: 'prod', EAS_BUILD: '1' },
    packageName: ANDROID_PACKAGE,
  });

  if (build.firebaseProjectId !== EXPECTED_PROJECT_ID) {
    throw new Error(`refusing project ${build.firebaseProjectId}; expected ${EXPECTED_PROJECT_ID}`);
  }

  const adminAccessToken = await getServiceAccountAccessToken({
    expectedProjectId: EXPECTED_PROJECT_ID,
  });
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  console.log(
    `[PROD_AUTH_SMOKE] project=${build.firebaseProjectId} roles=${roles.join(',')} started`
  );

  for (const role of roles) {
    const email = emailTemplate.replace('{{RUN_ID}}', `${role}-${runId}`);
    try {
      await runRoleSmoke({
        role,
        email,
        password,
        firebaseConfig: build.firebaseConfig,
        androidSigningSha1,
        adminAccessToken,
      });
    } catch (error) {
      console.error(
        `[PROD_AUTH_SMOKE] role=${role} FAILED code=${sanitizedApiError(error)}`
      );
      process.exitCode = 1;
      return;
    }
  }

  console.log('[PROD_AUTH_SMOKE] ✅ PROD email/password + Firestore role profiles OK');
}

main().catch((error) => {
  console.error(`[PROD_AUTH_SMOKE] BLOCKED code=${sanitizedApiError(error)}`);
  process.exitCode = 1;
});
