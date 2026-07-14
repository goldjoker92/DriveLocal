const { fixedClock, durationMs, systemClock } = require('../time/clock');

describe('clock', () => {
  it('fixedClock returns the fixed time and advances deterministically', () => {
    const c = fixedClock(1000);
    expect(c.now()).toBe(1000);
    c.advance(250);
    expect(c.now()).toBe(1250);
  });
  it('durationMs never returns a negative value', () => {
    expect(durationMs(1000, 1250)).toBe(250);
    expect(durationMs(1250, 1000)).toBe(0);
  });
  it('systemClock.now returns a number', () => {
    expect(typeof systemClock.now()).toBe('number');
  });
});
