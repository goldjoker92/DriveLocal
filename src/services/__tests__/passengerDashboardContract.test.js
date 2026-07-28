const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('passenger dashboard client contract', () => {
  it('renders the requested greeting and complete account dashboard', () => {
    const home = source('src/app/(passenger)/passenger-home.jsx');

    expect(home).toContain('Olá, ${firstName} 👋');
    expect(home).toContain('Pronto para sua próxima corrida?');
    expect(home).toContain('PEDIR CORRIDA');
    expect(home).toContain('MINHA CONTA');
    expect(home).toContain('Meus dados');
    expect(home).toContain('Histórico de corridas');
    expect(home).toContain('AJUDA E INFORMAÇÕES');
    expect(home).toContain('Política de Privacidade');
    expect(home).toContain('Termos de Uso');
    expect(home).toContain('Excluir conta e dados');
    expect(home).toContain('SAIR DA CONTA');
  });

  it('keeps active ride recovery and wires every dashboard action', () => {
    const home = source('src/app/(passenger)/passenger-home.jsx');

    expect(home).toContain("router.push('/request-ride')");
    expect(home).toContain("navigate('/passenger-profile', 'open_profile')");
    expect(home).toContain("navigate('/passenger-history', 'open_history')");
    expect(home).toContain("pathname: '/support-center'");
    expect(home).toContain("params: { source: 'passenger_home' }");
    expect(home).toContain('PUBLIC_POLICY_LINKS.privacyPolicyUrl');
    expect(home).toContain('PUBLIC_POLICY_LINKS.termsOfUseUrl');
    expect(home).toContain("router.push('/privacy-center')");
    expect(home).toContain('await logoutUser()');
    expect(home).toContain("pathname: '/searching'");
  });

  it('provides real owned history and read-only passenger data screens', () => {
    const service = source('src/services/passengerService.js');
    const history = source('src/app/(passenger)/passenger-history.jsx');
    const profile = source('src/app/(passenger)/passenger-profile.jsx');

    expect(service).toContain("where('passengerId', '==', uid)");
    expect(service).toContain('queryLimit(PASSENGER_HISTORY_READ_LIMIT)');
    expect(history).toContain('getPassengerRideHistory(uid)');
    expect(history).toContain('sortPassengerRideHistory(result)');
    expect(history).toContain('RefreshControl');
    expect(profile).toContain('getPassenger(uid)');
    expect(profile).toContain('Informações cadastradas na sua conta');
    expect(profile).not.toContain('updateDoc(');
    expect(profile).not.toContain('setDoc(');
  });

  it('adds privacy-safe traces and reusable haptic press feedback', () => {
    const home = source('src/app/(passenger)/passenger-home.jsx');
    const history = source('src/app/(passenger)/passenger-history.jsx');
    const button = source('src/components/AppButton.jsx');
    const logger = source('src/utils/clientRideLog.js');

    expect(home).toContain('ride.passenger_home.logout_succeeded');
    expect(history).toContain('ride.passenger_history.load_succeeded');
    expect(logger).toContain('itemCount: safeNumber(fields.itemCount)');
    expect(logger).toContain('route: safeString(fields.route, 96)');
    expect(button).toContain("import * as Haptics from 'expo-haptics'");
    expect(button).toContain('Animated.spring(scale');
    expect(button).toContain("haptic = 'light'");
    expect(button).toContain('pressScale = true');
    expect(home).toContain('haptic="medium"');
    expect(home).toContain('haptic="warning"');
  });
});
