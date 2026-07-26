import Constants from 'expo-constants';

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

export const PUBLIC_POLICY_LINKS = Object.freeze({
  privacyPolicyUrl: safeHttpsUrl(links.privacyPolicyUrl),
  termsOfUseUrl: safeHttpsUrl(links.termsOfUseUrl),
  accountDeletionWebUrl: safeHttpsUrl(links.accountDeletionWebUrl),
});

export function publicPolicyLinksConfigured() {
  return Object.values(PUBLIC_POLICY_LINKS).every(Boolean);
}
