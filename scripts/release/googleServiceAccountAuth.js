'use strict';

const crypto = require('crypto');
const fs = require('fs');

const TOKEN_AUDIENCE = 'https://oauth2.googleapis.com/token';
const DEFAULT_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

function base64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function readServiceAccount(expectedProjectId) {
  const filePath = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  if (!filePath) throw new Error('missing GOOGLE_APPLICATION_CREDENTIALS');
  if (!fs.existsSync(filePath)) throw new Error('service account file not found');

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`invalid service account JSON: ${error.message}`);
  }

  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('service account JSON is missing client_email or private_key');
  }

  if (expectedProjectId && serviceAccount.project_id !== expectedProjectId) {
    throw new Error(
      `service account project ${serviceAccount.project_id || 'unknown'} does not match ${expectedProjectId}`
    );
  }

  return serviceAccount;
}

async function getServiceAccountAccessToken({ expectedProjectId, scope = DEFAULT_SCOPE } = {}) {
  const serviceAccount = readServiceAccount(expectedProjectId);
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope,
    aud: TOKEN_AUDIENCE,
    iat: now,
    exp: now + 3600,
  }));
  const unsignedJwt = `${header}.${payload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsignedJwt), serviceAccount.private_key);
  const assertion = `${unsignedJwt}.${base64Url(signature)}`;

  const response = await fetch(TOKEN_AUDIENCE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    const reason = body?.error_description || body?.error || `HTTP_${response.status}`;
    throw new Error(`service account token request failed: ${String(reason).slice(0, 160)}`);
  }

  return body.access_token;
}

module.exports = {
  DEFAULT_SCOPE,
  readServiceAccount,
  getServiceAccountAccessToken,
};
