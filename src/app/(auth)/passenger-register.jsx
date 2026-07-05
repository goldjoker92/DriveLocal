// Passenger register (route "/passenger-register"). Iteration 3A.
// Creates the Firebase user + passengers/{uid} document, then continues straight
// into the ride-request intent (forwarding any address typed on the landing).
// Passengers are simple: name + WhatsApp + email + password. No CPF in V1.

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
import { registerPassenger } from '../../services/authService';

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
    setLoading(true);
    try {
      console.log('[AUTH_FLOW] registerPassenger');
      await registerPassenger(email.trim(), password, {
        fullName: fullName.trim(),
        whatsApp: whatsApp.trim(),
      });
      // Continue into the ride-request flow, forwarding any address the
      // passenger already typed on the landing page.
      router.replace({
        pathname: '/request-ride',
        params: {
          originText: typeof params.origem === 'string' ? params.origem : '',
          destinationText: typeof params.destino === 'string' ? params.destino : '',
        },
      });
    } catch (e) {
      console.log('[AUTH_FLOW] passenger register error', e.code || e.message);
      setError('Não foi possível criar a conta. Verifique o e-mail e a senha (mínimo 6 caracteres).');
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
          <AppButton title={loading ? 'Criando...' : 'Criar conta'} onPress={handleRegister} disabled={loading} />
        </AppCard>

        <AppButton
          title="Já tenho conta"
          variant="ghost"
          onPress={() => router.push({ pathname: '/email-login', params: { email: email.trim() } })}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
