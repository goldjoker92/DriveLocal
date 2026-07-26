// Admin support queue. The screen receives privacy-safe server projections only and
// changes status through predefined resolution codes; no free admin note exists.

import { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import Header from '../../components/Header';
import AppBadge from '../../components/AppBadge';
import AppButton from '../../components/AppButton';
import AppCard from '../../components/AppCard';
import { colors } from '../../constants/colors';
import { radius, spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import {
  shortSupportReference,
  supportCategoryLabel,
  supportResolutionLabel,
  supportStatusLabel,
  SUPPORT_RESOLUTIONS,
  SUPPORT_STATUS,
} from '../../constants/support';
import {
  listAdminSupportTickets,
  updateAdminSupportTicket,
} from '../../services/adminService';

const FILTERS = Object.freeze([
  { code: 'open', label: 'Abertos' },
  { code: 'in_review', label: 'Em análise' },
  { code: 'resolved', label: 'Resolvidos' },
  { code: 'closed', label: 'Encerrados' },
  { code: 'all', label: 'Todos' },
]);

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

function money(value) {
  const cents = Number(value || 0);
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function trace(event, details = {}, level = 'log') {
  const method = console[level] || console.log;
  method(`[ADMIN_SUPPORT] ${event}`, {
    scope: 'admin_support',
    event,
    atMs: Date.now(),
    ...details,
  });
}

function TicketContext({ ticket }) {
  const ride = ticket.contextSnapshot?.ride;
  const payment = ticket.contextSnapshot?.payment;
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>
        Ator: {ticket.actorRole} · {ticket.actorHash || 'hash indisponível'}
      </Text>
      {ticket.rideId ? (
        <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>
          Corrida: {shortSupportReference(ticket.rideId)} · {ride?.status || 'status desconhecido'}
        </Text>
      ) : null}
      {ride?.vehicleType ? (
        <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>
          Veículo: {ride.vehicleType}
        </Text>
      ) : null}
      {ride?.paymentAmountCentavos ? (
        <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>
          Pagamento da corrida: {money(ride.paymentAmountCentavos)} · {ride.passengerMarkedPaid ? 'informado' : 'não informado'}
        </Text>
      ) : null}
      {ticket.paymentRequestId ? (
        <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>
          Pagamento interno: {shortSupportReference(ticket.paymentRequestId)} · {payment?.status || 'status desconhecido'}
        </Text>
      ) : null}
      {ticket.providerOrderId ? (
        <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>
          Ordem do provedor: {shortSupportReference(ticket.providerOrderId)}
        </Text>
      ) : null}
      {payment?.amountCentavos ? (
        <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>
          Valor: {money(payment.amountCentavos)} · {payment.purpose || 'pagamento'}
        </Text>
      ) : null}
    </View>
  );
}

export default function SupportTicketsAdmin() {
  const router = useRouter();
  const [filter, setFilter] = useState('open');
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyTicketId, setBusyTicketId] = useState(null);
  const [resolutionTicket, setResolutionTicket] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await listAdminSupportTickets(filter, 100);
      setTickets(result);
      trace('tickets.loaded', { filter, ticketCount: result.length });
    } catch (loadError) {
      trace('tickets.load_failed', {
        filter,
        reason: loadError?.code || loadError?.name || 'unknown',
      }, 'warn');
      setError('Não foi possível carregar os tickets. Puxe para atualizar.');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function update(ticket, status, resolutionCode = null) {
    if (!ticket?.ticketId || busyTicketId) return;
    setBusyTicketId(ticket.ticketId);
    setError('');
    trace('ticket.update_requested', {
      ticketId: ticket.ticketId,
      fromStatus: ticket.status,
      toStatus: status,
      resolutionCode,
    });
    try {
      await updateAdminSupportTicket({
        ticketId: ticket.ticketId,
        status,
        resolutionCode,
      });
      trace('ticket.update_succeeded', {
        ticketId: ticket.ticketId,
        toStatus: status,
        resolutionCode,
      });
      setResolutionTicket(null);
      await load();
    } catch (updateError) {
      trace('ticket.update_failed', {
        ticketId: ticket.ticketId,
        toStatus: status,
        reason: updateError?.code || updateError?.name || 'unknown',
      }, 'warn');
      setError('Não foi possível atualizar o ticket. Recarregue e tente novamente.');
    } finally {
      setBusyTicketId(null);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      >
        <Header title="Tickets de suporte" subtitle="Fila operacional segura" onBack={() => router.back()} />

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {FILTERS.map((item) => {
            const selected = item.code === filter;
            return (
              <Pressable
                key={item.code}
                onPress={() => setFilter(item.code)}
                style={{
                  borderWidth: 1,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.primary : colors.card,
                  borderRadius: radius.full,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                }}
              >
                <Text style={[
                  { fontFamily, color: selected ? colors.onPrimary : colors.textMuted },
                  typography.small,
                ]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {error ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text>
          </AppCard>
        ) : null}

        {!loading && tickets.length === 0 ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
              Nenhum ticket neste filtro.
            </Text>
          </AppCard>
        ) : null}

        {tickets.map((ticket) => {
          const status = SUPPORT_STATUS[ticket.status] || { tone: 'neutral' };
          const resolution = supportResolutionLabel(ticket.resolutionCode);
          const busy = busyTicketId === ticket.ticketId;
          return (
            <AppCard key={ticket.ticketId}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                <Text style={[{ fontFamily, color: colors.text, flex: 1 }, typography.bodyBold]}>
                  {supportCategoryLabel(ticket.categoryCode)}
                </Text>
                <AppBadge label={supportStatusLabel(ticket.status)} tone={status.tone} />
              </View>
              <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
                Criado em {formatDate(ticket.createdAtMs)} · origem {ticket.sourceRoute || 'unknown'}
              </Text>
              <TicketContext ticket={ticket} />
              {resolution ? (
                <Text style={[{ fontFamily, color: colors.success }, typography.small]}>
                  Resultado: {resolution}
                </Text>
              ) : null}

              {ticket.status === 'open' ? (
                <AppButton
                  title={busy ? 'ATUALIZANDO…' : 'MARCAR EM ANÁLISE'}
                  variant="secondary"
                  disabled={Boolean(busyTicketId)}
                  onPress={() => update(ticket, 'in_review')}
                />
              ) : null}
              {ticket.status === 'resolved' || ticket.status === 'closed' ? (
                <AppButton
                  title={busy ? 'ATUALIZANDO…' : 'REABRIR'}
                  variant="secondary"
                  disabled={Boolean(busyTicketId)}
                  onPress={() => update(ticket, 'open')}
                />
              ) : (
                <AppButton
                  title="RESOLVER"
                  disabled={Boolean(busyTicketId)}
                  onPress={() => setResolutionTicket(ticket)}
                />
              )}
              {ticket.status !== 'closed' ? (
                <AppButton
                  title="ENCERRAR COMO DUPLICADO"
                  variant="ghost"
                  disabled={Boolean(busyTicketId)}
                  onPress={() => update(ticket, 'closed', 'duplicate_ticket')}
                />
              ) : null}
            </AppCard>
          );
        })}
      </ScrollView>

      <Modal
        visible={Boolean(resolutionTicket)}
        transparent
        animationType="fade"
        onRequestClose={() => !busyTicketId && setResolutionTicket(null)}
      >
        <View style={styles.backdrop}>
          <View style={styles.modalCard}>
            <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>
              Resultado do ticket
            </Text>
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
              Escolha um resultado operacional. Nenhuma nota livre será registrada.
            </Text>
            <ScrollView contentContainerStyle={{ gap: spacing.sm }}>
              {Object.entries(SUPPORT_RESOLUTIONS)
                .filter(([code]) => code !== 'duplicate_ticket')
                .map(([code, label]) => (
                  <AppButton
                    key={code}
                    title={busyTicketId === resolutionTicket?.ticketId ? 'ATUALIZANDO…' : label}
                    variant="secondary"
                    disabled={Boolean(busyTicketId)}
                    onPress={() => update(resolutionTicket, 'resolved', code)}
                  />
                ))}
            </ScrollView>
            <AppButton
              title="FECHAR"
              variant="ghost"
              disabled={Boolean(busyTicketId)}
              onPress={() => setResolutionTicket(null)}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = {
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
};