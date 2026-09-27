import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { auth } from '../config/firebase';
import { colors } from '../constants/colors';
import { quickMessageOptions, quickMessageSenderLabel } from '../constants/rideQuickMessages';
import { fontFamily } from '../constants/typography';
import useRideConversation from '../hooks/use-ride-conversation';
import { newMessageKey, sendConversationMessage } from '../services/ride-messages-service';
import { displayedMessage, messageAttempt, messageFailure, messageLength, messagePhaseOpen, MESSAGE_MAX_LENGTH } from '../utils/ride-messages';

function Action({ label, onPress, disabled, primary = false, testID }) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled: Boolean(disabled) }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.action, primary && styles.primaryAction, disabled && styles.disabled, pressed && styles.pressed]}>
    <Text style={[styles.actionLabel, primary && styles.primaryLabel]}>{label}</Text>
  </Pressable>;
}

function MessageBubble({ message, role }) {
  const own = message.senderRole === role;
  const time = new Date(Number(message.createdAtMs)).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return <View style={[styles.bubble, own ? styles.ownBubble : styles.otherBubble]}>
    <Text style={[styles.author, own && styles.primaryLabel]}>{own ? 'Você' : quickMessageSenderLabel(message.senderRole)}</Text>
    <Text selectable style={[styles.message, own && styles.primaryLabel]}>{displayedMessage(message)}</Text>
    <Text style={[styles.time, own && styles.primaryLabel]}>{time}{own ? ' · Enviada' : ''}</Text>
  </View>;
}

export function Conversation({ rideId, role, uid }) {
  const router = useRouter();
  const [pageSize, setPageSize] = useState(50);
  const conversation = useRideConversation(rideId, role, pageSize);
  const { messages, status, ready, loading, error, retry, hasMore } = conversation;
  const { height, fontScale } = useWindowDimensions();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(null);
  const [showPresets, setShowPresets] = useState(false);
  const lock = useRef(false);
  const attempt = useRef(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const open = messagePhaseOpen(status) && !error;
  const options = quickMessageOptions(role, status).filter((option) => ready || !option.requiresMessagingV1);
  const count = messageLength(draft);
  const remaining = MESSAGE_MAX_LENGTH - count;

  async function send(content) {
    // React state is asynchronous; this lock rejects a second tap in the same frame.
    if (lock.current || !open || (!content.messageCode && !ready)) return;
    lock.current = true; setBusy(true); setFailed(null);
    attempt.current = messageAttempt(attempt.current, content, newMessageKey);
    try {
      await sendConversationMessage(rideId, attempt.current, uid);
      if (!alive.current || auth.currentUser?.uid !== uid) return;
      attempt.current = null;
      if (!content.messageCode) setDraft('');
      setShowPresets(false);
    } catch (failure) {
      if (alive.current && auth.currentUser?.uid === uid) {
        setFailed(failure);
        const reason = failure?.details?.metadata?.reason;
        if (['MESSAGE_CLOSED', 'QUICK_MESSAGE_NOT_ALLOWED', 'MESSAGE_PEER_NOT_READY'].includes(reason)) retry();
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return <SafeAreaView style={styles.screen} edges={['bottom']}>
    <Stack.Screen options={{ headerShown: true, title: 'Mensagens da corrida', headerBackTitle: 'Voltar', headerTintColor: colors.primary, headerLeft: () => <Action label="Voltar" onPress={() => router.canGoBack() ? router.back() : router.replace(role === 'driver' ? '/driver-home' : '/passenger-home')} /> }} />
    <View style={styles.container}>
      <View style={styles.banner}>
        <Text style={styles.title}>{open ? 'Combine o encontro' : loading ? 'Abrindo conversa…' : 'Histórico da conversa'}</Text>
        <Text style={styles.hint}>{open
          ? role === 'driver' ? 'Responda somente com o veículo parado. Para anunciar a chegada, use “Cheguei” na corrida.' : 'Envie uma referência para facilitar o embarque.'
          : 'O envio fica disponível após o aceite e até o início da corrida.'}</Text>
      </View>

      {error ? <View style={styles.notice} accessibilityLiveRegion="polite">
        <Text style={styles.error}>Não foi possível atualizar a conversa. Verifique sua conexão.</Text>
        <Action label="Tentar novamente" onPress={retry} />
      </View> : null}

      {loading && messages.length === 0 ? <View style={styles.empty}><ActivityIndicator color={colors.primary} /><Text style={styles.hint}>Carregando mensagens…</Text></View>
        : messages.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>Tudo pronto para combinar o encontro</Text><Text style={styles.hint}>As mensagens desta corrida aparecem aqui.</Text></View>
          : <FlatList testID="message-history" data={messages} inverted keyExtractor={(item) => item.messageId}
            renderItem={({ item }) => <MessageBubble message={item} role={role} />}
            contentContainerStyle={styles.history} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
            ListFooterComponent={hasMore ? <Action label={loading ? 'Carregando…' : 'Mensagens anteriores'} disabled={loading} onPress={() => setPageSize((size) => size + 50)} /> : null} />}

      {open ? <ScrollView style={styles.composerScroll} contentContainerStyle={styles.composer} keyboardShouldPersistTaps="handled">
        {!ready ? <Text style={styles.hint}>Texto livre disponível quando a outra pessoa abrir esta corrida na versão atualizada. Por enquanto, use as respostas rápidas.</Text> : null}
        <Action label={showPresets ? 'Fechar respostas rápidas' : 'Respostas rápidas'} onPress={() => setShowPresets((value) => !value)} disabled={busy} />
        {showPresets ? <View style={styles.presets}>
          {options.map((item) => <Action key={item.code} label={item.text}
            onPress={() => send({ messageCode: item.code })} disabled={busy} />)}
        </View> : null}
        {ready ? <>
          <TextInput testID="message-input" accessibilityLabel="Mensagem para esta corrida" placeholder="Escreva uma mensagem…"
            placeholderTextColor={colors.textMuted} style={[styles.input, { maxHeight: height * 0.18 }]}
            multiline scrollEnabled textAlignVertical="top" onFocus={() => setShowPresets(false)} value={draft} onChangeText={setDraft}
            editable={!busy} maxLength={MESSAGE_MAX_LENGTH * 2} />
          <View style={[styles.sendRow, fontScale > 1.4 && styles.stacked]}>
            <Text style={[styles.hint, remaining < 0 && styles.error]}>{count}/{MESSAGE_MAX_LENGTH}</Text>
            <Action testID="send-message" primary label={busy ? 'Enviando…' : failed && attempt.current?.text === draft.trim() ? 'Tentar envio novamente' : 'Enviar mensagem'}
              disabled={busy || count === 0 || remaining < 0} onPress={() => send({ text: draft.trim() })} />
          </View>
        </> : null}
        {busy ? <Text accessibilityLiveRegion="polite" style={styles.hint}>Enviando…</Text> : null}
        {failed ? <View accessibilityLiveRegion="polite" style={styles.failure}>
          <Text style={styles.error}>{messageFailure(failed)}</Text>
          {attempt.current?.messageCode ? <Action label="Reenviar resposta rápida" onPress={() => send({ messageCode: attempt.current.messageCode })} disabled={busy} /> : null}
          {failed?.details?.metadata?.traceId ? <Text selectable style={styles.reference}>Referência: {failed.details.metadata.traceId}</Text> : null}
        </View> : null}
      </ScrollView> : !loading && !error ? <View style={styles.closed}><Text style={styles.hint}>Somente consulta · Novas mensagens não podem ser enviadas nesta etapa.</Text></View> : null}

    </View>
  </SafeAreaView>;
}

export default function RideConversationScreen({ role }) {
  const params = useLocalSearchParams();
  const rideId = typeof params.rideId === 'string' ? params.rideId : null;
  const [uid, setUid] = useState(auth.currentUser?.uid || null);
  useEffect(() => auth.onAuthStateChanged((user) => setUid(user?.uid || null)), []);
  if (!uid || !rideId) return <SafeAreaView style={styles.screen}><Text style={styles.hint}>Entre na sua conta e abra uma corrida para ver as mensagens.</Text></SafeAreaView>;
  // A new account/ride gets fresh state; no draft or history can leak across them.
  return <Conversation key={`${uid}:${rideId}`} rideId={rideId} role={role} uid={uid} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, width: '100%', maxWidth: 680, alignSelf: 'center' },
  banner: { padding: 16, gap: 6, backgroundColor: colors.primaryTint },
  title: { fontFamily, fontSize: 19, fontWeight: '700', color: colors.primary },
  hint: { fontFamily, fontSize: 13, color: colors.textMuted, flexShrink: 1 },
  history: { padding: 16, gap: 12 },
  bubble: { padding: 14, borderRadius: 18, maxWidth: '92%', gap: 5 },
  ownBubble: { alignSelf: 'flex-end', backgroundColor: colors.primary, borderBottomRightRadius: 5 },
  otherBubble: { alignSelf: 'flex-start', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 5 },
  author: { fontFamily, fontSize: 12, fontWeight: '700', color: colors.primary },
  message: { fontFamily, fontSize: 16, color: colors.text },
  time: { fontFamily, fontSize: 11, color: colors.textMuted, alignSelf: 'flex-end' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  emptyTitle: { fontFamily, fontSize: 18, fontWeight: '700', color: colors.primary, textAlign: 'center' },
  composerScroll: { flexGrow: 0, maxHeight: '60%' },
  composer: { padding: 12, borderTopWidth: 1, borderColor: colors.border, gap: 8 },
  presets: { gap: 8, paddingVertical: 4 },
  input: { minHeight: 52, borderWidth: 1, borderColor: colors.textMuted, borderRadius: 12, padding: 12, fontFamily, fontSize: 16, color: colors.text, backgroundColor: colors.background },
  sendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  stacked: { flexDirection: 'column', alignItems: 'stretch' },
  action: { minHeight: 48, paddingVertical: 12, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 12, backgroundColor: colors.primaryTint },
  actionLabel: { fontFamily, fontSize: 14, fontWeight: '700', color: colors.primary, textAlign: 'center' },
  primaryAction: { backgroundColor: colors.primary },
  primaryLabel: { color: colors.onPrimary },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  error: { fontFamily, fontSize: 13, color: colors.danger },
  failure: { gap: 8 },
  notice: { padding: 12, gap: 8 },
  closed: { padding: 16, backgroundColor: colors.card },
  reference: { fontFamily, fontSize: 11, color: colors.textMuted },
});
