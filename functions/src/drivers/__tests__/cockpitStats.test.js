'use strict';

const {
  COCKPIT_STATS_VERSION,
  COCKPIT_TIME_ZONE,
  cockpitPeriodKeys,
  nextDriverCockpitStats,
} = require('../cockpitStats');

function utc(iso) {
  return new Date(iso).getTime();
}

describe('driver cockpit statistics policy', () => {
  it('uses America/Fortaleza day boundaries', () => {
    expect(cockpitPeriodKeys(utc('2026-07-27T02:59:59.000Z'))).toMatchObject({
      dayKey: '2026-07-26',
      weekKey: '2026-07-20',
      timeZone: COCKPIT_TIME_ZONE,
    });
    expect(cockpitPeriodKeys(utc('2026-07-27T03:00:00.000Z'))).toMatchObject({
      dayKey: '2026-07-27',
      weekKey: '2026-07-27',
    });
  });

  it('accumulates completed ride fare on the same local day and week', () => {
    const first = nextDriverCockpitStats({}, utc('2026-07-21T15:00:00.000Z'), 1200);
    const second = nextDriverCockpitStats(first, utc('2026-07-21T18:00:00.000Z'), 1530);

    expect(second).toEqual({
      version: COCKPIT_STATS_VERSION,
      timeZone: COCKPIT_TIME_ZONE,
      dayKey: '2026-07-21',
      weekKey: '2026-07-20',
      todayRideCount: 2,
      todayReceivedCentavos: 2730,
      weekRideCount: 2,
      weekReceivedCentavos: 2730,
      lastCompletedAtMs: utc('2026-07-21T18:00:00.000Z'),
    });
  });

  it('resets the daily counters without resetting the current week', () => {
    const prior = {
      dayKey: '2026-07-21',
      weekKey: '2026-07-20',
      todayRideCount: 4,
      todayReceivedCentavos: 5000,
      weekRideCount: 10,
      weekReceivedCentavos: 14000,
    };
    const next = nextDriverCockpitStats(prior, utc('2026-07-22T12:00:00.000Z'), 800);

    expect(next.todayRideCount).toBe(1);
    expect(next.todayReceivedCentavos).toBe(800);
    expect(next.weekRideCount).toBe(11);
    expect(next.weekReceivedCentavos).toBe(14800);
  });

  it('resets both counters on a new Fortaleza week', () => {
    const prior = {
      dayKey: '2026-07-26',
      weekKey: '2026-07-20',
      todayRideCount: 2,
      todayReceivedCentavos: 2200,
      weekRideCount: 9,
      weekReceivedCentavos: 11800,
    };
    const next = nextDriverCockpitStats(prior, utc('2026-07-27T12:00:00.000Z'), 950);

    expect(next.dayKey).toBe('2026-07-27');
    expect(next.weekKey).toBe('2026-07-27');
    expect(next.todayRideCount).toBe(1);
    expect(next.todayReceivedCentavos).toBe(950);
    expect(next.weekRideCount).toBe(1);
    expect(next.weekReceivedCentavos).toBe(950);
  });

  it('normalizes invalid amounts and counters without producing negatives', () => {
    const next = nextDriverCockpitStats({
      dayKey: '2026-07-21',
      weekKey: '2026-07-20',
      todayRideCount: -2,
      todayReceivedCentavos: Number.NaN,
      weekRideCount: 'bad',
      weekReceivedCentavos: -500,
    }, utc('2026-07-21T20:00:00.000Z'), -100);

    expect(next.todayRideCount).toBe(1);
    expect(next.todayReceivedCentavos).toBe(0);
    expect(next.weekRideCount).toBe(1);
    expect(next.weekReceivedCentavos).toBe(0);
  });
});