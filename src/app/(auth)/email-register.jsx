// Email register (route "/email-register"). Iteration 1A — real Firebase Auth.
// Creates the Firebase user + drivers/{uid} document, then sends the driver to
// onboarding. WhatsApp OTP verification is a later step.

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

export default function EmailRegister() {
  const router = useRouter();
  const params = useLocalSearchParams();
  // Pre-fill email when coming from a failed login (VigiApp-style continuity).
  // roleIntent is driver-only for now; future Google login will use it too.
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleRegister() {
    setError('');
    setLoading(true);
    try {
      console.log('[AUTH_FLOW] registerDriver roleIntent=', params.roleIntent || 'driver');
      await registerDriver(email.trim(), password);
      router.replace('/(driver)/onboarding');
    } catch (e) {
      console.log('[AUTH_FLOW] register error', e.code || e.message);
      setError('Não foi possível criar a conta. Verifique o e-mail e a senha (mínimo 6 caracteres).');
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
            title={loading ? 'Criando...' : 'Continuar'}
            onPress={handleRegister}
            disabled={loading}
          />
        </AppCard>
      </ScrollView>
    </SafeAreaView>
  );
}
