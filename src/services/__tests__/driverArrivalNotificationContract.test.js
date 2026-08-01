const path = require('path');

const serverConstants = require('../../../functions/src/rides/constants');
const {
  DRIVER_ARRIVAL_VIBRATION_PATTERN,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_SOUNDS,
} = require('../../constants/notificationChannels');
const {
  DRIVER_ARRIVAL_SOUND_BASENAME,
  createDriverArrivalWaveBuffer,
} = require('../../../scripts/build/ensureNotificationSounds');

describe('driver arrival notification contract', () => {
  test('keeps the mobile channel and Firebase payload constants identical', () => {
    expect(NOTIFICATION_CHANNELS.DRIVER_ARRIVAL).toBe(
      serverConstants.NOTIFICATION_CHANNELS.DRIVER_ARRIVAL,
    );
    expect(NOTIFICATION_SOUNDS.DRIVER_ARRIVAL).toBe(
      serverConstants.NOTIFICATION_SOUNDS.DRIVER_ARRIVAL,
    );
    expect([...DRIVER_ARRIVAL_VIBRATION_PATTERN]).toEqual(
      [...serverConstants.DRIVER_ARRIVAL_VIBRATION_PATTERN],
    );
  });

  test('bundles the exact sound filename referenced by both sides', () => {
    expect(path.basename(NOTIFICATION_SOUNDS.DRIVER_ARRIVAL)).toBe(
      DRIVER_ARRIVAL_SOUND_BASENAME,
    );
    expect(createDriverArrivalWaveBuffer().toString('ascii', 0, 4)).toBe('RIFF');
  });
});
