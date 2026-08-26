import { formatBRL } from './format';
import { resolveCommercialPolicy, toMillis } from './commercialPolicy';

export const DRIVER_WALLET_VIEW_VERSION = 'driver-wallet-view-v1';
export const WALLET_TOPUP_PRESETS = Object.freeze([1000, 2000, 3000, 5000]);
export const WALLET_TOPUP_MIN_CENTAVOS = 1000;
export const WALLET_TOPUP_MAX_CENTAVOS = 20000;

const PAYMENT_STATUS_LABELS = Object.freeze({
  pending: 'Aguardando pagamento',
  paid: 'Pagamento confirmado',
  expired: 'Pix expirado',
  cancelled: 'Pagamento cancelado',
  failed: 'Falha no pagamento',
  refunded: 'Pagamento estornado',
  manual_review: 'Pagamento em análise',
});

const LEDGER_STATUS_LABELS = Object.freeze({
  held: 'Reservada',
  settled: 'Liquidada',
  released: 'Liberada',
  captured: 'Capturada',
  paid: 'Confirmada',
});

function optionalCentavos(value, { signed = false } = {}) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) return null;
  if (!signed && number < 0) return null;
  return number;
}

function optionalTimestamp(value) {
  const number = toMillis(value);
  return number > 0 ? number : null;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function parseWalletTopupInput(rawValue) {
  const raw = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!raw) {
    return { valid: false, amountCentavos: null, error: 'Digite um valor entre R$ 10 e R$ 200.' };
  }

  const normalized = raw
    .replace(/^R\$\s*/i, '')
    .replace(/\s+/g, '')
    .replace(',', '.');

  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    return { valid: false, amountCentavos: null, error: 'Use no máximo duas casas decimais.' };
  }

  const [wholeText, decimalText = ''] = normalized.split('.');
  const whole = Number(wholeText);
  const decimal = Number(decimalText.padEnd(2, '0'));
  const amountCentavos = whole * 100 + decimal;

  if (!Number.isSafeInteger(amountCentavos)) {
    return { valid: false, amountCentavos: null, error: 'Valor inválido.' };
  }
  if (amountCentavos < WALLET_TOPUP_MIN_CENTAVOS) {
    return { valid: false, amountCentavos: null, error: 'O valor mínimo é R$ 10,00.' };
  }
  if (amountCentavos > WALLET_TOPUP_MAX_CENTAVOS) {
    return { valid: false, amountCentavos: null, error: 'O valor máximo é R$ 200,00.' };
  }

  return { valid: true, amountCentavos, error: null };
}

export function formatTopupPreset(amountCentavos, locked = false) {
  const whole = optionalCentavos(amountCentavos);
  const value = whole == null ? 'Valor' : `R$ ${Math.floor(whole / 100)}`;
  return locked ? `🔒 ${value}` : value;
}

function formatHistoryDate(timestampMs) {
  if (!timestampMs) return null;
  const date = new Date(timestampMs);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function amountLabel(amountCentavos, direction) {
  const amount = optionalCentavos(amountCentavos);
  if (amount == null) return 'Valor indisponível';
  const prefix = direction === 'credit' ? '+ ' : direction === 'debit' ? '− ' : '';
  return `${prefix}${formatBRL(amount)}`;
}

function baseHistoryRow({ id, title, amountCentavos, direction, status, timestampMs, detail, kind }) {
  return {
    id,
    kind,
    title,
    amountCentavos: optionalCentavos(amountCentavos),
    amountLabel: amountLabel(amountCentavos, direction),
    direction,
    status,
    timestampMs: optionalTimestamp(timestampMs),
    dateLabel: formatHistoryDate(optionalTimestamp(timestampMs)),
    detail: detail || null,
  };
}

export function expandWalletTransaction(transaction = {}) {
  const id = transaction.id || `wallet-${transaction.createdAtMs || 'unknown'}`;
  const amount = optionalCentavos(transaction.amountCentavos);
  const timestampMs = transaction.settledAtMs || transaction.createdAtMs;
  const status = LEDGER_STATUS_LABELS[transaction.status] || transaction.status || 'Registrada';

  switch (transaction.type) {
    case 'topup':
      return [baseHistoryRow({
        id,
        kind: 'topup',
        title: 'Recarga Pix',
        amountCentavos: amount,
        direction: 'credit',
        status: 'Confirmada',
        timestampMs,
        detail: transaction.paymentId ? 'Saldo creditado' : null,
      })];
    case 'commission_hold':
      return [baseHistoryRow({
        id,
        kind: 'hold',
        title: 'Reserva da taxa da plataforma',
        amountCentavos: amount,
        direction: 'debit',
        status,
        timestampMs: transaction.createdAtMs,
        detail: transaction.rideId ? 'Valor reservado durante a corrida' : null,
      })];
    case 'commission_hold_release':
      return [baseHistoryRow({
        id,
        kind: 'release',
        title: 'Liberação de reserva',
        amountCentavos: amount,
        direction: 'credit',
        status: 'Liberada',
        timestampMs,
        detail: transaction.rideId ? 'Corrida cancelada ou reserva liberada' : null,
      })];
    case 'commission_capture': {
      const captured = optionalCentavos(transaction.amountCentavos)
        ?? optionalCentavos(transaction.capturedCentavos);
      const released = optionalCentavos(transaction.releasedCentavos);
      const rows = [];
      if (captured != null && captured > 0) {
        rows.push(baseHistoryRow({
          id: `${id}:capture`,
          kind: 'capture',
          title: 'Taxa da plataforma debitada',
          amountCentavos: captured,
          direction: 'debit',
          status: 'Capturada',
          timestampMs,
          detail: transaction.rideId ? 'Corrida concluída' : null,
        }));
      }
      if (released != null && released > 0) {
        rows.push(baseHistoryRow({
          id: `${id}:release`,
          kind: 'release',
          title: 'Liberação de reserva',
          amountCentavos: released,
          direction: 'credit',
          status: 'Liberada',
          timestampMs,
          detail: 'Parte não capturada da reserva',
        }));
      }
      return rows.length > 0 ? rows : [baseHistoryRow({
        id,
        kind: 'capture',
        title: 'Liquidação da taxa da plataforma',
        amountCentavos: amount,
        direction: 'neutral',
        status,
        timestampMs,
      })];
    }
    case 'admin_credit':
    case 'admin_debit':
    case 'admin_correction':
    case 'admin_reversal': {
      const delta = optionalCentavos(transaction.availableDeltaCentavos, { signed: true });
      const direction = delta == null ? 'neutral' : delta >= 0 ? 'credit' : 'debit';
      const operation = transaction.type.replace('admin_', '');
      const titles = {
        credit: 'Crédito administrativo',
        debit: 'Débito administrativo',
        correction: 'Correção de saldo',
        reversal: 'Estorno de ajuste',
      };
      return [baseHistoryRow({
        id,
        kind: 'adjustment',
        title: titles[operation] || 'Ajuste de saldo',
        amountCentavos: delta == null ? amount : Math.abs(delta),
        direction,
        status: 'Aplicado',
        timestampMs,
        detail: transaction.reasonCode || null,
      })];
    }
    default:
      return [baseHistoryRow({
        id,
        kind: 'other',
        title: 'Movimento da carteira',
        amountCentavos: amount,
        direction: 'neutral',
        status,
        timestampMs,
      })];
  }
}

export function walletPaymentHistoryRow(payment = {}) {
  const amount = optionalCentavos(payment.amountCentavos);
  const statusCode = payment.status || 'pending';
  return baseHistoryRow({
    id: `payment:${payment.localPaymentId || payment.createdAtMs || 'unknown'}`,
    kind: 'payment',
    title: payment.customAmount ? 'Recarga Pix — outro valor' : 'Recarga Pix',
    amountCentavos: amount,
    direction: statusCode === 'paid' ? 'credit' : 'neutral',
    status: PAYMENT_STATUS_LABELS[statusCode] || 'Status desconhecido',
    timestampMs: payment.appliedAtMs || payment.createdAtMs,
    detail: statusCode === 'pending' && payment.expiresAtMs
      ? `Pix válido até ${formatHistoryDate(payment.expiresAtMs)}`
      : null,
  });
}

export function mergeDriverWalletHistory(transactions, payments) {
  const ledger = safeArray(transactions);
  const paymentList = safeArray(payments);
  const creditedPaymentIds = new Set(
    ledger
      .filter((entry) => entry.type === 'topup' && entry.paymentId)
      .map((entry) => entry.paymentId)
  );

  const ledgerRows = ledger.flatMap(expandWalletTransaction);
  const paymentRows = paymentList
    .filter((payment) => !(
      payment.status === 'paid'
      && payment.localPaymentId
      && creditedPaymentIds.has(payment.localPaymentId)
    ))
    .map(walletPaymentHistoryRow);

  return [...ledgerRows, ...paymentRows]
    .sort((left, right) => Number(right.timestampMs || 0) - Number(left.timestampMs || 0));
}

export function deriveDriverWalletView(liveDriver, snapshot, nowMs = Date.now()) {
  const driver = liveDriver || {};
  const serverWallet = snapshot?.wallet || {};
  const commercial = resolveCommercialPolicy(driver, nowMs);

  const balanceCentavos = optionalCentavos(
    driver.walletBalanceCentavos ?? serverWallet.balanceCentavos
  );
  const availableCentavos = optionalCentavos(
    driver.walletAvailableCentavos ?? serverWallet.availableCentavos
  );
  const heldCentavos = optionalCentavos(
    driver.walletHeldCentavos ?? serverWallet.heldCentavos
  );
  const serverPolicy = snapshot?.topupPolicy || {};
  const unlockAtMs = optionalTimestamp(serverPolicy.unlockAtMs)
    || optionalTimestamp(commercial.freePeriodUntilMs);
  const policyLocked = typeof serverPolicy.locked === 'boolean'
    ? serverPolicy.locked
    : commercial.freePeriodActive;
  // A snapshot may remain mounted across the exact end of the free period. The
  // known server unlock timestamp must release the UI without requiring a restart.
  const locked = policyLocked && (!unlockAtMs || unlockAtMs > nowMs);
  const projectedPresets = safeArray(serverPolicy.presetCentavos)
    .map((value) => optionalCentavos(value))
    .filter((value) => value != null);

  return {
    version: DRIVER_WALLET_VIEW_VERSION,
    balanceCentavos,
    availableCentavos,
    heldCentavos,
    balancesReady: balanceCentavos != null && availableCentavos != null && heldCentavos != null,
    topupLocked: locked,
    topupUnlockAtMs: unlockAtMs,
    topupPresets: projectedPresets.length > 0
      ? projectedPresets
      : [...WALLET_TOPUP_PRESETS],
    topupMinCentavos: optionalCentavos(serverPolicy.minCentavos) ?? WALLET_TOPUP_MIN_CENTAVOS,
    topupMaxCentavos: optionalCentavos(serverPolicy.maxCentavos) ?? WALLET_TOPUP_MAX_CENTAVOS,
    history: mergeDriverWalletHistory(snapshot?.transactions, snapshot?.payments),
  };
}
