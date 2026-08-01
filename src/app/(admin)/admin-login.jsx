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

import { useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import KeyboardSafeScreen from '../../components/KeyboardSafeScreen';
import { goBackOrReplace } from '../../utils/navigation';

export default function AdminLogin() {
  const router = useRouter();
  const passwordRef = useRef(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  function enterDashboard() {
    router.replace('/dashboard');
  }

  return (
    <KeyboardSafeScreen>
      <Header title="Admin — entrar" onBack={() => goBackOrReplace(router, '/')} />
      <AppCard>
        <AppInput
          label="E-mail"
          value={email}
          onChangeText={setEmail}
          placeholder="admin@drivelocal.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
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
          returnKeyType="done"
          onSubmitEditing={enterDashboard}
        />
        <AppButton title="Entrar" onPress={enterDashboard} />
      </AppCard>
    </KeyboardSafeScreen>
  );
}
