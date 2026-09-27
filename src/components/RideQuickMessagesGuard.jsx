import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useGlobalSearchParams, useRouter } from 'expo-router';
import { auth } from '../config/firebase';
import { colors } from '../constants/colors';
import useRideConversation from '../hooks/use-ride-conversation';
import { conversationRoute, displayedMessage, messagePhaseOpen } from '../utils/ride-messages';

function roleForRoute(route) {
  const path = String(route || '').toLowerCase();
  if (path.includes('active-ride')) return 'driver';
  if (path.includes('driver-accepted')) return 'passenger';
  return null;
}

function Entry({ role, rideId }) {
  const router = useRouter();
  // Opening an active ride advertises the new UI automatically to its peer.
  const { messages, status, error, loading } = useRideConversation(rideId, role, 1);
  const latest = messages[0];
  return <Pressable accessibilityRole="button" accessibilityLabel="Abrir mensagens da corrida"
    onPress={() => router.push({ pathname: conversationRoute(role), params: { rideId } })}
    style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}>
    <View style={styles.copy}>
      <Text style={styles.title}>Mensagens da corrida</Text>
      <Text style={styles.preview} numberOfLines={2}>{error ? 'Toque para tentar abrir a conversa.' : latest
        ? `${latest.senderRole === role ? 'Você' : role === 'driver' ? 'Passageiro' : 'Motorista'}: ${displayedMessage(latest)}`
        : loading ? 'Abrindo conversa…' : messagePhaseOpen(status) ? 'Combine o encontro por aqui.' : 'Consultar histórico da conversa.'}</Text>
    </View>
    <Text style={styles.arrow}>›</Text>
  </Pressable>;
}

export default function RideQuickMessagesGuard({ route }) {
  const params = useGlobalSearchParams();
  const rideId = typeof params?.rideId === 'string' ? params.rideId : null;
  const role = roleForRoute(route);
  const [uid, setUid] = useState(auth.currentUser?.uid || null);
  useEffect(() => auth.onAuthStateChanged((user) => setUid(user?.uid || null)), []);
  if (!role || !rideId || !uid) return null;
  return <Entry key={`${uid}:${rideId}:${role}`} rideId={rideId} role={role} />;
}

const styles = StyleSheet.create({
  card: { minHeight: 64, marginHorizontal: 16, marginTop: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, flexDirection: 'row', alignItems: 'center', gap: 12 },
  copy: { flex: 1, gap: 4 },
  title: { fontSize: 15, fontWeight: '700', color: colors.primary },
  preview: { fontSize: 13, color: colors.textMuted },
  arrow: { fontSize: 28, color: colors.primary },
});
