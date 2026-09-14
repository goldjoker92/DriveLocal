// @ts-check
// Compatibility bridge for driver profiles created by older app versions.
// The public profile remains readable by its owner; the payment destination is
// copied into the server-only document only after structural Pix validation.

const admin = require('firebase-admin');
const C = require('../rides/constants');
const { normalizePixKey } = require('./pixKey');

async function syncDriverPixKeyForRide({ db, driverId }) {
  if (!driverId) return { synced: false, reasonCode: 'UNAUTHENTICATED' };

  const driverRef = db.collection(C.DRIVERS).doc(driverId);
  const privateRef = db.collection(C.PRIVATE_DRIVER_DATA).doc(driverId);

  return db.runTransaction(async (tx) => {
    const driverSnap = await tx.get(driverRef);
    const privateSnap = await tx.get(privateRef);
    const driver = driverSnap.exists ? driverSnap.data() || {} : {};
    const privateData = privateSnap.exists ? privateSnap.data() || {} : {};
    const publicPix = normalizePixKey(driver.pixKey, driver.pixKeyType);
    const privatePix = normalizePixKey(privateData.pixKey, privateData.pixKeyType);

    if (!publicPix.valid) {
      return {
        synced: false,
        reasonCode: publicPix.reasonCode,
        privateKeyValid: privatePix.valid,
      };
    }

    const publicNeedsNormalization = driver.pixKey !== publicPix.key
      || driver.pixKeyType !== publicPix.pixKeyType;
    const privateNeedsSync = !privatePix.valid
      || privatePix.key !== publicPix.key
      || privatePix.keyType !== publicPix.keyType;
    const timestamp = admin.firestore.FieldValue.serverTimestamp();

    if (publicNeedsNormalization) {
      tx.set(driverRef, {
        pixKey: publicPix.key,
        pixKeyType: publicPix.pixKeyType,
        pixKeyNormalizedAt: timestamp,
        updatedAt: timestamp,
      }, { merge: true });
    }
    if (privateNeedsSync) {
      tx.set(privateRef, {
        pixKey: publicPix.key,
        pixKeyType: publicPix.pixKeyType,
        pixOwnerName: driver.pixOwnerName || driver.fullName || null,
        syncedFromDriverProfileAt: timestamp,
      }, { merge: true });
    }

    return {
      synced: publicNeedsNormalization || privateNeedsSync,
      reasonCode: null,
      privateKeyValid: true,
    };
  });
}

module.exports = { syncDriverPixKeyForRide };
