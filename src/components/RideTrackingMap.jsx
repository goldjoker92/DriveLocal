import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Constants from 'expo-constants';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import AppButton from './AppButton';
import { colors } from '../constants/colors';
import { radius, spacing } from '../constants/spacing';
import { fontFamily, typography } from '../constants/typography';
import { logRideClientEvent } from '../utils/clientRideLog';
import {
  DEFAULT_TRACKING_STALE_MS,
  isTrackingLocationFresh,
  normalizeTrackingPoint,
} from '../utils/rideTracking';

const EARTH_RADIUS_KM = 6371;
const MAX_TRACKING_LOG_CACHE = 50;
const trackingLogStateByRide = new Map();

function regionAround(points) {
  const valid = points.filter(Boolean);
  if (valid.length === 0) {
    return {
      latitude: -4.1045,
      longitude: -38.4955,
      latitudeDelta: 0.04,
      longitudeDelta: 0.04,
    };
  }

  const lats = valid.map((p) => p.lat);
  const lngs = valid.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.008, (maxLat - minLat) * 1.8),
    longitudeDelta: Math.max(0.008, (maxLng - minLng) * 1.8),
  };
}

function toRadians(value) {
  return (Number(value) * Math.PI) / 180;
}

function distanceKm(a, b) {
  if (!a || !b) return null;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function etaRange(distance, vehicleType) {
  if (!Number.isFinite(distance)) return null;
  // MVP estimate: intentionally presented as a range, not false route precision.
  const averageKph = vehicleType === 'moto' ? 28 : 22;
  const centerMinutes = Math.max(1, Math.ceil((distance / averageKph) * 60));
  return {
    min: Math.max(1, centerMinutes - 2),
    max: Math.max(3, centerMinutes + 3),
  };
}

function lastUpdateLabel(updatedAtMs, nowMs) {
  const ageSeconds = Math.max(0, Math.floor((nowMs - Number(updatedAtMs || 0)) / 1000));
  if (!Number.isFinite(ageSeconds) || !updatedAtMs) return 'sem atualização';
  if (ageSeconds < 5) return 'agora';
  if (ageSeconds < 60) return `há ${ageSeconds}s`;
  return `há ${Math.floor(ageSeconds / 60)} min`;
}

function trimTrackingLogCache() {
  while (trackingLogStateByRide.size > MAX_TRACKING_LOG_CACHE) {
    const oldestKey = trackingLogStateByRide.keys().next().value;
    trackingLogStateByRide.delete(oldestKey);
  }
}

function meaningfulTrackingState({ configured, mapReady, targetPoint, driverPoint, fresh }) {
  if (!configured) return 'maps_unconfigured';
  if (!mapReady) return 'map_loading';
  if (!targetPoint) return 'waiting_target';
  if (!driverPoint) return 'waiting_driver_location';
  return fresh ? 'tracking_fresh' : 'tracking_stale';
}

function logTrackingStateOnce(rideId, state, details) {
  if (!rideId || !state) return;
  if (trackingLogStateByRide.get(rideId) === state) return;
  trackingLogStateByRide.delete(rideId);
  trackingLogStateByRide.set(rideId, state);
  trimTrackingLogCache();
  logRideClientEvent('ride.map.tracking_state_changed', {
    rideId,
    trackingState: state,
    ...details,
  });
}

export default function RideTrackingMap({
  rideId = null,
  target,
  targetTitle = 'Local de embarque',
  driverLocation,
  vehicleType = 'car',
  showEta = true,
  etaContext = 'pickup',
}) {
  const mapRef = useRef(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [mapReady, setMapReady] = useState(false);
  const targetPoint = normalizeTrackingPoint(target);
  const driverPoint = normalizeTrackingPoint(driverLocation?.location);
  const fresh = isTrackingLocationFresh(driverLocation, nowMs, DEFAULT_TRACKING_STALE_MS);
  const directDistanceKm = distanceKm(driverPoint, targetPoint);
  const eta = etaRange(directDistanceKm, vehicleType);
  const distanceText = Number.isFinite(directDistanceKm)
    ? directDistanceKm < 1
      ? `${Math.max(50, Math.round(directDistanceKm * 1000))} m`
      : `${directDistanceKm.toFixed(1)} km`
    : null;
  const googleMapsAndroidConfigured = Constants.expoConfig?.extra?.googleMapsAndroidConfigured === true;

  const initialRegion = useMemo(
    () => regionAround([targetPoint, driverPoint]),
    [targetPoint?.lat, targetPoint?.lng, driverPoint?.lat, driverPoint?.lng]
  );

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  const trackingState = meaningfulTrackingState({
    configured: googleMapsAndroidConfigured,
    mapReady,
    targetPoint,
    driverPoint,
    fresh,
  });

  useEffect(() => {
    logTrackingStateOnce(rideId, trackingState, {
      mapReady,
      googleMapsAndroidConfigured,
      hasTarget: !!targetPoint,
      hasDriverLocation: !!driverPoint,
      fresh,
      distanceKm: directDistanceKm,
      updatedAtMs: driverLocation?.updatedAtMs || null,
      logPolicy: 'semantic_state_only',
    });
  }, [
    rideId,
    trackingState,
    mapReady,
    googleMapsAndroidConfigured,
    !!targetPoint,
    !!driverPoint,
    fresh,
  ]);

  useEffect(() => {
    if (!mapRef.current || !targetPoint || !driverPoint) return;
    mapRef.current.fitToCoordinates(
      [
        { latitude: targetPoint.lat, longitude: targetPoint.lng },
        { latitude: driverPoint.lat, longitude: driverPoint.lng },
      ],
      {
        animated: true,
        edgePadding: { top: 54, right: 54, bottom: 54, left: 54 },
      }
    );
  }, [driverPoint?.lat, driverPoint?.lng, targetPoint?.lat, targetPoint?.lng]);

  function recenter() {
    if (!mapRef.current) return;
    logRideClientEvent('ride.map.recenter_pressed', {
      rideId,
      hasTarget: !!targetPoint,
      hasDriverLocation: !!driverPoint,
    });
    mapRef.current.animateToRegion(regionAround([targetPoint, driverPoint]), 350);
  }

  return (
    <View style={{ gap: spacing.sm }}>
      <View
        style={{
          height: 250,
          overflow: 'hidden',
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.card,
        }}
      >
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={{ flex: 1 }}
          initialRegion={initialRegion}
          loadingEnabled
          showsCompass
          showsTraffic
          toolbarEnabled={false}
          moveOnMarkerPress={false}
          onMapReady={() => setMapReady(true)}
        >
          {targetPoint ? (
            <Marker
              coordinate={{ latitude: targetPoint.lat, longitude: targetPoint.lng }}
              title={targetTitle}
              pinColor={colors.accent}
            />
          ) : null}

          {driverPoint ? (
            <Marker
              coordinate={{ latitude: driverPoint.lat, longitude: driverPoint.lng }}
              title={vehicleType === 'moto' ? 'Moto do motorista' : 'Carro do motorista'}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges
            >
              <View
                style={{
                  minWidth: 42,
                  minHeight: 42,
                  borderRadius: 21,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.white,
                  borderWidth: 2,
                  borderColor: fresh ? colors.primary : colors.warning,
                  shadowColor: colors.black,
                  shadowOpacity: 0.18,
                  shadowRadius: 4,
                  elevation: 4,
                }}
              >
                <Text style={{ fontSize: 23 }}>{vehicleType === 'moto' ? '🏍️' : '🚗'}</Text>
              </View>
            </Marker>
          ) : null}
        </MapView>
      </View>

      {showEta && driverPoint && targetPoint && eta && distanceText ? (
        <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>
          {etaContext === 'destination'
            ? `${distanceText} restantes • chegada estimada em ${eta.min}–${eta.max} min`
            : `${distanceText} • chegada estimada em ${eta.min}–${eta.max} min`}
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text
          style={[
            { flex: 1, fontFamily, color: fresh ? colors.success : colors.warning },
            typography.caption,
          ]}
        >
          {driverPoint
            ? fresh
              ? `Posição atualizada ${lastUpdateLabel(driverLocation?.updatedAtMs, nowMs)}.`
              : `Última posição ${lastUpdateLabel(driverLocation?.updatedAtMs, nowMs)} — sinal temporariamente desatualizado.`
            : 'Aguardando a primeira posição do motorista…'}
        </Text>
        <AppButton title="Centralizar" variant="ghost" onPress={recenter} />
      </View>

      {!googleMapsAndroidConfigured ? (
        <Text style={[{ fontFamily, color: colors.warning }, typography.caption]}>
          Este build Android não contém uma chave Google Maps. Configure GOOGLE_MAPS_ANDROID_API_KEY e gere um novo build nativo.
        </Text>
      ) : !mapReady ? (
        <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>
          Carregando o mapa… Se ele permanecer escuro, verifique a chave, o package e o SHA-1 deste build.
        </Text>
      ) : null}
    </View>
  );
}
