// Login screen (route "/login").
// Placeholder for WhatsApp OTP login — real flow added in the backend pass.

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

export default function Login() {
  const router = useRouter();
  const [phone, setPhone] = useState('');

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={['top', 'bottom']}
    >
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header
          title="Entrar"
          subtitle="Login via WhatsApp OTP (placeholder)"
          onBack={() => router.back()}
        />

        <AppCard>
          <AppInput
            label="WhatsApp"
            value={phone}
            onChangeText={setPhone}
            placeholder="+55 85 9 9999-9999"
            keyboardType="phone-pad"
          />
          <AppButton title="Enviar código" onPress={() => {}} />
        </AppCard>

        {/* Other auth entry points. */}
        <AppButton title="Entrar com e-mail" variant="ghost" onPress={() => router.push('/email-login')} />
        <AppButton title="Criar conta" variant="ghost" onPress={() => router.push('/email-register')} />

        {/* Dev shortcuts while there is no real auth yet. */}
        <AppButton
          title="Entrar como Passageiro"
          variant="secondary"
          onPress={() => router.replace('/passenger-home')}
        />
        <AppButton
          title="Entrar como Motorista"
          variant="ghost"
          onPress={() => router.replace('/driver-home')}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
