import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useGlobalSearchParams } from 'expo-router';

import { auth } from '../config/firebase';
import { colors } from '../constants/colors';
import {
  quickMessageOptions,
  quickMessageSenderLabel,
  quickMessageText,
} from '../constants/rideQuickMessages';
import { radius, spacing } from '../constants/spacing';
import { fontFamily, typography } from '../constants/typography';
import {
  listenToMyOffer,
  listenToRide,
  listenToRideQuickMessages,
  sendRideQuickMessage,
} from '../services/ridesService';
import AppButton from './AppButton';

const MESSAGE_PHASES = new Set(['assigned', 'driver_arrived']);

function roleForRoute(route) {
  const path = String(route || '').toLowerCase();
  if (path.includes('active-ride')) return 'driver';
  if (path.includes('driver-accepted')) return 'passenger';
  return null;
}

function firstString(value) {
  if (Array.isArray(value)) return value[0] || null;
  return typeof value === 'string' ? value : null;
}

function traceQuickMessage(event, details = {}, level = 'log') {
  const method = console[level] || console.log;
  method(`[RIDE_MESSAGE] ${event}`, {
    scope: 'ride_quick_message',
    event,
    atMs: Date.now(),
    ...details,
  });
}

function errorLabel(error) {
  const remainingMs = Number(error?.details?.metadata?.remainingMs);
  if (Number.isFinite(remainingMs) && remainingMs > 0) {
    return `Aguarde ${Math.max(1, Math.ceil(remainingMs / 1000))} segundo(s) antes de enviar outra mensagem.`;
  }
  return 'Não foi possível enviar agora. Verifique a conexão e tente novamente.';
}

export default function RideQuickMessagesGuard({ route }) {
  const params = useGlobalSearchParams();
  const role = roleForRoute(route);
  const rideId = firstString(params?.rideId);
  const [authenticatedUid, setAuthenticatedUid] = useState(auth.currentUser?.uid || null);
  const [rideStatus, setRideStatus] = useState(null);
  const [messages, setMessages] = useState([]);
  const [open, setOpen] = useState(false);
  const [busyCode, setBusyCode] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => auth.onAuthStateChanged((user) => {
    setAuthenticatedUid(user?.uid || null);
    if (!user) {
      setRideStatus(null);
      setMessages([]);
      setOpen(false);
    }
  }), []);

  useEffect(() => {
    setRideStatus(null);
    setError('');
    if (!role || !rideId || !authenticatedUid) return undefined;

    if (role === 'driver') {
      return listenToMyOffer(
        authenticatedUid,
        (offer) => setRideStatus(offer?.rideId === rideId ? offer?.driverRideStatus || null : null),
        (listenerError) => {
          traceQuickMessage('context_listener.failed', {
            role,
            rideId,
            reason: listenerError?.code || listenerError?.name || 'unknown',
          }, 'warn');
        },
        rideId,
      );
    }

    return listenToRide(
      rideId,
      (ride) => setRideStatus(ride?.status || null),
      (listenerError) => {
        traceQuickMessage('context_listener.failed', {
          role,
          rideId,
          reason: listenerError?.code || listenerError?.name || 'unknown',
        }, 'warn');
      },
    );
  }, [authenticatedUid, rideId, role]);

  useEffect(() => {
    setMessages([]);
    if (!role || !rideId || !authenticatedUid) return undefined;
    return listenToRideQuickMessages(
      rideId,
      setMessages,
      (listenerError) => {
        traceQuickMessage('history_listener.failed', {
          role,
          rideId,
          reason: listenerError?.code || listenerError?.name || 'unknown',
        }, 'warn');
      },
    );
  }, [authenticatedUid, rideId, role]);

  useEffect(() => {
    if (!MESSAGE_PHASES.has(rideStatus)) setOpen(false);
  }, [rideStatus]);

  const options = useMemo(
    () => quickMessageOptions(role, rideStatus),
    [role, rideStatus],
  );
  const latest = messages[0] || null;

  if (
    !role
    || !rideId
    || !authenticatedUid
    || !MESSAGE_PHASES.has(rideStatus)
    || options.length === 0
  ) {
    return null;
  }

  async function handleSend(messageCode) {
    if (!messageCode || busyCode) return;
    setBusyCode(messageCode);
    setError('');
    traceQuickMessage('send.requested', {
      rideId,
      senderRole: role,
      rideStatus,
      messageCode,
    });
    try {
      const result = await sendRideQuickMessage(rideId, messageCode);
      traceQuickMessage('send.succeeded', {
        rideId,
        senderRole: role,
        rideStatus: result?.status || rideStatus,
        messageCode,
        sequence: result?.sequence || null,
        replay: result?.replay === true,
      });
      setOpen(false);
    } catch (sendError) {
      setError(errorLabel(sendError));
      traceQuickMessage('send.failed', {
        rideId,
        senderRole: role,
        rideStatus,
        messageCode,
        reason: sendError?.code || sendError?.name || 'unknown',
      }, 'warn');
    } finally {
      setBusyCode(null);
    }
  }

  return (
    <>
      <View accessibilityRole="summary" style={styles.compactCard}>
        <View style={styles.compactCopy}>
          <Text style={styles.compactTitle}>Mensagens rápidas</Text>
          {latest ? (
            <Text style={styles.latestMessage} numberOfLines={2}>
              {quickMessageSenderLabel(latest.senderRole)}: {quickMessageText(latest.messageCode)}
            </Text>
          ) : (
            <Text style={styles.emptyMessage}>Use somente frases prontas durante o embarque.</Text>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Abrir mensagens rápidas"
          onPress={() => {
            setError('');
            setOpen(true);
            traceQuickMessage('panel.opened', { rideId, senderRole: role, rideStatus });
          }}
          style={({ pressed }) => [styles.openButton, pressed && styles.pressed]}
        >
          <Text style={styles.openButtonText}>ENVIAR</Text>
        </Pressable>
      </View>

      <Modal
        animationType="fade"
        transparent
        visible={open}
        onRequestClose={() => !busyCode && setOpen(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Mensagem rápida</Text>
            <Text style={styles.modalSubtitle}>
              Escolha uma frase pronta. Nenhum contato pessoal é compartilhado.
            </Text>

            <ScrollView contentContainerStyle={styles.options}>
              {options.map((option) => (
                <Pressable
                  key={option.code}
                  accessibilityRole="button"
                  disabled={Boolean(busyCode)}
                  onPress={() => handleSend(option.code)}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.pressed,
                    busyCode && styles.disabled,
                  ]}
                >
                  <Text style={styles.optionText}>
                    {busyCode === option.code ? 'Enviando…' : option.text}
                  </Text>
                </Pressable>
              ))}

              {messages.length > 0 ? (
                <View style={styles.history}>
                  <Text style={styles.historyTitle}>Últimas mensagens</Text>
                  {messages.map((message) => (
                    <View key={message.messageId} style={styles.historyRow}>
                      <Text style={styles.historyRole}>
                        {quickMessageSenderLabel(message.senderRole)}
                      </Text>
                      <Text style={styles.historyText}>
                        {quickMessageText(message.messageCode)}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {error ? <Text style={styles.error}>{error}</Text> : null}
            </ScrollView>

            <AppButton
              title="FECHAR"
              variant="ghost"
              disabled={Boolean(busyCode)}
              onPress={() => setOpen(false)}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  compactCard: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  compactCopy: {
    flex: 1,
    gap: 2,
  },
  compactTitle: {
    ...typography.bodyBold,
    fontFamily,
    color: colors.text,
  },
  latestMessage: {
    ...typography.caption,
    fontFamily,
    color: colors.textMuted,
  },
  emptyMessage: {
    ...typography.caption,
    fontFamily,
    color: colors.textMuted,
  },
  openButton: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primaryTint,
  },
  openButtonText: {
    ...typography.small,
    fontFamily,
    color: colors.primary,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: 'rgba(15, 27, 45, 0.55)',
  },
  modalCard: {
    maxHeight: '85%',
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
    gap: spacing.md,
  },
  modalTitle: {
    ...typography.h3,
    fontFamily,
    color: colors.text,
  },
  modalSubtitle: {
    ...typography.small,
    fontFamily,
    color: colors.textMuted,
  },
  options: {
    gap: spacing.sm,
  },
  option: {
    minHeight: 52,
    justifyContent: 'center',
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
  },
  optionText: {
    ...typography.bodyBold,
    fontFamily,
    color: colors.text,
  },
  history: {
    marginTop: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  historyTitle: {
    ...typography.bodyBold,
    fontFamily,
    color: colors.text,
  },
  historyRow: {
    gap: 2,
  },
  historyRole: {
    ...typography.caption,
    fontFamily,
    color: colors.primary,
  },
  historyText: {
    ...typography.small,
    fontFamily,
    color: colors.textMuted,
  },
  error: {
    ...typography.small,
    fontFamily,
    color: colors.danger,
  },
  pressed: {
    opacity: 0.82,
  },
  disabled: {
    opacity: 0.55,
  },
});
