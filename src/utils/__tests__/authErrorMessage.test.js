import {
  loginErrorMessage,
  registrationErrorMessage,
} from '../authErrorMessage';

describe('authErrorMessage', () => {
  test.each([
    'auth/operation-not-allowed',
    'auth/configuration-not-found',
    'auth/app-not-authorized',
    'auth/invalid-api-key',
  ])('maps %s to an actionable production configuration message', (code) => {
    expect(registrationErrorMessage({ code })).toContain('AUTH-PROD-CONFIG');
    expect(loginErrorMessage({ code })).toContain('AUTH-PROD-CONFIG');
  });

  test('does not blame the passenger for an unknown backend failure', () => {
    expect(registrationErrorMessage({ code: 'auth/unexpected-production-failure' }))
      .toBe('Não foi possível concluir o acesso agora. Código: AUTH-UNKNOWN.');
  });

  test('keeps profile permission failures recoverable with the same Auth account', () => {
    const message = registrationErrorMessage({ code: 'firestore/permission-denied' });

    expect(message).toContain('PROFILE-RETRY');
    expect(message).toContain('mesmo e-mail e senha');
    expect(message).not.toContain('PROFILE-PERMISSION');
  });

  test('explains that Auth is preserved after profile provisioning retries fail', () => {
    const message = registrationErrorMessage({ code: 'auth/profile-provisioning-failed' });

    expect(message).toContain('Sua conta foi preservada');
    expect(message).toContain('PROFILE-RETRY');
  });

  test('keeps invalid credentials understandable during login', () => {
    expect(loginErrorMessage({ code: 'auth/invalid-credential' }))
      .toBe('E-mail ou senha incorretos.');
  });
});
