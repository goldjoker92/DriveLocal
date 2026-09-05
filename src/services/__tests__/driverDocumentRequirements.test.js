jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  updateDoc: jest.fn(),
  collection: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  arrayUnion: jest.fn(),
  serverTimestamp: jest.fn(),
}));

jest.mock('../../config/firebase', () => ({ db: {} }));
jest.mock('../founderService', () => ({ assignFounderStatusIfEligible: jest.fn() }));

const { checkAllDocumentsSubmitted } = require('../driverService');

const COMPLETE_DOCUMENTS = Object.freeze({
  selfieStatus: 'submitted',
  cnhFrenteStatus: 'submitted',
  cnhVersoStatus: 'submitted',
  crlvStatus: 'submitted',
  vehiclePhotoStatus: 'submitted',
});

describe('driver document requirements', () => {
  it('accepts a motorcycle application with the five standard documents', () => {
    expect(checkAllDocumentsSubmitted(COMPLETE_DOCUMENTS, 'moto')).toEqual({
      allSubmitted: true,
      missing: [],
    });
  });

  it.each([
    ['selfieStatus', 'selfie'],
    ['cnhFrenteStatus', 'cnh_frente'],
    ['cnhVersoStatus', 'cnh_verso'],
    ['crlvStatus', 'crlv'],
    ['vehiclePhotoStatus', 'vehicle_photo'],
  ])('still blocks submission when %s is missing', (statusField, documentType) => {
    const application = { ...COMPLETE_DOCUMENTS, [statusField]: 'missing' };

    expect(checkAllDocumentsSubmitted(application, 'moto')).toEqual({
      allSubmitted: false,
      missing: [documentType],
    });
  });

  it('keeps the car document requirements unchanged', () => {
    expect(checkAllDocumentsSubmitted(COMPLETE_DOCUMENTS, 'car')).toEqual({
      allSubmitted: true,
      missing: [],
    });
  });

  it('keeps a legacy driver unblocked without a criminal certificate', () => {
    expect(checkAllDocumentsSubmitted({ uid: 'legacy', ...COMPLETE_DOCUMENTS })).toEqual({
      allSubmitted: true,
      missing: [],
    });
  });

  it('requires the certificate only when the new policy marker is present', () => {
    const application = {
      uid: 'new-driver',
      ...COMPLETE_DOCUMENTS,
      driverDocumentPolicyVersion: 'criminal-certificate-v1',
      criminalCertificateStatus: 'missing',
    };
    expect(checkAllDocumentsSubmitted(application)).toEqual({
      allSubmitted: false,
      missing: ['criminal_certificate'],
    });

    const version = 'certificate_12345678_abcd1234';
    expect(checkAllDocumentsSubmitted({
      ...application,
      criminalCertificateStatus: 'submitted',
      criminalCertificateVersion: version,
      criminalCertificateContentType: 'application/pdf',
      criminalCertificateSizeBytes: 3210,
      criminalCertificatePath: `drivers/new-driver/criminal-certificate/${version}/certificate.pdf`,
    })).toEqual({ allSubmitted: true, missing: [] });
  });
});
