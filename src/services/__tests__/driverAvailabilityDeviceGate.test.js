const callable = jest.fn();
const prepareDriverDeviceForAvailability = jest.fn();

jest.mock('firebase/functions', () => ({
  httpsCallable: jest.fn(() => callable),
}));

jest.mock('../../config/firebase', () => ({
  functions: {},
}));

jest.mock('../driverDeviceDiagnostics', () => ({
  prepareDriverDeviceForAvailability: (...args) => prepareDriverDeviceForAvailability(...args),
}));

const { startDriverWorkSession } = require('../driverAvailabilityService');

describe('driver availability device gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    callable.mockResolvedValue({
      data: {
        driverId: 'driver1',
        availabilityStatus: 'online',
        availabilitySessionId: 'session_1234567890',
        availabilityUpdatedAtMs: 1_000_000,
      },
    });
  });

  it('does not call Firebase when the device is not ready', async () => {
    prepareDriverDeviceForAvailability.mockResolvedValue({
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

    expect(prepareDriverDeviceForAvailability).toHaveBeenCalledTimes(1);
    expect(callable).not.toHaveBeenCalled();
  });

  it('opens the server work session only after a successful preflight', async () => {
    const order = [];
    prepareDriverDeviceForAvailability.mockImplementation(async () => {
      order.push('preflight');
      return {
        readyForAvailability: true,
        primaryIssue: null,
        devSimulationBypass: false,
      };
    });
    callable.mockImplementation(async () => {
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
    expect(callable).toHaveBeenCalledWith({ availabilityStatus: 'online' });
    expect(result).toMatchObject({
      availabilityStatus: 'online',
      availabilitySessionId: 'session_1234567890',
    });
  });
});
