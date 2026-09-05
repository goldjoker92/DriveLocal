const {
  DRIVER_DOCUMENT_POLICY_VERSION,
  classifyCriminalCertificateAsset,
  hasSubmittedCriminalCertificate,
  requiresCriminalCertificate,
} = require('../driverDocumentPolicy');
const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function submittedCertificate(overrides = {}) {
  const uid = 'driver-new';
  const version = 'certificate_12345678_abcd1234';
  return {
    uid,
    driverDocumentPolicyVersion: DRIVER_DOCUMENT_POLICY_VERSION,
    criminalCertificateStatus: 'submitted',
    criminalCertificateVersion: version,
    criminalCertificateContentType: 'application/pdf',
    criminalCertificateSizeBytes: 12345,
    criminalCertificatePath: `drivers/${uid}/criminal-certificate/${version}/certificate.pdf`,
    ...overrides,
  };
}

describe('criminal certificate rollout', () => {
  it('never blocks a legacy driver without the new policy marker', () => {
    const legacy = { uid: 'driver-legacy', criminalCertificateStatus: 'missing' };
    expect(requiresCriminalCertificate(legacy)).toBe(false);
    expect(hasSubmittedCriminalCertificate(legacy, legacy.uid)).toBe(true);
  });

  it('requires valid private metadata only for a new-policy driver', () => {
    const missing = {
      uid: 'driver-new',
      driverDocumentPolicyVersion: DRIVER_DOCUMENT_POLICY_VERSION,
      criminalCertificateStatus: 'missing',
    };
    expect(requiresCriminalCertificate(missing)).toBe(true);
    expect(hasSubmittedCriminalCertificate(missing, missing.uid)).toBe(false);
    expect(hasSubmittedCriminalCertificate(submittedCertificate(), 'driver-new')).toBe(true);
  });

  it('rejects a certificate path belonging to another driver', () => {
    expect(hasSubmittedCriminalCertificate(submittedCertificate(), 'another-driver')).toBe(false);
  });

  it.each([
    [{ mime: 'application/pdf', fileName: 'certidao' }, 'application/pdf', 'certificate.pdf'],
    [{ mime: 'image/png', fileName: 'certidao' }, 'image/jpeg', 'certificate.jpg'],
    [{ fileName: 'CERTIDAO.WEBP' }, 'image/jpeg', 'certificate.jpg'],
    [{ uri: 'file:///cache/certidao.jpeg?source=picker' }, 'image/jpeg', 'certificate.jpg'],
  ])('accepts supported picker input %#', (asset, contentType, fileName) => {
    expect(classifyCriminalCertificateAsset(asset)).toMatchObject({ contentType, fileName });
  });

  it.each(['certidao.zip', 'certidao.exe', 'certidao.docx'])('rejects unsafe/unknown format %s', (fileName) => {
    expect(() => classifyCriminalCertificateAsset({ fileName })).toThrow('Formato não aceito');
  });
});

describe('criminal certificate integration contract', () => {
  it('stamps only newly created driver profiles and leaves passenger registration untouched', () => {
    const auth = source('src/services/authService.js');
    const driverProfile = auth.slice(
      auth.indexOf('function buildInitialDriverProfile'),
      auth.indexOf('export async function registerDriver')
    );
    const passengerProfile = auth.slice(
      auth.indexOf('export async function registerPassenger'),
      auth.indexOf('// Signs the user in')
    );

    expect(driverProfile).toContain('driverDocumentPolicyVersion: DRIVER_DOCUMENT_POLICY_VERSION');
    expect(driverProfile).toContain("criminalCertificateStatus: 'missing'");
    expect(passengerProfile).not.toContain('criminalCertificate');
  });

  it('keeps private storage versioned, immutable and deleted with the existing account prefix', () => {
    const storageRules = source('backend/firebase/rules/storage.rules');
    const firestoreRules = source('backend/firebase/rules/firestore.rules');
    const deletion = source('functions/src/accounts/processDeletion.js');

    expect(storageRules).toContain('match /drivers/{driverId}/criminal-certificate/{version}/{fileName}');
    expect(storageRules).toContain('!criminalCertificateVersionRegistered(driverId, version)');
    expect(storageRules).toContain('allow read: if isOwner(driverId) || isAdmin()');
    expect(storageRules).toContain("fileName == 'certificate.pdf'");
    expect(storageRules).toContain("request.resource.contentType == 'image/jpeg'");
    expect(firestoreRules).toContain('(!requiresCriminalCertificate() || criminalCertificateSubmitted(driverId))');
    expect(deletion).toContain('`drivers/${uid}/`');
  });

  it('adds the official issuer link and file picker without changing ride code', () => {
    const documents = source('src/app/(driver)/documents.jsx');
    const packageJson = source('package.json');

    expect(documents).toContain('DocumentPicker.getDocumentAsync');
    expect(documents).toContain('Emitir gratuitamente no portal oficial');
    expect(documents).toContain('uploadDriverCriminalCertificate');
    expect(packageJson).toContain('"expo-document-picker": "~56.0.4"');
  });

  it('shows the private document to admins and repeats the approval gate on the backend', () => {
    const admin = source('src/app/(admin)/driver-detail.jsx');
    const approval = source('functions/src/drivers/approveDriver.js');

    expect(admin).toContain('getPrivateDriverDocumentUrl');
    expect(admin).toContain('hasCriminalCertificateForDriverApproval(driver, driverId)');
    expect(approval).toContain('hasSubmittedCriminalCertificate(before, driverId)');
    expect(approval).toContain("reason: 'CRIMINAL_CERTIFICATE_REQUIRED'");
  });

  it('ships as the next Android bundle without imposing a minimum app version', () => {
    const app = JSON.parse(source('app.json')).expo;
    const policy = source('src/utils/driverDocumentPolicy.js');

    expect(app.version).toBe('1.0.7');
    expect(app.android.versionCode).toBe(12);
    expect(policy).not.toMatch(/minimum(App)?Version|force.?update/i);
  });
});
