// External navigation helpers for Google Maps and Waze.
// DriveLocal does not provide in-app turn-by-turn navigation. Universal HTTPS
// links open the installed app when available and otherwise fall back to the web.

import { Linking } from 'react-native';
import { logRideClientEvent } from './clientRideLog';

export function isValidMapPoint(point) {
  const lat = Number(point?.lat);
  const lng = Number(point?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function assertPoint(point) {
  if (!isValidMapPoint(point)) {
    throw new Error('Coordenadas de navegação inválidas.');
  }
  return { lat: Number(point.lat), lng: Number(point.lng) };
}

function googleTravelMode(vehicleType) {
  return vehicleType === 'moto' ? 'two-wheeler' : 'driving';
}

function wazeVehicleType(vehicleType) {
  return vehicleType === 'moto' ? 'motorcycle' : 'private';
}

export function buildGoogleMapsRouteUrl({ origin, destination, vehicleType = 'car' }) {
  const from = assertPoint(origin);
  const to = assertPoint(destination);
  const params = new URLSearchParams({
    api: '1',
    origin: `${from.lat},${from.lng}`,
    destination: `${to.lat},${to.lng}`,
    travelmode: googleTravelMode(vehicleType),
    dir_action: 'navigate',
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function buildGoogleMapsPointUrl(point, vehicleType = 'car') {
  const destination = assertPoint(point);
  const params = new URLSearchParams({
    api: '1',
    destination: `${destination.lat},${destination.lng}`,
    travelmode: googleTravelMode(vehicleType),
    dir_action: 'navigate',
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function buildWazePointUrl(point, vehicleType = 'car') {
  const destination = assertPoint(point);
  const params = new URLSearchParams({
    ll: `${destination.lat},${destination.lng}`,
    navigate: 'yes',
    vehicle_type: wazeVehicleType(vehicleType),
    utm_source: 'drivelocal',
  });
  return `https://waze.com/ul?${params.toString()}`;
}

async function openTracedNavigation(provider, url, point, vehicleType) {
  const destination = assertPoint(point);
  logRideClientEvent('navigation.external_open_started', {
    provider,
    vehicleType,
    destination,
  });
  try {
    await Linking.openURL(url);
    logRideClientEvent('navigation.external_open_succeeded', {
      provider,
      vehicleType,
      destination,
    });
  } catch (error) {
    logRideClientEvent('navigation.external_open_failed', {
      provider,
      vehicleType,
      destination,
      error,
    }, 'error');
    throw error;
  }
}

export function openGoogleMapsRoute(input) {
  const destination = assertPoint(input.destination);
  const url = buildGoogleMapsRouteUrl(input);
  return openTracedNavigation('google_maps_route', url, destination, input.vehicleType || 'car');
}

export function openGoogleMapsToPoint(point, vehicleType = 'car') {
  return openTracedNavigation('google_maps', buildGoogleMapsPointUrl(point, vehicleType), point, vehicleType);
}

export function openWazeToPoint(point, vehicleType = 'car') {
  return openTracedNavigation('waze', buildWazePointUrl(point, vehicleType), point, vehicleType);
}

export function openWazeRoute({ lat, lng, vehicleType = 'car' }) {
  return openWazeToPoint({ lat, lng }, vehicleType);
}
