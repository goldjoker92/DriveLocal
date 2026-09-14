// ============================================================
// Driver profile (route "/profile"). Iteration 1B.
// Charge/sauvegarde le profil chauffeur dans Firestore drivers/{uid}.
// Champs : fullName, cpf (validé), whatsApp, pixKeyType (select), pixKey.
// ============================================================

import { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import KeyboardSafeScreen from '../../components/KeyboardSafeScreen';
import { colors } from '../../constants/colors';
import { spacing, radius } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { auth } from '../../config/firebase';
import { getDriver, updateDriverProfile } from '../../services/driverService';
import { validateCPF } from '../../utils/validation';
import { validateAndNormalizePixKey } from '../../utils/pixKey';
import { goBackOrReplace } from '../../utils/navigation';

const PIX_KEY_TYPES = ['CPF', 'Telefone', 'E-mail', 'Chave aleatória'];

const PIX_KEY_INPUT = {
  CPF: { placeholder: '000.000.000-00', keyboardType: 'number-pad' },
  Telefone: { placeholder: '+55 85 99999-9999', keyboardType: 'phone-pad' },
  'E-mail': { placeholder: 'nome@exemplo.com', keyboardType: 'email-address' },
  'Chave aleatória': { placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', keyboardType: 'default' },
};

function FieldHint({ message, tone = 'danger' }) {
  if (!message) return null;
  const color = tone === 'warning' ? colors.warning : colors.danger;
  return <Text style={[{ fontFamily, color }, typography.small]}>{message}</Text>;
}

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
  const params = useLocalSearchParams();
  const returnToCockpit = params.returnTo === 'home';
  const [fullName, setFullName] = useState('');
  const [cpf, setCpf] = useState('');
  const [whatsApp, setWhatsApp] = useState('');
  const [pixKeyType, setPixKeyType] = useState('CPF');
  const [pixKey, setPixKey] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [warnings, setWarnings] = useState({});

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

  function onChangeCpf(text) {
    setCpf(text);
    if (text.trim() === '') {
      setErrors((e) => ({ ...e, cpf: '' }));
      return;
    }
    const res = validateCPF(text);
    setErrors((e) => ({ ...e, cpf: res.valid ? '' : res.message }));
  }

  async function handleSave() {
    const uid = auth.currentUser && auth.currentUser.uid;
    if (!uid) {
      setErrors({ form: 'Sessão expirada. Entre novamente.' });
      return;
    }

    const cpfRes = validateCPF(cpf);
    const pixRes = validateAndNormalizePixKey(pixKey, pixKeyType);
    const nextErrors = {};
    if (!fullName.trim()) nextErrors.fullName = 'Informe seu nome completo.';
    if (!cpfRes.valid) nextErrors.cpf = cpfRes.message || 'CPF inválido.';
    if (!whatsApp.trim()) nextErrors.whatsApp = 'Informe seu WhatsApp.';
    if (!pixKeyType) nextErrors.pixKeyType = 'Escolha o tipo de chave Pix.';
    if (!pixRes.valid) nextErrors.pixKey = pixRes.message;

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      console.log('[PROFILE] validation failed', JSON.stringify(Object.keys(nextErrors)));
      return;
    }

    setSaving(true);
    try {
      setWarnings({});
      await updateDriverProfile(uid, {
        fullName: fullName.trim(),
        cpf: cpf.trim(),
        whatsApp: whatsApp.trim(),
        pixKeyType,
        pixKey: pixRes.value,
      });

      setPixKey(pixRes.value);
      console.log('[PROFILE] profile saved');
      router.replace(returnToCockpit ? '/(driver)/driver-home' : '/(driver)/vehicle');
    } catch (e) {
      console.log('[PROFILE] save error', e.message);
      setErrors({ form: 'Não foi possível salvar. Tente novamente.' });
      setSaving(false);
    }
  }

  return (
    <KeyboardSafeScreen>
      <Header
        title="Seu perfil"
        subtitle="Etapa 1 de 3"
        onBack={() => goBackOrReplace(router, '/(driver)/onboarding')}
      />
      <AppCard>
        {loading ? (
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.body]}>Carregando...</Text>
        ) : (
          <>
            <AppInput
              label="Nome completo"
              value={fullName}
              onChangeText={setFullName}
              placeholder="Seu nome completo"
              textContentType="name"
            />
            <FieldHint message={errors.fullName} />

            <AppInput
              label="CPF"
              value={cpf}
              onChangeText={onChangeCpf}
              placeholder="000.000.000-00"
              keyboardType="number-pad"
            />
            <FieldHint message={errors.cpf} />
            <FieldHint message={warnings.cpf} tone="warning" />

            <AppInput
              label="WhatsApp"
              value={whatsApp}
              onChangeText={setWhatsApp}
              placeholder="+55 85 99999-9999"
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
            />
            <FieldHint message={errors.whatsApp} />
            <FieldHint message={warnings.whatsApp} tone="warning" />

            <PixKeyTypeSelect
              value={pixKeyType}
              onChange={(nextType) => {
                setPixKeyType(nextType);
                setPixKey('');
                setErrors((current) => ({ ...current, pixKey: '' }));
              }}
            />
            <FieldHint message={errors.pixKeyType} />

            <AppInput
              label="Chave Pix"
              value={pixKey}
              onChangeText={(text) => {
                setPixKey(text);
                setErrors((current) => ({ ...current, pixKey: '' }));
              }}
              placeholder={PIX_KEY_INPUT[pixKeyType]?.placeholder || 'Sua chave Pix'}
              keyboardType={PIX_KEY_INPUT[pixKeyType]?.keyboardType || 'default'}
              autoCapitalize="none"
            />
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
    </KeyboardSafeScreen>
  );
}
