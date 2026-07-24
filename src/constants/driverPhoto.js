// Driver profile-photo workflow constants shared by driver/admin screens.
// A pending/rejected replacement never disables the last approved public copy.

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

// Active passenger-facing photo is independent from the current candidate state.
// This is the key replacement invariant: old approved photo stays visible until
// a new candidate is approved and atomically becomes the active public path.
export function hasApprovedDriverPhoto(driver) {
  return typeof driver?.driverPhotoPublicPath === 'string'
    && driver.driverPhotoPublicPath.length > 0
    && typeof driver?.driverPhotoPublicVersion === 'string'
    && driver.driverPhotoPublicVersion.length > 0;
}

// Candidate review status. This may be pending/rejected while an older approved
// public photo remains active for passengers. An inconsistent "approved" flag
// without a public path/version fails closed instead of letting onboarding appear
// complete when the server would later reject driver approval.
export function driverPhotoStatus(driver) {
  const status = driver?.driverPhotoReviewStatus;
  if (status === DRIVER_PHOTO_STATUS.APPROVED) {
    return hasApprovedDriverPhoto(driver)
      ? DRIVER_PHOTO_STATUS.APPROVED
      : DRIVER_PHOTO_STATUS.MISSING;
  }
  if (status === DRIVER_PHOTO_STATUS.PENDING || status === DRIVER_PHOTO_STATUS.REJECTED) {
    return status;
  }
  if (hasApprovedDriverPhoto(driver)) return DRIVER_PHOTO_STATUS.APPROVED;
  if (driver?.selfieStatus === 'submitted') return DRIVER_PHOTO_STATUS.PENDING;
  if (driver?.selfieStatus === 'rejected') return DRIVER_PHOTO_STATUS.REJECTED;
  return DRIVER_PHOTO_STATUS.MISSING;
}

export function rejectionReasonLabel(code) {
  return DRIVER_PHOTO_REJECTION_REASONS.find((item) => item.code === code)?.label || 'Foto não aprovada';
}
