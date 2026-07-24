import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { colors } from '../../constants/colors';
import { DEV_RIDE_SIMULATOR_ENABLED } from '../../config/runtimeEnvironment';
import {
  activateRobotDriver,
  moveRobotTo,
  pauseRobotDriver,
  resolveRobotStartPoint,
  resumeRobotDriver,
  stopRobotDriver,
  subscribeRobotDriver,
} from '../../services/robotDriverEngine';

const PRESETS = [0.5, 1, 3, 5];
const SPEEDS = [5, 20, 40, 60];

function Choice({ active, label, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.choice, active && styles.choiceActive]}>
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Action({ label, onPress, disabled, danger }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.action, danger && styles.actionDanger, disabled && styles.disabled]}
    >
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

export default function RobotDriverScreen() {
  const router = useRouter();
  const [robot, setRobot] = useState(null);
  const [vehicleType, setVehicleType] = useState('car');
  const [presetKm, setPresetKm] = useState(1);
  const [speedKmh, setSpeedKmh] = useState(20);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeRobotDriver(setRobot), []);

  const coordinates = useMemo(() => {
    const point = robot?.currentPoint;
    return point ? `${Number(point.lat).toFixed(6)}, ${Number(point.lng).toFixed(6)}` : '—';
  }, [robot?.currentPoint]);

  async function run(label, action) {
    setBusy(true);
    console.log('[ROBOT_DRIVER_UI] action.started', {
      label,
      rideId: robot?.rideId,
      rideStatus: robot?.rideStatus,
      phase: robot?.phase,
      atMs: Date.now(),
    });
    try {
      await action();
      console.log('[ROBOT_DRIVER_UI] action.succeeded', {
        label,
        rideId: robot?.rideId,
        rideStatus: robot?.rideStatus,
        atMs: Date.now(),
      });
    } catch (error) {
      console.error('[ROBOT_DRIVER_UI] action.failed', {
        label,
        rideId: robot?.rideId,
        rideStatus: robot?.rideStatus,
        code: error?.code,
        message: error?.message,
        atMs: Date.now(),
      });
      Alert.alert('Robot Driver', error?.message || 'Une erreur est survenue.');
    } finally {
      setBusy(false);
    }
  }

  if (!DEV_RIDE_SIMULATOR_ENABLED) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Robot Driver indisponible</Text>
        <Text style={styles.help}>Cet outil existe uniquement dans le build de développement autorisé.</Text>
        <Action label="Retour" onPress={() => router.back()} />
      </View>
    );
  }

  const enabled = Boolean(robot?.enabled);
  const hasRide = enabled && Boolean(robot?.rideId);
  const canMoveToPickup = hasRide && robot?.rideStatus === 'assigned' && !busy;
  const canMoveToDestination = hasRide && robot?.rideStatus === 'in_progress' && !busy;
  const canResume = robot?.phase === 'paused'
    && ((robot?.targetKind === 'pickup' && robot?.rideStatus === 'assigned')
      || (robot?.targetKind === 'destination' && robot?.rideStatus === 'in_progress'))
    && !busy;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()}><Text style={styles.back}>‹ Retour</Text></Pressable>
        <Text style={styles.title}>🤖 Robot Driver</Text>
      </View>

      <View style={styles.warningCard}>
        <Text style={styles.warningTitle}>{enabled ? 'SIMULATION ACTIVE' : 'OUTIL DE DÉVELOPPEMENT'}</Text>
        <Text style={styles.help}>
          La demande, l’offre, l’acceptation et tous les écrans restent réels. Seule la position GPS du chauffeur est simulée.
        </Text>
      </View>

      {!enabled && (
        <>
          <Text style={styles.sectionTitle}>Véhicule</Text>
          <View style={styles.row}>
            <Choice active={vehicleType === 'moto'} label="Moto" onPress={() => setVehicleType('moto')} />
            <Choice active={vehicleType === 'car'} label="Voiture" onPress={() => setVehicleType('car')} />
          </View>

          <Text style={styles.sectionTitle}>Position de départ</Text>
          <View style={styles.wrap}>
            {PRESETS.map((value) => (
              <Choice
                key={value}
                active={!address.trim() && presetKm === value}
                label={value < 1 ? '500 m' : `${value} km`}
                onPress={() => { setAddress(''); setPresetKm(value); }}
              />
            ))}
          </View>
          <TextInput
            value={address}
            onChangeText={setAddress}
            placeholder="Ou saisir une adresse"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
          />

          <Text style={styles.sectionTitle}>Vitesse simulée</Text>
          <View style={styles.wrap}>
            {SPEEDS.map((value) => (
              <Choice key={value} active={speedKmh === value} label={`${value} km/h`} onPress={() => setSpeedKmh(value)} />
            ))}
          </View>

          <Action
            label={busy ? 'Activation…' : 'Activer la simulation'}
            disabled={busy}
            onPress={() => run('activate', async () => {
              const startPoint = await resolveRobotStartPoint({ presetKm, address });
              await activateRobotDriver({ vehicleType, speedKmh, startPoint });
            })}
          />
        </>
      )}

      {enabled && (
        <>
          <View style={styles.statusCard}>
            <Text style={styles.statusLine}>Phase robot : {robot?.phase}</Text>
            <Text style={styles.statusLine}>Course : {robot?.rideId || 'en attente d’une demande client'}</Text>
            <Text style={styles.statusLine}>Statut réel course : {robot?.rideStatus || '—'}</Text>
            <Text style={styles.statusLine}>Position : {coordinates}</Text>
            <Text style={styles.statusLine}>Vitesse : {robot?.speedKmh} km/h</Text>
            <Text style={styles.statusLine}>Dernier événement : {robot?.lastEvent}</Text>
            <Text style={styles.statusLine}>Dernière publication : {robot?.lastPublishAtMs ? new Date(robot.lastPublishAtMs).toLocaleTimeString() : '—'}</Text>
            {robot?.errorCode ? <Text style={styles.error}>Erreur : {robot.errorCode}</Text> : null}
          </View>

          <Text style={styles.help}>
            Pickup autorisé uniquement lorsque la vraie course est « assigned ». Destination autorisée uniquement après « Iniciar corrida ».
          </Text>

          <Action
            label="Aller au pickup"
            disabled={!canMoveToPickup}
            onPress={() => run('move_to_pickup', () => moveRobotTo('pickup'))}
          />
          <Action
            label="Pause"
            disabled={robot?.phase !== 'moving' || busy}
            onPress={() => pauseRobotDriver()}
          />
          <Action
            label="Reprendre"
            disabled={!canResume}
            onPress={() => resumeRobotDriver()}
          />
          <Action
            label="Aller à destination"
            disabled={!canMoveToDestination}
            onPress={() => run('move_to_destination', () => moveRobotTo('destination'))}
          />
          <Action
            label={busy ? 'Arrêt…' : 'Arrêter et restaurer le GPS réel'}
            danger
            disabled={busy}
            onPress={() => run('stop', stopRobotDriver)}
          />
        </>
      )}

      <View style={styles.debugCard}>
        <Text style={styles.sectionTitle}>Débogage</Text>
        <Text style={styles.help}>Filtres Metro / Logcat :</Text>
        <Text style={styles.code}>ROBOT_DRIVER</Text>
        <Text style={styles.code}>ROBOT_DRIVER_UI</Text>
        <Text style={styles.code}>DRIVER_LOCATION</Text>
        <Text style={styles.help}>Chaque action trace simulationId, driverId, rideId, rideStatus, phase, événement, timestamp et erreur.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 48, backgroundColor: colors.background, gap: 14 },
  centered: { flex: 1, justifyContent: 'center', padding: 24, gap: 18, backgroundColor: colors.background },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 4 },
  back: { color: colors.primary, fontSize: 17, fontWeight: '700' },
  title: { color: colors.text, fontSize: 24, fontWeight: '800', flex: 1 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginTop: 8 },
  help: { color: colors.textMuted, lineHeight: 20 },
  warningCard: { padding: 16, borderRadius: 14, backgroundColor: colors.warningBg, gap: 6 },
  warningTitle: { color: colors.warning, fontWeight: '900', letterSpacing: 0.5 },
  row: { flexDirection: 'row', gap: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  choice: { paddingVertical: 11, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  choiceActive: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  choiceText: { color: colors.textMuted, fontWeight: '700' },
  choiceTextActive: { color: colors.primary },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, color: colors.text, backgroundColor: colors.white },
  action: { minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, backgroundColor: colors.primary },
  actionDanger: { backgroundColor: colors.danger },
  actionText: { color: colors.white, fontWeight: '800', textAlign: 'center' },
  disabled: { opacity: 0.35 },
  statusCard: { padding: 16, borderRadius: 14, backgroundColor: colors.accentTint, gap: 6 },
  statusLine: { color: colors.text, lineHeight: 20 },
  error: { color: colors.danger, fontWeight: '800', marginTop: 4 },
  debugCard: { padding: 16, borderRadius: 14, borderWidth: 1, borderColor: colors.border, gap: 6 },
  code: { fontFamily: 'monospace', color: colors.primary, fontWeight: '700' },
});
