const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('registration, login and notification regressions', () => {
  it('allows only the validated initial driver profile written by registerDriver', () => {
    const rules = source('backend/firebase/rules/firestore.rules');

    expect(rules).toContain("'verificationStatus'");
    expect(rules).toContain("'documentsStatus'");
    expect(rules).toContain("'selfieStatus'");
    expect(rules).toContain("'duplicateCheckStatus'");
    expect(rules).toContain('driverInitialCreateValid(driverId)');
    expect(rules).toContain("request.resource.data.verificationStatus == 'draft'");
    expect(rules).toContain("request.resource.data.serviceAreaId == 'HORIZONTE_CE_BR'");
  });

  it('rolls back only a newly created Auth user when its Firestore profile fails', () => {
    const authService = source('src/services/authService.js');

    expect(authService).toContain('await deleteUser(user)');
    expect(authService).toContain("accountState: 'created'");
    expect(authService).toContain('Existing accounts are never deleted by the recovery path');
  });

  it('reconnects an existing email and repairs an orphan Auth account', () => {
    const authService = source('src/services/authService.js');

    expect(authService).toContain("error?.code !== 'auth/email-already-in-use'");
    expect(authService).toContain('signInWithEmailAndPassword(auth, email, password)');
    expect(authService).toContain('resolveAccountRole(user.uid)');
    expect(authService).toContain("accountState: 'existing'");
    expect(authService).toContain("accountState: 'recovered'");
    expect(authService).toContain("error.code = 'auth/account-role-conflict'");
  });

  it('clears stale device sessions before creating or switching accounts', () => {
    const authService = source('src/services/authService.js');

    expect(authService).toContain('async function clearAuthenticatedSession()');
    expect(authService).toContain('if (auth.currentUser)');
    expect(authService).toContain('await clearAuthenticatedSession()');
    expect(authService).toContain('await disablePushNotifications()');
  });

  it('normalizes emails and displays actionable registration errors', () => {
    const authService = source('src/services/authService.js');
    const messages = source('src/utils/authErrorMessage.js');
    const driverRegister = source('src/app/(auth)/email-register.jsx');
    const passengerRegister = source('src/app/(auth)/passenger-register.jsx');
    const login = source('src/app/(auth)/email-login.jsx');

    expect(authService).toContain("trim().toLowerCase()");
    expect(messages).toContain('Este e-mail já possui uma conta');
    expect(messages).toContain("code === 'auth/account-role-conflict'");
    expect(driverRegister).toContain("result.accountState === 'existing'");
    expect(driverRegister).toContain('redirectDriver(result.profile)');
    expect(passengerRegister).toContain("roleIntent: 'passenger'");
    expect(login).toContain("passengerIntent ? 'Criar conta de passageiro'");
  });

  it('offers a real Firebase password-reset flow from login', () => {
    const resetService = source('src/services/passwordResetService.js');
    const login = source('src/app/(auth)/email-login.jsx');

    expect(resetService).toContain('sendPasswordResetEmail');
    expect(resetService).toContain('trim().toLowerCase()');
    expect(login).toContain('requestPasswordReset(email)');
    expect(login).toContain('Esqueci minha senha');
  });

  it('keeps the Expo SDK 56 default-sound warning fixed', () => {
    const notifications = source('src/services/notificationsService.js');
    const passengerLogger = source('src/utils/clientRideLog.js');

    // Match an executable object property only, not explanatory comments.
    expect(notifications).not.toMatch(/^\s*sound\s*:\s*['"]default['"]\s*,?/m);
    expect(passengerLogger).toContain('export function logRideClientEvent');
  });
});
