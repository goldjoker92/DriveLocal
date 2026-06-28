// Email login (route "/email-login"). Iteration 1A/1B — real Firebase Auth.
// Resolves the user role (admin / driver). Driver routing is delegated to the
// shared useDriverRedirect() hook so the status->route logic stays in one place.

import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { loginUser } from '../../services/authService';
import { useDriverRedirect } from '../../hooks/useDriverRedirect';

export default function EmailLogin() {
  const router = useRouter();
  const redirectDriver = useDriverRedirect();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Authentifie puis route selon le rôle/statut.
  async function handleLogin() {
    setError('');
    setLoading(true);
    try {
      const result = await loginUser(email.trim(), password);

      if (result.role === 'admin') {
        console.log('[LOGIN] role=admin -> /(admin)/admin-home');
        router.replace('/(admin)/admin-home');
        return;
      }

      if (result.role === 'driver') {
        const status = result.driver && result.driver.verificationStatus;
        console.log(`[LOGIN] role=driver status=${status} -> redirecting`);
        redirectDriver(result.driver);
        return;
      }

      console.log('[LOGIN] role=unknown');
      setError('Conta não encontrada. Verifique seus dados.');
    } catch (e) {
      console.log('[LOGIN] error', e.message);
      setError('Não foi possível entrar. Verifique seu e-mail e senha.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Entrar com e-mail" onBack={() => router.back()} />
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
            title={loading ? 'Entrando...' : 'Entrar'}
            onPress={handleLogin}
            disabled={loading}
          />
        </AppCard>
        <AppButton title="Criar conta" variant="ghost" onPress={() => router.push('/email-register')} />
      </ScrollView>
    </SafeAreaView>
  );
}
