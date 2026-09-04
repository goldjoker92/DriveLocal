jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(() => Promise.resolve()),
  deactivateKeepAwake: jest.fn(() => Promise.resolve()),
}));

const {
  deriveDriverKeepAwakeState,
} = require('../DriverKeepAwakeGuard');

describe('DriverKeepAwakeGuard policy', () => {
  it('keeps the foreground screen awake while the driver is online', () => {
    expect(deriveDriverKeepAwakeState({
      availabilityStatus: 'online',
      activeRideId: null,
      appState: 'active',
    })).toEqual({
      enabled: true,
      reason: 'driver_online',
      hasActiveRide: false,
    });
  });

  it('keeps the foreground screen awake throughout an active ride', () => {
    expect(deriveDriverKeepAwakeState({
      availabilityStatus: 'offline',
      activeRideId: 'ride-123',
      appState: 'active',
    })).toEqual({
      enabled: true,
      reason: 'active_ride',
      hasActiveRide: true,
    });
  });

  it('restores the normal timeout for an offline driver without a ride', () => {
    expect(deriveDriverKeepAwakeState({
      availabilityStatus: 'offline',
      activeRideId: null,
      appState: 'active',
    })).toEqual({
      enabled: false,
      reason: 'driver_offline',
      hasActiveRide: false,
    });
  });

  it.each(['background', 'inactive'])(
    'never forces another foreground app to keep the screen awake (%s)',
    (appState) => {
      expect(deriveDriverKeepAwakeState({
        availabilityStatus: 'online',
        activeRideId: 'ride-123',
        appState,
      })).toEqual({
        enabled: false,
        reason: 'app_not_foreground',
        hasActiveRide: true,
      });
    }
  );
});
