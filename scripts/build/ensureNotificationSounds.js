#!/usr/bin/env node
// @ts-check

const fs = require('fs');
const path = require('path');

const DRIVER_ARRIVAL_SOUND_BASENAME = 'drivelocal_driver_arrived.wav';
const DRIVER_ARRIVAL_SOUND_RELATIVE_PATH = `./assets/generated/${DRIVER_ARRIVAL_SOUND_BASENAME}`;
const DRIVER_OFFER_SOUND_BASENAME = 'drivelocal_ride_offer.wav';
const DRIVER_OFFER_SOUND_RELATIVE_PATH = `./assets/generated/${DRIVER_OFFER_SOUND_BASENAME}`;
const SAMPLE_RATE = 22_050;
const CHANNEL_COUNT = 1;
const BITS_PER_SAMPLE = 16;
const DURATION_SECONDS = 1.55;
const DRIVER_OFFER_PATTERN_SECONDS = 2.5;
const DRIVER_OFFER_DURATION_SECONDS = 30;

const NOTES = Object.freeze([
  Object.freeze({ start: 0.00, duration: 0.34, frequency: 659.25, gain: 0.34 }),
  Object.freeze({ start: 0.39, duration: 0.42, frequency: 783.99, gain: 0.39 }),
  Object.freeze({ start: 0.87, duration: 0.58, frequency: 987.77, gain: 0.46 }),
]);

// A distinct two-part call designed for small Android phone speakers. It is
// intentionally original (not copied from another platform) and repeats for the
// full 30-second alert without changing the server-side offer/search window.
const DRIVER_OFFER_NOTES = Object.freeze([
  Object.freeze({ start: 0.00, duration: 0.30, frequency: 783.99, gain: 0.48 }),
  Object.freeze({ start: 0.34, duration: 0.30, frequency: 987.77, gain: 0.52 }),
  Object.freeze({ start: 0.70, duration: 0.43, frequency: 1174.66, gain: 0.56 }),
  Object.freeze({ start: 1.26, duration: 0.30, frequency: 783.99, gain: 0.48 }),
  Object.freeze({ start: 1.60, duration: 0.30, frequency: 987.77, gain: 0.52 }),
  Object.freeze({ start: 1.96, duration: 0.43, frequency: 1318.51, gain: 0.58 }),
]);

function noteEnvelope(localTime, duration) {
  if (localTime < 0 || localTime >= duration) return 0;
  const attackSeconds = 0.015;
  const releaseSeconds = Math.min(0.22, duration * 0.45);
  const attack = Math.min(1, localTime / attackSeconds);
  const release = Math.min(1, (duration - localTime) / releaseSeconds);
  return Math.max(0, Math.min(attack, release));
}

function sampleAt(timeSeconds) {
  let mixed = 0;
  for (const note of NOTES) {
    const localTime = timeSeconds - note.start;
    const envelope = noteEnvelope(localTime, note.duration);
    if (envelope <= 0) continue;

    const phase = 2 * Math.PI * note.frequency * localTime;
    const tone = Math.sin(phase)
      + 0.22 * Math.sin(phase * 2)
      + 0.07 * Math.sin(phase * 3);
    mixed += note.gain * envelope * tone;
  }

  // Soft limiting keeps the chime clear without clipping or sounding like an alarm.
  return Math.tanh(mixed * 0.9) * 0.72;
}

function driverOfferSampleAt(timeSeconds) {
  const patternTimeSeconds = timeSeconds % DRIVER_OFFER_PATTERN_SECONDS;
  let mixed = 0;
  for (const note of DRIVER_OFFER_NOTES) {
    const localTime = patternTimeSeconds - note.start;
    const envelope = noteEnvelope(localTime, note.duration);
    if (envelope <= 0) continue;

    const phase = 2 * Math.PI * note.frequency * localTime;
    const tone = Math.sin(phase)
      + 0.26 * Math.sin(phase * 2)
      + 0.09 * Math.sin(phase * 3);
    mixed += note.gain * envelope * tone;
  }

  // The limiter prevents clipping while retaining enough presence on compact
  // speakers. Android still owns the final volume and silent/DND policies.
  return Math.tanh(mixed) * 0.82;
}

function createDriverArrivalWaveBuffer() {
  const sampleCount = Math.ceil(SAMPLE_RATE * DURATION_SECONDS);
  const bytesPerSample = BITS_PER_SAMPLE / 8;
  const dataSize = sampleCount * CHANNEL_COUNT * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(CHANNEL_COUNT, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * CHANNEL_COUNT * bytesPerSample, 28);
  buffer.writeUInt16LE(CHANNEL_COUNT * bytesPerSample, 32);
  buffer.writeUInt16LE(BITS_PER_SAMPLE, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < sampleCount; index += 1) {
    const value = Math.max(-1, Math.min(1, sampleAt(index / SAMPLE_RATE)));
    buffer.writeInt16LE(Math.round(value * 32767), 44 + index * bytesPerSample);
  }

  return buffer;
}

function createDriverOfferWaveBuffer() {
  const sampleCount = Math.ceil(SAMPLE_RATE * DRIVER_OFFER_DURATION_SECONDS);
  const bytesPerSample = BITS_PER_SAMPLE / 8;
  const dataSize = sampleCount * CHANNEL_COUNT * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(CHANNEL_COUNT, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * CHANNEL_COUNT * bytesPerSample, 28);
  buffer.writeUInt16LE(CHANNEL_COUNT * bytesPerSample, 32);
  buffer.writeUInt16LE(BITS_PER_SAMPLE, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < sampleCount; index += 1) {
    const value = Math.max(-1, Math.min(1, driverOfferSampleAt(index / SAMPLE_RATE)));
    buffer.writeInt16LE(Math.round(value * 32767), 44 + index * bytesPerSample);
  }

  return buffer;
}

function ensureDriverArrivalNotificationSound({ cwd = process.cwd() } = {}) {
  const outputPath = path.resolve(cwd, DRIVER_ARRIVAL_SOUND_RELATIVE_PATH);
  const expected = createDriverArrivalWaveBuffer();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  let current = null;
  try {
    current = fs.readFileSync(outputPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  if (!current || !current.equals(expected)) {
    fs.writeFileSync(outputPath, expected);
  }

  return DRIVER_ARRIVAL_SOUND_RELATIVE_PATH;
}

function ensureDriverOfferNotificationSound({ cwd = process.cwd() } = {}) {
  const outputPath = path.resolve(cwd, DRIVER_OFFER_SOUND_RELATIVE_PATH);
  const expected = createDriverOfferWaveBuffer();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  let current = null;
  try {
    current = fs.readFileSync(outputPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  if (!current || !current.equals(expected)) {
    fs.writeFileSync(outputPath, expected);
  }

  return DRIVER_OFFER_SOUND_RELATIVE_PATH;
}

if (require.main === module) {
  const generatedPaths = [
    ensureDriverArrivalNotificationSound({ cwd: process.cwd() }),
    ensureDriverOfferNotificationSound({ cwd: process.cwd() }),
  ];
  process.stdout.write(`${generatedPaths.join('\n')}\n`);
}

module.exports = {
  BITS_PER_SAMPLE,
  CHANNEL_COUNT,
  DRIVER_ARRIVAL_SOUND_BASENAME,
  DRIVER_ARRIVAL_SOUND_RELATIVE_PATH,
  DRIVER_OFFER_DURATION_SECONDS,
  DRIVER_OFFER_PATTERN_SECONDS,
  DRIVER_OFFER_SOUND_BASENAME,
  DRIVER_OFFER_SOUND_RELATIVE_PATH,
  DURATION_SECONDS,
  SAMPLE_RATE,
  createDriverArrivalWaveBuffer,
  createDriverOfferWaveBuffer,
  ensureDriverArrivalNotificationSound,
  ensureDriverOfferNotificationSound,
};
