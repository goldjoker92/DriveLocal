// @ts-check
// Removes the opaque approved passenger photo when passengers/{uid} is deleted.
// The path cannot be derived from uid by design, so the deleted profile snapshot is
// the only authoritative cleanup source.

const admin = require('firebase-admin');
const { onDocumentDeleted } = require('firebase-functions/v2/firestore');
const { createLoggerContext, logInfo, logWarning } = require('../logging/logger');
const { approvedPassengerPhotoPath } = require('../rides/passengerPublicIdentity');
const C = require('../rides/constants');

const REGION = 'southamerica-east1';

async function deleteApprovedPassengerPhoto(profile, bucket = admin.storage().bucket()) {
  const path = approvedPassengerPhotoPath(profile || {});
  if (!path) return { action: 'no_approved_photo' };

  try {
    await bucket.file(path).delete({ ignoreNotFound: true });
    return { action: 'deleted' };
  } catch (error) {
    if (Number(error?.code) === 404 || error?.code === 'storage/object-not-found') {
      return { action: 'already_missing' };
    }
    throw error;
  }
}

const passengerPublicPhotoCleanupTrigger = onDocumentDeleted(
  {
    document: `${C.PASSENGERS}/{passengerId}`,
    region: REGION,
    retry: true,
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async (event) => {
    const context = createLoggerContext({
      functionName: 'passengerPublicPhotoCleanupTrigger',
      actorType: 'system',
    });
    try {
      const result = await deleteApprovedPassengerPhoto(event.data?.data() || {});
      logInfo(context, 'account_deletion.passenger_photo_cleanup_completed', {
        operation: 'delete_public_passenger_photo',
        result: result.action,
      });
    } catch (error) {
      logWarning(context, 'account_deletion.passenger_photo_cleanup_failed', {
        operation: 'delete_public_passenger_photo',
        errorCode: error?.code || error?.name || 'PASSENGER_PHOTO_DELETE_FAILED',
      });
      throw error;
    }
    return null;
  }
);

module.exports = {
  deleteApprovedPassengerPhoto,
  passengerPublicPhotoCleanupTrigger,
};
