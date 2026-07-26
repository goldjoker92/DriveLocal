import { useState } from 'react';
import { Alert, Linking, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AppInput from '../../components/AppInput';
import { colors } from '../../constants/colors';
import { spacing, radius } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { PUBLIC_POLICY_LINKS } from '../../config/publicPolicyLinks';
import {
  accountDeletionErrorMessage,
  requestAccountDeletion,
} from '../../services/accountDeletionService';
import { logoutUser } from '../../services/authService';

function Copy({ children, tone = 'muted' }) {
  const color = tone === 'danger'
    ? colors.danger
    : tone === 'text'
      ? colors.text
      : colors.textMuted;
  return <Text style={[{ fontFamily, color }, typography.small]}>{children}</Text>;
}

function SectionTitle({ children }) {
  return <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>{children}</Text>;
}

async function openPublicLink(url, label, setError) {
  setError('');
  if (!url) {
    setError(`${label} ainda não está publicado. Esta configuração bloqueará o build de produção.`);
    return;
  }
  try {
    await Linking.openURL(url);
  } catch (_error) {
    setError(`Não foi possível abrir ${label.toLowerCase()} agora.`);
  }
}

export default function PrivacyCenter() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const confirmationValid = confirmation.trim().toUpperCase() === 'EXCLUIR';

  function confirmDeletion() {
    setError('');
    if (!password.trim()) {
      setError('Digite sua senha atual para continuar.');
      return;
    }
    if (!confirmationValid) {
      setError('Digite EXCLUIR exatamente como mostrado.');
      return;
    }

    Alert.alert(
      'Excluir sua conta?',
      'A solicitação encerra seu acesso. Dados pessoais serão excluídos ou anonimizados. Registros mínimos de transações, segurança, prevenção à fraude ou disputas podem ser conservados conforme a política de privacidade.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'EXCLUIR CONTA',
          style: 'destructive',
          onPress: submitDeletion,
        },
      ],
    );
  }

  async function submitDeletion() {
    setSubmitting(true);
    setError('');
    try {
      await requestAccountDeletion(password);
      try {
        await logoutUser();
      } catch (_logoutError) {
        // The server processor may delete Firebase Auth before local sign-out. The
        // account request is already durable, so returning to landing is correct.
      }
      setPassword('');
      setConfirmation('');
      Alert.alert(
        'Solicitação registrada',
        'Sua conta entrou no processo de exclusão. Você foi desconectado deste aparelho.',
        [{ text: 'OK', onPress: () => router.replace('/') }],
        { cancelable: false },
      );
    } catch (requestError) {
      setError(accountDeletionErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header
          title="Privacidade e conta"
          subtitle="Seus dados e seus controles"
          onBack={() => router.back()}
        />

        <AppCard>
          <SectionTitle>SEUS DIREITOS E INFORMAÇÕES</SectionTitle>
          <Copy>
            Consulte como o DriveLocal utiliza localização, identidade, documentos, pagamentos e dados das corridas.
          </Copy>
          <Copy>
            Você pode solicitar acesso, correção, informação sobre compartilhamento e exclusão ou anonimização quando aplicável.
          </Copy>
          <AppButton
            title="POLÍTICA DE PRIVACIDADE"
            variant="secondary"
            onPress={() => openPublicLink(PUBLIC_POLICY_LINKS.privacyPolicyUrl, 'Política de privacidade', setError)}
          />
          <AppButton
            title="TERMOS DE USO"
            variant="ghost"
            onPress={() => openPublicLink(PUBLIC_POLICY_LINKS.termsOfUseUrl, 'Termos de uso', setError)}
          />
          <AppButton
            title="EXCLUSÃO FORA DO APLICATIVO"
            variant="ghost"
            onPress={() => openPublicLink(PUBLIC_POLICY_LINKS.accountDeletionWebUrl, 'Página de exclusão de conta', setError)}
          />
        </AppCard>

        <AppCard>
          <SectionTitle>EXCLUIR MINHA CONTA</SectionTitle>
          <Copy tone="text">
            Você não pode excluir a conta durante uma corrida ativa.
          </Copy>
          <Copy>
            Fotos, documentos, tokens de notificação, dados de perfil e outros dados pessoais diretos serão removidos. Corridas e registros financeiros indispensáveis serão minimizados e desvinculados da sua identidade.
          </Copy>

          <View
            style={{
              backgroundColor: colors.dangerBg,
              borderColor: colors.danger,
              borderWidth: 1,
              borderRadius: radius.md,
              padding: spacing.md,
              gap: spacing.xs,
            }}
          >
            <Text style={[{ fontFamily, color: colors.danger }, typography.bodyBold]}>
              Esta ação não pode ser desfeita.
            </Text>
            <Copy tone="text">Digite EXCLUIR e confirme sua senha atual.</Copy>
          </View>

          <AppInput
            label="Confirmação"
            value={confirmation}
            onChangeText={setConfirmation}
            placeholder="EXCLUIR"
            autoCapitalize="characters"
            editable={!submitting}
          />
          <AppInput
            label="Senha atual"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
            editable={!submitting}
          />

          <AppButton
            title={submitting ? 'REGISTRANDO EXCLUSÃO…' : 'EXCLUIR MINHA CONTA'}
            onPress={confirmDeletion}
            disabled={submitting || !confirmationValid || !password.trim()}
            style={{ backgroundColor: colors.danger }}
          />
        </AppCard>

        {error ? <Copy tone="danger">{error}</Copy> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
