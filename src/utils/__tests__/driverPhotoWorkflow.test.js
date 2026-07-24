const fs = require('fs');
const path = require('path');
const {
  driverPhotoStatus,
  hasApprovedDriverPhoto,
} = require('../../constants/driverPhoto');
const {
  createDriverPhotoVersion,
  firstName,
  publicDriverPhotoCrop,
  publicDriverPhotoSize,
  validateDriverPhotoAsset,
} = require('../driverPhoto');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function section(text, start, end) {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex + start.length);
  return text.slice(startIndex, endIndex === -1 ? undefined : endIndex);
}

describe('secure driver profile-photo workflow', () => {
  it('keeps the approved public photo active while a replacement is pending or rejected', () => {
    const base = {
      driverPhotoPublicPath: 'publicDriverPhotos/driver-1/photo_123_abcd.jpg',
      driverPhotoPublicVersion: 'photo_123_abcd',
    };

    expect(hasApprovedDriverPhoto({ ...base, driverPhotoReviewStatus: 'pending' })).toBe(true);
    expect(hasApprovedDriverPhoto({ ...base, driverPhotoReviewStatus: 'rejected' })).toBe(true);
    expect(driverPhotoStatus({ ...base, driverPhotoReviewStatus: 'pending' })).toBe('pending');
    expect(driverPhotoStatus({ ...base, driverPhotoReviewStatus: 'rejected' })).toBe('rejected');
  });

  it('fails closed when an approved flag has no public path and version', () => {
    expect(hasApprovedDriverPhoto({ driverPhotoReviewStatus: 'approved' })).toBe(false);
    expect(driverPhotoStatus({ driverPhotoReviewStatus: 'approved' })).toBe('missing');
    expect(driverPhotoStatus({
      driverPhotoReviewStatus: 'approved',
      driverPhotoPublicPath: 'publicDriverPhotos/driver-1/photo_123_abcd.jpg',
    })).toBe('missing');
  });

  it('creates deterministic safe versions and a top-biased square passenger crop', () => {
    expect(createDriverPhotoVersion(1234567890, 0.5)).toBe('photo_1234567890_apsw');
    expect(publicDriverPhotoSize()).toBe(512);
    expect(publicDriverPhotoCrop({ width: 1000, height: 1600 })).toEqual({
      originX: 0,
      originY: 168,
      width: 1000,
      height: 1000,
    });
    expect(firstName('  João da Silva ')).toBe('João');
  });

  it('rejects unusable local images before upload', () => {
    expect(validateDriverPhotoAsset(null).code).toBe('PHOTO_URI_MISSING');
    expect(validateDriverPhotoAsset({ uri: 'file://photo.jpg', width: 0, height: 1200 }).code)
      .toBe('PHOTO_DIMENSIONS_MISSING');
    expect(validateDriverPhotoAsset({ uri: 'file://photo.jpg', width: 500, height: 1000 }).code)
      .toBe('PHOTO_TOO_SMALL');
    expect(validateDriverPhotoAsset({ uri: 'file://photo.jpg', width: 1080, height: 1920 }).valid)
      .toBe(true);
  });

  it('previews and uploads the exact same sanitized public candidate', () => {
    const screen = source('src/app/(driver)/driver-photo.jsx');
    const storage = source('src/services/storageService.js');

    expect(screen).toContain('prepareDriverPhotoVariants(candidate)');
    expect(screen).toContain('preparedVariants?.publicCandidateUri');
    expect(screen).toContain('preparedVariants,');
    expect(screen).toContain('EXATAMENTE COMO O PASSAGEIRO VERÁ');
    expect(storage).toContain('const variants = preparedVariants || await prepareDriverPhotoVariants(asset)');
    expect(storage).toContain('uri: variants.publicCandidateUri');
  });

  it('never exposes a private selfie path to the passenger snapshot or screen', () => {
    const acceptOffer = source('functions/src/rides/acceptOffer.js');
    const passenger = source('src/app/(passenger)/driver-accepted.jsx');
    const publicSummary = section(acceptOffer, 'function publicDriverSummary', 'function resolveHold');

    expect(publicSummary).toContain('photoStoragePath');
    expect(publicSummary).toContain('photoVerified');
    expect(publicSummary).not.toContain('selfieUrl');
    expect(publicSummary).not.toContain('driverPhotoCandidate');
    expect(passenger).toContain('acceptedDriverPublic?.photoStoragePath');
    expect(passenger).not.toContain('selfieUrl');
  });

  it('uses the last approved version during replacement review', () => {
    const acceptOffer = source('functions/src/rides/acceptOffer.js');
    const resolver = section(acceptOffer, 'function approvedPhotoPath', 'function publicDriverSummary');

    expect(resolver).toContain('driverPhotoPublicVersion');
    expect(resolver).toContain('path !== `${expectedPrefix}${version}.jpg`');
    expect(resolver).not.toContain("driverPhotoReviewStatus !== 'approved'");
  });

  it('binds admin decisions to the exact candidate version and commits them transactionally', () => {
    const backend = source('functions/src/drivers/photoReview.js');
    const adminClient = source('src/services/adminService.js');
    const adminScreen = source('src/app/(admin)/driver-photo-review.jsx');

    expect(backend).toContain("required: ['driverId', 'expectedVersion']");
    expect(backend).toContain("required: ['driverId', 'expectedVersion', 'reasonCode']");
    expect(backend).toContain("optional: ['reason']");
    expect(backend).toContain('db.runTransaction');
    expect(backend).toContain('PHOTO_CANDIDATE_CHANGED');
    expect(backend).toContain('orphan_cleanup_failed');
    expect(adminClient).toContain('approveDriverPhoto = (driverId, expectedVersion)');
    expect(adminClient).toContain('rejectDriverPhoto = (driverId, expectedVersion, reasonCode, reason)');
    expect(adminScreen).toContain('approveDriverPhoto(driverId, version)');
    expect(adminScreen).toContain('rejectDriverPhoto(');
    expect(adminScreen).toContain('selectedReason');
  });

  it('prevents the client from publishing and isolates immutable JPEG candidates', () => {
    const firestoreRules = source('backend/firebase/rules/firestore.rules');
    const candidateRule = section(
      firestoreRules,
      'function driverPhotoCandidateUpdateValid',
      'function newPhotoPackageSubmitted'
    );
    const storageRules = source('backend/firebase/rules/storage.rules');

    expect(candidateRule).toContain('changed.hasOnly(driverPhotoCandidateFields())');
    expect(candidateRule).not.toContain('request.resource.data.driverPhotoPublicPath == resource.data.driverPhotoPublicPath');
    expect(storageRules).toContain('validProfilePhotoWrite()');
    expect(storageRules).toContain("request.resource.contentType.matches('image/(jpeg|jpg)')");
    expect(storageRules).toContain('!candidateVersionRegistered(driverId, version)');
    expect(storageRules).toContain('allow read: if isOwner(driverId) || isAdmin()');
    expect(storageRules).toContain('match /publicDriverPhotos/{driverId}/{fileName}');
    expect(storageRules).toContain('allow write: if false');
  });

  it('keeps photo operations traceable without tokenized URLs or raw IDs in client logs', () => {
    const log = source('src/utils/driverPhotoLog.js');
    const storage = source('src/services/storageService.js');
    const backend = source('functions/src/drivers/photoReview.js');

    expect(log).toContain('[DRIVER_PHOTO]');
    expect(log).toContain('ALLOWED_KEYS');
    expect(log).not.toContain("'driverId',");
    expect(storage).not.toContain('success url=');
    expect(backend).toContain('driver_photo_approved');
    expect(backend).toContain('driver_photo_rejected');
  });
});
