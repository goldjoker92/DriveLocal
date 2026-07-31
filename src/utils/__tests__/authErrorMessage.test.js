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

  test('maps Firestore profile permissions separately from authentication', () => {
    expect(registrationErrorMessage({ code: 'firestore/permission-denied' }))
      .toContain('PROFILE-PERMISSION');
  });

  test('keeps invalid credentials understandable during login', () => {
    expect(loginErrorMessage({ code: 'auth/invalid-credential' }))
      .toBe('E-mail ou senha incorretos.');
  });
});
