// ============================================================
// Email login (route "/email-login"). Iteration 1D — real Firebase Auth.
// Single email/password screen used by three entry points:
//   - "Entrar com e-mail" (general)      -> redirect by role
//   - "Entrar como motorista" (?roleIntent=driver) -> same role redirect
//   - "Área interna" (?intent=internal)  -> STRICT admin only
//
// Role redirect logic lives here (admin/driver/passenger). Driver status->route
// is delegated to useDriverRedirect() so the mapping stays in one place.
// All auth/Firestore errors are caught and shown as clean UI messages.
// ============================================================

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

export default function EmailLogin() {
  const router = useRouter();
  const redirectDriver = useDriverRedirect();
  const params = useLocalSearchParams();

  // Entry-point intent. "internal" = Área interna (strict admin). roleIntent is
  // informational for now (future Google login will use it to create the right
  // role); email may be passed to pre-fill after a failed lookup.
  const isInternal = params.intent === 'internal';
  const roleIntent = typeof params.roleIntent === 'string' ? params.roleIntent : null;

  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  // Blocks a non-admin who reached the internal entry: message, sign out, home.
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
      const result = await loginUser(email.trim(), password);

      // --- Área interna: STRICT admin only. Never route to driver/passenger. ---
      if (isInternal) {
        if (result.role === 'admin') {
          console.log('[INTERNAL_ACCESS] admin ok -> /(admin)/admin-home');
          router.replace('/(admin)/admin-home');
          return;
        }
        await denyInternal();
        return;
      }

      // --- General login: redirect by role. ---
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

      // Unknown: authenticated but no profile yet. Clean placeholder message —
      // most likely a new user who should create a driver account.
      console.log('[ROLE_REDIRECT] unknown role -> profile placeholder message');
      setInfo('Sua conta ainda não tem um perfil. Crie seu cadastro de motorista para começar.');
    } catch (e) {
      console.log('[AUTH_FLOW] login error', e.code || e.message);
      setError('Não foi possível entrar. Verifique seu e-mail e senha.');
    } finally {
      setLoading(false);
    }
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

        {/* No account-creation shortcut inside the internal entry. */}
        {!isInternal ? (
          <AppButton
            title="Criar cadastro de motorista"
            variant="ghost"
            onPress={() => router.push({ pathname: '/email-register', params: { email: email.trim() } })}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
