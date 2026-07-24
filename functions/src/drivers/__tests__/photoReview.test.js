const {
  assertExpectedPendingCandidate,
  candidatePathsValid,
  publicPath,
} = require('../photoReview');

function pendingCandidate(overrides = {}) {
  return {
    driverPhotoReviewStatus: 'pending',
    driverPhotoCandidateVersion: 'photo_1234_abcd',
    driverPhotoCandidateOriginalPath: 'drivers/driver-1/profile-photo/photo_1234_abcd/original.jpg',
    driverPhotoCandidatePublicPath: 'drivers/driver-1/profile-photo/photo_1234_abcd/public-candidate.jpg',
    ...overrides,
  };
}

describe('driver photo review guards', () => {
  it('accepts only exact private candidate paths', () => {
    expect(candidatePathsValid(
      'driver-1',
      'photo_1234_abcd',
      'drivers/driver-1/profile-photo/photo_1234_abcd/original.jpg',
      'drivers/driver-1/profile-photo/photo_1234_abcd/public-candidate.jpg'
    )).toBe(true);

    expect(candidatePathsValid(
      'driver-1',
      'photo_1234_abcd',
      'drivers/other/profile-photo/photo_1234_abcd/original.jpg',
      'drivers/driver-1/profile-photo/photo_1234_abcd/public-candidate.jpg'
    )).toBe(false);
  });

  it('derives a versioned public path', () => {
    expect(publicPath('driver-1', 'photo_1234_abcd'))
      .toBe('publicDriverPhotos/driver-1/photo_1234_abcd.jpg');
  });

  it('accepts the exact pending version', () => {
    expect(assertExpectedPendingCandidate(
      'driver-1',
      'photo_1234_abcd',
      pendingCandidate()
    )).toEqual({
      originalPath: 'drivers/driver-1/profile-photo/photo_1234_abcd/original.jpg',
      candidatePath: 'drivers/driver-1/profile-photo/photo_1234_abcd/public-candidate.jpg',
    });
  });

  it('rejects a stale admin decision after a replacement', () => {
    expect(() => assertExpectedPendingCandidate(
      'driver-1',
      'photo_old',
      pendingCandidate({ driverPhotoCandidateVersion: 'photo_new' })
    )).toThrow(expect.objectContaining({
      code: 'INVALID_STATE_TRANSITION',
      safeMetadata: { reason: 'PHOTO_CANDIDATE_CHANGED' },
    }));
  });

  it('rejects decisions when the candidate is no longer pending', () => {
    expect(() => assertExpectedPendingCandidate(
      'driver-1',
      'photo_1234_abcd',
      pendingCandidate({ driverPhotoReviewStatus: 'approved' })
    )).toThrow(expect.objectContaining({
      code: 'INVALID_STATE_TRANSITION',
      safeMetadata: { reason: 'PHOTO_NOT_PENDING' },
    }));
  });
});
