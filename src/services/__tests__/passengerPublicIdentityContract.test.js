const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('accepted passenger public identity contract', () => {
  it('keeps all pre-acceptance offers anonymous', () => {
    const offers = source('functions/src/rides/offers.js');
    expect(offers).not.toContain('acceptedPassengerPublic');
    expect(offers).not.toContain('passengerFirstName');
    expect(offers).not.toContain('passengerPhotoPublicPath');
  });

  it('exports one retryable post-acceptance projection trigger', () => {
    const index = source('functions/src/index.js');
    const projection = source('functions/src/rides/passengerIdentityProjection.js');

    expect(index).toContain('exports.acceptedPassengerIdentityTrigger');
    expect(projection).toContain('onDocumentUpdated');
    expect(projection).toContain('retry: true');
    expect(projection).toContain('identityProjectionNeeded');
    expect(projection).toContain('duplicate_ignored');
  });

  it('limits the driver projection to first name and verified public photo metadata', () => {
    const identity = source('functions/src/rides/passengerPublicIdentity.js');
    const projection = source('functions/src/rides/passengerIdentityProjection.js');

    expect(identity).toContain('firstName: passengerFirstName(passenger)');
    expect(identity).toContain('photoStoragePath');
    expect(identity).toContain('photoVerified: Boolean(photoStoragePath)');
    expect(identity).toContain('publicPassengerPhotos/${version}.jpg');
    expect(identity).not.toContain('publicPassengerPhotos/${passengerId}');
    expect(projection).toContain("keys.join('|') !== 'firstName|photoStoragePath|photoVerified'");
  });

  it('keeps the source passenger profile private from drivers', () => {
    const rules = source('backend/firebase/rules/firestore.rules');
    expect(rules).toContain('match /passengers/{uid}');
    expect(rules).toContain('allow read: if isOwner(uid) || isAdmin();');
    expect(rules).not.toMatch(/match \/passengers\/\{uid\}[\s\S]{0,250}isAcceptedRideDriver/);
  });

  it('allows reads only for opaque approved photo objects and forbids client writes', () => {
    const storageRules = source('backend/firebase/rules/storage.rules');
    expect(storageRules).toContain('match /publicPassengerPhotos/{fileName}');
    expect(storageRules).toContain("fileName.matches('[A-Za-z0-9_-]{12,80}\\\\.jpg')");
    expect(storageRules).toContain('allow write: if false;');
  });

  it('keeps the reusable mobile card free of private passenger fields', () => {
    const card = source('src/components/AcceptedPassengerIdentityCard.jsx');
    const photoService = source('src/services/passengerPublicPhotoService.js');
    const combined = `${card}\n${photoService}`;

    expect(card).toContain('identity?.firstName');
    expect(card).toContain('identity?.photoVerified');
    expect(card).toContain('identity?.photoStoragePath');
    expect(combined).not.toMatch(/\b(email|whatsApp|cpf|fullName|passengerId|phone|telefone)\b/);
    expect(card).not.toContain('photoStoragePath,');
    expect(card).not.toContain('firstName,');
  });
});
