// Admin wallet adjustment (route "/(admin)/wallet-adjust"). BLOCK 11+12.
// Minimal, operational, PT-BR. Credit / debit / correction / reversal on a
// driver's Saldo DriveLocal through the secure callable adjustDriverWalletSecure.
// The client never writes wallet fields or ledger entries directly. Amounts are
// entered in BRL and converted to integer centavos before the call.

import { useRef, useState } from 'react';
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
import { adjustDriverWallet } from '../../services/adminService';

// "12,50" / "12.50" -> 1250 centavos. Returns null on invalid input.
function brlToCentavos(text) {
  const cleaned = String(text || '').replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}

const OPERATIONS = [
  { key: 'credit', title: 'Crédito' },
  { key: 'debit', title: 'Débito' },
  { key: 'correction', title: 'Correção' },
  { key: 'reversal', title: 'Estorno' },
];

export default function WalletAdjust() {
  const router = useRouter();
  const amountRef = useRef(null);
  const reasonRef = useRef(null);
  const noteRef = useRef(null);
  const originalLedgerRef = useRef(null);
  const [driverId, setDriverId] = useState('');
  const [operation, setOperation] = useState('credit');
  const [amount, setAmount] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [correctionSign, setCorrectionSign] = useState('increase');
  const [originalLedgerEntryId, setOriginalLedgerEntryId] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const needsAmount = operation !== 'reversal';

  function focusOperationValue() {
    if (needsAmount) amountRef.current?.focus();
    else originalLedgerRef.current?.focus();
  }

  function handleSubmit() {
    setError('');
    if (!driverId.trim()) { setError('Informe o ID do motorista.'); return; }
    if (!reasonCode.trim()) { setError('Informe o código do motivo.'); return; }
    if (!note.trim()) { setError('A nota é obrigatória.'); return; }
    let amountCentavos;
    if (needsAmount) {
      amountCentavos = brlToCentavos(amount);
      if (amountCentavos == null || amountCentavos <= 0) { setError('Valor inválido (ex.: 12,50).'); return; }
    }
    if (operation === 'reversal' && !originalLedgerEntryId.trim()) { setError('Informe o lançamento original a estornar.'); return; }

    showConfirmAlert({
      title: 'Confirmar ajuste?',
      message: `Operação: ${operation}${needsAmount ? ` — ${formatBRL(amountCentavos)}` : ''}. Esta ação é registrada e imutável.`,
      confirmText: 'Confirmar',
      destructive: operation === 'debit' || operation === 'reversal',
      onConfirm: async () => {
        setSubmitting(true);
        setResult(null);
        try {
          const res = await adjustDriverWallet({
            driverId: driverId.trim(),
            operation,
            amountCentavos,
            reasonCode: reasonCode.trim(),
            note: note.trim(),
            correctionSign: operation === 'correction' ? correctionSign : undefined,
            originalLedgerEntryId: operation === 'reversal' ? originalLedgerEntryId.trim() : undefined,
          });
          setResult(res);
          setAmount('');
        } catch (e) {
          console.log('[ADMIN_WALLET] adjust error', e.message);
          const insufficient = /insufficient|insuficiente|failed-precondition/i.test(e.message || '') || e.code === 'functions/failed-precondition';
          setError(insufficient ? 'Saldo insuficiente para este débito.' : 'Não foi possível aplicar o ajuste.');
        } finally {
          setSubmitting(false);
        }
      },
    });
  }

  return (
    <KeyboardSafeScreen
      scrollViewProps={{ contentContainerStyle: { paddingBottom: spacing.xxl * 2 } }}
    >
      <Header
        title="Ajuste de saldo"
        onBack={() => goBackOrReplace(router, '/(admin)/admin-home')}
      />

      <AppCard>
        <AppInput
          label="ID do motorista"
          value={driverId}
          onChangeText={setDriverId}
          placeholder="driverId"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={focusOperationValue}
        />

        <Text style={[{ fontFamily, color: colors.textMuted, marginTop: spacing.sm }, typography.small]}>Operação</Text>
        <View style={{ gap: spacing.xs }}>
          {OPERATIONS.map((o) => (
            <AppButton key={o.key} title={o.title} variant={operation === o.key ? 'primary' : 'ghost'} onPress={() => setOperation(o.key)} />
          ))}
        </View>

        {needsAmount ? (
          <AppInput
            ref={amountRef}
            label="Valor (BRL)"
            value={amount}
            onChangeText={setAmount}
            placeholder="Ex.: 12,50"
            keyboardType="decimal-pad"
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => reasonRef.current?.focus()}
          />
        ) : (
          <AppInput
            ref={originalLedgerRef}
            label="Lançamento original (ID)"
            value={originalLedgerEntryId}
            onChangeText={setOriginalLedgerEntryId}
            placeholder="ledgerEntryId"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => reasonRef.current?.focus()}
          />
        )}

        {operation === 'correction' ? (
          <View style={{ gap: spacing.xs }}>
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>Sinal da correção</Text>
            <AppButton title="Aumentar (+)" variant={correctionSign === 'increase' ? 'primary' : 'ghost'} onPress={() => setCorrectionSign('increase')} />
            <AppButton title="Diminuir (−)" variant={correctionSign === 'decrease' ? 'primary' : 'ghost'} onPress={() => setCorrectionSign('decrease')} />
          </View>
        ) : null}

        <AppInput
          ref={reasonRef}
          label="Código do motivo"
          value={reasonCode}
          onChangeText={setReasonCode}
          placeholder="ex.: correcao_topup"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={() => noteRef.current?.focus()}
        />
        <AppInput
          ref={noteRef}
          label="Nota (obrigatória)"
          value={note}
          onChangeText={setNote}
          placeholder="Descreva o ajuste"
          returnKeyType="done"
          onSubmitEditing={handleSubmit}
        />

        <AppButton title={submitting ? 'Processando…' : 'Aplicar ajuste'} onPress={handleSubmit} disabled={submitting} />
      </AppCard>

      {error ? <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text> : null}

      {result ? (
        <AppCard>
          <AdminTableRow label="Operação" value={result.operation} />
          <AdminTableRow label="Lançamento" value={result.ledgerEntryId} />
          <AdminTableRow label="Saldo disponível" value={formatBRL(result.walletAvailableCentavos || 0)} />
          <AdminTableRow label="Saldo total" value={formatBRL(result.walletBalanceCentavos || 0)} />
          {result.replay ? <AdminTableRow label="Idempotente" value="já aplicado" /> : null}
        </AppCard>
      ) : null}
    </KeyboardSafeScreen>
  );
}
