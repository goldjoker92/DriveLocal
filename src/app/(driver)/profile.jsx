// ============================================================
// Driver profile (route "/profile"). Iteration 1B.
// Charge/sauvegarde le profil chauffeur dans Firestore drivers/{uid}.
// Champs : fullName, cpf (validé), whatsApp, pixKeyType (select), pixKey.
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
import { getDriver, updateDriverProfile, checkDuplicates } from '../../services/driverService';
import { validateCPF } from '../../utils/validation';

// Options de type de clé Pix (libellés PT-BR).
const PIX_KEY_TYPES = ['CPF', 'Telefone', 'E-mail', 'Chave aleatória'];

// Petit message d'erreur/alerte sous un champ.
function FieldHint({ message, tone = 'danger' }) {
  if (!message) return null;
  const color = tone === 'warning' ? colors.warning : colors.danger;
  return <Text style={[{ fontFamily, color }, typography.small]}>{message}</Text>;
}

// Sélecteur simple (chips) pour le type de clé Pix.
function PixKeyTypeSelect({ value, onChange }) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>Tipo de chave Pix</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {PIX_KEY_TYPES.map((opt) => {
          const selected = value === opt;
          return (
            <Pressable
              key={opt}
              onPress={() => onChange(opt)}
              style={{
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.md,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: selected ? colors.primary : colors.border,
                backgroundColor: selected ? colors.primaryTint : colors.background,
              }}
            >
              <Text style={[{ fontFamily, color: selected ? colors.primary : colors.textMuted }, typography.small]}>
                {opt}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function Profile() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [cpf, setCpf] = useState('');
  const [whatsApp, setWhatsApp] = useState('');
  const [pixKeyType, setPixKeyType] = useState('CPF');
  const [pixKey, setPixKey] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({}); // erreurs bloquantes par champ
  const [warnings, setWarnings] = useState({}); // alertes doublon (non bloquantes)

  // Charge les données existantes au montage.
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
        console.log('[PROFILE] loaded driver data from Firestore');
        setFullName(d.fullName || '');
        setCpf(d.cpf || '');
        setWhatsApp(d.whatsApp || d.phone || '');
        setPixKeyType(d.pixKeyType || 'CPF');
        setPixKey(d.pixKey || '');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Validation CPF en temps réel pendant la saisie.
  function onChangeCpf(text) {
    setCpf(text);
    if (text.trim() === '') {
      setErrors((e) => ({ ...e, cpf: '' }));
      return;
    }
    const res = validateCPF(text);
    setErrors((e) => ({ ...e, cpf: res.valid ? '' : res.message }));
  }

  // Sauvegarde le profil après validation + contrôle de doublons.
  async function handleSave() {
    const uid = auth.currentUser && auth.currentUser.uid;
    if (!uid) {
      setErrors({ form: 'Sessão expirada. Entre novamente.' });
      return;
    }

    // 1. Valide le CPF.
    const cpfRes = validateCPF(cpf);
    // 2. Vérifie que tous les champs sont remplis.
    const nextErrors = {};
    if (!fullName.trim()) nextErrors.fullName = 'Informe seu nome completo.';
    if (!cpfRes.valid) nextErrors.cpf = cpfRes.message || 'CPF inválido.';
    if (!whatsApp.trim()) nextErrors.whatsApp = 'Informe seu WhatsApp.';
    if (!pixKeyType) nextErrors.pixKeyType = 'Escolha o tipo de chave Pix.';
    if (!pixKey.trim()) nextErrors.pixKey = 'Informe sua chave Pix.';

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      console.log('[PROFILE] validation failed', JSON.stringify(Object.keys(nextErrors)));
      return;
    }

    setSaving(true);
    try {
      // 3. Contrôle de doublons (CPF, WhatsApp, clé Pix). Plaque non concernée ici.
      const dup = await checkDuplicates(cpf.trim(), whatsApp.trim(), null, pixKey.trim(), uid);
      // 4. Affiche les warnings par champ — sans bloquer (l'admin décide).
      const nextWarnings = {};
      if (dup.cpf) nextWarnings.cpf = 'Atenção: este CPF já consta em outro cadastro.';
      if (dup.phone) nextWarnings.whatsApp = 'Atenção: este WhatsApp já consta em outro cadastro.';
      if (dup.pixKey) nextWarnings.pixKey = 'Atenção: esta chave Pix já consta em outro cadastro.';
      setWarnings(nextWarnings);
      if (Object.keys(nextWarnings).length > 0) {
        console.log('[PROFILE] duplicate warnings', JSON.stringify(Object.keys(nextWarnings)));
      }

      // 5. Sauvegarde -> profileStatus passe à "complete" si tout est rempli.
      await updateDriverProfile(uid, {
        fullName: fullName.trim(),
        cpf: cpf.trim(),
        whatsApp: whatsApp.trim(),
        pixKeyType,
        pixKey: pixKey.trim(),
      });

      console.log('[PROFILE] profile saved -> navigating to /vehicle');
      router.replace('/(driver)/vehicle');
    } catch (e) {
      console.log('[PROFILE] save error', e.message);
      setErrors({ form: 'Não foi possível salvar. Tente novamente.' });
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Seu perfil" subtitle="Etapa 1 de 3" onBack={() => router.back()} />
        <AppCard>
          {loading ? (
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.body]}>Carregando...</Text>
          ) : (
            <>
              <AppInput label="Nome completo" value={fullName} onChangeText={setFullName} placeholder="Seu nome completo" />
              <FieldHint message={errors.fullName} />

              <AppInput label="CPF" value={cpf} onChangeText={onChangeCpf} placeholder="000.000.000-00" keyboardType="number-pad" />
              <FieldHint message={errors.cpf} />
              <FieldHint message={warnings.cpf} tone="warning" />

              <AppInput label="WhatsApp" value={whatsApp} onChangeText={setWhatsApp} placeholder="+55 85 99999-9999" keyboardType="phone-pad" />
              <FieldHint message={errors.whatsApp} />
              <FieldHint message={warnings.whatsApp} tone="warning" />

              <PixKeyTypeSelect value={pixKeyType} onChange={setPixKeyType} />
              <FieldHint message={errors.pixKeyType} />

              <AppInput label="Chave Pix" value={pixKey} onChangeText={setPixKey} placeholder="Sua chave Pix" />
              <FieldHint message={errors.pixKey} />
              <FieldHint message={warnings.pixKey} tone="warning" />

              <FieldHint message={errors.form} />

              <AppButton
                title={saving ? 'Salvando...' : 'Salvar e continuar'}
                onPress={handleSave}
                disabled={saving}
              />
            </>
          )}
        </AppCard>
      </ScrollView>
    </SafeAreaView>
  );
}
