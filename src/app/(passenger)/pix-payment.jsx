// Pix payment (route "/pix-payment"). Step 1 frontend only.
// Payment in MVP 0.1 is "Pix direto ao motorista" (driver receives directly).
// TODO(backend): generate a real Pix QR / key and confirm payment server-side.

import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppButton from '../../components/AppButton';
import PixQRCodeCard from '../../components/PixQRCodeCard';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { mockRides } from '../../mock/mockRides';
import { formatBRL } from '../../utils/format';

export default function PixPayment() {
  const router = useRouter();
  const ride = mockRides[0];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Pagamento Pix" onBack={() => router.back()} />
        <PixQRCodeCard amountLabel={formatBRL(ride.fareCents)} />
        {/* Passenger taps after paying; driver later confirms receipt. */}
        <AppButton title="Já paguei" onPress={() => router.replace('/ride-completed')} />
      </ScrollView>
    </SafeAreaView>
  );
}
