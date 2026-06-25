// Driver profile (route "/profile"). Step 1 frontend only — mock prefilled.
// TODO(backend): load/save the driver profile from Firestore.

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
import { mockDrivers } from '../../mock/mockDrivers';

export default function Profile() {
  const router = useRouter();
  const driver = mockDrivers[0];
  const [name, setName] = useState(driver.name);
  const [phone, setPhone] = useState(driver.phone);
  const [plate, setPlate] = useState(driver.plate);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Seu perfil" onBack={() => router.back()} />
        <AppCard>
          <AppInput label="Nome" value={name} onChangeText={setName} />
          <AppInput label="WhatsApp" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <AppInput label="Placa" value={plate} onChangeText={setPlate} />
          <AppButton title="Salvar e continuar" onPress={() => router.push('/documents')} />
        </AppCard>
      </ScrollView>
    </SafeAreaView>
  );
}
