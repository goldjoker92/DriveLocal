// WhatsApp OTP verification (route "/verify-whatsapp"). Step 1 frontend only.
// TODO(backend): verify the 6-digit code sent via the WhatsApp OTP service.

import { useState } from 'react';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import KeyboardSafeScreen from '../../components/KeyboardSafeScreen';
import { goBackOrReplace } from '../../utils/navigation';

export default function VerifyWhatsApp() {
  const router = useRouter();
  const [code, setCode] = useState('');

  function confirmCode() {
    router.replace('/passenger-home');
  }

  return (
    <KeyboardSafeScreen>
      <Header
        title="Verificar WhatsApp"
        subtitle="Enviamos um código de 6 dígitos (placeholder)"
        onBack={() => goBackOrReplace(router, '/')}
      />
      <AppCard>
        <AppInput
          label="Código"
          value={code}
          onChangeText={setCode}
          placeholder="000000"
          keyboardType="number-pad"
          maxLength={6}
          returnKeyType="done"
          onSubmitEditing={confirmCode}
        />
        <AppButton title="Confirmar" onPress={confirmCode} />
      </AppCard>
      <AppButton title="Reenviar código" variant="ghost" onPress={() => {}} />
    </KeyboardSafeScreen>
  );
}
