// Shared support center for passengers and drivers. Users select a closed category;
// no free-text, contact or attachment field exists in this pilot flow.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import Header from '../components/Header';
import AppBadge from '../components/AppBadge';
import AppButton from '../components/AppButton';
import AppCard from '../components/AppCard';
import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';
import {
  shortSupportReference,
  supportCategoryLabel,
  supportCategoryOptions,
  supportResolutionLabel,
  supportStatusLabel,
  SUPPORT_STATUS,
} from '../constants/support';
import {
  createSupportTicket,
  listMySupportTickets,
} from '../services/supportService';

const SAFE_SOURCES = new Set([
  'driver_home',
  'passenger_home',
  'active_ride',
  'driver_accepted',
  'pix_payment',
  'privacy_center',
]);

function firstString(value) {
  if (Array.isArray(value)) return value[0] || null;
  return typeof value === 'string' ? value : null;
}

function formatDate(value) {
  const atMs = Number(value || 0);
  if (!(atMs > 0)) return 'Data indisponível';
  return new Date(atMs).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function errorMessage(error) {
  const reason = error?.details?.metadata?.reason;
  if (reason === 'OPEN_TICKET_LIMIT') {
    return 'Você já possui várias solicitações abertas. Aguarde a análise antes de criar outra.';
  }
  if (reason === 'ACCOUNT_DELETION_PENDING') {
    return 'A conta está em processo de exclusão e não pode abrir uma nova solicitação.';
  }
  if (reason === 'CATEGORY_NOT_ALLOWED') {
    return 'Esta categoria não está disponível para sua conta.';
  }
  return 'Não foi possível registrar a solicitação. Verifique a conexão e tente novamente.';
}

function confirmCategory(label) {
  return new Promise((resolve) => {
    Alert.alert(
      'Enviar solicitação?',
      `${label}\n\nO DriveLocal anexará somente as referências técnicas necessárias. Nenhum contato ou texto pessoal será enviado.`,
      [
        { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
        { text: 'ENVIAR', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

function TicketCard({ ticket }) {
  const status = SUPPORT_STATUS[ticket.status] || { tone: 'neutral' };
  const rideReference = shortSupportReference(ticket.rideId);
  const paymentReference = shortSupportReference(ticket.paymentRequestId);
  const resolution = supportResolutionLabel(ticket.resolutionCode);

  return (
    <AppCard>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
        <Text style={[{ fontFamily, color: colors.text, flex: 1 }, typography.bodyBold]}>
          {supportCategoryLabel(ticket.categoryCode)}
        </Text>
        <AppBadge label={supportStatusLabel(ticket.status)} tone={status.tone} />
      </View>
      <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
        Criado em {formatDate(ticket.createdAtMs)}
      </Text>
      {rideReference ? (
        <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>
          Referência da corrida: {rideReference}
        </Text>
      ) : null}
      {paymentReference ? (
        <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>
          Referência do pagamento: {paymentReference}
        </Text>
      ) : null}
      {resolution ? (
        <Text style={[{ fontFamily, color: colors.success }, typography.small]}>
          Resultado: {resolution}
        </Text>
      ) : null}
    </AppCard>
  );
}

export default function SupportCenter() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const rideId = firstString(params.rideId);
  const requestedSource = firstString(params.source);
  const sourceRoute = SAFE_SOURCES.has(requestedSource) ? requestedSource : 'unknown';
  const [actorRole, setActorRole] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyCode, setBusyCode] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await listMySupportTickets();
      setActorRole(result?.actorRole || null);
      setTickets(Array.isArray(result?.tickets) ? result.tickets : []);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const categories = useMemo(
    () => supportCategoryOptions(actorRole, Boolean(rideId)),
    [actorRole, rideId],
  );

  async function handleCreate(category) {
    if (!category?.code || busyCode) return;
    const confirmed = await confirmCategory(category.label);
    if (!confirmed) return;

    setBusyCode(category.code);
    setError('');
    setSuccess('');
    try {
      const result = await createSupportTicket({
        categoryCode: category.code,
        rideId,
        sourceRoute,
      });
      setSuccess(result?.duplicate
        ? 'Esta solicitação já estava aberta. O ticket existente foi mantido.'
        : 'Solicitação registrada. Você pode acompanhar o status abaixo.');
      await load();
    } catch (createError) {
      setError(errorMessage(createError));
    } finally {
      setBusyCode(null);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      >
        <Header
          title="Ajuda e suporte"
          subtitle={rideId ? 'Solicitação vinculada à corrida' : 'Conta e pagamentos'}
          onBack={() => router.back()}
        />

        <AppCard>
          <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>
            Como podemos ajudar?
          </Text>
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
            Escolha uma categoria. As referências técnicas necessárias serão anexadas automaticamente.
          </Text>
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>
            Não envie CPF, telefone, endereço, chave Pix ou senha. Este fluxo não possui campo de texto.
          </Text>
        </AppCard>

        {actorRole && categories.length > 0 ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>
              Nova solicitação
            </Text>
            {categories.map((category) => (
              <AppButton
                key={category.code}
                title={busyCode === category.code ? 'ENVIANDO…' : category.label}
                variant="secondary"
                disabled={Boolean(busyCode)}
                onPress={() => handleCreate(category)}
              />
            ))}
          </AppCard>
        ) : null}

        {success ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.success }, typography.small]}>{success}</Text>
          </AppCard>
        ) : null}

        {error ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text>
          </AppCard>
        ) : null}

        <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>
          Minhas solicitações
        </Text>
        {!loading && tickets.length === 0 ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
              Nenhuma solicitação registrada.
            </Text>
          </AppCard>
        ) : null}
        {tickets.map((ticket) => <TicketCard key={ticket.ticketId} ticket={ticket} />)}
      </ScrollView>
    </SafeAreaView>
  );
}