// Driver documents (route "/documents"). Step 1 frontend only.
// Upload buttons are placeholders. TODO(backend): upload to Firebase Storage
// and store references on the driver document for admin review.

import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AdminTableRow from '../../components/AdminTableRow';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';

// Documents required for driver verification.
const REQUIRED_DOCS = ['CNH (habilitação)', 'CRLV (documento do veículo)', 'Selfie com documento'];

export default function Documents() {
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Documentos" subtitle="Envie para verificação" onBack={() => router.back()} />
        <AppCard>
          {REQUIRED_DOCS.map((doc) => (
            <AdminTableRow key={doc} label={doc} value="Enviar" />
          ))}
        </AppCard>
        <AppButton title="Enviar para análise" onPress={() => router.push('/verification-status')} />
      </ScrollView>
    </SafeAreaView>
  );
}
