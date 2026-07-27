'use strict';

// Static, non-mutating source audit used by release:check.
// It complements tests and manual APK evidence; it never deploys, builds or writes.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const OPERATIONAL_PHASES = Object.freeze([
  'requested',
  'started',
  'succeeded',
  'failed',
  'restored',
  'duplicate_ignored',
]);

function read(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function exists(root, relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function collectSourceFiles(directory, output = []) {
  if (!fs.existsSync(directory)) return output;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectSourceFiles(absolutePath, output);
    else if (/\.(js|jsx|ts|tsx)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
      output.push(absolutePath);
    }
  }
  return output;
}

function containsEvery(source, values) {
  return values.every((value) => source.includes(value));
}

function validateProductionSourceAudit({ root = ROOT } = {}) {
  const problems = [];
  const check = (condition, message) => {
    if (!condition) problems.push(message);
  };

  const requiredFiles = [
    'src/utils/clientRideLog.js',
    'functions/src/logging/logger.js',
    'src/services/networkRecoveryService.js',
    'src/services/driverAvailabilityService.js',
    'src/services/driverLocationTracking.js',
    'src/utils/maps.js',
    'src/hooks/useRideNotifications.js',
    'functions/src/notifications/processEvent.js',
    'functions/src/rides/markDriverArrived.js',
    'functions/src/payments/callables.js',
    'src/components/AppButton.jsx',
  ];
  requiredFiles.forEach((relativePath) => {
    check(exists(root, relativePath), `Audit production: fichier critique absent: ${relativePath}`);
  });
  if (problems.length > 0) return problems;

  const clientLogger = read(root, 'src/utils/clientRideLog.js');
  const functionLogger = read(root, 'functions/src/logging/logger.js');
  for (const phase of OPERATIONAL_PHASES) {
    check(clientLogger.includes(`'${phase}'`), `Logger mobile: phase absente: ${phase}`);
    check(functionLogger.includes(`'${phase}'`), `Logger Functions: phase absente: ${phase}`);
  }
  check(clientLogger.includes('deriveOperationalPhase'), 'Logger mobile: normalisation phase absente.');
  check(functionLogger.includes('deriveOperationalPhase'), 'Logger Functions: normalisation phase absente.');
  check(!clientLogger.includes('errorMessage:'), 'Logger mobile: texte libre errorMessage interdit.');
  check(!clientLogger.includes('availableFields:'), 'Logger mobile: inventaire arbitraire de champs interdit.');
  check(containsEvery(functionLogger, [
    "'fullname'",
    "'passengername'",
    "'drivername'",
    "'pickup'",
    "'destination'",
    "'pixpayload'",
    "'lat'",
    "'lng'",
  ]), 'Logger Functions: couverture de redaction PII/localisation/Pix incomplète.');

  const applicationSources = collectSourceFiles(path.join(root, 'src'));
  const functionSources = collectSourceFiles(path.join(root, 'functions/src'));
  const allFiles = [...applicationSources, ...functionSources];
  const forbiddenFinancialMock = /\b(?:MOCK_(?:DRIVERS?|TX|TOPUPS?|WALLETS?|BALANCES?|PAYMENTS?|SUBSCRIPTIONS?)|mockDrivers|fakeWallet|fakeBalance|fakeTopup|fakePayment|fakeSubscription)\b/i;
  const financialMockFiles = allFiles
    .filter((filePath) => forbiddenFinancialMock.test(fs.readFileSync(filePath, 'utf8')))
    .map((filePath) => path.relative(root, filePath));
  check(financialMockFiles.length === 0,
    `Audit production: mock financier détecté: ${financialMockFiles.join(', ')}`);

  const fontScalingDisabledFiles = applicationSources
    .filter((filePath) => /allowFontScaling\s*=\s*\{?false\}?/.test(fs.readFileSync(filePath, 'utf8')))
    .map((filePath) => path.relative(root, filePath));
  check(fontScalingDisabledFiles.length === 0,
    `Accessibilité: allowFontScaling=false détecté: ${fontScalingDisabledFiles.join(', ')}`);

  const appButton = read(root, 'src/components/AppButton.jsx');
  check(appButton.includes('minHeight: 48'), 'AppButton doit conserver une cible tactile minimale de 48 px.');
  check(appButton.includes('accessibilityRole="button"'), 'AppButton doit exposer accessibilityRole=button.');
  check(appButton.includes('accessibilityState={{ disabled }}'), 'AppButton doit exposer son état désactivé.');
  check(appButton.includes('flexShrink: 1') && appButton.includes("textAlign: 'center'"),
    'AppButton doit accepter le retour à la ligne avec une police agrandie.');

  const maps = read(root, 'src/utils/maps.js');
  check(containsEvery(maps, [
    'navigation.external_open_started',
    'navigation.external_open_succeeded',
    'navigation.external_open_failed',
    'openGoogleMapsToPoint',
    'openWazeToPoint',
  ]), 'Navigation externe: traces started/succeeded/failed ou providers incomplets.');

  const network = read(root, 'src/services/networkRecoveryService.js');
  check(network.includes('idempotency.prepared'), 'Réseau: préparation idempotente absente.');
  check(network.includes('confirmation_uncertain'), 'Réseau: état de confirmation incertaine absent.');
  check(network.includes('connection.recovered'), 'Réseau: trace de restauration absente.');

  const availability = read(root, 'src/services/driverAvailabilityService.js');
  check(availability.includes('work_session.start_requested'), 'Disponibilité: trace requested absente.');
  check(availability.includes('work_session.start_succeeded'), 'Disponibilité: trace succeeded absente.');
  check(availability.includes('work_session.start_failed'), 'Disponibilité: trace failed absente.');

  const location = read(root, 'src/services/driverLocationTracking.js');
  check(/restor|recover|resume/i.test(location), 'GPS: logique de restauration/reprise absente.');

  const notifications = read(root, 'src/hooks/useRideNotifications.js');
  check(containsEvery(notifications, [
    'setNotificationHandler',
    'addNotificationReceivedListener',
    'addNotificationResponseReceivedListener',
    'getLastNotificationResponseAsync',
  ]), 'Notifications: couverture premier plan/arrière-plan/démarrage à froid incomplète.');

  const arrival = read(root, 'functions/src/rides/markDriverArrived.js');
  check(containsEvery(arrival, [
    'DRIVER_ARRIVED',
    'notificationEventCreated',
    'passengerScreenUpdated: true',
    'notificationEventReady: true',
  ]), 'Arrivée chauffeur: transition, notification ou reprise incomplète.');

  const notificationProcessor = read(root, 'functions/src/notifications/processEvent.js');
  check(notificationProcessor.includes('no_active_tokens'),
    'Notifications: absence de token doit rester un résultat explicite.');
  check(notificationProcessor.includes('notification.duplicate_ignored'),
    'Notifications: protection de redélivrance absente.');

  const payments = read(root, 'functions/src/payments/callables.js');
  check(containsEvery(payments, [
    'MERCADO_PAGO_ACCESS_TOKEN',
    'MERCADO_PAGO_WEBHOOK_SECRET',
    'mercadoPagoWebhook',
    'createMercadoPagoAdapter',
  ]), 'Mercado Pago: secrets, adapter réel ou webhook incomplet.');

  const allSource = allFiles.map((filePath) => fs.readFileSync(filePath, 'utf8')).join('\n');
  const domainEvidence = [
    ['offre', ['offers_created', 'offer_created', 'offer_expiry']],
    ['acceptation', ['ride.accept.started', 'ride.accept.won']],
    ['arrivée', ['ride.arrived', 'arrived_replayed']],
    ['embarquement', ['ride.started']],
    ['fin de course', ['ride.awaiting_payment', 'finishRideSecure']],
    ['Pix', ['payment_marked_sent', 'pix_charge_created']],
    ['wallet', ['wallet.', 'wallet_']],
    ['abonnement', ['subscription', 'assinatura']],
    ['notification', ['notification.sent', 'notification.failed']],
    ['restauration', ['restored', 'recovered', 'replayed']],
  ];
  for (const [domain, tokens] of domainEvidence) {
    check(tokens.some((token) => allSource.includes(token)),
      `Observabilité: aucune preuve de trace pour le domaine ${domain}.`);
  }

  return problems;
}

module.exports = {
  ROOT,
  OPERATIONAL_PHASES,
  collectSourceFiles,
  validateProductionSourceAudit,
};
