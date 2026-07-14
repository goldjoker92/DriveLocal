// @ts-check
// Operating-hours domain (DriveLocal V1.1, governance D3).
//
// PURE + deterministic. There is NO driver-count threshold — availability is
// never gated by how many drivers are online. Default mode is 24_7. An optional
// scheduled mode uses minute-of-day (0..1439) so tests are timezone-independent;
// callers convert a real clock to a minute-of-day at the edge. Schedules that
// cross midnight are supported (openMinuteOfDay > closeMinuteOfDay).

import { OPERATING_MODE } from '../constants/pricingConfig';

// Clamps any input to a valid minute-of-day integer in [0, 1439].
function clampMinute(value) {
  const n = Math.trunc(Number(value) || 0);
  if (n < 0) return 0;
  if (n > 1439) return 1439;
  return n;
}

/**
 * Whether the service is operating at the given minute-of-day.
 *   - mode '24_7'      -> always true.
 *   - mode 'scheduled' -> open window [openMinuteOfDay, closeMinuteOfDay).
 *       * open === close  -> treated as open all day.
 *       * open <  close   -> same-day window (e.g. 06:00 -> 22:00).
 *       * open >  close   -> window crosses midnight (e.g. 22:00 -> 06:00).
 * The close bound is EXCLUSIVE.
 * @param {{mode?:string, openMinuteOfDay?:number, closeMinuteOfDay?:number}} config
 * @param {number} nowMinuteOfDay integer 0..1439 (injected; see minuteOfDay())
 * @returns {boolean}
 */
export function isWithinOperatingHours(config = {}, nowMinuteOfDay = 0) {
  const mode = config.mode || OPERATING_MODE.ALWAYS;
  if (mode === OPERATING_MODE.ALWAYS) return true;

  const open = clampMinute(config.openMinuteOfDay);
  const close = clampMinute(config.closeMinuteOfDay);
  const now = clampMinute(nowMinuteOfDay);

  if (open === close) return true; //         open all day
  if (open < close) return now >= open && now < close; // same-day window
  return now >= open || now < close; //        crosses midnight
}

/** Helper: minute-of-day (0..1439) from hours + minutes. */
export function minuteOfDay(hours, minutes = 0) {
  return clampMinute((Number(hours) || 0) * 60 + (Number(minutes) || 0));
}
