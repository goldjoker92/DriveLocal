// Pure driver-photo helpers. Kept free of React Native/Firebase dependencies so
// crop/validation rules stay deterministic and unit-testable.

const MIN_EDGE_PX = 640;
const PUBLIC_SIZE_PX = 512;

export function createDriverPhotoVersion(nowMs = Date.now(), randomValue = Math.random()) {
  const safeNow = Number.isFinite(Number(nowMs)) ? Math.floor(Number(nowMs)) : Date.now();
  const random = Math.max(0, Math.min(0.999999, Number(randomValue) || 0));
  return `photo_${safeNow}_${Math.floor(random * 1_000_000).toString(36).padStart(4, '0')}`;
}

export function validateDriverPhotoAsset(asset) {
  const width = Number(asset?.width);
  const height = Number(asset?.height);
  if (!asset?.uri) return { valid: false, code: 'PHOTO_URI_MISSING', message: 'Não foi possível ler a foto.' };
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { valid: false, code: 'PHOTO_DIMENSIONS_MISSING', message: 'Não foi possível verificar o tamanho da foto.' };
  }
  if (Math.min(width, height) < MIN_EDGE_PX) {
    return { valid: false, code: 'PHOTO_TOO_SMALL', message: 'A foto ficou pequena demais. Aproxime o rosto e tente novamente.' };
  }
  return { valid: true, width, height };
}

export function publicDriverPhotoCrop(asset) {
  const width = Math.max(1, Math.floor(Number(asset?.width) || 1));
  const height = Math.max(1, Math.floor(Number(asset?.height) || 1));
  const size = Math.min(width, height);
  const originX = Math.max(0, Math.floor((width - size) / 2));
  // Portrait selfies benefit from a slightly top-biased crop so the head and
  // shoulders remain visible instead of centering on the torso.
  const freeVertical = Math.max(0, height - size);
  const originY = Math.max(0, Math.min(freeVertical, Math.floor(freeVertical * 0.28)));
  return { originX, originY, width: size, height: size };
}

export function publicDriverPhotoSize() {
  return PUBLIC_SIZE_PX;
}

export function firstName(fullName) {
  const value = String(fullName || '').trim();
  return value ? value.split(/\s+/)[0] : 'Motorista';
}
