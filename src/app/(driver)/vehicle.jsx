// ============================================================
// Ã‰cran vÃ©hicule chauffeur DriveLocal â€” Iteration 1B
// Route: /(driver)/vehicle
// Charge/sauvegarde les infos vÃ©hicule dans Firestore drivers/{uid}.
// ============================================================

import { useEffect, useState } from 'react';
import { ScrollView, View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import { colors } from '../../constants/colors';
import { spacing, radius } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { auth } from '../../config/firebase';
import { getDriver, updateVehicleInfo } from '../../services/driverService';
import { validatePlate, validateVehicleYear } from '../../utils/validation';
import { VEHICLE_MOTO, VEHICLE_CAR, VEHICLE_LABELS_PT_BR } from '../../constants/vehicleTypes';

// Message d'erreur PT-BR sous un champ.
function FieldHint({ message, tone = 'danger' }) {
  if (!message) return null;
  const color = tone === 'warning' ? colors.warning : colors.danger;
  return <Text style={[{ fontFamily, color }, typography.small]}>{message}</Text>;
}

// Boutons radio Moto | Carro.
function VehicleTypeRadio({ value, onChange }) {
  const options = [VEHICLE_MOTO, VEHICLE_CAR];
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>Tipo de veÃ­culo</Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {options.map((opt) => {
          const selected = value === opt;
          return (
            <Pressable
              key={opt}
              onPress={() => onChange(opt)}
              style={{
                flex: 1,
                alignItems: 'center',
                paddingVertical: spacing.md,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: selected ? colors.primary : colors.border,
                backgroundColor: selected ? colors.primaryTint : colors.background,
              }}
            >
              <Text style={[{ fontFamily, color: selected ? colors.primary : colors.textMuted }, typography.bodyBold]}>
                {VEHICLE_LABELS_PT_BR[opt]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function Vehicle() {
  const router = useRouter();
  const [vehicleType, setVehicleType] = useState(VEHICLE_MOTO);
  const [vehicleBrand, setVehicleBrand] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleColor, setVehicleColor] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleYear, setVehicleYear] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [warnings, setWarnings] = useState({});

  // Charge les donnÃ©es existantes au montage.
  useEffect(() => {
    let active = true;
    const uid = auth.currentUser && auth.currentUser.uid;
    if (!uid) {
      setLoading(false);
      return;
    }
    getDriver(uid)
      .then((d) => {
        if (!active || !d) return;
        console.log('[VEHICLE] loaded vehicle data from Firestore');
        setVehicleType(d.vehicleType || VEHICLE_MOTO);
        setVehicleBrand(d.vehicleBrand || '');
        setVehicleModel(d.vehicleModel || '');
        setVehicleColor(d.vehicleColor || '');
        setVehiclePlate(d.vehiclePlate || d.plate || '');
        setVehicleYear(d.vehicleYear ? String(d.vehicleYear) : '');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Valide puis sauvegarde les infos vÃ©hicule.
  async function handleSave() {
    const uid = auth.currentUser && auth.currentUser.uid;
    if (!uid) {
      setErrors({ form: 'SessÃ£o expirada. Entre novamente.' });
      return;
    }

    // 1. Champs obligatoires.
    const nextErrors = {};
    if (!vehicleType) nextErrors.vehicleType = 'Escolha o tipo de veÃ­culo.';
    if (!vehicleBrand.trim()) nextErrors.vehicleBrand = 'Informe a marca.';
    if (!vehicleModel.trim()) nextErrors.vehicleModel = 'Informe o modelo.';
    if (!vehicleColor.trim()) nextErrors.vehicleColor = 'Informe a cor.';

    // 2. Plaque.
    const plateRes = validatePlate(vehiclePlate);
    if (!plateRes.valid) nextErrors.vehiclePlate = plateRes.message;

    // 3. AnnÃ©e.
    const yearRes = validateVehicleYear(vehicleYear);
    if (!yearRes.valid) nextErrors.vehicleYear = yearRes.message;

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      console.log('[VEHICLE] validation failed', JSON.stringify(Object.keys(nextErrors)));
      return;
    }

    setSaving(true);
    try {
      // 4. Contrôle de doublon réservé à l'admin pour éviter une lecture globale de drivers côté chauffeur.
      setWarnings({});
      // 5. Sauvegarde -> vehicleStatus passe Ã  "complete".
      await updateVehicleInfo(uid, {
        vehicleType,
        vehicleBrand: vehicleBrand.trim(),
        vehicleModel: vehicleModel.trim(),
        vehicleColor: vehicleColor.trim(),
        vehiclePlate: vehiclePlate.trim().toUpperCase(),
        vehicleYear: parseInt(vehicleYear, 10),
      });

      console.log('[VEHICLE] vehicle saved -> navigating to /documents');
      router.replace('/(driver)/documents');
    } catch (e) {
      console.log('[VEHICLE] save error', e.message);
      setErrors({ form: 'NÃ£o foi possÃ­vel salvar. Tente novamente.' });
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Seu veÃ­culo" subtitle="Etapa 2 de 3" onBack={() => router.back()} />
        <AppCard>
          {loading ? (
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.body]}>Carregando...</Text>
          ) : (
            <>
              <VehicleTypeRadio value={vehicleType} onChange={setVehicleType} />
              <FieldHint message={errors.vehicleType} />

              <AppInput label="Marca" value={vehicleBrand} onChangeText={setVehicleBrand} placeholder="Ex: Honda" />
              <FieldHint message={errors.vehicleBrand} />

              <AppInput label="Modelo" value={vehicleModel} onChangeText={setVehicleModel} placeholder="Ex: CG 160" />
              <FieldHint message={errors.vehicleModel} />

              <AppInput label="Cor" value={vehicleColor} onChangeText={setVehicleColor} placeholder="Ex: Vermelha" />
              <FieldHint message={errors.vehicleColor} />

              <AppInput label="Placa" value={vehiclePlate} onChangeText={setVehiclePlate} placeholder="ABC1D23" />
              <FieldHint message={errors.vehiclePlate} />
              <FieldHint message={warnings.vehiclePlate} tone="warning" />

              <AppInput label="Ano" value={vehicleYear} onChangeText={setVehicleYear} placeholder="2020" keyboardType="number-pad" />
              <FieldHint message={errors.vehicleYear} />

              <FieldHint message={errors.form} />

              <AppButton
                title={saving ? 'Salvando...' : 'Salvar e continuar'}
                onPress={handleSave}
                disabled={saving}
              />
              <AppButton title="Voltar" variant="ghost" onPress={() => router.back()} />
            </>
          )}
        </AppCard>
      </ScrollView>
    </SafeAreaView>
  );
}
