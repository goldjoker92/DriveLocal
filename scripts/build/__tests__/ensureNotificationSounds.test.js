const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  BITS_PER_SAMPLE,
  CHANNEL_COUNT,
  DRIVER_ARRIVAL_SOUND_BASENAME,
  DURATION_SECONDS,
  SAMPLE_RATE,
  createDriverArrivalWaveBuffer,
  ensureDriverArrivalNotificationSound,
} = require('../ensureNotificationSounds');

describe('driver arrival notification sound', () => {
  test('creates a deterministic PCM WAV suitable for the Expo notifications plugin', () => {
    const first = createDriverArrivalWaveBuffer();
    const second = createDriverArrivalWaveBuffer();

    expect(first.equals(second)).toBe(true);
    expect(first.toString('ascii', 0, 4)).toBe('RIFF');
    expect(first.toString('ascii', 8, 12)).toBe('WAVE');
    expect(first.toString('ascii', 36, 40)).toBe('data');
    expect(first.readUInt16LE(20)).toBe(1);
    expect(first.readUInt16LE(22)).toBe(CHANNEL_COUNT);
    expect(first.readUInt32LE(24)).toBe(SAMPLE_RATE);
    expect(first.readUInt16LE(34)).toBe(BITS_PER_SAMPLE);
    expect(first.length).toBeGreaterThan(SAMPLE_RATE * DURATION_SECONDS);
  });

  test('writes only the generated sound beneath the supplied project directory', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'drivelocal-arrival-sound-'));
    try {
      const relativePath = ensureDriverArrivalNotificationSound({ cwd });
      const outputPath = path.resolve(cwd, relativePath);
      const first = fs.readFileSync(outputPath);
      const firstModifiedAt = fs.statSync(outputPath).mtimeMs;

      expect(path.basename(outputPath)).toBe(DRIVER_ARRIVAL_SOUND_BASENAME);
      expect(first.toString('ascii', 0, 4)).toBe('RIFF');

      ensureDriverArrivalNotificationSound({ cwd });
      expect(fs.statSync(outputPath).mtimeMs).toBe(firstModifiedAt);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
