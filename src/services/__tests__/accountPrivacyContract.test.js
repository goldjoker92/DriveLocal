const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('account privacy client contracts', () => {
  it('requires password reauthentication before the deletion callable', () => {
    const service = source('src/services/accountDeletionService.js');
    const reauthIndex = service.indexOf('await reauthenticateWithCredential');
    const tokenIndex = service.indexOf('await user.getIdToken(true)');
    const callableIndex = service.indexOf("httpsCallable(functions, 'requestAccountDeletionSecure')");

    expect(reauthIndex).toBeGreaterThan(-1);
    expect(tokenIndex).toBeGreaterThan(reauthIndex);
    expect(callableIndex).toBeGreaterThan(tokenIndex);
    expect(service).toContain("confirmation: 'EXCLUIR'");
    expect(service).not.toContain('console.log(password');
    expect(service).not.toContain('console.warn(password');
  });

  it('renders a discoverable in-app deletion path with external resources', () => {
    const screen = source('src/app/(account)/privacy-center.jsx');

    expect(screen).toContain('POLÍTICA DE PRIVACIDADE');
    expect(screen).toContain('TERMOS DE USO');
    expect(screen).toContain('EXCLUSÃO FORA DO APLICATIVO');
    expect(screen).toContain('EXCLUIR MINHA CONTA');
    expect(screen).toContain('Digite EXCLUIR');
    expect(screen).toContain('Senha atual');
    expect(screen).toContain('requestAccountDeletion(password)');
    expect(screen).toContain('corrida ativa ou enquanto uma disputa estiver aberta');
  });

  it('exposes the privacy center from both user dashboards', () => {
    const passenger = source('src/app/(passenger)/passenger-home.jsx');
    const rootLayout = source('src/app/_layout.jsx');
    const shortcut = source('src/components/AccountPrivacyShortcut.jsx');

    expect(passenger).toContain("router.push('/privacy-center')");
    expect(rootLayout).toContain('<AccountPrivacyShortcut route={pathname} />');
    expect(shortcut).toContain("path.includes('driver-home')");
    expect(shortcut).toContain("router.push('/privacy-center')");
  });

  it('fails production closed until the three public URLs exist', () => {
    const config = source('app.config.js');
    const policy = source('scripts/build/publicPolicyConfig.js');

    expect(config).toContain('loadPublicPolicyConfig');
    expect(config).toContain('publicPolicyLinks: publicPolicy.links');
    expect(policy).toContain('PRIVACY_POLICY_URL');
    expect(policy).toContain('TERMS_OF_USE_URL');
    expect(policy).toContain('ACCOUNT_DELETION_WEB_URL');
    expect(policy).toContain('Production EAS build blocked');
  });
});
