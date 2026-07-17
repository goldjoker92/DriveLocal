import {
  buildDevSimulationRoute,
  createFallbackSimulationStart,
  devSimulationProgress,
  DEV_SIMULATION_MAX_STEPS,
  DEV_SIMULATION_MIN_STEPS,
} from '../devRideSimulation';

describe('DEV ride simulation helpers', () => {
  it('builds a bounded route with exact start and destination endpoints', () => {
    const start = { lat: -4.105, lng: -38.505 };
    const target = { lat: -4.095, lng: -38.495 };
    const route = buildDevSimulationRoute(start, target, 12);

    expect(route).toHaveLength(13);
    expect(route[0]).toEqual(start);
    expect(route[route.length - 1].lat).toBeCloseTo(target.lat, 10);
    expect(route[route.length - 1].lng).toBeCloseTo(target.lng, 10);
    route.forEach((point) => {
      expect(point.lat).toBeGreaterThanOrEqual(-90);
      expect(point.lat).toBeLessThanOrEqual(90);
      expect(point.lng).toBeGreaterThanOrEqual(-180);
      expect(point.lng).toBeLessThanOrEqual(180);
    });
  });

  it('clamps too-small and too-large routes', () => {
    expect(buildDevSimulationRoute({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, 1))
      .toHaveLength(DEV_SIMULATION_MIN_STEPS + 1);
    expect(buildDevSimulationRoute({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, 999))
      .toHaveLength(DEV_SIMULATION_MAX_STEPS + 1);
  });

  it('rejects malformed points and creates a valid nearby fallback', () => {
    expect(buildDevSimulationRoute(null, { lat: -4.1, lng: -38.5 })).toEqual([]);
    const fallback = createFallbackSimulationStart({ lat: -4.1, lng: -38.5 });
    expect(fallback).not.toEqual({ lat: -4.1, lng: -38.5 });
    expect(Number.isFinite(fallback.lat)).toBe(true);
    expect(Number.isFinite(fallback.lng)).toBe(true);
  });

  it('reports stable rounded progress', () => {
    expect(devSimulationProgress(0, 24)).toBe(0);
    expect(devSimulationProgress(12, 24)).toBe(50);
    expect(devSimulationProgress(24, 24)).toBe(100);
    expect(devSimulationProgress(99, 24)).toBe(100);
  });
});

describe('DEV simulator native-build gate', () => {
  const originalAppEnv = process.env.APP_ENV;
  const originalSimulatorFlag = process.env.ENABLE_DEV_RIDE_SIMULATOR;

  afterEach(() => {
    process.env.APP_ENV = originalAppEnv;
    process.env.ENABLE_DEV_RIDE_SIMULATOR = originalSimulatorFlag;
    jest.resetModules();
  });

  function readExtra(appEnv, flag) {
    process.env.APP_ENV = appEnv;
    process.env.ENABLE_DEV_RIDE_SIMULATOR = flag;
    jest.resetModules();
    const factory = require('../../../app.config');
    return factory({ config: {} }).extra;
  }

  it('enables the lab only for the explicit development build', () => {
    expect(readExtra('dev', '1')).toEqual(expect.objectContaining({
      appEnvironment: 'development',
      devRideSimulatorEnabled: true,
    }));
  });

  it('fails closed in production even if the simulator variable is forced on', () => {
    expect(readExtra('prod', '1')).toEqual(expect.objectContaining({
      appEnvironment: 'production',
      devRideSimulatorEnabled: false,
    }));
  });

  it('keeps preview/internal builds clean when explicitly disabled', () => {
    expect(readExtra('dev', '0')).toEqual(expect.objectContaining({
      appEnvironment: 'development',
      devRideSimulatorEnabled: false,
    }));
  });
});
