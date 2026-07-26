'use strict';

const {
  DEFAULT_FIRST_NAME,
  passengerFirstName,
  approvedPassengerPhotoPath,
  buildAcceptedPassengerPublic,
} = require('../passengerPublicIdentity');

const PASSENGER_ID = 'passenger_secure_001';
const VERSION = 'photo_v20260726';
const PUBLIC_PATH = `publicPassengerPhotos/${VERSION}.jpg`;

describe('accepted passenger public identity', () => {
  it('publishes only the first name from a private full name', () => {
    expect(passengerFirstName({ fullName: '  Maria   Clara de Souza  ' })).toBe('Maria');
    expect(passengerFirstName({ fullName: 'João-Pedro Silva' })).toBe('João-Pedro');
    expect(passengerFirstName({ fullName: "D’Ávila Santos" })).toBe('D’Ávila');
  });

  it('never turns an email, phone or empty value into a public name', () => {
    expect(passengerFirstName({ fullName: 'maria@example.com' })).toBe(DEFAULT_FIRST_NAME);
    expect(passengerFirstName({ fullName: '+55 85 99999-9999' })).toBe(DEFAULT_FIRST_NAME);
    expect(passengerFirstName({ fullName: '' })).toBe(DEFAULT_FIRST_NAME);
  });

  it('accepts only an explicitly verified opaque public photo', () => {
    const passenger = {
      passengerPhotoPublicVerified: true,
      passengerPhotoPublicVersion: VERSION,
      passengerPhotoPublicPath: PUBLIC_PATH,
    };
    expect(approvedPassengerPhotoPath(passenger)).toBe(PUBLIC_PATH);
  });

  it.each([
    [{ passengerPhotoPublicVerified: false, passengerPhotoPublicVersion: VERSION, passengerPhotoPublicPath: PUBLIC_PATH }],
    [{ passengerPhotoPublicVerified: true, passengerPhotoPublicVersion: 'bad', passengerPhotoPublicPath: PUBLIC_PATH }],
    [{ passengerPhotoPublicVerified: true, passengerPhotoPublicVersion: VERSION, passengerPhotoPublicPath: 'passengers/private.jpg' }],
    [{ passengerPhotoPublicVerified: true, passengerPhotoPublicVersion: VERSION, passengerPhotoPublicPath: `publicPassengerPhotos/${PASSENGER_ID}/${VERSION}.jpg` }],
  ])('rejects unverified, private or account-derived photo metadata', (passenger) => {
    expect(approvedPassengerPhotoPath(passenger)).toBeNull();
  });

  it('returns the closed three-field projection without private profile data', () => {
    const projection = buildAcceptedPassengerPublic({
      fullName: 'Maria Clara de Souza',
      email: 'private@example.com',
      whatsApp: '85999999999',
      cpf: '00000000000',
      passengerPhotoPublicVerified: true,
      passengerPhotoPublicVersion: VERSION,
      passengerPhotoPublicPath: PUBLIC_PATH,
    });

    expect(projection).toEqual({
      firstName: 'Maria',
      photoStoragePath: PUBLIC_PATH,
      photoVerified: true,
    });
    expect(Object.keys(projection).sort()).toEqual([
      'firstName',
      'photoStoragePath',
      'photoVerified',
    ]);
    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain('private@example.com');
    expect(serialized).not.toContain('85999999999');
    expect(serialized).not.toContain('00000000000');
    expect(serialized).not.toContain('Clara');
    expect(serialized).not.toContain(PASSENGER_ID);
  });
});
