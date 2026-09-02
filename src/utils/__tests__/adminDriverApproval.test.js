const {
  driverApprovalErrorMessage,
  hasPhotoApprovedForDriverApproval,
} = require('../adminDriverApproval');
const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe.each(['moto', 'car'])('admin final approval — %s', (vehicleType) => {
  const driverId = `driver-${vehicleType}`;

  it('blocks final approval while the public photo is pending', () => {
    expect(hasPhotoApprovedForDriverApproval({
      vehicleType,
      driverPhotoReviewStatus: 'pending',
      selfieStatus: 'submitted',
    }, driverId)).toBe(false);
  });

  it('allows final approval only with the approved public photo for this driver', () => {
    expect(hasPhotoApprovedForDriverApproval({
      vehicleType,
      driverPhotoReviewStatus: 'approved',
      driverPhotoPublicPath: `publicDriverPhotos/${driverId}/photo-v1.jpg`,
    }, driverId)).toBe(true);

    expect(hasPhotoApprovedForDriverApproval({
      vehicleType,
      driverPhotoReviewStatus: 'approved',
      driverPhotoPublicPath: 'publicDriverPhotos/another-driver/photo-v1.jpg',
    }, driverId)).toBe(false);
  });
});

describe('admin driver approval errors', () => {
  it('turns the backend photo precondition into an actionable message', () => {
    expect(driverApprovalErrorMessage({
      code: 'functions/failed-precondition',
      details: { metadata: { reason: 'DRIVER_PHOTO_APPROVAL_REQUIRED' } },
    })).toBe('Aprove primeiro a foto do motorista.');
  });

  it('keeps a safe fallback for unknown callable failures', () => {
    expect(driverApprovalErrorMessage({ code: 'functions/internal' }))
      .toBe('Não foi possível aprovar o motorista.');
  });

  it('wires the precheck, direct photo-review action and structured diagnostics', () => {
    const screen = source('src/app/(admin)/driver-detail.jsx');

    expect(screen).toContain('hasPhotoApprovedForDriverApproval(driver, driverId)');
    expect(screen).toContain('Aprove primeiro a foto do motorista.');
    expect(screen).toContain("pathname: '/(admin)/driver-photo-review'");
    expect(screen).toContain("'[ADMIN_DRIVER_DETAIL] approval blocked'");
    expect(screen).toContain("'[ADMIN_DRIVER_DETAIL] approval failed'");
    expect(screen).toContain('driverPhotoReviewStatus: driver?.driverPhotoReviewStatus || null');
    expect(screen).toContain('code: e?.code || null');
  });
});
