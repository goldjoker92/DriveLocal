'use strict';

// Public legal/support URLs embedded in the Expo manifest.
//
// These URLs are deliberately supplied by the build environment instead of being
// invented or committed as placeholders. Production EAS builds fail closed until
// all three HTTPS resources exist. DEV commands remain usable so the screens can
// be implemented and tested before the public pages are published.

const POLICY_ENV_KEYS = Object.freeze({
  privacyPolicyUrl: 'PRIVACY_POLICY_URL',
  termsOfUseUrl: 'TERMS_OF_USE_URL',
  accountDeletionWebUrl: 'ACCOUNT_DELETION_WEB_URL',
});

function normalizeHttpsUrl(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  let parsed;
  try {
    parsed = new URL(text);
  } catch (_error) {
    return null;
  }

  if (parsed.protocol !== 'https:') return null;
  if (!parsed.hostname || parsed.username || parsed.password) return null;
  return parsed.toString();
}

function loadPublicPolicyConfig({
  env = process.env,
  appEnvironment = 'production',
  easBuildActive = false,
} = {}) {
  const links = {};
  const missing = [];
  const invalid = [];

  for (const [field, envKey] of Object.entries(POLICY_ENV_KEYS)) {
    const rawValue = String(env[envKey] || '').trim();
    const normalized = normalizeHttpsUrl(rawValue);
    links[field] = normalized;
    if (!rawValue) missing.push(envKey);
    else if (!normalized) invalid.push(envKey);
  }

  const productionBuild = appEnvironment === 'production' && easBuildActive === true;
  if (productionBuild && (missing.length > 0 || invalid.length > 0)) {
    const details = [
      missing.length ? `missing: ${missing.join(', ')}` : null,
      invalid.length ? `invalid HTTPS URL: ${invalid.join(', ')}` : null,
    ].filter(Boolean).join('; ');
    throw new Error(`[public-policy] Production EAS build blocked (${details}).`);
  }

  return Object.freeze({
    links: Object.freeze(links),
    configured: missing.length === 0 && invalid.length === 0,
    missing: Object.freeze(missing),
    invalid: Object.freeze(invalid),
  });
}

module.exports = {
  POLICY_ENV_KEYS,
  normalizeHttpsUrl,
  loadPublicPolicyConfig,
};
