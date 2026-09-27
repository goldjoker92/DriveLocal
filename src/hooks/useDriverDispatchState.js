import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { getDriverTrackingSession } from '../services/driverLocationTracking';
import { getDriverDeviceHealth, subscribeDriverDeviceHealth, publishDriverDeviceHealth } from '../services/driverDeviceHealthStore';
import { getDriverDeviceDiagnostic } from '../services/driverDeviceDiagnostics';
import { getNetworkRecoveryState, subscribeNetworkRecovery } from '../services/networkRecoveryService';
import { recoverDriverAvailability } from '../services/driverAvailabilityRecovery';
import { driverDispatchVisibility } from '../utils/driverWorkSession';
import { driverAvailabilityPresentation } from '../utils/driverAvailabilityPresentation';

export default function useDriverDispatchState(driver, source = {}) {
  const router = useRouter();
  const uid = auth.currentUser?.uid;
  const [nowMs, setNowMs] = useState(Date.now());
  const [session, setSession] = useState({ known: false, value: null });
  const [policy, setPolicy] = useState({ confirmed: false, value: {} });
  const [device, setDevice] = useState(getDriverDeviceHealth);
  const [network, setNetwork] = useState(getNetworkRecoveryState);
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const serviceAreaId = driver?.serviceAreaId || 'HORIZONTE_CE_BR';

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => subscribeDriverDeviceHealth(setDevice), []);
  useEffect(() => subscribeNetworkRecovery(setNetwork), []);
  useEffect(() => {
    setPolicy({ confirmed: false, value: {} });
    if (!uid) return undefined;
    return onSnapshot(doc(db, 'cityPublicConfig', serviceAreaId), { includeMetadataChanges: true }, (snap) => {
      setPolicy({
        confirmed: !snap.metadata.fromCache && !snap.metadata.hasPendingWrites,
        value: snap.exists() ? snap.data() : {},
      });
    }, () => setPolicy({ confirmed: false, value: {} }));
  }, [uid, serviceAreaId]);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (active) setNowMs(Date.now());
      try {
        const value = await getDriverTrackingSession();
        if (active) setSession({ known: true, value: value?.driverId === uid ? value : null });
        if (active && value?.driverId === uid && value?.availabilitySessionId === driver?.availabilitySessionId
          && getDriverDeviceHealth()?.sessionId !== value.availabilitySessionId) {
          const diagnostic = await getDriverDeviceDiagnostic({ expectTrackingActive: true });
          if (active) publishDriverDeviceHealth(uid, diagnostic, value.availabilitySessionId);
        }
      } catch (_error) {
        if (active) setSession({ known: false, value: null });
      }
    };
    void refresh();
    const timer = setInterval(refresh, 15_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => { active = false; clearInterval(timer); subscription.remove(); };
  }, [uid, driver?.availabilitySessionId, driver?.locationUpdatedAtMs]);

  const deviceKnown = device?.uid === uid && nowMs - device.atMs < 75_000
    && device.sessionId === driver?.availabilitySessionId;
  const visibility = driverDispatchVisibility(driver, {
    nowMs, snapshotConfirmed: source.confirmed === true, fromCache: source.fromCache,
    driverBuildPolicy: policy.value, policyConfirmed: policy.confirmed,
    localSessionKnown: session.known, localSessionId: session.value?.availabilitySessionId,
    deviceKnown, deviceDiagnostic: deviceKnown ? device.diagnostic : null,
    networkStatus: network.status,
  });
  const presentation = driverAvailabilityPresentation(visibility);

  useEffect(() => {
    console.info('[DRIVER_AVAILABILITY] visibility.changed', {
      scope: 'driver_availability', event: 'visibility.changed', atMs: Date.now(),
      state: visibility.state, reason: visibility.reason,
    });
    setRecoveryError('');
  }, [visibility.state, visibility.reason]);

  const recover = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRecovering(true);
    setRecoveryError('');
    let timeout;
    try {
      const route = { home: '/driver-home', wallet: '/wallet', profile: '/profile',
        update: '/update-required', support: '/support-center' }[presentation.action];
      if (presentation.action === 'settings') await Linking.openSettings();
      else if (route) router.push(route);
      else {
        await Promise.race([
          recoverDriverAvailability(policy.value),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(Object.assign(
              new Error('A confirmação demorou. Verifique o GPS e a internet e tente novamente.'),
              { code: 'RECOVERY_TIMEOUT' }
            )), 20_000);
          }),
        ]);
      }
    } catch (error) {
      if (error?.code === 'RECOVERY_TIMEOUT') console.info('[DRIVER_AVAILABILITY] recovery.ui_timeout', {
        scope: 'driver_availability', event: 'recovery.ui_timeout', atMs: Date.now(),
        reason: 'RECOVERY_TIMEOUT', result: 'pending_attempt_preserved',
      });
      const safeCodes = ['SESSION_RESTART_REQUIRED', 'LOCATION_NOT_CONFIRMED', 'SESSION_CHANGED',
        'AVAILABILITY_NOT_CONFIRMED', 'DEVICE_NOT_READY', 'RECOVERY_TIMEOUT'];
      if (mounted.current) setRecoveryError(safeCodes.includes(error?.code)
        ? error.message : 'Sem confirmação do servidor. Verifique o GPS e a conexão e tente novamente.');
    } finally {
      clearTimeout(timeout);
      inFlight.current = false;
      if (mounted.current) { setRecovering(false); setNowMs(Date.now()); }
    }
  }, [presentation.action, policy.value, router]);

  return { visibility, presentation, recovering, recoveryError, recover };
}
