const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('proactive driver wallet recovery contract', () => {
  it('derives wallet readiness from real balance and commercial policy', () => {
    const summary = source('src/utils/driverCockpitSummary.js');
    const pricing = source('src/constants/pricingConfig.js');

    expect(pricing).toContain('MIN_WALLET_BALANCE_CENTAVOS = 300');
    expect(summary).toContain("import { resolveCommercialPolicy } from './commercialPolicy'");
    expect(summary).toContain('availableCentavos > MIN_WALLET_BALANCE_CENTAVOS');
    expect(summary).toContain("walletState: blocked ? 'blocked' : 'ready'");
    expect(summary).toContain('walletNeedsTopup: blocked');
    expect(summary).not.toContain('walletStatusPresentation(status)');
  });

  it('warns proactively and sends a blocked driver directly to contextual topup', () => {
    const dashboard = source('src/components/DriverCockpitDashboardCard.jsx');

    expect(dashboard).toContain('Recarga necessária para receber corridas');
    expect(dashboard).toContain('RECARREGAR AGORA');
    expect(dashboard).toContain("reason: 'wallet_required'");
    expect(dashboard).toContain("returnTo: '/driver-home'");
    expect(dashboard).toContain('saldo deve ficar acima de');
  });

  it('explains the block, threshold, Pix minimum and successful recovery in wallet', () => {
    const wallet = source('src/app/(driver)/wallet.jsx');

    expect(wallet).toContain('useLocalSearchParams');
    expect(wallet).toContain("firstParam(params.reason) === 'wallet_required'");
    expect(wallet).toContain('POR QUE VOCÊ VEIO PARA A CARTEIRA');
    expect(wallet).toContain('Recarga necessária para voltar a trabalhar');
    expect(wallet).toContain('A recarga Pix mínima é R$ 10,00');
    expect(wallet).toContain('Saldo liberado para voltar a trabalhar');
    expect(wallet).toContain('VOLTAR AO PAINEL DO MOTORISTA');
    expect(wallet).toContain("router.replace('/driver-home')");
    expect(wallet).toContain('wallet.availableCentavos > MIN_WALLET_BALANCE_CENTAVOS');
  });

  it('redirects automatically when the authoritative server rejects work for wallet balance', () => {
    const service = source('src/services/driverAvailabilityService.js');

    expect(service).toContain("safeCode === 'WALLET_INSUFFICIENT'");
    expect(service).toContain("reason === 'wallet_low'");
    expect(service).toContain('work_session.wallet_recovery_redirected');
    expect(service).toContain("pathname: '/wallet'");
    expect(service).toContain("reason: 'wallet_required'");
    expect(service).toContain('redirectToRequiredWalletTopup(error)');
  });

  it('keeps both backend wallet gates authoritative', () => {
    const availability = source('functions/src/drivers/availability.js');
    const acceptance = source('functions/src/rides/acceptOffer.js');

    expect(availability).toContain('walletAvailable > rideC.MIN_WALLET_BALANCE_CENTAVOS');
    expect(availability).toContain("reason: 'wallet_low'");
    expect(acceptance).toContain('available > C.MIN_WALLET_BALANCE_CENTAVOS');
    expect(acceptance).toContain('available < holdAmount');
    expect(acceptance).toContain('WALLET_INSUFFICIENT');
  });
});
