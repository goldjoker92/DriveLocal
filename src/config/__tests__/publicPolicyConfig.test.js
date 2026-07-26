const {
  normalizeHttpsUrl,
  loadPublicPolicyConfig,
} = require('../../../scripts/build/publicPolicyConfig');

describe('public policy build configuration', () => {
  const validEnv = {
    PRIVACY_POLICY_URL: 'https://drivelocal.example/privacy',
    TERMS_OF_USE_URL: 'https://drivelocal.example/terms',
    ACCOUNT_DELETION_WEB_URL: 'https://drivelocal.example/delete-account',
  };

  it('accepts and normalizes three HTTPS resources', () => {
    const result = loadPublicPolicyConfig({
      env: validEnv,
      appEnvironment: 'production',
      easBuildActive: true,
    });

    expect(result.configured).toBe(true);
    expect(result.links).toMatchObject({
      privacyPolicyUrl: 'https://drivelocal.example/privacy',
      termsOfUseUrl: 'https://drivelocal.example/terms',
      accountDeletionWebUrl: 'https://drivelocal.example/delete-account',
    });
  });

  it('blocks a production EAS build when a public deletion resource is missing', () => {
    const env = { ...validEnv };
    delete env.ACCOUNT_DELETION_WEB_URL;

    expect(() => loadPublicPolicyConfig({
      env,
      appEnvironment: 'production',
      easBuildActive: true,
    })).toThrow(/ACCOUNT_DELETION_WEB_URL/);
  });

  it('rejects non-HTTPS, credentialed and malformed URLs', () => {
    expect(normalizeHttpsUrl('http://example.com/privacy')).toBeNull();
    expect(normalizeHttpsUrl('https://user:pass@example.com/privacy')).toBeNull();
    expect(normalizeHttpsUrl('not-a-url')).toBeNull();
  });

  it('keeps local DEV usable while reporting incomplete links', () => {
    const result = loadPublicPolicyConfig({
      env: {},
      appEnvironment: 'development',
      easBuildActive: false,
    });

    expect(result.configured).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining([
      'PRIVACY_POLICY_URL',
      'TERMS_OF_USE_URL',
      'ACCOUNT_DELETION_WEB_URL',
    ]));
  });
});
