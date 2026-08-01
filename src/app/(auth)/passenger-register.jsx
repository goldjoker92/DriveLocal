// Passenger registration. New emails create an account; an existing email with
// the correct password reconnects and repairs a missing passenger profile.

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
import { registerPassenger } from '../../services/authService';
import { registrationErrorMessage } from '../../utils/authErrorMessage';

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function authTrace(stage, details = {}) {
  console.log('[AUTH_FLOW]', {
    scope: 'passenger_registration',
    stage,
    projectId: auth?.app?.options?.projectId || 'unknown',
    atMs: Date.now(),
    ...details,
  });
}

export default function PassengerRegister() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const whatsAppRef = useRef(null);
  const emailRef = useRef(null);
  const passwordRef = useRef(null);
  const [fullName, setFullName] = useState('');
  const [whatsApp, setWhatsApp] = useState('');
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleRegister() {
    setError('');

    if (!fullName.trim() || !whatsApp.trim()) {
      setError('Informe seu nome e WhatsApp.');
      return;
    }

    if (!validEmail(email)) {
      setError('Informe um e-mail válido.');
      return;
    }

    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    setLoading(true);
    try {
      authTrace('register_started');
      const result = await registerPassenger(email, password, {
        fullName: fullName.trim(),
        whatsApp: whatsApp.trim(),
      });
      authTrace('register_completed', { accountState: result.accountState || 'unknown' });

      router.replace({
        pathname: '/request-ride',
        params: {
          originText: typeof params.origem === 'string' ? params.origem : '',
          destinationText: typeof params.destino === 'string' ? params.destino : '',
        },
      });
    } catch (e) {
      authTrace('register_failed', {
        code: e?.code || 'unknown',
        name: e?.name || 'Error',
      });
      setError(registrationErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardSafeScreen>
      <Header
        title="Criar conta de passageiro"
        subtitle="Peça corridas locais em Horizonte"
        onBack={() => router.back()}
      />
      <AppCard>
        <AppInput
          label="Nome completo"
          value={fullName}
          onChangeText={setFullName}
          placeholder="Seu nome"
          textContentType="name"
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={() => whatsAppRef.current?.focus()}
        />
        <AppInput
          ref={whatsAppRef}
          label="WhatsApp"
          value={whatsApp}
          onChangeText={setWhatsApp}
          placeholder="Ex: 85 99999-9999"
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={() => emailRef.current?.focus()}
        />
        <AppInput
          ref={emailRef}
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
        <AppButton title={loading ? 'Acessando...' : 'Criar conta'} onPress={handleRegister} disabled={loading} />
      </AppCard>

      <AppButton
        title="Já tenho conta"
        variant="ghost"
        onPress={() =>
          router.push({
            pathname: '/email-login',
            params: { email: email.trim(), roleIntent: 'passenger' },
          })
        }
      />
    </KeyboardSafeScreen>
  );
}
