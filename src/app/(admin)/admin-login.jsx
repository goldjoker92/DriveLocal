// Admin login (route "/admin-login"). LEGACY / DEV ONLY — mock auth.
//
// Iteration 1D: real admin access is via the general email login + the discreet
// landing "Área interna" link (/email-login?intent=internal), which does real
// Firebase Auth and role detection. This mock screen is NO LONGER linked from
// the landing or any public navigation. Kept only as a dev shortcut; do not
// expose it as a real path.
//
// NOTE: named "admin-login" (not "login") on purpose. Route groups like
// (admin) are silent in the URL, so a file named "login.jsx" here would
// resolve to "/login" and COLLIDE with (auth)/login.jsx.

import { useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Admin — entrar" onBack={() => router.back()} />
        <AppCard>
          <AppInput
            label="E-mail"
            value={email}
            onChangeText={setEmail}
            placeholder="admin@drivelocal.com"
            keyboardType="email-address"
          />
          <AppInput
            label="Senha"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
          />
          <AppButton title="Entrar" onPress={() => router.replace('/dashboard')} />
        </AppCard>
      </ScrollView>
    </SafeAreaView>
  );
}
