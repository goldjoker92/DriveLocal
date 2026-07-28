import Constants from 'expo-constants';

import { LEGAL_URLS } from '../constants/legalUrls';

function manifestExtra() {
  return Constants.expoConfig?.extra
    || Constants.manifest?.extra
    || Constants.manifest2?.extra?.expoClient?.extra
    || {};
}

function safeHttpsUrl(value) {
  const text = String(value || '').trim();
  return /^https:\/\/[A-Za-z0-9.-]+(?:[/:?#][^\s]*)?$/i.test(text) ? text : null;
}

const links = manifestExtra().publicPolicyLinks || {};

// EAS build values remain authoritative. The committed Vercel URLs are a safe
// runtime fallback for local DEV, tests and already-installed development clients.
export const PUBLIC_POLICY_LINKS = Object.freeze({
  privacyPolicyUrl:
    safeHttpsUrl(links.privacyPolicyUrl) || LEGAL_URLS.privacyPolicyUrl,
  termsOfUseUrl:
    safeHttpsUrl(links.termsOfUseUrl) || LEGAL_URLS.termsOfUseUrl,
  accountDeletionWebUrl:
    safeHttpsUrl(links.accountDeletionWebUrl) || LEGAL_URLS.accountDeletionWebUrl,
});

export function publicPolicyLinksConfigured() {
  return Object.values(PUBLIC_POLICY_LINKS).every(Boolean);
}
