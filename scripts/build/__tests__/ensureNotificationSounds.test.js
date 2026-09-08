const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  BITS_PER_SAMPLE,
  CHANNEL_COUNT,
  DRIVER_ARRIVAL_SOUND_BASENAME,
  DRIVER_OFFER_DURATION_SECONDS,
  DRIVER_OFFER_PATTERN_SECONDS,
  DRIVER_OFFER_SOUND_BASENAME,
  DURATION_SECONDS,
  SAMPLE_RATE,
  createDriverArrivalWaveBuffer,
  createDriverOfferWaveBuffer,
  ensureDriverArrivalNotificationSound,
  ensureDriverOfferNotificationSound,
} = require('../ensureNotificationSounds');

function peakAmplitudeInRange(buffer, startSeconds, endSeconds) {
  const bytesPerSample = BITS_PER_SAMPLE / 8;
  const firstSample = Math.floor(startSeconds * SAMPLE_RATE);
  const finalSample = Math.min(
    Math.ceil(endSeconds * SAMPLE_RATE),
    (buffer.length - 44) / bytesPerSample,
  );
  let peak = 0;
  for (let sample = firstSample; sample < finalSample; sample += 1) {
    peak = Math.max(peak, Math.abs(buffer.readInt16LE(44 + sample * bytesPerSample)));
  }
  return peak;
}

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

describe('driver ride-offer notification sound', () => {
  test('creates a deterministic and distinct PCM WAV for Android channels', () => {
    const first = createDriverOfferWaveBuffer();
    const second = createDriverOfferWaveBuffer();

    expect(first.equals(second)).toBe(true);
    expect(first.equals(createDriverArrivalWaveBuffer())).toBe(false);
    expect(first.toString('ascii', 0, 4)).toBe('RIFF');
    expect(first.toString('ascii', 8, 12)).toBe('WAVE');
    expect(first.toString('ascii', 36, 40)).toBe('data');
    expect(first.readUInt16LE(20)).toBe(1);
    expect(first.readUInt16LE(22)).toBe(CHANNEL_COUNT);
    expect(first.readUInt32LE(24)).toBe(SAMPLE_RATE);
    expect(first.readUInt16LE(34)).toBe(BITS_PER_SAMPLE);
    const expectedSampleCount = Math.ceil(SAMPLE_RATE * DRIVER_OFFER_DURATION_SECONDS);
    const expectedByteLength =
      44 + expectedSampleCount * CHANNEL_COUNT * (BITS_PER_SAMPLE / 8);
    expect(first.length).toBe(expectedByteLength);
    expect(DRIVER_OFFER_DURATION_SECONDS).toBe(30);
    expect(DRIVER_OFFER_DURATION_SECONDS / DRIVER_OFFER_PATTERN_SECONDS).toBe(12);
  });

  test('keeps the alert audible near the beginning, middle and end of 30 seconds', () => {
    const wave = createDriverOfferWaveBuffer();

    expect(peakAmplitudeInRange(wave, 0, 1)).toBeGreaterThan(1_000);
    expect(peakAmplitudeInRange(wave, 14, 15)).toBeGreaterThan(1_000);
    expect(peakAmplitudeInRange(wave, 29, 30)).toBeGreaterThan(1_000);
  });

  test('writes the generated offer sound idempotently beneath the project directory', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'drivelocal-offer-sound-'));
    try {
      const relativePath = ensureDriverOfferNotificationSound({ cwd });
      const outputPath = path.resolve(cwd, relativePath);
      const first = fs.readFileSync(outputPath);
      const firstModifiedAt = fs.statSync(outputPath).mtimeMs;

      expect(path.basename(outputPath)).toBe(DRIVER_OFFER_SOUND_BASENAME);
      expect(first.toString('ascii', 0, 4)).toBe('RIFF');

      ensureDriverOfferNotificationSound({ cwd });
      expect(fs.statSync(outputPath).mtimeMs).toBe(firstModifiedAt);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
