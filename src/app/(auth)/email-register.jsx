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
import { registerDriver } from '../../services/authService';
import { useDriverRedirect } from '../../hooks/useDriverRedirect';
import { registrationErrorMessage } from '../../utils/authErrorMessage';
import { goBackOrReplace } from '../../utils/navigation';

export default function EmailRegister() {
  const router = useRouter();
  const redirectDriver = useDriverRedirect();
  const params = useLocalSearchParams();
  const passwordRef = useRef(null);
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleRegister() {
    setError('');
    setLoading(true);
    try {
      console.log('[AUTH_FLOW] registerDriver roleIntent=', params.roleIntent || 'driver');
      const result = await registerDriver(email, password);
      console.log('[AUTH_FLOW] registerDriver accountState=', result.accountState);

      if (result.accountState === 'existing') {
        redirectDriver(result.profile);
        return;
      }

      router.replace('/(driver)/onboarding');
    } catch (e) {
      console.log('[AUTH_FLOW] register error', e.code || e.message);
      setError(registrationErrorMessage(e));
    } finally {
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
          title={loading ? 'Acessando...' : 'Continuar'}
          onPress={handleRegister}
          disabled={loading}
        />
      </AppCard>

      <AppButton
        title="Já tenho conta"
        variant="ghost"
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
