// Separate admin push to passenger accounts. The old passenger app already
// receives status notifications and can open /passenger-home from their tap.
// This message is sent only after the new Play version is available.

import { useRef, useState } from 'react';
import { Text } from 'react-native';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AppInput from '../../components/AppInput';
import KeyboardSafeScreen from '../../components/KeyboardSafeScreen';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { fontFamily, typography } from '../../constants/typography';
import { showConfirmAlert } from '../../utils/alertUtils';
import { sendPassengerBroadcast } from '../../services/adminService';

const MAX_TITLE = 60;
const MAX_BODY = 160;
const UPDATE_TITLE = 'Atualização do DriveLocal';
const UPDATE_BODY = 'Nova versão na Google Play. Atualize o DriveLocal para ver o preço antes de confirmar sua corrida. Sua conta continua. Não desinstale o aplicativo.';

export default function PassengerMessage() {
  const sendingRef = useRef(false);
  const [title, setTitle] = useState(UPDATE_TITLE);
  const [body, setBody] = useState(UPDATE_BODY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  const canSend = !submitting && trimmedTitle.length > 0 && trimmedTitle.length <= MAX_TITLE
    && trimmedBody.length > 0 && trimmedBody.length <= MAX_BODY;

  function handleSend() {
    if (!canSend) return;
    showConfirmAlert({
      title: 'Enviar somente aos passageiros?',
      message: `Confira se a nova versão já está disponível na Google Play.\n\n${trimmedTitle}\n${trimmedBody}`,
      confirmText: 'Enviar notificação',
      onConfirm: async () => {
        if (sendingRef.current) return;
        sendingRef.current = true;
        setSubmitting(true);
        setError('');
        setResult(null);
        try {
          const campaignId = `passenger_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
          setResult(await sendPassengerBroadcast({
            campaignId,
            title: trimmedTitle,
            body: trimmedBody,
          }));
        } catch (sendError) {
          setError(sendError?.details?.message || sendError?.message || 'Não foi possível enviar a notificação.');
        } finally {
          sendingRef.current = false;
          setSubmitting(false);
        }
      },
    });
  }

  return (
    <KeyboardSafeScreen>
      <Header title="Avisar passageiros" subtitle="Notificação push somente para passageiros" />
      <AppCard style={{ gap: spacing.sm }}>
        <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
          Envie depois que a nova versão estiver disponível na Google Play. O aviso
          aparece nas notificações dos passageiros que permitiram recebê-las.
          O aviso dos motoristas é administrado em outra tela.
        </Text>
        <AppInput
          label="Título"
          value={title}
          onChangeText={setTitle}
          maxLength={MAX_TITLE}
        />
        <AppInput
          label="Mensagem"
          value={body}
          onChangeText={setBody}
          multiline
          numberOfLines={4}
          maxLength={MAX_BODY}
        />
        <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
          {trimmedBody.length}/{MAX_BODY} caracteres · Limite: uma campanha por hora.
        </Text>
        {error ? (
          <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text>
        ) : null}
        <AppButton
          title={submitting ? 'Enviando…' : 'Enviar aos passageiros'}
          onPress={handleSend}
          disabled={!canSend}
        />
      </AppCard>

      {result ? (
        <AppCard>
          <Text style={[{ fontFamily, color: colors.text }, typography.body]}>
            {result.replay
              ? 'Esta campanha já foi registrada. Nenhuma notificação duplicada foi criada.'
              : result.recipientCount > 0
                ? `Notificação preparada para ${result.recipientCount} passageiro(s). A entrega depende do dispositivo e das permissões de notificação.`
                : 'Nenhum passageiro elegível encontrado. Nenhuma notificação foi criada.'}
          </Text>
        </AppCard>
      ) : null}
    </KeyboardSafeScreen>
  );
}
