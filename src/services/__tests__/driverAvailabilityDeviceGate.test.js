const mockCallable = jest.fn();
const mockPrepareDriverDeviceForAvailability = jest.fn();

jest.mock('firebase/functions', () => ({
  httpsCallable: jest.fn(() => mockCallable),
}));

jest.mock('../../config/firebase', () => ({
  functions: {},
}));

jest.mock('../../config/runtimeEnvironment', () => ({
  APP_BUILD_NUMBER: 17,
  APP_VERSION: '1.0.12',
}));

jest.mock('../driverDeviceDiagnostics', () => ({
  prepareDriverDeviceForAvailability: (...args) => mockPrepareDriverDeviceForAvailability(...args),
}));

const { startDriverWorkSession } = require('../driverAvailabilityService');

describe('driver availability device gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCallable.mockResolvedValue({
      data: {
        driverId: 'driver1',
        availabilityStatus: 'online',
        availabilitySessionId: 'session_1234567890',
        availabilityUpdatedAtMs: 1_000_000,
      },
    });
  });

  it('does not call Firebase when the device is not ready', async () => {
    mockPrepareDriverDeviceForAvailability.mockResolvedValue({
      readyForAvailability: false,
      primaryIssue: {
        code: 'notifications_permission_required',
        message: 'Ative as notificações.',
        action: 'repair',
      },
    });

    await expect(startDriverWorkSession()).rejects.toMatchObject({
      code: 'DRIVER_DEVICE_NOT_READY',
      details: {
        issueCode: 'notifications_permission_required',
        message: 'Ative as notificações.',
      },
    });

    expect(mockPrepareDriverDeviceForAvailability).toHaveBeenCalledTimes(1);
    expect(mockCallable).not.toHaveBeenCalled();
  });

  it('opens the server work session only after a successful preflight', async () => {
    const order = [];
    mockPrepareDriverDeviceForAvailability.mockImplementation(async () => {
      order.push('preflight');
      return {
        readyForAvailability: true,
        primaryIssue: null,
        devSimulationBypass: false,
      };
    });
    mockCallable.mockImplementation(async () => {
      order.push('firebase');
      return {
        data: {
          driverId: 'driver1',
          availabilityStatus: 'online',
          availabilitySessionId: 'session_1234567890',
          availabilityUpdatedAtMs: 1_000_000,
        },
      };
    });

    const result = await startDriverWorkSession();

    expect(order).toEqual(['preflight', 'firebase']);
    expect(mockCallable).toHaveBeenCalledWith({
      availabilityStatus: 'online',
      clientBuildNumber: 17,
      clientVersion: '1.0.12',
    });
    expect(result).toMatchObject({
      availabilityStatus: 'online',
      availabilitySessionId: 'session_1234567890',
    });
  });
});
