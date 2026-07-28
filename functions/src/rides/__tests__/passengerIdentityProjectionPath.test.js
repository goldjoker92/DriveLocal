'use strict';

const { closedProjection } = require('../passengerIdentityProjection');

describe('passenger identity projected photo path', () => {
  it('accepts null or the opaque public path only', () => {
    expect(closedProjection({
      firstName: 'Maria',
      photoStoragePath: null,
      photoVerified: false,
    })).not.toBeNull();

    expect(closedProjection({
      firstName: 'Maria',
      photoStoragePath: 'publicPassengerPhotos/photo_public_20260726.jpg',
      photoVerified: true,
    })).not.toBeNull();
  });

  it.each([
    'passengers/private.jpg',
    'publicPassengerPhotos/passenger_uid/photo_public_20260726.jpg',
    'publicPassengerPhotos/bad.jpg',
    'https://example.com/photo.jpg',
  ])('rejects unsafe path %s', (photoStoragePath) => {
    expect(closedProjection({
      firstName: 'Maria',
      photoStoragePath,
      photoVerified: true,
    })).toBeNull();
  });
});
