import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import AppButton from './AppButton';
import { colors } from '../constants/colors';
import { radius, spacing } from '../constants/spacing';
import { fontFamily, typography } from '../constants/typography';
import {
  DEFAULT_TRACKING_STALE_MS,
  isTrackingLocationFresh,
  normalizeTrackingPoint,
} from '../utils/rideTracking';

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

export default function RideTrackingMap({ pickup, driverLocation, vehicleType = 'car' }) {
  const mapRef = useRef(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const pickupPoint = normalizeTrackingPoint(pickup);
  const driverPoint = normalizeTrackingPoint(driverLocation?.location);
  const fresh = isTrackingLocationFresh(driverLocation, nowMs, DEFAULT_TRACKING_STALE_MS);

  const initialRegion = useMemo(
    () => regionAround([pickupPoint, driverPoint]),
    [pickupPoint?.lat, pickupPoint?.lng, driverPoint?.lat, driverPoint?.lng]
  );

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!mapRef.current || !pickupPoint || !driverPoint) return;
    mapRef.current.fitToCoordinates(
      [
        { latitude: pickupPoint.lat, longitude: pickupPoint.lng },
        { latitude: driverPoint.lat, longitude: driverPoint.lng },
      ],
      {
        animated: true,
        edgePadding: { top: 54, right: 54, bottom: 54, left: 54 },
      }
    );
  }, [driverPoint?.lat, driverPoint?.lng, pickupPoint?.lat, pickupPoint?.lng]);

  function recenter() {
    if (!mapRef.current) return;
    mapRef.current.animateToRegion(regionAround([pickupPoint, driverPoint]), 350);
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
        >
          {pickupPoint ? (
            <Marker
              coordinate={{ latitude: pickupPoint.lat, longitude: pickupPoint.lng }}
              title="Local de embarque"
              pinColor={colors.accent}
            />
          ) : null}

          {driverPoint ? (
            <Marker
              coordinate={{ latitude: driverPoint.lat, longitude: driverPoint.lng }}
              title={vehicleType === 'moto' ? 'Sua moto' : 'Seu motorista'}
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

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text
          style={[
            { flex: 1, fontFamily, color: fresh ? colors.success : colors.warning },
            typography.caption,
          ]}
        >
          {driverPoint
            ? fresh
              ? 'Posição do motorista atualizada ao vivo.'
              : 'A posição do motorista está temporariamente desatualizada.'
            : 'Aguardando a primeira posição do motorista…'}
        </Text>
        <AppButton title="Centralizar" variant="ghost" onPress={recenter} />
      </View>
    </View>
  );
}
