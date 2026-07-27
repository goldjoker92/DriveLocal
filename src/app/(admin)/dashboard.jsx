// DriveLocal admin command center (route "/dashboard").
//
// Information hierarchy is intentionally operational:
//   1. what requires the solo operator's attention now;
//   2. live supply and the selected-period result;
//   3. expandable analysis and specialist queues.
//
// Privacy: business metrics and queues are privacy-safe server projections. The
// dashboard never downloads raw financial ledgers, Pix payloads, private documents
// or precise passenger coordinates.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import {
  ActionRow,
  DisclosureSection,
  InsightCard,
  KpiCard,
  MetricRow,
  ProgressMetric,
  SectionHeading,
  StatusBanner,
} from '../../components/admin/AdminDashboardPrimitives';
import { colors } from '../../constants/colors';
import { radius, spacing } from '../../constants/spacing';
import { fontFamily, typography } from '../../constants/typography';
import { formatBRL } from '../../utils/format';
import {
  getAdminBusinessAnalytics,
  listAdminAlerts,
  listAdminSupportTickets,
  listDisputedRides,
  listDriversByStatus,
} from '../../services/adminService';

const PERIODS = Object.freeze([
  { days: 1, label: 'Hoje' },
  { days: 7, label: '7 dias' },
  { days: 30, label: '30 dias' },
  { days: 90, label: '90 dias' },
]);

const INITIAL_EXPANDED = Object.freeze({
  drivers: true,
  finance: false,
  subscriptions: false,
  vehicles: false,
  demand: false,
  peaks: false,
  operations: false,
});

const money = (value) => formatBRL(Number(value || 0));
const number = (value) => Number(value || 0).toLocaleString('pt-BR');
const decimal = (value) => Number(value || 0).toLocaleString('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const percentage = (value) => `${(Number(value || 0) * 100).toFixed(1).replace('.', ',')}%`;
const hourLabel = (hour) => `${String(Number(hour || 0)).padStart(2, '0')}h–${String((Number(hour || 0) + 1) % 24).padStart(2, '0')}h`;

function traceDashboard(event, details = {}, level = 'log') {
  const method = console[level] || console.log;
  method(`[ADMIN_COMMAND_CENTER] ${event}`, {
    scope: 'admin_command_center',
    event,
    atMs: Date.now(),
    ...details,
  });
}

function safeTimestamp(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function oldestTimestamp(items, keys) {
  return (items || []).reduce((oldest, item) => {
    const current = keys
      .map((key) => safeTimestamp(item?.[key]))
      .find(Boolean);
    if (!current) return oldest;
    return oldest == null ? current : Math.min(oldest, current);
  }, null);
}

function relativeAge(atMs, nowMs = Date.now()) {
  const timestamp = safeTimestamp(atMs);
  if (!timestamp) return 'idade indisponível';
  const ageMinutes = Math.max(0, Math.floor((Number(nowMs) - timestamp) / 60_000));
  if (ageMinutes < 1) return 'agora';
  if (ageMinutes < 60) return `há ${ageMinutes} min`;
  const ageHours = Math.floor(ageMinutes / 60);
  if (ageHours < 24) return `há ${ageHours} h`;
  const ageDays = Math.floor(ageHours / 24);
  return `há ${ageDays} dia${ageDays > 1 ? 's' : ''}`;
}

function rate(numerator, denominator) {
  const total = Number(denominator || 0);
  if (!(total > 0)) return 0;
  return Math.max(0, Number(numerator || 0) / total);
}

function PeriodSelector({ selectedDays, onSelect }) {
  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
      {PERIODS.map((period) => {
        const selected = period.days === selectedDays;
        return (
          <Pressable
            key={period.days}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onSelect(period.days)}
            style={({ pressed }) => ({
              borderRadius: radius.full,
              borderWidth: 1,
              borderColor: selected ? colors.primary : colors.border,
              backgroundColor: selected ? colors.primary : colors.card,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              opacity: pressed ? 0.68 : 1,
            })}
          >
            <Text style={[
              { fontFamily, color: selected ? colors.onPrimary : colors.textMuted },
              typography.small,
            ]}>
              {period.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function KpiGrid({ children }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.md }}>
      {children}
    </View>
  );
}

function KpiCell({ children }) {
  return <View style={{ width: '48%' }}>{children}</View>;
}

function VehicleFinanceCard({ label, icon, data }) {
  const requests = Number(data?.requests || 0);
  const completed = Number(data?.completed || 0);
  return (
    <AppCard style={{ width: '48%', padding: spacing.md }}>
      <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>{icon} {label}</Text>
      <MetricRow label="Solicitações" value={number(requests)} />
      <MetricRow
        label="Concluídas"
        value={`${number(completed)} · ${percentage(rate(completed, requests))}`}
        strong
        tone="success"
      />
      <MetricRow label="Sem motorista" value={number(data?.noDriverAvailable)} tone="warning" />
      <MetricRow label="Comissão capturada" value={money(data?.commissionCapturedCentavos)} />
      <MetricRow label="Em disputa" value={money(data?.commissionDisputedCentavos)} tone="danger" />
    </AppCard>
  );
}

function PeakList({ rows, valueLabel, valueKey }) {
  const visible = (rows || []).filter((row) => Number(row?.[valueKey] || 0) > 0).slice(0, 5);
  if (visible.length === 0) {
    return (
      <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
        Ainda não há dados suficientes para este período.
      </Text>
    );
  }
  return visible.map((row, index) => (
    <MetricRow
      key={`${row.hour}-${index}-${valueKey}`}
      label={`${index + 1}. ${hourLabel(row.hour)}`}
      value={valueLabel(row)}
      strong={index === 0}
      tone={index === 0 ? 'primary' : 'neutral'}
    />
  ));
}

function DemandSupplyList({ rows }) {
  const visible = [...(rows || [])]
    .filter((row) => Number(row.requests || 0) > 0 || Number(row.averageOnlineDrivers || 0) > 0)
    .sort((a, b) => {
      const aPressure = a.requestsPerAvailableDriver == null ? -1 : a.requestsPerAvailableDriver;
      const bPressure = b.requestsPerAvailableDriver == null ? -1 : b.requestsPerAvailableDriver;
      return bPressure - aPressure || Number(b.noDriverAvailable || 0) - Number(a.noDriverAvailable || 0);
    })
    .slice(0, 5);

  if (visible.length === 0) {
    return (
      <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
        As médias de oferta aparecerão após os primeiros snapshots horários.
      </Text>
    );
  }

  return visible.map((row, index) => (
    <MetricRow
      key={`supply-${row.hour}`}
      label={`${index + 1}. ${hourLabel(row.hour)}`}
      value={row.requestsPerAvailableDriver == null
        ? 'sem motorista disponível'
        : `${decimal(row.requestsPerAvailableDriver)} pedido(s) / disponível`}
      strong={index === 0}
      tone={index === 0 ? 'warning' : 'neutral'}
      hint={`${number(row.requests)} pedidos · média ${decimal(row.averageAvailableDrivers)} disponíveis · ${number(row.noDriverAvailable)} não atendidos`}
    />
  ));
}

function buildAutomaticComment({
  dataReady,
  criticalCount,
  highCount,
  availableNow,
  requests,
  completed,
  noDriverAvailable,
  captureRate,
  pendingDrivers,
}) {
  if (!dataReady) {
    return {
      tone: 'primary',
      icon: '⏳',
      title: 'Montando a leitura da operação',
      message: 'Os indicadores e as filas estão sendo sincronizados antes de gerar uma orientação.',
    };
  }

  const completionRate = rate(completed, requests);
  const unservedRate = rate(noDriverAvailable, requests);

  if (criticalCount > 0) {
    return {
      tone: 'danger',
      icon: '🚨',
      title: `${criticalCount} alerta${criticalCount > 1 ? 's críticos exigem' : ' crítico exige'} ação`,
      message: 'Abra a fila de alertas antes das análises. Incidentes críticos têm prioridade sobre crescimento e receita.',
    };
  }
  if (requests > 0 && availableNow === 0) {
    return {
      tone: 'danger',
      icon: '📍',
      title: 'Há demanda, mas nenhum motorista disponível agora',
      message: 'Acompanhe as próximas solicitações e acione os motoristas fundadores. O risco imediato é perder corridas por falta de oferta.',
    };
  }
  if (unservedRate >= 0.15) {
    return {
      tone: 'warning',
      icon: '⚡',
      title: 'A oferta de motoristas está abaixo da demanda',
      message: `${percentage(unservedRate)} dos pedidos ficaram sem motorista no período. Priorize disponibilidade nos horários de maior pressão.`,
    };
  }
  if (Number(captureRate || 0) > 0 && Number(captureRate || 0) < 0.9) {
    return {
      tone: 'warning',
      icon: '💳',
      title: 'A captura de comissão merece revisão',
      message: `A taxa está em ${percentage(captureRate)}. Verifique retenções, disputas e carteiras antes de considerar a receita fechada.`,
    };
  }
  if (requests >= 5 && completionRate < 0.65) {
    return {
      tone: 'warning',
      icon: '🧭',
      title: 'Muitas solicitações não estão chegando ao fim',
      message: `A realização está em ${percentage(completionRate)}. Observe atribuição, cancelamentos e tempo de chegada para localizar a perda.`,
    };
  }
  if (pendingDrivers >= 5) {
    return {
      tone: 'warning',
      icon: '🪪',
      title: 'A fila de motoristas pode limitar o crescimento',
      message: `${pendingDrivers} cadastros aguardam análise. Liberar bons motoristas agora aumenta a oferta sem gastar em aquisição.`,
    };
  }
  if (requests === 0) {
    return {
      tone: 'primary',
      icon: '🌱',
      title: 'Ainda não há movimento suficiente para uma conclusão',
      message: 'Use este momento para validar motoristas, testar o fluxo completo e preparar a aquisição local antes da abertura.',
    };
  }
  if (highCount > 0) {
    return {
      tone: 'warning',
      icon: '🔎',
      title: 'A operação funciona, mas há pendências de alta prioridade',
      message: 'Trate os alertas altos hoje para impedir que pequenos problemas virem disputas, perda financeira ou suporte acumulado.',
    };
  }
  return {
    tone: 'success',
    icon: '✅',
    title: 'A operação está equilibrada neste momento',
    message: `${percentage(completionRate)} dos pedidos foram concluídos e não há alerta crítico aberto. Continue observando oferta, cancelamentos e captura.`,
  };
}

export default function Dashboard() {
  const router = useRouter();
  const [rangeDays, setRangeDays] = useState(1);
  const [data, setData] = useState(null);
  const [queues, setQueues] = useState({ alerts: [], tickets: [], disputes: [], pendingDrivers: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [queueWarning, setQueueWarning] = useState('');
  const [expanded, setExpanded] = useState(INITIAL_EXPANDED);
  const [clockMs, setClockMs] = useState(Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setQueueWarning('');
    traceDashboard('load.started', { rangeDays });

    const results = await Promise.allSettled([
      getAdminBusinessAnalytics(rangeDays),
      listAdminAlerts('open', 'all', 100),
      listAdminSupportTickets('open', 100),
      listDisputedRides(100),
      listDriversByStatus('pending_review', 100),
    ]);

    const [analyticsResult, alertsResult, ticketsResult, disputesResult, driversResult] = results;
    if (analyticsResult.status === 'rejected') {
      traceDashboard('load.failed', {
        rangeDays,
        reason: analyticsResult.reason?.code || analyticsResult.reason?.name || 'unknown',
      }, 'warn');
      setError('Não foi possível carregar os indicadores. Puxe para atualizar.');
      setLoading(false);
      return;
    }

    const nextQueues = {
      alerts: alertsResult.status === 'fulfilled' ? alertsResult.value : [],
      tickets: ticketsResult.status === 'fulfilled' ? ticketsResult.value : [],
      disputes: disputesResult.status === 'fulfilled' ? disputesResult.value : [],
      pendingDrivers: driversResult.status === 'fulfilled' ? driversResult.value : [],
    };
    const partialFailures = results.slice(1).filter((result) => result.status === 'rejected').length;

    setData(analyticsResult.value);
    setQueues(nextQueues);
    if (partialFailures > 0) {
      setQueueWarning('Algumas filas não responderam. Os indicadores principais continuam válidos; atualize novamente para completar as ações.');
    }
    setClockMs(Date.now());
    setLoading(false);

    traceDashboard('load.succeeded', {
      rangeDays,
      generatedAtMs: analyticsResult.value?.generatedAtMs,
      openAlerts: nextQueues.alerts.length,
      openTickets: nextQueues.tickets.length,
      openDisputes: nextQueues.disputes.length,
      pendingDrivers: nextQueues.pendingDrivers.length,
      partialFailures,
      truncated: analyticsResult.value?.truncated,
    });
  }, [rangeDays]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => setClockMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const revenue = data?.revenue || {};
  const rides = data?.rides || {};
  const drivers = data?.drivers || {};
  const analyticsAlerts = data?.alerts || {};
  const supply = data?.supply || {};
  const latestSupply = supply.latest || {};
  const totals = rides.total || {};

  const requests = Number(totals.requests || 0);
  const assigned = Number(totals.assigned || 0);
  const started = Number(totals.started || 0);
  const completed = Number(totals.completed || 0);
  const noDriverAvailable = Number(totals.noDriverAvailable || 0);
  const cancelled = Number(totals.cancelled || 0);
  const disputed = Number(totals.disputed || 0);
  const availableNow = Number(latestSupply.available?.total || 0);
  const onlineNow = Number(latestSupply.online?.total ?? drivers.online ?? 0);
  const busyNow = Number(latestSupply.busy?.total || 0);

  const queueCritical = queues.alerts.filter((alert) => alert?.severity === 'critical').length;
  const queueHigh = queues.alerts.filter((alert) => alert?.severity === 'high').length;
  const criticalCount = Math.max(queueCritical, Number(analyticsAlerts.critical || 0));
  const highCount = Math.max(queueHigh, Number(analyticsAlerts.high || 0));
  const alertCount = Math.max(queues.alerts.length, Number(analyticsAlerts.open || 0));
  const ticketCount = queues.tickets.length;
  const disputeCount = Math.max(queues.disputes.length, disputed);
  const pendingCount = Math.max(queues.pendingDrivers.length, Number(drivers.pendingReview || 0));
  const lowWalletCount = Number(drivers.lowWallet?.total || 0);
  const expiringCount = Number(drivers.expiringWithin7Days?.total || 0);

  const completionRate = rate(completed, requests);
  const assignmentRate = rate(assigned, requests);
  const startRate = rate(started, requests);
  const unservedRate = rate(noDriverAvailable, requests);
  const cancellationRate = rate(cancelled, requests);

  const oldestAlertAt = oldestTimestamp(queues.alerts, ['firstDetectedAtMs', 'lastDetectedAtMs', 'updatedAtMs']);
  const oldestTicketAt = oldestTimestamp(queues.tickets, ['createdAtMs', 'updatedAtMs']);
  const oldestDisputeAt = oldestTimestamp(queues.disputes, ['disputedAtMs', 'updatedAtMs', 'createdAtMs']);
  const oldestPendingAt = oldestTimestamp(queues.pendingDrivers, ['createdAtMs', 'submittedAtMs', 'updatedAtMs']);

  const actionItems = useMemo(() => [
    {
      key: 'alerts',
      icon: criticalCount > 0 ? '🚨' : '🔔',
      title: criticalCount > 0 ? 'Alertas críticos e operacionais' : 'Alertas operacionais',
      count: alertCount,
      detail: alertCount > 0 ? `Mais antigo ${relativeAge(oldestAlertAt, clockMs)}` : 'Nenhum alerta aberto',
      tone: criticalCount > 0 ? 'danger' : 'warning',
      route: '/admin-alerts',
    },
    {
      key: 'disputes',
      icon: '⚖️',
      title: 'Disputas de corrida',
      count: disputeCount,
      detail: disputeCount > 0 ? `Mais antiga ${relativeAge(oldestDisputeAt, clockMs)}` : 'Nenhuma disputa aberta',
      tone: disputeCount > 0 ? 'warning' : 'success',
      route: '/ride-disputes',
    },
    {
      key: 'tickets',
      icon: '💬',
      title: 'Tickets sem resposta',
      count: ticketCount,
      detail: ticketCount > 0 ? `Mais antigo ${relativeAge(oldestTicketAt, clockMs)}` : 'Fila de suporte vazia',
      tone: ticketCount >= 5 ? 'danger' : 'warning',
      route: '/support-tickets',
    },
    {
      key: 'drivers',
      icon: '🪪',
      title: 'Motoristas aguardando análise',
      count: pendingCount,
      detail: pendingCount > 0 ? `Mais antigo ${relativeAge(oldestPendingAt, clockMs)}` : 'Nenhum cadastro pendente',
      tone: pendingCount >= 10 ? 'danger' : 'warning',
      route: '/drivers-pending',
    },
    {
      key: 'wallets',
      icon: '👛',
      title: 'Carteiras próximas do bloqueio',
      count: lowWalletCount,
      detail: 'Saldo igual ou inferior a R$ 3',
      tone: lowWalletCount > 0 ? 'warning' : 'success',
      route: '/wallets',
    },
    {
      key: 'subscriptions',
      icon: '📅',
      title: 'Assinaturas expirando em 7 dias',
      count: expiringCount,
      detail: 'Antecipe comunicação e renovação',
      tone: expiringCount > 0 ? 'primary' : 'success',
      route: '/wallets',
    },
  ].filter((item) => Number(item.count || 0) > 0), [
    alertCount,
    clockMs,
    criticalCount,
    disputeCount,
    expiringCount,
    lowWalletCount,
    oldestAlertAt,
    oldestDisputeAt,
    oldestPendingAt,
    oldestTicketAt,
    pendingCount,
    ticketCount,
  ]);

  const urgentActionCount = actionItems.reduce((sum, item) => sum + Number(item.count || 0), 0);
  const operationTone = criticalCount > 0
    ? 'danger'
    : (highCount > 0 || disputeCount > 0 || ticketCount >= 5 || unservedRate >= 0.15)
      ? 'warning'
      : 'success';

  const operationTitle = operationTone === 'danger'
    ? 'Ação imediata necessária'
    : operationTone === 'warning'
      ? 'A operação pede atenção hoje'
      : 'Operação sob controle';

  const operationMessage = operationTone === 'danger'
    ? `${criticalCount} alerta${criticalCount > 1 ? 's críticos estão' : ' crítico está'} aberto${criticalCount > 1 ? 's' : ''}. Trate a origem antes de continuar a análise.`
    : operationTone === 'warning'
      ? `${urgentActionCount} item${urgentActionCount !== 1 ? 's' : ''} distribuído${urgentActionCount !== 1 ? 's' : ''} nas filas de trabalho. Comece pela lista abaixo.`
      : actionItems.length === 0
        ? 'Nenhuma fila operacional exige ação neste momento. Acompanhe oferta, demanda e receita.'
        : 'Não há alerta crítico. As pendências existentes podem ser tratadas pela ordem apresentada.';

  const automaticComment = buildAutomaticComment({
    dataReady: Boolean(data),
    criticalCount,
    highCount,
    availableNow,
    requests,
    completed,
    noDriverAvailable,
    captureRate: revenue.captureRate,
    pendingDrivers: pendingCount,
  });

  useEffect(() => {
    if (!data) return;
    traceDashboard('comment.generated', {
      rangeDays,
      tone: automaticComment.tone,
      criticalCount,
      availableNow,
      requests,
      completionRate,
      unservedRate,
    });
  }, [automaticComment.tone, availableNow, completionRate, criticalCount, data, rangeDays, requests, unservedRate]);

  function openRoute(route, source) {
    traceDashboard('action.opened', { source, route });
    router.push(route);
  }

  function changePeriod(days) {
    traceDashboard('period.changed', { fromDays: rangeDays, toDays: days });
    setRangeDays(days);
  }

  function toggleSection(section) {
    setExpanded((current) => {
      const nextValue = !current[section];
      traceDashboard('section.toggled', { section, expanded: nextValue });
      return { ...current, [section]: nextValue };
    });
  }

  const displayNumber = (value) => (data ? number(value) : loading ? '…' : '—');
  const displayMoney = (value) => (data ? money(value) : loading ? '…' : '—');
  const displayPercent = (value) => (data ? percentage(value) : loading ? '…' : '—');
  const periodLabel = PERIODS.find((period) => period.days === rangeDays)?.label || `${rangeDays} dias`;
  const generatedLabel = data?.generatedAtMs
    ? `Atualizado ${relativeAge(data.generatedAtMs, clockMs)}`
    : loading ? 'Atualizando indicadores…' : 'Atualização indisponível';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      >
        <Header title="Painel DriveLocal" subtitle="Centro de comando · Horizonte / CE" onBack={() => router.back()} />

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>{generatedLabel}</Text>
            <Text style={[{ fontFamily, color: colors.textFaint }, typography.caption]}>
              Arraste para baixo ou toque em atualizar.
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={load}
            disabled={loading}
            style={({ pressed }) => ({
              borderRadius: radius.full,
              backgroundColor: colors.primaryTint,
              borderWidth: 1,
              borderColor: colors.primary,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              opacity: loading ? 0.5 : pressed ? 0.65 : 1,
            })}
          >
            <Text style={[{ fontFamily, color: colors.primary }, typography.small]}>
              {loading ? 'ATUALIZANDO…' : '↻ ATUALIZAR'}
            </Text>
          </Pressable>
        </View>

        <StatusBanner
          icon={operationTone === 'danger' ? '🚨' : operationTone === 'warning' ? '⚡' : '✅'}
          tone={operationTone}
          eyebrow={operationTone === 'success' ? 'Saúde operacional' : 'Prioridade operacional'}
          title={operationTitle}
          message={operationMessage}
          actionLabel={alertCount > 0 ? 'Abrir alertas' : null}
          onPress={alertCount > 0 ? () => openRoute('/admin-alerts', 'health_banner') : null}
        />

        <InsightCard
          icon={automaticComment.icon}
          tone={automaticComment.tone}
          title={automaticComment.title}
          message={automaticComment.message}
          footer={`Leitura baseada em ${periodLabel.toLowerCase()}, nas filas abertas e no último snapshot de oferta.`}
        />

        {error ? (
          <StatusBanner
            icon="⛔"
            tone="danger"
            eyebrow="Falha de atualização"
            title="Os indicadores não foram carregados"
            message={error}
            actionLabel="Tentar novamente"
            onPress={load}
          />
        ) : null}

        {queueWarning ? (
          <StatusBanner
            icon="↻"
            tone="warning"
            eyebrow="Atualização parcial"
            title="Algumas filas estão temporariamente indisponíveis"
            message={queueWarning}
            actionLabel="Atualizar"
            onPress={load}
          />
        ) : null}

        <SectionHeading
          icon="🎯"
          title="À tratar agora"
          subtitle="Ordene o trabalho pelo risco e pela idade da fila."
          actionLabel={actionItems.length > 0 ? `${urgentActionCount} pendência${urgentActionCount !== 1 ? 's' : ''}` : null}
          onAction={actionItems.length > 0 ? () => openRoute('/admin-alerts', 'action_heading') : null}
        />

        {actionItems.length > 0 ? actionItems.map((item) => (
          <ActionRow
            key={item.key}
            icon={item.icon}
            title={item.title}
            count={number(item.count)}
            detail={item.detail}
            tone={item.tone}
            onPress={() => openRoute(item.route, `queue_${item.key}`)}
          />
        )) : (
          <StatusBanner
            icon="🎉"
            tone="success"
            eyebrow="Fila limpa"
            title="Nada exige intervenção agora"
            message="Use o tempo livre para acompanhar a operação, validar o fluxo e conversar com motoristas e passageiros."
          />
        )}

        <SectionHeading
          icon="📡"
          title="Agora"
          subtitle="Último retrato disponível da oferta de motoristas."
        />
        <KpiGrid>
          <KpiCell>
            <KpiCard icon="🟢" label="Online agora" value={displayNumber(onlineNow)} tone="primary" />
          </KpiCell>
          <KpiCell>
            <KpiCard
              icon="📍"
              label="Disponíveis"
              value={displayNumber(availableNow)}
              hint={`Moto ${number(latestSupply.available?.moto)} · Carro ${number(latestSupply.available?.car)}`}
              tone={availableNow === 0 && requests > 0 ? 'danger' : 'success'}
            />
          </KpiCell>
          <KpiCell>
            <KpiCard icon="🛣️" label="Ocupados" value={displayNumber(busyNow)} tone="primary" />
          </KpiCell>
          <KpiCell>
            <KpiCard
              icon="⚡"
              label="Pressão sem motorista"
              value={displayPercent(unservedRate)}
              hint={`${number(noDriverAvailable)} pedido(s) no período`}
              tone={unservedRate >= 0.15 ? 'danger' : unservedRate > 0 ? 'warning' : 'success'}
            />
          </KpiCell>
        </KpiGrid>

        <SectionHeading
          icon="📊"
          title={`Resultado · ${periodLabel}`}
          subtitle="Mude a janela sem alterar as filas operacionais acima."
        />
        <PeriodSelector selectedDays={rangeDays} onSelect={changePeriod} />
        <KpiGrid>
          <KpiCell>
            <KpiCard icon="📲" label="Solicitações" value={displayNumber(requests)} tone="primary" />
          </KpiCell>
          <KpiCell>
            <KpiCard
              icon="🏁"
              label="Concluídas"
              value={displayNumber(completed)}
              hint={data ? percentage(completionRate) : undefined}
              tone={completionRate >= 0.75 ? 'success' : requests > 0 ? 'warning' : 'neutral'}
            />
          </KpiCell>
          <KpiCell>
            <KpiCard
              icon="💰"
              label="Receita confirmada"
              value={displayMoney(revenue.confirmedRevenueCentavos)}
              hint="Comissões + assinaturas pagas"
              tone="success"
            />
          </KpiCell>
          <KpiCell>
            <KpiCard
              icon="🛡️"
              label="Valor em risco"
              value={displayMoney(revenue.amountAtRiskCentavos)}
              hint={`${number(alertCount)} alerta(s) aberto(s)`}
              tone={Number(revenue.amountAtRiskCentavos || 0) > 0 ? 'danger' : 'success'}
              onPress={() => openRoute('/admin-alerts', 'risk_kpi')}
            />
          </KpiCell>
        </KpiGrid>

        <AppCard>
          <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>Funil essencial</Text>
          <ProgressMetric
            label="Atribuídas"
            value={assigned}
            total={requests}
            valueLabel={`${number(assigned)} · ${percentage(assignmentRate)}`}
            tone={assignmentRate >= 0.8 ? 'success' : 'warning'}
          />
          <ProgressMetric
            label="Iniciadas"
            value={started}
            total={requests}
            valueLabel={`${number(started)} · ${percentage(startRate)}`}
            tone={startRate >= 0.7 ? 'success' : 'warning'}
          />
          <ProgressMetric
            label="Concluídas"
            value={completed}
            total={requests}
            valueLabel={`${number(completed)} · ${percentage(completionRate)}`}
            tone={completionRate >= 0.7 ? 'success' : 'warning'}
          />
          <MetricRow
            label="Sem motorista"
            value={`${number(noDriverAvailable)} · ${percentage(unservedRate)}`}
            tone={unservedRate >= 0.15 ? 'danger' : 'warning'}
          />
          <MetricRow
            label="Canceladas"
            value={`${number(cancelled)} · ${percentage(cancellationRate)}`}
            tone={cancellationRate >= 0.15 ? 'danger' : 'neutral'}
          />
          <MetricRow label="Em disputa" value={number(disputed)} tone={disputed > 0 ? 'danger' : 'neutral'} />
        </AppCard>

        <DisclosureSection
          icon="🧑‍✈️"
          title="Motoristas e carteiras"
          subtitle="Oferta aprovada, pendências e risco de bloqueio."
          badge={pendingCount > 0 ? `${pendingCount} pendente${pendingCount > 1 ? 's' : ''}` : null}
          expanded={expanded.drivers}
          onToggle={() => toggleSection('drivers')}
        >
          <KpiGrid>
            <KpiCell><KpiCard icon="✅" label="Aprovados" value={displayNumber(drivers.approved)} tone="success" /></KpiCell>
            <KpiCell><KpiCard icon="🟢" label="Online" value={displayNumber(drivers.online)} tone="primary" /></KpiCell>
            <KpiCell>
              <KpiCard
                icon="🪪"
                label="Pendentes"
                value={displayNumber(pendingCount)}
                tone={pendingCount > 0 ? 'warning' : 'success'}
                onPress={() => openRoute('/drivers-pending', 'drivers_pending_kpi')}
              />
            </KpiCell>
            <KpiCell><KpiCard icon="⛔" label="Suspensos/bloqueados" value={displayNumber(drivers.suspended)} tone="danger" /></KpiCell>
            <KpiCell>
              <KpiCard
                icon="👛"
                label="Carteiras ≤ R$ 3"
                value={displayNumber(lowWalletCount)}
                hint={`Moto ${number(drivers.lowWallet?.moto)} · Carro ${number(drivers.lowWallet?.car)}`}
                tone={lowWalletCount > 0 ? 'warning' : 'success'}
                onPress={() => openRoute('/wallets', 'low_wallet_kpi')}
              />
            </KpiCell>
            <KpiCell><KpiCard icon="🔒" label="Comissões retidas" value={displayMoney(drivers.walletHeldCentavos)} tone="primary" /></KpiCell>
          </KpiGrid>
        </DisclosureSection>

        <DisclosureSection
          icon="💵"
          title="Financeiro"
          subtitle="Receita real, captura, retenções e risco."
          badge={displayMoney(revenue.confirmedRevenueCentavos)}
          expanded={expanded.finance}
          onToggle={() => toggleSection('finance')}
        >
          <MetricRow label="Receita DriveLocal" value={displayMoney(revenue.confirmedRevenueCentavos)} strong tone="success" />
          <MetricRow label="Comissões capturadas" value={displayMoney(revenue.commissionRevenueCentavos)} />
          <MetricRow label="Assinaturas recebidas" value={displayMoney(revenue.subscriptionRevenueCentavos)} />
          <MetricRow label="Comissão esperada" value={displayMoney(revenue.commissionExpectedCentavos)} />
          <MetricRow label="Comissão ainda retida" value={displayMoney(revenue.commissionHeldCentavos)} tone="warning" />
          <MetricRow label="Comissão em disputa" value={displayMoney(revenue.commissionDisputedCentavos)} tone="danger" />
          <MetricRow label="Retenções liberadas" value={displayMoney(revenue.commissionReleasedCentavos)} tone="success" />
          <MetricRow
            label="Taxa de captura"
            value={displayPercent(revenue.captureRate)}
            strong
            tone={Number(revenue.captureRate || 0) >= 0.95 ? 'success' : 'warning'}
          />
        </DisclosureSection>

        <DisclosureSection
          icon="🔁"
          title="Assinaturas"
          subtitle="Pagas, gratuitas, expirações e MRR teórico."
          badge={drivers.activeSubscriptions?.total != null ? number(drivers.activeSubscriptions.total) : null}
          expanded={expanded.subscriptions}
          onToggle={() => toggleSection('subscriptions')}
        >
          <MetricRow label="Moto — pagas ativas" value={displayNumber(drivers.activeSubscriptions?.moto)} hint={`MRR teórico: ${displayMoney(drivers.theoreticalMrrCentavos?.moto)}`} />
          <MetricRow label="Carro — pagas ativas" value={displayNumber(drivers.activeSubscriptions?.car)} hint={`MRR teórico: ${displayMoney(drivers.theoreticalMrrCentavos?.car)}`} />
          <MetricRow label="Total pagas ativas" value={displayNumber(drivers.activeSubscriptions?.total)} hint={`MRR teórico total: ${displayMoney(drivers.theoreticalMrrCentavos?.total)}`} strong tone="success" />
          <MetricRow label="Moto — gratuitas ativas" value={displayNumber(drivers.freeSubscriptions?.moto)} />
          <MetricRow label="Carro — gratuitas ativas" value={displayNumber(drivers.freeSubscriptions?.car)} />
          <MetricRow label="Expiram em até 7 dias" value={displayNumber(expiringCount)} tone={expiringCount > 0 ? 'warning' : 'neutral'} />
          <MetricRow label="Assinaturas expiradas" value={displayNumber(drivers.expiredSubscriptions?.total)} tone="danger" />
        </DisclosureSection>

        <DisclosureSection
          icon="🏍️"
          title="Moto x carro"
          subtitle="Demanda, conclusão e receita por tipo de veículo."
          expanded={expanded.vehicles}
          onToggle={() => toggleSection('vehicles')}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <VehicleFinanceCard label="Moto" icon="🏍️" data={rides.byVehicle?.moto} />
            <VehicleFinanceCard label="Carro" icon="🚗" data={rides.byVehicle?.car} />
          </View>
        </DisclosureSection>

        <DisclosureSection
          icon="📍"
          title="Oferta x demanda"
          subtitle="Onde e quando a falta de motoristas pressiona a operação."
          badge={unservedRate > 0 ? percentage(unservedRate) : null}
          expanded={expanded.demand}
          onToggle={() => toggleSection('demand')}
        >
          <MetricRow label="Online no último snapshot" value={displayNumber(onlineNow)} strong tone="primary" />
          <MetricRow label="Disponíveis agora" value={displayNumber(availableNow)} hint={`Moto ${number(latestSupply.available?.moto)} · Carro ${number(latestSupply.available?.car)}`} tone={availableNow === 0 && requests > 0 ? 'danger' : 'success'} />
          <MetricRow label="Ocupados agora" value={displayNumber(busyNow)} />
          <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>Horários com maior pressão</Text>
          <DemandSupplyList rows={supply.demandVsSupply} />
        </DisclosureSection>

        <DisclosureSection
          icon="🕒"
          title="Picos e dias mais ativos"
          subtitle="Horários de demanda, receita e pedidos sem motorista."
          expanded={expanded.peaks}
          onToggle={() => toggleSection('peaks')}
        >
          <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>Mais solicitações</Text>
          <PeakList rows={rides.peakHours} valueKey="requests" valueLabel={(row) => `${number(row.requests)} pedido(s)`} />
          <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>Maior receita de comissão</Text>
          <PeakList rows={rides.peakRevenueHours} valueKey="commissionCapturedCentavos" valueLabel={(row) => money(row.commissionCapturedCentavos)} />
          <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>Falta de motoristas</Text>
          <PeakList rows={rides.peakUnservedHours} valueKey="noDriverAvailable" valueLabel={(row) => `${number(row.noDriverAvailable)} não atendida(s)`} />
          <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>Dias mais ativos</Text>
          {(rides.peakDays || []).filter((day) => Number(day.requests || 0) > 0).map((day, index) => (
            <MetricRow
              key={day.dayKey}
              label={`${index + 1}. ${day.label}`}
              value={`${number(day.requests)} pedidos · ${money(day.commissionCapturedCentavos)}`}
              strong={index === 0}
              tone={index === 0 ? 'primary' : 'neutral'}
              hint={`${number(day.completed)} concluída(s) · ${number(day.noDriverAvailable)} sem motorista`}
            />
          ))}
          {(rides.peakDays || []).every((day) => Number(day.requests || 0) === 0) ? (
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
              Ainda não há dados suficientes para este período.
            </Text>
          ) : null}
        </DisclosureSection>

        <DisclosureSection
          icon="🧰"
          title="Operações administrativas"
          subtitle="Atalhos para filas especializadas e decisões sensíveis."
          expanded={expanded.operations}
          onToggle={() => toggleSection('operations')}
        >
          <ActionRow icon="🛡️" title="Antifraude — casos e decisões" count="›" detail="Revisar sinais e registrar uma decisão" tone="danger" onPress={() => openRoute('/antifraud', 'operations_antifraud')} />
          <ActionRow icon="⚖️" title="Disputas de corrida" count={number(disputeCount)} detail="Resolver comissão e resultado da corrida" tone="warning" onPress={() => openRoute('/ride-disputes', 'operations_disputes')} />
          <ActionRow icon="💬" title="Tickets de suporte" count={number(ticketCount)} detail="Responder e encerrar solicitações" tone="primary" onPress={() => openRoute('/support-tickets', 'operations_support')} />
          <ActionRow icon="➕" title="Recargas pendentes" count="›" detail="Validar solicitações Pix internas" tone="primary" onPress={() => openRoute('/topups-pending', 'operations_topups')} />
          <ActionRow icon="🧮" title="Ajuste de saldo" count="›" detail="Correção manual auditável e idempotente" tone="warning" onPress={() => openRoute('/wallet-adjust', 'operations_wallet_adjust')} />
          <ActionRow icon="🛣️" title="Corridas" count="›" detail="Consultar o histórico operacional" tone="primary" onPress={() => openRoute('/rides', 'operations_rides')} />
          <ActionRow icon="👛" title="Carteiras" count="›" detail="Consultar saldos e retenções" tone="primary" onPress={() => openRoute('/wallets', 'operations_wallets')} />
          <ActionRow icon="📄" title="Relatórios" count="›" detail="Exportações e fechamento operacional" tone="primary" onPress={() => openRoute('/reports', 'operations_reports')} />
        </DisclosureSection>

        {data?.truncated && Object.values(data.truncated).some(Boolean) ? (
          <StatusBanner
            icon="⚠️"
            tone="warning"
            eyebrow="Totais parciais"
            title="A consulta atingiu o limite de segurança"
            message="Os totais exibidos são parciais. Aumente a agregação antes de usar estes números como fechamento contábil."
          />
        ) : null}

        <Text style={[{ fontFamily, color: colors.textFaint, textAlign: 'center' }, typography.caption]}>
          Comentários automáticos orientam a operação, mas não executam bloqueios, ajustes ou decisões financeiras.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
