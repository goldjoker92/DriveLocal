const {
  driverApprovalErrorReason,
  driverApprovalErrorMessage,
  hasCriminalCertificateForDriverApproval,
  hasPhotoApprovedForDriverApproval,
  requiresDuplicateApprovalReview,
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

  it('requires an explicit admin decision for a duplicate-review record', () => {
    expect(requiresDuplicateApprovalReview({
      vehicleType,
      duplicateCheckStatus: 'review_required',
    })).toBe(true);
    expect(requiresDuplicateApprovalReview({
      vehicleType,
      duplicateCheckStatus: 'clear',
    })).toBe(false);
  });
});

describe('admin driver approval errors', () => {
  it('keeps legacy approvals unchanged and blocks only an incomplete new-policy record', () => {
    expect(hasCriminalCertificateForDriverApproval({ uid: 'legacy' }, 'legacy')).toBe(true);
    expect(hasCriminalCertificateForDriverApproval({
      uid: 'new-driver',
      driverDocumentPolicyVersion: 'criminal-certificate-v1',
      criminalCertificateStatus: 'missing',
    }, 'new-driver')).toBe(false);
  });

  it('turns the backend photo precondition into an actionable message', () => {
    expect(driverApprovalErrorMessage({
      code: 'functions/failed-precondition',
      details: { metadata: { reason: 'DRIVER_PHOTO_APPROVAL_REQUIRED' } },
    })).toBe('Aprove primeiro a foto do motorista.');
  });

  it('extracts and explains the duplicate-review precondition', () => {
    const error = {
      details: { metadata: { reason: 'DUPLICATE_REVIEW_REQUIRED' } },
    };
    expect(driverApprovalErrorReason(error)).toBe('DUPLICATE_REVIEW_REQUIRED');
    expect(driverApprovalErrorMessage(error))
      .toBe('A aprovação exige revisar primeiro os possíveis dados duplicados.');
  });

  it('keeps a safe fallback for unknown callable failures', () => {
    expect(driverApprovalErrorMessage({ code: 'functions/internal' }))
      .toBe('Não foi possível aprovar o motorista.');
  });

  it('explains the server-side criminal certificate precondition', () => {
    expect(driverApprovalErrorMessage({
      details: { metadata: { reason: 'CRIMINAL_CERTIFICATE_REQUIRED' } },
    })).toBe('Envie e revise primeiro a certidão de antecedentes criminais.');
  });

  it('wires the precheck, direct photo-review action and structured diagnostics', () => {
    const screen = source('src/app/(admin)/driver-detail.jsx');

    expect(screen).toContain('hasPhotoApprovedForDriverApproval(driver, driverId)');
    expect(screen).toContain('Aprove primeiro a foto do motorista.');
    expect(screen).toContain("pathname: '/(admin)/driver-photo-review'");
    expect(screen).toContain("'[ADMIN_DRIVER_DETAIL] approval blocked'");
    expect(screen).toContain("'[ADMIN_DRIVER_DETAIL] approval failed'");
    expect(screen).toContain('approveDriver(driverId, duplicateOverrideReason)');
    expect(screen).toContain('DUPLICATE_OVERRIDE_REASON_REQUIRED');
    expect(screen).toContain('Revisão de possível duplicata');
    expect(screen).toContain('driverPhotoReviewStatus: driver?.driverPhotoReviewStatus || null');
    expect(screen).toContain('code: e?.code || null');
  });
});
