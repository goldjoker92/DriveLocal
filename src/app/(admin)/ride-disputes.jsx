// Admin ride disputes (route "/(admin)/ride-disputes"). BLOCK 11+12.
// Minimal, operational, PT-BR. Search a disputed ride by id, review a SAFE
// summary (masked identities, payment/hold references), and resolve it through
// the secure callable resolveRideDisputeSecure — never a client status write.
// Firestore is the source of truth; reads are admin-gated and bounded.

import { useRef, useState, useEffect } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AppInput from '../../components/AppInput';
import AdminTableRow from '../../components/AdminTableRow';
import KeyboardSafeScreen from '../../components/KeyboardSafeScreen';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { fontFamily, typography } from '../../constants/typography';
import { formatBRL } from '../../utils/format';
import { showConfirmAlert } from '../../utils/alertUtils';
import { goBackOrReplace } from '../../utils/navigation';
import { getRideById, listDisputedRides, resolveRideDispute } from '../../services/adminService';

// Never expose a full uid in the admin UI.
const mask = (id) => (id ? `${String(id).slice(0, 6)}…` : '—');

const OUTCOMES = [
  { key: 'confirm_driver_payment', title: 'Confirmar pagamento ao motorista', variant: 'primary' },
  { key: 'release_driver_hold', title: 'Liberar reserva (sem cobrança)', variant: 'secondary' },
  { key: 'retain_for_manual_review', title: 'Reter para análise manual', variant: 'ghost' },
];

export default function RideDisputes() {
  const router = useRouter();
  const reasonRef = useRef(null);
  const noteRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState([]);
  const [rideIdInput, setRideIdInput] = useState('');
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function loadList() {
    setLoading(true);
    setError('');
    try {
      setList(await listDisputedRides());
    } catch (e) {
      console.log('[ADMIN_DISPUTES] list error', e.message);
      setError('Não foi possível carregar as disputas.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadList(); }, []);

  async function handleSearch() {
    const id = rideIdInput.trim();
    if (!id) return;
    setError('');
    setSuccess('');
    try {
      const ride = await getRideById(id);
      if (!ride) { setError('Corrida não encontrada.'); setSelected(null); return; }
      setSelected(ride);
    } catch (e) {
      console.log('[ADMIN_DISPUTES] search error', e.message);
      setError('Não foi possível buscar a corrida.');
    }
  }

  function handleResolve(outcome) {
    const text = reason.trim();
    if (!text) { setError('Informe o motivo da resolução.'); return; }
    if (!selected) return;
    showConfirmAlert({
      title: 'Resolver disputa?',
      message: `Ação: ${outcome}. Esta operação é registrada e não pode ser desfeita pelo cliente.`,
      confirmText: 'Confirmar',
      destructive: outcome !== 'retain_for_manual_review',
      onConfirm: async () => {
        setError('');
        setSuccess('');
        setSubmitting(true);
        try {
          const res = await resolveRideDispute(selected.rideId, outcome, text, note.trim() || null);
          setSuccess(`Disputa resolvida (${res.outcome}).`);
          setReason(''); setNote('');
          const refreshed = await getRideById(selected.rideId);
          setSelected(refreshed);
          await loadList();
        } catch (e) {
          console.log('[ADMIN_DISPUTES] resolve error', e.message);
          setError('Não foi possível resolver a disputa.');
        } finally {
          setSubmitting(false);
        }
      },
    });
  }

  const canResolve = selected && selected.status === 'disputed';

  return (
    <KeyboardSafeScreen
      scrollViewProps={{ contentContainerStyle: { paddingBottom: spacing.xxl * 2 } }}
    >
      <Header
        title="Disputas de corrida"
        onBack={() => goBackOrReplace(router, '/(admin)/admin-home')}
      />

      <AppCard>
        <AppInput
          label="Buscar por ID da corrida"
          value={rideIdInput}
          onChangeText={setRideIdInput}
          placeholder="rideId"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={handleSearch}
        />
        <AppButton title="Buscar" variant="secondary" onPress={handleSearch} />
      </AppCard>

      {error ? <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text> : null}
      {success ? <Text style={[{ fontFamily, color: colors.success }, typography.small]}>{success}</Text> : null}

      {selected ? (
        <AppCard>
          <AdminTableRow label="Corrida" value={mask(selected.rideId)} />
          <AdminTableRow label="Status" value={selected.status || '—'} />
          <AdminTableRow label="Passageiro" value={mask(selected.passengerId)} />
          <AdminTableRow label="Motorista" value={mask(selected.acceptedDriverId)} />
          <AdminTableRow label="Valor" value={formatBRL(selected.finalFareCentavos || selected.estimatedFareCentavos || 0)} />
          <AdminTableRow label="Reserva (hold)" value={formatBRL(selected.commissionHoldCentavos || 0)} />
          <AdminTableRow label="Comissão capturada" value={formatBRL(selected.commissionCapturedCentavos || 0)} />
          <AdminTableRow label="Motivo disputa" value={selected.disputeReasonCode || '—'} />
          {selected.disputeResolution ? (
            <AdminTableRow label="Resolução" value={selected.disputeResolution.outcome} />
          ) : null}

          {canResolve ? (
            <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              <AppInput
                ref={reasonRef}
                label="Motivo (obrigatório)"
                value={reason}
                onChangeText={setReason}
                placeholder="Motivo da resolução"
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => noteRef.current?.focus()}
              />
              <AppInput
                ref={noteRef}
                label="Nota (opcional)"
                value={note}
                onChangeText={setNote}
                placeholder="Observação do admin"
                returnKeyType="done"
              />
              {OUTCOMES.map((o) => (
                <AppButton key={o.key} title={submitting ? 'Processando…' : o.title} variant={o.variant} onPress={() => handleResolve(o.key)} disabled={submitting} />
              ))}
            </View>
          ) : (
            <Text style={[{ fontFamily, color: colors.textMuted, marginTop: spacing.sm }, typography.small]}>
              Esta corrida não está em disputa aberta.
            </Text>
          )}
        </AppCard>
      ) : null}

      <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>Disputas abertas</Text>
      <AppCard>
        {loading ? (
          <AdminTableRow label="Carregando…" />
        ) : list.length === 0 ? (
          <AdminTableRow label="Nenhuma disputa aberta" />
        ) : (
          list.map((r) => (
            <AdminTableRow key={r.rideId} label={`${mask(r.rideId)} — ${formatBRL(r.finalFareCentavos || r.estimatedFareCentavos || 0)}`} right={<AppButton title="Abrir" variant="ghost" onPress={() => { setSelected(r); setError(''); setSuccess(''); }} />} />
          ))
        )}
      </AppCard>
    </KeyboardSafeScreen>
  );
}
