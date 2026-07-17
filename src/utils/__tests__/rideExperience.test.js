import fs from 'fs';
import path from 'path';
import {
  buildGoogleMapsPointUrl,
  buildGoogleMapsRouteUrl,
  buildWazePointUrl,
  isValidMapPoint,
} from '../maps';
import {
  buildNotificationRouteTarget,
  notificationDataFromResponse,
} from '../notificationNavigation';

const PICKUP = { lat: -4.0995358, lng: -38.5006227 };
const DESTINATION = { lat: -4.10497, lng: -38.44969 };

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('external navigation URLs', () => {
  it('opens exact Google Maps coordinates with the correct car/moto mode', () => {
    const car = new URL(buildGoogleMapsPointUrl(PICKUP, 'car'));
    expect(car.origin + car.pathname).toBe('https://www.google.com/maps/dir/');
    expect(car.searchParams.get('destination')).toBe(`${PICKUP.lat},${PICKUP.lng}`);
    expect(car.searchParams.get('travelmode')).toBe('driving');
    expect(car.searchParams.get('dir_action')).toBe('navigate');

    const moto = new URL(buildGoogleMapsRouteUrl({
      origin: PICKUP,
      destination: DESTINATION,
      vehicleType: 'moto',
    }));
    expect(moto.searchParams.get('origin')).toBe(`${PICKUP.lat},${PICKUP.lng}`);
    expect(moto.searchParams.get('destination')).toBe(`${DESTINATION.lat},${DESTINATION.lng}`);
    expect(moto.searchParams.get('travelmode')).toBe('two-wheeler');
  });

  it('builds a universal Waze link and rejects malformed coordinates', () => {
    const waze = new URL(buildWazePointUrl(DESTINATION, 'moto'));
    expect(waze.origin + waze.pathname).toBe('https://waze.com/ul');
    expect(waze.searchParams.get('ll')).toBe(`${DESTINATION.lat},${DESTINATION.lng}`);
    expect(waze.searchParams.get('navigate')).toBe('yes');
    expect(waze.searchParams.get('vehicle_type')).toBe('motorcycle');
    expect(waze.searchParams.get('utm_source')).toBe('drivelocal');

    expect(isValidMapPoint(PICKUP)).toBe(true);
    expect(isValidMapPoint({ lat: 91, lng: 0 })).toBe(false);
    expect(() => buildGoogleMapsPointUrl({ lat: 'x', lng: 1 })).toThrow('Coordenadas');
  });
});

describe('notification tap routing', () => {
  it('preserves ride and offer context for foreground/background/cold-start taps', () => {
    const response = {
      notification: {
        request: {
          content: {
            data: {
              notificationId: 'ride1_offer_created_driver1',
              eventType: 'offer_created',
              route: '/ride-request',
              rideId: 'ride1',
              offerId: 'ride1_driver1',
            },
          },
        },
      },
    };
    const data = notificationDataFromResponse(response);
    expect(buildNotificationRouteTarget(data)).toEqual({
      pathname: '/ride-request',
      params: {
        rideId: 'ride1',
        offerId: 'ride1_driver1',
        eventType: 'offer_created',
      },
    });
  });

  it('blocks unknown routes and ride screens without rideId', () => {
    expect(buildNotificationRouteTarget({ route: '/admin-secret', rideId: 'r1' })).toBeNull();
    expect(buildNotificationRouteTarget({ route: '/pix-payment' })).toBeNull();
    expect(buildNotificationRouteTarget({ route: '/driver-home' })).toBe('/driver-home');
  });
});

describe('active passenger/driver screen contracts', () => {
  it('contains no runtime ride mocks and uses secured listeners/callables', () => {
    const assigned = source('src/app/(passenger)/driver-accepted.jsx');
    const completed = source('src/app/(passenger)/ride-completed.jsx');
    const searching = source('src/app/(passenger)/searching.jsx');
    const activeDriver = source('src/app/(driver)/active-ride.jsx');
    const notificationHook = source('src/hooks/useRideNotifications.js');

    expect(assigned).not.toContain('/mock/');
    expect(completed).not.toContain('/mock/');
    expect(assigned).toContain('listenToRide');
    expect(assigned).toContain("pathname: '/pix-payment', params: { rideId }");
    expect(completed).toContain('listenToRide');
    expect(searching).toContain('cancelRide');
    expect(activeDriver).toContain('driverRideStatus');
    expect(activeDriver).toContain('listenToMyOffer');
    expect(notificationHook).toContain('buildNotificationRouteTarget');
  });

  it('does not log exact passenger coordinates or addresses', () => {
    const location = source('src/services/locationService.js');
    expect(location).not.toContain('console.log');
    expect(location).not.toContain('position lat=');
  });
});
