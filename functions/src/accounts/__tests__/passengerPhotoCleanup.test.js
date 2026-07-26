'use strict';

const { deleteApprovedPassengerPhoto } = require('../passengerPhotoCleanup');

const VERSION = 'photo_public_20260726';
const PATH = `publicPassengerPhotos/${VERSION}.jpg`;

function bucketMock(deleteImpl = async () => undefined) {
  const deleteFile = jest.fn(deleteImpl);
  const file = jest.fn(() => ({ delete: deleteFile }));
  return { bucket: { file }, file, deleteFile };
}

describe('passenger public photo cleanup', () => {
  it('deletes only the canonical approved photo object', async () => {
    const mock = bucketMock();
    const result = await deleteApprovedPassengerPhoto({
      passengerPhotoPublicVerified: true,
      passengerPhotoPublicVersion: VERSION,
      passengerPhotoPublicPath: PATH,
      email: 'private@example.com',
    }, mock.bucket);

    expect(result).toEqual({ action: 'deleted' });
    expect(mock.file).toHaveBeenCalledWith(PATH);
    expect(mock.deleteFile).toHaveBeenCalledWith({ ignoreNotFound: true });
  });

  it('does not touch Storage for unverified or malformed metadata', async () => {
    const mock = bucketMock();
    await expect(deleteApprovedPassengerPhoto({
      passengerPhotoPublicVerified: false,
      passengerPhotoPublicVersion: VERSION,
      passengerPhotoPublicPath: PATH,
    }, mock.bucket)).resolves.toEqual({ action: 'no_approved_photo' });
    await expect(deleteApprovedPassengerPhoto({
      passengerPhotoPublicVerified: true,
      passengerPhotoPublicVersion: VERSION,
      passengerPhotoPublicPath: 'passengers/private.jpg',
    }, mock.bucket)).resolves.toEqual({ action: 'no_approved_photo' });
    expect(mock.file).not.toHaveBeenCalled();
  });

  it('treats an already missing object as an idempotent success', async () => {
    const error = Object.assign(new Error('missing'), { code: 404 });
    const mock = bucketMock(async () => { throw error; });
    await expect(deleteApprovedPassengerPhoto({
      passengerPhotoPublicVerified: true,
      passengerPhotoPublicVersion: VERSION,
      passengerPhotoPublicPath: PATH,
    }, mock.bucket)).resolves.toEqual({ action: 'already_missing' });
  });

  it('rethrows transient Storage failures for trigger retry', async () => {
    const error = Object.assign(new Error('temporary'), { code: 503 });
    const mock = bucketMock(async () => { throw error; });
    await expect(deleteApprovedPassengerPhoto({
      passengerPhotoPublicVerified: true,
      passengerPhotoPublicVersion: VERSION,
      passengerPhotoPublicPath: PATH,
    }, mock.bucket)).rejects.toThrow('temporary');
  });
});
