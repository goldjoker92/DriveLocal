'use strict';

// End-to-end Firebase PROD smoke test for closed-test releases.
//
// It proves that a brand-new email/password user can be created in
// drivelocal-prod, that the authenticated user can write and read the exact role
// profile expected by the mobile app, then removes both the Firestore document
// and Firebase Auth account. It never logs email, password, token or API key.
//
// Required environment variables:
//   GOOGLE_SERVICES_JSON=/secure/path/google-services.prod.json
//   PROD_AUTH_SMOKE_EMAIL_TEMPLATE=qa+drivelocal-{{RUN_ID}}@example.com
//   PROD_AUTH_SMOKE_PASSWORD=<strong test password>
//   CONFIRM_PRODUCTION_AUTH_SMOKE=DRIVELOCAL_PRODUCTION
//
// Optional:
//   PROD_AUTH_SMOKE_ROLES=passenger,driver

const { loadFirebaseBuildConfig } = require('../build/firebaseBuildConfig');

const REQUIRED_CONFIRMATION = 'DRIVELOCAL_PRODUCTION';
const EXPECTED_PROJECT_ID = 'drivelocal-prod';
const DEFAULT_ROLES = Object.freeze(['passenger', 'driver']);

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
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

  return { emailTemplate, password, roles };
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

async function firebaseAuthRequest(apiKey, method, payload) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:${method}?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
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

function boolValue(value) {
  return { booleanValue: Boolean(value) };
}

function timestampValue() {
  return { timestampValue: new Date().toISOString() };
}

function roleProfile(role, uid, email) {
  if (role === 'passenger') {
    return {
      uid: stringValue(uid),
      email: stringValue(email),
      fullName: stringValue('Closed Test Smoke'),
      whatsApp: stringValue('00000000000'),
      role: stringValue('passenger'),
      serviceAreaId: stringValue('HORIZONTE_CE_BR'),
      createdAt: timestampValue(),
      updatedAt: timestampValue(),
    };
  }

  return {
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
    availabilityUpdatedAt: timestampValue(),
    createdAt: timestampValue(),
    updatedAt: timestampValue(),
    smokeTest: boolValue(true),
  };
}

function documentUrl(projectId, collectionName, uid) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}`
    + `/databases/(default)/documents/${encodeURIComponent(collectionName)}/${encodeURIComponent(uid)}`;
}

async function firestoreRequest(url, idToken, method, body) {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${idToken}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (method === 'DELETE' && response.status === 404) return {};
  return readJsonResponse(response);
}

function sanitizedApiError(error) {
  const message = String(error?.apiMessage || error?.message || 'unknown');
  if (message.includes('OPERATION_NOT_ALLOWED')) return 'EMAIL_PASSWORD_PROVIDER_DISABLED';
  if (message.includes('API_KEY_INVALID')) return 'INVALID_PRODUCTION_API_KEY';
  if (message.includes('EMAIL_EXISTS')) return 'SMOKE_EMAIL_ALREADY_EXISTS';
  if (message.includes('PERMISSION_DENIED')) return 'FIRESTORE_PERMISSION_DENIED';
  return message.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '[email-redacted]').slice(0, 180);
}

async function runRoleSmoke({ role, email, password, firebaseConfig }) {
  const collectionName = role === 'passenger' ? 'passengers' : 'drivers';
  let idToken = null;
  let uid = null;
  let documentCreated = false;

  console.log(`[PROD_AUTH_SMOKE] role=${role} stage=auth_create started`);

  try {
    const authResult = await firebaseAuthRequest(firebaseConfig.apiKey, 'signUp', {
      email,
      password,
      returnSecureToken: true,
    });

    idToken = authResult.idToken;
    uid = authResult.localId;
    if (!idToken || !uid) throw new Error('AUTH_RESPONSE_MISSING_TOKEN_OR_UID');
    console.log(`[PROD_AUTH_SMOKE] role=${role} stage=auth_create OK`);

    const url = documentUrl(firebaseConfig.projectId, collectionName, uid);
    console.log(`[PROD_AUTH_SMOKE] role=${role} stage=profile_write started`);
    await firestoreRequest(url, idToken, 'PATCH', {
      fields: roleProfile(role, uid, email),
    });
    documentCreated = true;
    console.log(`[PROD_AUTH_SMOKE] role=${role} stage=profile_write OK`);

    console.log(`[PROD_AUTH_SMOKE] role=${role} stage=profile_read started`);
    const readBack = await firestoreRequest(url, idToken, 'GET');
    if (!readBack?.fields?.uid || readBack.fields.uid.stringValue !== uid) {
      throw new Error('PROFILE_READBACK_UID_MISMATCH');
    }
    console.log(`[PROD_AUTH_SMOKE] role=${role} stage=profile_read OK`);
  } finally {
    if (idToken && uid && documentCreated) {
      try {
        const url = documentUrl(firebaseConfig.projectId, collectionName, uid);
        await firestoreRequest(url, idToken, 'DELETE');
        console.log(`[PROD_AUTH_SMOKE] role=${role} stage=profile_cleanup OK`);
      } catch (cleanupError) {
        console.error(
          `[PROD_AUTH_SMOKE] role=${role} stage=profile_cleanup FAILED code=${sanitizedApiError(cleanupError)}`
        );
      }
    }

    if (idToken) {
      try {
        await firebaseAuthRequest(firebaseConfig.apiKey, 'delete', { idToken });
        console.log(`[PROD_AUTH_SMOKE] role=${role} stage=auth_cleanup OK`);
      } catch (cleanupError) {
        console.error(
          `[PROD_AUTH_SMOKE] role=${role} stage=auth_cleanup FAILED code=${sanitizedApiError(cleanupError)}`
        );
      }
    }
  }
}

async function main() {
  const { emailTemplate, password, roles } = assertSafeConfiguration();
  const build = loadFirebaseBuildConfig({
    env: { ...process.env, APP_ENV: 'prod', EAS_BUILD: '1' },
    packageName: 'com.drivelocal.app',
  });

  if (build.firebaseProjectId !== EXPECTED_PROJECT_ID) {
    throw new Error(`refusing project ${build.firebaseProjectId}; expected ${EXPECTED_PROJECT_ID}`);
  }

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  console.log(
    `[PROD_AUTH_SMOKE] project=${build.firebaseProjectId} roles=${roles.join(',')} started`
  );

  for (const role of roles) {
    const email = emailTemplate.replace('{{RUN_ID}}', `${role}-${runId}`);
    try {
      await runRoleSmoke({ role, email, password, firebaseConfig: build.firebaseConfig });
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
