import { DEV_RIDE_SIMULATOR_ENABLED } from '../config/runtimeEnvironment';

// Client-side DEV traces deliberately exclude coordinates, ride/user ids,
// addresses, Pix data and tokens. The traceId is displayed in the DEV panel so
// one test run can be followed across every simulation event in Metro logs.
const SAFE_KEYS = new Set([
  'traceId',
  'status',
  'mode',
  'stepIndex',
  'stepCount',
  'durationMs',
  'errorCode',
]);

export function createDevTraceId(prefix = 'ride-sim') {
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${time}-${random}`;
}

function safeFields(fields) {
  const output = {};
  Object.entries(fields || {}).forEach(([key, value]) => {
    if (!SAFE_KEYS.has(key)) return;
    if (typeof value === 'string') output[key] = value.slice(0, 96);
    else if (typeof value === 'number' && Number.isFinite(value)) output[key] = value;
    else if (typeof value === 'boolean') output[key] = value;
  });
  return output;
}

export function logDevTrace(eventName, fields = {}, level = 'info') {
  if (!DEV_RIDE_SIMULATOR_ENABLED) return;

  const entry = {
    scope: 'dev_ride_simulator',
    eventName,
    at: new Date().toISOString(),
    ...safeFields(fields),
  };

  const message = `[DriveLocal][DEV_TRACE] ${JSON.stringify(entry)}`;
  if (level === 'error') console.error(message);
  else if (level === 'warning') console.warn(message);
  else console.info(message);
}
