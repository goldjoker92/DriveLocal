// Email register (route "/email-register"). Step 1 frontend only — mock auth.
// TODO(backend): create the user in Firebase Auth + Firestore, then send the
// WhatsApp OTP for phone verification.

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

export default function EmailRegister() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Criar conta" onBack={() => router.back()} />
        <AppCard>
          <AppInput label="Nome" value={name} onChangeText={setName} placeholder="Seu nome" />
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
          {/* Next step verifies the phone via WhatsApp OTP. */}
          <AppButton title="Continuar" onPress={() => router.push('/verify-whatsapp')} />
        </AppCard>
      </ScrollView>
    </SafeAreaView>
  );
}
