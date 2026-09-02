// Mirrors the secure backend precondition used by approveDriverSecure.
// Keeping this check in the admin UI avoids a doomed callable request while the
// backend remains the final authority against stale or manipulated clients.
export function hasPhotoApprovedForDriverApproval(driver, driverId) {
  const publicPath = driver?.driverPhotoPublicPath;
  return driver?.driverPhotoReviewStatus === 'approved'
    && typeof publicPath === 'string'
    && publicPath.startsWith(`publicDriverPhotos/${driverId}/`);
}

export function driverApprovalErrorMessage(error) {
  const reason = error?.details?.metadata?.reason || error?.metadata?.reason;
  if (reason === 'DRIVER_PHOTO_APPROVAL_REQUIRED') {
    return 'Aprove primeiro a foto do motorista.';
  }
  if (reason === 'DUPLICATE_REVIEW_REQUIRED') {
    return 'A aprovação exige revisar primeiro os possíveis dados duplicados.';
  }
  return 'Não foi possível aprovar o motorista.';
}
