// WhatsApp OTP verification (route "/verify-whatsapp"). Step 1 frontend only.
// TODO(backend): verify the 6-digit code sent via the WhatsApp OTP service.

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

export default function VerifyWhatsApp() {
  const router = useRouter();
  const [code, setCode] = useState('');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header
          title="Verificar WhatsApp"
          subtitle="Enviamos um código de 6 dígitos (placeholder)"
          onBack={() => router.back()}
        />
        <AppCard>
          <AppInput
            label="Código"
            value={code}
            onChangeText={setCode}
            placeholder="000000"
            keyboardType="number-pad"
          />
          <AppButton title="Confirmar" onPress={() => router.replace('/passenger-home')} />
        </AppCard>
        <AppButton title="Reenviar código" variant="ghost" onPress={() => {}} />
      </ScrollView>
    </SafeAreaView>
  );
}
