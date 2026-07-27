import { StyleSheet, Text, View } from 'react-native';
import AppButton from './AppButton';
import AppCard from './AppCard';
import RideTrackingMap from './RideTrackingMap';
import { colors } from '../constants/colors';
import { radius, spacing } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';
import { VEHICLE_LABELS_PT_BR } from '../constants/vehicleTypes';
import { firstName } from '../utils/driverPhoto';
import { formatBRL } from '../utils/format';

const MAP_STATUSES = new Set(['assigned', 'driver_arrived', 'in_progress']);

const STATUS_COPY = Object.freeze({
  searching: {
    eyebrow: 'BUSCANDO MOTORISTA',
    title: 'Procurando motoristas disponíveis',
    detail: 'Você pode acompanhar a busca sem refazer a solicitação.',
    action: 'ACOMPANHAR BUSCA',
  },
  assigned: {
    eyebrow: 'MOTORISTA A CAMINHO',
    title: 'Seu motorista está indo até você',
    detail: 'A posição e a estimativa de chegada são atualizadas no mapa.',
    action: 'ACOMPANHAR CORRIDA',
  },
  driver_arrived: {
    eyebrow: 'MOTORISTA CHEGOU',
    title: 'Confira o veículo e a placa',
    detail: 'Entre somente no veículo mostrado abaixo.',
    action: 'VER MOTORISTA',
  },
  in_progress: {
    eyebrow: 'CORRIDA EM ANDAMENTO',
    title: 'Você está a caminho do destino',
    detail: 'A posição do motorista e o destino permanecem visíveis.',
    action: 'ACOMPANHAR TRAJETO',
  },
  awaiting_payment: {
    eyebrow: 'PAGAMENTO PIX',
    title: 'A corrida terminou',
    detail: 'Pague diretamente ao motorista pelo Pix exibido no fluxo seguro.',
    action: 'ABRIR PAGAMENTO PIX',
  },
  payment_marked_sent: {
    eyebrow: 'PIX INFORMADO',
    title: 'Aguardando confirmação do motorista',
    detail: 'O registro permanece visível até a confirmação do recebimento.',
    action: 'VER PAGAMENTO',
  },
  disputed: {
    eyebrow: 'PAGAMENTO EM ANÁLISE',
    title: 'O pagamento precisa de conferência',
    detail: 'Os dados da corrida e do Pix permanecem registrados.',
    action: 'VER DETALHES',
  },
});

function DriverSummary({ ride }) {
  const driver = ride?.acceptedDriverPublic || {};
  if (!ride?.acceptedDriverId && !driver?.name) return null;
  const vehicleType = driver.vehicleType || ride.vehicleType;
  const vehicle = [driver.vehicleMake, driver.vehicleModel, driver.vehicleColor]
    .filter(Boolean)
    .join(' • ');

  return (
    <View style={styles.driverBox}>
      <View style={styles.driverHeader}>
        <View style={styles.driverCopy}>
          <Text style={styles.driverName}>{firstName(driver.name || 'Motorista')}</Text>
          <Text style={styles.driverVehicle}>
            {`${VEHICLE_LABELS_PT_BR[vehicleType] || 'Veículo'}${vehicle ? ` • ${vehicle}` : ''}`}
          </Text>
        </View>
        <Text style={styles.plate}>{driver.vehiclePlate || 'Placa indisponível'}</Text>
      </View>
      <Text style={styles.verified}>Motorista e veículo verificados pelo cadastro DriveLocal</Text>
    </View>
  );
}

export default function PassengerActiveRideDashboardCard({ ride, driverLocation, onOpen }) {
  if (!ride?.rideId) return null;
  const copy = STATUS_COPY[ride.status] || {
    eyebrow: 'SUA CORRIDA',
    title: 'Atualizando sua corrida',
    detail: 'Aguarde alguns instantes.',
    action: 'ACOMPANHAR CORRIDA',
  };
  const showMap = MAP_STATUSES.has(ride.status);
  const mapTarget = ride.status === 'in_progress' ? ride.destination : ride.pickup;
  const mapTargetTitle = ride.status === 'in_progress' ? 'Destino da corrida' : 'Local de embarque';
  const amount = ride.finalFareCentavos ?? ride.paymentAmountCentavos ?? ride.estimatedFareCentavos;

  return (
    <AppCard style={styles.card}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.detail}>{copy.detail}</Text>
      </View>

      <DriverSummary ride={ride} />

      <View style={styles.routeBox}>
        <View style={styles.routeRow}>
          <Text style={styles.routeIcon}>📍</Text>
          <View style={styles.routeCopy}>
            <Text style={styles.routeLabel}>LOCAL DE PARTIDA</Text>
            <Text style={styles.routeValue}>{ride.pickup?.label || 'Local de partida indisponível'}</Text>
          </View>
        </View>
        <View style={styles.routeDivider} />
        <View style={styles.routeRow}>
          <Text style={styles.routeIcon}>🏁</Text>
          <View style={styles.routeCopy}>
            <Text style={styles.routeLabel}>DESTINO</Text>
            <Text style={styles.routeValue}>{ride.destination?.label || 'Destino indisponível'}</Text>
          </View>
        </View>
      </View>

      <View style={styles.paymentRow}>
        <View style={styles.paymentCopy}>
          <Text style={styles.paymentLabel}>VALOR DA CORRIDA</Text>
          <Text style={styles.paymentValue}>{amount == null ? 'Valor indisponível' : formatBRL(amount)}</Text>
        </View>
        <View style={styles.pixBadge}>
          <Text style={styles.pixBadgeTitle}>PIX DIRETO</Text>
          <Text style={styles.pixBadgeText}>Passageiro → motorista</Text>
        </View>
      </View>

      {showMap ? (
        <View style={styles.mapBox}>
          <Text style={styles.mapTitle}>
            {ride.status === 'in_progress' ? 'POSIÇÃO DURANTE A CORRIDA' : 'CHEGADA ESTIMADA'}
          </Text>
          <RideTrackingMap
            rideId={ride.rideId}
            target={mapTarget}
            targetTitle={mapTargetTitle}
            driverLocation={driverLocation}
            vehicleType={ride.acceptedDriverPublic?.vehicleType || ride.vehicleType}
            showEta={ride.status === 'assigned' || ride.status === 'in_progress'}
            etaContext={ride.status === 'in_progress' ? 'destination' : 'pickup'}
          />
        </View>
      ) : null}

      <AppButton title={copy.action} onPress={onOpen} />
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md, borderWidth: 2, borderColor: colors.primary },
  hero: { gap: 4 },
  eyebrow: { fontFamily, color: colors.primary, ...typography.caption, fontWeight: '800', letterSpacing: 0.8 },
  title: { fontFamily, color: colors.text, ...typography.h3 },
  detail: { fontFamily, color: colors.textMuted, ...typography.small },
  driverBox: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primaryTint,
  },
  driverHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  driverCopy: { flex: 1, gap: 2 },
  driverName: { fontFamily, color: colors.text, ...typography.h3 },
  driverVehicle: { fontFamily, color: colors.textMuted, ...typography.small },
  plate: { fontFamily, color: colors.primary, ...typography.bodyBold },
  verified: { fontFamily, color: colors.success, ...typography.caption },
  routeBox: { gap: spacing.sm },
  routeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  routeIcon: { fontSize: 18 },
  routeCopy: { flex: 1, gap: 2 },
  routeLabel: { fontFamily, color: colors.textMuted, ...typography.caption, fontWeight: '800' },
  routeValue: { fontFamily, color: colors.text, ...typography.small },
  routeDivider: { height: 1, marginLeft: 28, backgroundColor: colors.border },
  paymentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  paymentCopy: {
    flexGrow: 1,
    flexBasis: 130,
    gap: 2,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.accentTint,
  },
  paymentLabel: { fontFamily, color: colors.textMuted, ...typography.caption, fontWeight: '800' },
  paymentValue: { fontFamily, color: colors.success, ...typography.h3 },
  pixBadge: {
    flexGrow: 1,
    flexBasis: 130,
    gap: 2,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pixBadgeTitle: { fontFamily, color: colors.primary, ...typography.bodyBold },
  pixBadgeText: { fontFamily, color: colors.textMuted, ...typography.caption },
  mapBox: { gap: spacing.sm },
  mapTitle: { fontFamily, color: colors.textMuted, ...typography.caption, fontWeight: '800' },
});