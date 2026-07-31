// Passenger registration. New emails create an account; an existing email with
// the correct password reconnects and repairs a missing passenger profile.

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

      // New, existing and repaired accounts all continue into the requested ride.
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
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header
          title="Criar conta de passageiro"
          subtitle="Peça corridas locais em Horizonte"
          onBack={() => router.back()}
        />
        <AppCard>
          <AppInput label="Nome completo" value={fullName} onChangeText={setFullName} placeholder="Seu nome" />
          <AppInput
            label="WhatsApp"
            value={whatsApp}
            onChangeText={setWhatsApp}
            placeholder="Ex: 85 99999-9999"
            keyboardType="phone-pad"
          />
          <AppInput
            label="E-mail"
            value={email}
            onChangeText={setEmail}
            placeholder="voce@email.com"
            keyboardType="email-address"
          />
          <AppInput label="Senha" value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry />
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
      </ScrollView>
    </SafeAreaView>
  );
}
