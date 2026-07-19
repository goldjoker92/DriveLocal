// Driver email registration. New emails create an account; an existing email
// with the correct password reconnects and repairs a missing driver profile.

import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { registerDriver } from '../../services/authService';
import { useDriverRedirect } from '../../hooks/useDriverRedirect';
import { registrationErrorMessage } from '../../utils/authErrorMessage';

export default function EmailRegister() {
  const router = useRouter();
  const redirectDriver = useDriverRedirect();
  const params = useLocalSearchParams();
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

      // Clicking "Criar" with an existing valid driver account behaves like a
      // normal reconnection and preserves its current onboarding/approval state.
      if (result.accountState === 'existing') {
        redirectDriver(result.profile);
        return;
      }

      // Brand-new and repaired orphan accounts start the normal onboarding.
      router.replace('/(driver)/onboarding');
    } catch (e) {
      console.log('[AUTH_FLOW] register error', e.code || e.message);
      setError(registrationErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Criar conta" onBack={() => router.back()} />
        <AppCard>
          <AppInput
            label="E-mail"
            value={email}
            onChangeText={setEmail}
            placeholder="voce@email.com"
            keyboardType="email-address"
          />
          <AppInput
            label="Senha"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
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
      </ScrollView>
    </SafeAreaView>
  );
}
