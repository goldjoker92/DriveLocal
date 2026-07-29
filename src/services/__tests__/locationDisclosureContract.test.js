const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('Google Play prominent location disclosure contract', () => {
  test('shows the complete driver background-location disclosure before Android', () => {
    const context = source('src/contexts/LocationDisclosureContext.jsx');

    expect(context).toContain('A DriveLocal coleta dados de localização');
    expect(context).toContain('mesmo quando o app estiver fechado ou não estiver em uso');
    expect(context).toContain('despacho de corridas');
    expect(context).toContain('envio de ofertas próximas');
    expect(context).toContain('acompanhamento do motorista pelo passageiro');
    expect(context).toContain('O rastreamento para quando você fica indisponível');
    expect(context).toContain('A localização não é usada para anúncios');
    expect(context).toContain('Ao tocar em “Continuar”, a solicitação oficial do Android será exibida em seguida.');
    expect(context.indexOf("traceDisclosure('accepted'")) .toBeLessThan(
      context.indexOf('requestLocationPermissions({')
    );
  });

  test('keeps passenger location foreground-only and offers manual entry', () => {
    const context = source('src/contexts/LocationDisclosureContext.jsx');
    const permissions = source('src/services/locationPermissionService.js');

    expect(context).toContain('PASSAGEIRO · LOCALIZAÇÃO DURANTE O USO');
    expect(context).toContain('A localização do passageiro não é acompanhada em segundo plano');
    expect(context).toContain('Você também pode informar o endereço manualmente');
    expect(permissions).toContain('if (selectedRole === LOCATION_ROLE.PASSENGER)');
    expect(permissions).toContain("stage: 'foreground'");
    expect(permissions).toContain('Location.requestBackgroundPermissionsAsync()');
  });

  test('runs after authentication and before passenger or approved-driver redirect', () => {
    const login = source('src/app/(auth)/email-login.jsx');

    expect(login).toContain('useLocationDisclosure()');
    expect(login).toContain("source: 'email_login'");
    expect(login).toContain("trigger: 'post_authentication'");
    expect(login).toContain("result?.role === 'driver' && result?.driver?.verificationStatus === 'approved'");

    const disclosure = login.indexOf('await runPostLoginLocationFlow(result)');
    expect(disclosure).toBeGreaterThan(-1);
    expect(disclosure).toBeLessThan(login.indexOf("if (result.role === 'driver')"));
    expect(disclosure).toBeLessThan(login.indexOf("if (result.role === 'passenger')"));
  });

  test('keeps location diagnostics privacy-safe and traceable', () => {
    const context = source('src/contexts/LocationDisclosureContext.jsx');
    const permissions = source('src/services/locationPermissionService.js');

    expect(context).toContain('[LOCATION_DISCLOSURE]');
    expect(context).toContain("traceDisclosure('presented'");
    expect(context).toContain("traceDisclosure('deferred'");
    expect(context).toContain("'permission_flow_completed'");
    expect(permissions).toContain('[LOCATION_PERMISSION]');
    expect(permissions).toContain("'native_prompt.opening'");
    expect(permissions).not.toContain('latitude');
    expect(permissions).not.toContain('longitude');
    expect(permissions).not.toContain('currentUser');
    expect(context).not.toContain('currentUser');
  });

  test('mounts one global provider so every auth role uses the same modal', () => {
    const layout = source('src/app/_layout.jsx');

    expect(layout).toContain("import { LocationDisclosureProvider } from '../contexts/LocationDisclosureContext'");
    expect(layout).toContain('<LocationDisclosureProvider>');
    expect(layout).toContain('</LocationDisclosureProvider>');
  });
});
