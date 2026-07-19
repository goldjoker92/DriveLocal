// Email login shared by admin, driver and passenger entry points.
// Existing accounts reconnect normally and are redirected by their stored role.

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
import { loginUser, logoutUser } from '../../services/authService';
import { useDriverRedirect } from '../../hooks/useDriverRedirect';
import { showAppAlert } from '../../utils/alertUtils';
import { loginErrorMessage } from '../../utils/authErrorMessage';

export default function EmailLogin() {
  const router = useRouter();
  const redirectDriver = useDriverRedirect();
  const params = useLocalSearchParams();

  const isInternal = params.intent === 'internal';
  const roleIntent = typeof params.roleIntent === 'string' ? params.roleIntent : null;
  const passengerIntent = roleIntent === 'passenger';

  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  async function denyInternal() {
    console.log('[INTERNAL_ACCESS] non-admin blocked -> signOut + landing');
    try {
      await logoutUser();
    } catch (e) {
      console.log('[INTERNAL_ACCESS] signOut error', e.message);
    }
    showAppAlert('Acesso restrito', 'Esta área é reservada à equipe DriveLocal.', () =>
      router.replace('/')
    );
  }

  async function handleLogin() {
    setError('');
    setInfo('');
    setLoading(true);
    try {
      console.log(`[AUTH_FLOW] login attempt intent=${isInternal ? 'internal' : 'general'} roleIntent=${roleIntent}`);
      const result = await loginUser(email, password);

      if (isInternal) {
        if (result.role === 'admin') {
          console.log('[INTERNAL_ACCESS] admin ok -> /(admin)/admin-home');
          router.replace('/(admin)/admin-home');
          return;
        }
        await denyInternal();
        return;
      }

      if (result.role === 'admin') {
        console.log('[ROLE_REDIRECT] admin -> /(admin)/admin-home');
        router.replace('/(admin)/admin-home');
        return;
      }

      if (result.role === 'driver') {
        const status = result.driver && result.driver.verificationStatus;
        console.log(`[ROLE_REDIRECT] driver status=${status} -> redirecting`);
        redirectDriver(result.driver);
        return;
      }

      if (result.role === 'passenger') {
        console.log('[ROLE_REDIRECT] passenger -> /(passenger)/passenger-home');
        router.replace('/(passenger)/passenger-home');
        return;
      }

      console.log('[ROLE_REDIRECT] unknown role -> recovery message');
      setInfo(
        passengerIntent
          ? 'Sua conta existe, mas o perfil de passageiro está incompleto. Use “Criar conta de passageiro” abaixo para repará-lo.'
          : 'Sua conta existe, mas o perfil de motorista está incompleto. Use “Criar cadastro de motorista” abaixo para repará-lo.'
      );
    } catch (e) {
      console.log('[AUTH_FLOW] login error', e.code || e.message);
      setError(loginErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  function openRegistration() {
    if (passengerIntent) {
      router.push({
        pathname: '/passenger-register',
        params: { email: email.trim(), roleIntent: 'passenger' },
      });
      return;
    }

    router.push({
      pathname: '/email-register',
      params: { email: email.trim(), roleIntent: 'driver' },
    });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header
          title={isInternal ? 'Área interna' : 'Entrar com e-mail'}
          subtitle={isInternal ? 'Acesso reservado à equipe DriveLocal' : undefined}
          onBack={() => router.back()}
        />
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
          {info ? (
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>{info}</Text>
          ) : null}
          <AppButton
            title={loading ? 'Entrando...' : 'Entrar'}
            onPress={handleLogin}
            disabled={loading}
          />
        </AppCard>

        {!isInternal ? (
          <AppButton
            title={passengerIntent ? 'Criar conta de passageiro' : 'Criar cadastro de motorista'}
            variant="ghost"
            onPress={openRegistration}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
