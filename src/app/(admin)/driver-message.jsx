// Admin driver communication (route "/(admin)/driver-message").
//
// Two channels, deliberately separate:
//
//   - the ANNOUNCEMENT is the reliable one. It sits in every driver's app until
//     he taps "Entendi", so it does not depend on notifications being enabled,
//     on the driver not swiping it away, or on the phone not rebooting.
//   - the PUSH is a single shot used to make drivers OPEN the app. It is
//     optional, rate limited to one per hour by the backend, and rides on the
//     status channel so it never devalues the ride-offer alert.
//
// Publishing an announcement replaces the previous one and gives it a new id,
// so drivers who dismissed the old message see the new one.

import { useState } from 'react';
import { Text, View } from 'react-native';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AppInput from '../../components/AppInput';
import KeyboardSafeScreen from '../../components/KeyboardSafeScreen';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { fontFamily, typography } from '../../constants/typography';
import { showConfirmAlert } from '../../utils/alertUtils';
import {
  publishDriverAnnouncement,
  clearDriverAnnouncement,
  sendDriverBroadcast,
} from '../../services/adminService';

const MAX_TITLE = 80;
const MAX_BODY = 400;
const MAX_PUSH_TITLE = 60;
const MAX_PUSH_BODY = 160;

const TONES = [
  { key: 'info', label: 'Informação' },
  { key: 'warning', label: 'Atenção' },
  { key: 'critical', label: 'Urgente' },
];

// Campaign ids must be stable and safe as a document id: the backend uses them
// to make push events deterministic, so resending the same campaign notifies
// nobody twice.
function campaignIdFrom(title, nowMs) {
  const slug = String(title || 'aviso')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'aviso';
  return `${slug}_${nowMs.toString(36)}`.slice(0, 64);
}

export default function DriverMessage() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tone, setTone] = useState('info');
  const [alsoPush, setAlsoPush] = useState(true);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  const canSubmit = trimmedTitle.length > 0
    && trimmedBody.length > 0
    && trimmedTitle.length <= MAX_TITLE
    && trimmedBody.length <= MAX_BODY
    && !submitting;

  async function handlePublish() {
    if (!canSubmit) return;
    setError('');
    setResult(null);
    setSubmitting(true);

    try {
      const announcement = await publishDriverAnnouncement({
        title: trimmedTitle,
        body: trimmedBody,
        tone,
      });

      let pushOutcome = null;
      if (alsoPush) {
        try {
          pushOutcome = await sendDriverBroadcast({
            campaignId: campaignIdFrom(trimmedTitle, Date.now()),
            // A push has far less room than the banner: send the headline and
            // let the app carry the detail.
            title: trimmedTitle.slice(0, MAX_PUSH_TITLE),
            body: trimmedBody.slice(0, MAX_PUSH_BODY),
          });
        } catch (pushError) {
          // The announcement is already live and is the channel that matters.
          // A rate-limited or failed push must not look like a total failure.
          pushOutcome = { failed: true, reason: pushError?.message || 'push_failed' };
        }
      }

      setResult({ announcement, pushOutcome });
      setTitle('');
      setBody('');
    } catch (publishError) {
      setError(publishError?.message || 'Não foi possível publicar o aviso.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleClear() {
    showConfirmAlert({
      title: 'Remover aviso',
      message: 'O aviso deixa de aparecer no app dos motoristas. Confirmar?',
      confirmText: 'Remover',
      destructive: true,
      onConfirm: async () => {
        setError('');
        setSubmitting(true);
        try {
          await clearDriverAnnouncement();
          setResult({ cleared: true });
        } catch (clearError) {
          setError(clearError?.message || 'Não foi possível remover o aviso.');
        } finally {
          setSubmitting(false);
        }
      },
    });
  }

  return (
    <KeyboardSafeScreen>
      <Header
        title="Avisar motoristas"
        subtitle="Mensagem fixa no app até o motorista confirmar"
      />

      <AppCard style={{ gap: spacing.sm }}>
        <AppInput
          label="Título"
          value={title}
          onChangeText={setTitle}
          placeholder="Ex.: Nova versão disponível"
          maxLength={MAX_TITLE}
        />
        <AppInput
          label="Mensagem"
          value={body}
          onChangeText={setBody}
          placeholder="Explique o que o motorista precisa fazer."
          multiline
          numberOfLines={4}
          maxLength={MAX_BODY}
        />
        <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
          {trimmedBody.length}/{MAX_BODY}
        </Text>

        <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
          {TONES.map((option) => (
            <AppButton
              key={option.key}
              title={option.label}
              variant={tone === option.key ? 'primary' : 'secondary'}
              onPress={() => setTone(option.key)}
            />
          ))}
        </View>

        <AppButton
          title={alsoPush
            ? 'Notificação: ATIVADA (toque para desativar)'
            : 'Notificação: desativada (toque para ativar)'}
          variant="secondary"
          onPress={() => setAlsoPush((value) => !value)}
        />
        <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
          O aviso sempre aparece no app. A notificação só serve para o motorista
          abrir o app — é limitada a uma por hora.
        </Text>

        {error ? (
          <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>
            {error}
          </Text>
        ) : null}

        <AppButton
          title={submitting ? 'Publicando…' : 'Publicar aviso'}
          onPress={handlePublish}
          disabled={!canSubmit}
        />
        <AppButton
          title="Remover aviso atual"
          variant="secondary"
          onPress={handleClear}
          disabled={submitting}
        />
      </AppCard>

      {result ? (
        <AppCard style={{ gap: spacing.xs }}>
          {result.cleared ? (
            <Text style={[{ fontFamily, color: colors.text }, typography.body]}>
              Aviso removido do app dos motoristas.
            </Text>
          ) : (
            <>
              <Text style={[{ fontFamily, color: colors.text }, typography.body]}>
                Aviso publicado. Aparece para todos os motoristas até confirmarem.
              </Text>
              {result.pushOutcome?.failed ? (
                <Text style={[{ fontFamily, color: colors.warning }, typography.small]}>
                  A notificação não foi enviada (limite de uma por hora). O aviso
                  no app continua valendo.
                </Text>
              ) : result.pushOutcome ? (
                <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
                  Notificação enviada para {result.pushOutcome.recipientCount} motorista(s).
                </Text>
              ) : null}
            </>
          )}
        </AppCard>
      ) : null}
    </KeyboardSafeScreen>
  );
}
