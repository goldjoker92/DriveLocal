// Mirrors the secure backend precondition used by approveDriverSecure.
// Keeping this check in the admin UI avoids a doomed callable request while the
// backend remains the final authority against stale or manipulated clients.
export function hasPhotoApprovedForDriverApproval(driver, driverId) {
  const publicPath = driver?.driverPhotoPublicPath;
  return driver?.driverPhotoReviewStatus === 'approved'
    && typeof publicPath === 'string'
    && publicPath.startsWith(`publicDriverPhotos/${driverId}/`);
}

// `review_required` is written by approveDriverSecure after its server-side
// duplicate scan finds matching CPF, plate, Pix, phone or email. `warning` keeps
// compatibility with older records that already flagged a possible duplicate.
export function requiresDuplicateApprovalReview(driver) {
  return driver?.duplicateCheckStatus === 'review_required'
    || driver?.duplicateCheckStatus === 'warning';
}

export function driverApprovalErrorReason(error) {
  return error?.details?.metadata?.reason || error?.metadata?.reason || null;
}

export function driverApprovalErrorMessage(error) {
  const reason = driverApprovalErrorReason(error);
  if (reason === 'DRIVER_PHOTO_APPROVAL_REQUIRED') {
    return 'Aprove primeiro a foto do motorista.';
  }
  if (reason === 'DUPLICATE_REVIEW_REQUIRED') {
    return 'A aprovação exige revisar primeiro os possíveis dados duplicados.';
  }
  return 'Não foi possível aprovar o motorista.';
}
