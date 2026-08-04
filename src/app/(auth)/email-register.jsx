// Driver email registration. New emails create an account; an existing email
// with the correct password reconnects and repairs a missing driver profile.

import { useRef, useState } from 'react';
import { Text } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import KeyboardSafeScreen from '../../components/KeyboardSafeScreen';
import { colors } from '../../constants/colors';
import { typography, fontFamily } from '../../constants/typography';
import { auth } from '../../config/firebase';
import { registerDriver } from '../../services/authService';
import { useDriverRedirect } from '../../hooks/useDriverRedirect';
import { registrationErrorMessage } from '../../utils/authErrorMessage';
import { goBackOrReplace } from '../../utils/navigation';

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function authTrace(stage, details = {}) {
  console.log('[AUTH_FLOW]', {
    scope: 'driver_registration_screen',
    stage,
    projectId: auth?.app?.options?.projectId || 'unknown',
    atMs: Date.now(),
    ...details,
  });
}

export default function EmailRegister() {
  const router = useRouter();
  const redirectDriver = useDriverRedirect();
  const params = useLocalSearchParams();
  const registrationLockRef = useRef(false);
  const passwordRef = useRef(null);
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleRegister() {
    if (registrationLockRef.current) {
      authTrace('duplicate_submit_blocked');
      return;
    }

    setError('');

    if (!validEmail(email)) {
      setError('Informe um e-mail válido.');
      return;
    }

    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    // A synchronous ref lock blocks repeated taps and keyboard submissions before
    // React has time to render the disabled state.
    registrationLockRef.current = true;
    setLoading(true);

    try {
      authTrace('register_started', {
        roleIntent: params.roleIntent || 'driver',
      });
      const result = await registerDriver(email, password);
      authTrace('register_completed', {
        accountState: result.accountState || 'unknown',
        flowId: result.flowId || 'unknown',
      });

      if (result.accountState === 'existing') {
        redirectDriver(result.profile);
        return;
      }

      router.replace('/(driver)/onboarding');
    } catch (e) {
      authTrace('register_failed', {
        code: e?.code || 'unknown',
        originalCode: e?.originalCode || null,
        flowId: e?.flowId || 'unknown',
        authAccountPreserved: e?.authAccountPreserved === true,
      });
      setError(registrationErrorMessage(e));
    } finally {
      registrationLockRef.current = false;
      setLoading(false);
    }
  }

  return (
    <KeyboardSafeScreen>
      <Header title="Criar conta" onBack={() => goBackOrReplace(router, '/')} />
      <AppCard>
        <AppInput
          label="E-mail"
          value={email}
          onChangeText={setEmail}
          placeholder="voce@email.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="emailAddress"
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
        <AppInput
          ref={passwordRef}
          label="Senha"
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          secureTextEntry
          textContentType="newPassword"
          returnKeyType="done"
          onSubmitEditing={handleRegister}
        />
        {error ? (
          <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text>
        ) : null}
        <AppButton
          title={loading ? 'Criando conta...' : 'Continuar'}
          onPress={handleRegister}
          disabled={loading}
        />
      </AppCard>

      <AppButton
        title="Já tenho conta"
        variant="ghost"
        disabled={loading}
        onPress={() =>
          router.push({
            pathname: '/email-login',
            params: { email: email.trim(), roleIntent: 'driver' },
          })
        }
      />
    </KeyboardSafeScreen>
  );
}
