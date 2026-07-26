// Aggregated admin incident inbox. Alerts contain only server-selected operational
// codes and references; all sensitive decisions remain in their dedicated screens.

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
import { formatBRL } from '../../utils/format';
import {
  ADMIN_ALERT_ACTIONS,
  ADMIN_ALERT_RESOLUTIONS,
  ADMIN_ALERT_SEVERITY,
  ADMIN_ALERT_STATUS,
  adminAlertTitle,
  shortAdminAlertReference,
} from '../../constants/adminAlerts';
import { listAdminAlerts, updateAdminAlert } from '../../services/adminService';

const STATUS_FILTERS = Object.freeze([
  { code: 'open', label: 'Abertos' },
  { code: 'acknowledged', label: 'Reconhecidos' },
  { code: 'in_progress', label: 'Em tratamento' },
  { code: 'resolved', label: 'Resolvidos' },
  { code: 'all', label: 'Todos' },
]);

const SEVERITY_FILTERS = Object.freeze([
  { code: 'all', label: 'Todas' },
  { code: 'critical', label: 'Críticas' },
  { code: 'high', label: 'Altas' },
  { code: 'warning', label: 'Atenção' },
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

function trace(event, details = {}, level = 'log') {
  const method = console[level] || console.log;
  method(`[ADMIN_ALERTS] ${event}`, {
    scope: 'admin_alerts',
    event,
    atMs: Date.now(),
    ...details,
  });
}

function FilterRow({ items, selected, onSelect }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
      {items.map((item) => {
        const active = item.code === selected;
        return (
          <Pressable
            key={item.code}
            accessibilityRole="button"
            onPress={() => onSelect(item.code)}
            style={{
              borderWidth: 1,
              borderColor: active ? colors.primary : colors.border,
              backgroundColor: active ? colors.primary : colors.card,
              borderRadius: radius.full,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
            }}
          >
            <Text style={[
              { fontFamily, color: active ? colors.onPrimary : colors.textMuted },
              typography.small,
            ]}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function AlertCard({ alert, busy, onStatus, onResolve, onOpenSource }) {
  const status = ADMIN_ALERT_STATUS[alert.status] || { label: alert.status || 'Aberto', tone: 'neutral' };
  const severity = ADMIN_ALERT_SEVERITY[alert.severity] || { label: alert.severity || 'Atenção', tone: 'warning' };
  const targetReference = shortAdminAlertReference(alert.targetId);
  const sourceReference = shortAdminAlertReference(alert.sourceRefHash);

  return (
    <AppCard>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
        <Text style={[{ fontFamily, color: colors.text, flex: 1 }, typography.bodyBold]}>
          {adminAlertTitle(alert.titleCode)}
        </Text>
        <View style={{ gap: spacing.xs, alignItems: 'flex-end' }}>
          <AppBadge label={severity.label} tone={severity.tone} />
          <AppBadge label={status.label} tone={status.tone} />
        </View>
      </View>

      <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
        Atualizado em {formatDate(alert.updatedAtMs || alert.lastDetectedAtMs)}
      </Text>
      <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>
        Motivo: {alert.reasonCode || 'REVIEW_REQUIRED'}
      </Text>
      {targetReference ? (
        <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>
          Referência operacional: {targetReference}
        </Text>
      ) : null}
      {sourceReference ? (
        <Text style={[{ fontFamily, color: colors.textFaint }, typography.caption]}>
          Correlação: {sourceReference}
        </Text>
      ) : null}
      {Number.isSafeInteger(alert.amountCentavos) ? (
        <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>
          Valor relacionado: {formatBRL(alert.amountCentavos)}
        </Text>
      ) : null}
      {Number(alert.occurrenceCount || 0) > 1 ? (
        <Text style={[{ fontFamily, color: colors.warning }, typography.caption]}>
          Detectado {alert.occurrenceCount} vezes para a mesma fonte.
        </Text>
      ) : null}

      {alert.status === 'open' ? (
        <AppButton
          title={busy ? 'ATUALIZANDO…' : 'RECONHECER'}
          variant="secondary"
          disabled={busy}
          onPress={() => onStatus(alert, 'acknowledged')}
        />
      ) : null}
      {alert.status === 'open' || alert.status === 'acknowledged' ? (
        <AppButton
          title={busy ? 'ATUALIZANDO…' : 'INICIAR TRATAMENTO'}
          disabled={busy}
          onPress={() => onStatus(alert, 'in_progress')}
        />
      ) : null}
      {alert.targetRoute && alert.status !== 'resolved' ? (
        <AppButton
          title={ADMIN_ALERT_ACTIONS[alert.actionCode] || 'ABRIR FILA RELACIONADA'}
          variant="secondary"
          disabled={busy}
          onPress={() => onOpenSource(alert)}
        />
      ) : null}
      {alert.status !== 'resolved' ? (
        <AppButton
          title="RESOLVER"
          variant="ghost"
          disabled={busy}
          onPress={() => onResolve(alert)}
        />
      ) : (
        <AppButton
          title={busy ? 'ATUALIZANDO…' : 'REABRIR'}
          variant="secondary"
          disabled={busy}
          onPress={() => onStatus(alert, 'open')}
        />
      )}
    </AppCard>
  );
}

export default function AdminAlerts() {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState('open');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyAlertId, setBusyAlertId] = useState(null);
  const [resolutionAlert, setResolutionAlert] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await listAdminAlerts(statusFilter, severityFilter, 100);
      setAlerts(result);
      trace('alerts.loaded', {
        status: statusFilter,
        severity: severityFilter,
        alertCount: result.length,
      });
    } catch (loadError) {
      trace('alerts.load_failed', {
        status: statusFilter,
        severity: severityFilter,
        reason: loadError?.code || loadError?.name || 'unknown',
      }, 'warn');
      setError('Não foi possível carregar os alertas. Puxe para atualizar.');
    } finally {
      setLoading(false);
    }
  }, [severityFilter, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function updateStatus(alert, status, resolutionCode = null) {
    if (!alert?.alertId || busyAlertId) return;
    setBusyAlertId(alert.alertId);
    setError('');
    trace('alert.update_requested', {
      alertId: alert.alertId,
      fromStatus: alert.status,
      toStatus: status,
      resolutionCode,
    });
    try {
      await updateAdminAlert({ alertId: alert.alertId, status, resolutionCode });
      trace('alert.update_succeeded', {
        alertId: alert.alertId,
        toStatus: status,
        resolutionCode,
      });
      setResolutionAlert(null);
      await load();
    } catch (updateError) {
      trace('alert.update_failed', {
        alertId: alert.alertId,
        toStatus: status,
        reason: updateError?.code || updateError?.name || 'unknown',
      }, 'warn');
      setError('Não foi possível atualizar o alerta. Recarregue e tente novamente.');
    } finally {
      setBusyAlertId(null);
    }
  }

  function openSource(alert) {
    if (!alert?.targetRoute) return;
    trace('alert.source_opened', {
      alertId: alert.alertId,
      actionCode: alert.actionCode,
      targetRoute: alert.targetRoute,
      hasTargetId: Boolean(alert.targetId),
    });
    router.push({
      pathname: alert.targetRoute,
      params: alert.targetId ? { sourceId: alert.targetId } : {},
    });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      >
        <Header title="Alertas operacionais" subtitle="Incidentes que exigem ação" onBack={() => router.back()} />

        <AppCard>
          <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>
            Caixa única de incidentes
          </Text>
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
            Reconheça o alerta aqui e conclua a ação na fila especializada indicada.
          </Text>
          <Text style={[{ fontFamily, color: colors.textFaint }, typography.caption]}>
            Nenhum nome, telefone, CPF, endereço, coordenada ou chave Pix é exibido nesta caixa.
          </Text>
        </AppCard>

        <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>Status</Text>
        <FilterRow items={STATUS_FILTERS} selected={statusFilter} onSelect={setStatusFilter} />
        <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>Prioridade</Text>
        <FilterRow items={SEVERITY_FILTERS} selected={severityFilter} onSelect={setSeverityFilter} />

        {error ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text>
          </AppCard>
        ) : null}

        {!loading && alerts.length === 0 ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
              Nenhum alerta neste filtro.
            </Text>
          </AppCard>
        ) : null}

        {alerts.map((alert) => (
          <AlertCard
            key={alert.alertId}
            alert={alert}
            busy={busyAlertId === alert.alertId}
            onStatus={updateStatus}
            onResolve={setResolutionAlert}
            onOpenSource={openSource}
          />
        ))}
      </ScrollView>

      <Modal
        visible={Boolean(resolutionAlert)}
        transparent
        animationType="fade"
        onRequestClose={() => !busyAlertId && setResolutionAlert(null)}
      >
        <View style={styles.backdrop}>
          <View style={styles.modalCard}>
            <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>
              Resolver alerta
            </Text>
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
              Escolha um resultado operacional. Nenhuma nota livre será registrada.
            </Text>
            <ScrollView contentContainerStyle={{ gap: spacing.sm }}>
              {Object.entries(ADMIN_ALERT_RESOLUTIONS)
                .filter(([code]) => code !== 'source_resolved')
                .map(([code, label]) => (
                  <AppButton
                    key={code}
                    title={busyAlertId === resolutionAlert?.alertId ? 'ATUALIZANDO…' : label}
                    variant="secondary"
                    disabled={Boolean(busyAlertId)}
                    onPress={() => updateStatus(resolutionAlert, 'resolved', code)}
                  />
                ))}
            </ScrollView>
            <AppButton
              title="FECHAR"
              variant="ghost"
              disabled={Boolean(busyAlertId)}
              onPress={() => setResolutionAlert(null)}
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
