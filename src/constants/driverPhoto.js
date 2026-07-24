// Driver profile-photo workflow constants shared by driver/admin screens.
// The uploaded candidate stays private until an admin approves the public copy.

export const DRIVER_PHOTO_STATUS = Object.freeze({
  MISSING: 'missing',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

export const DRIVER_PHOTO_REJECTION_REASONS = Object.freeze([
  { code: 'face_covered', label: 'Rosto parcialmente coberto' },
  { code: 'too_dark', label: 'Foto muito escura' },
  { code: 'blurry', label: 'Foto desfocada' },
  { code: 'multiple_people', label: 'Mais de uma pessoa na foto' },
  { code: 'screen_or_document', label: 'Foto de uma tela ou documento' },
  { code: 'face_too_far', label: 'Rosto muito distante' },
  { code: 'identity_mismatch', label: 'Pessoa diferente do cadastro' },
  { code: 'other', label: 'Outro motivo' },
]);

export function driverPhotoStatus(driver) {
  const status = driver?.driverPhotoReviewStatus;
  if (Object.values(DRIVER_PHOTO_STATUS).includes(status)) return status;
  if (driver?.driverPhotoPublicPath) return DRIVER_PHOTO_STATUS.APPROVED;
  if (driver?.selfieStatus === 'submitted') return DRIVER_PHOTO_STATUS.PENDING;
  if (driver?.selfieStatus === 'rejected') return DRIVER_PHOTO_STATUS.REJECTED;
  return DRIVER_PHOTO_STATUS.MISSING;
}

export function hasApprovedDriverPhoto(driver) {
  return driverPhotoStatus(driver) === DRIVER_PHOTO_STATUS.APPROVED
    && typeof driver?.driverPhotoPublicPath === 'string'
    && driver.driverPhotoPublicPath.length > 0;
}

export function rejectionReasonLabel(code) {
  return DRIVER_PHOTO_REJECTION_REASONS.find((item) => item.code === code)?.label || 'Foto não aprovada';
}
