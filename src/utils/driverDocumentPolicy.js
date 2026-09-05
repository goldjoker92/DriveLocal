export const DRIVER_DOCUMENT_POLICY_VERSION = 'criminal-certificate-v1';

export const CRIMINAL_CERTIFICATE_ISSUER_URL =
  'https://www.gov.br/pt-br/servicos/emitir-certidao-de-antecedentes-criminais';

export const CRIMINAL_CERTIFICATE_ACCEPTED_MIME_TYPES = Object.freeze([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

export const CRIMINAL_CERTIFICATE_STORED_MIME_TYPES = Object.freeze([
  'application/pdf',
  'image/jpeg',
]);

export const CRIMINAL_CERTIFICATE_MAX_SIZE_BYTES = 5 * 1024 * 1024;

function certificateExtension(fileName, uri) {
  const source = String(fileName || uri || '').split(/[?#]/)[0].toLowerCase();
  const match = source.match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

// Android content providers do not always expose a MIME type. A recognized file
// extension is an intentional compatibility fallback for the four supported
// formats; unknown, archive and executable files stay rejected.
export function classifyCriminalCertificateAsset({ mime, fileName, uri }) {
  const normalizedMime = String(mime || '').trim().toLowerCase();
  const extension = certificateExtension(fileName, uri);
  const isPdf = normalizedMime === 'application/pdf' || extension === 'pdf';
  const isSupportedImage = CRIMINAL_CERTIFICATE_ACCEPTED_MIME_TYPES.includes(normalizedMime)
    || ['jpg', 'jpeg', 'png', 'webp'].includes(extension);

  if (isPdf) return { contentType: 'application/pdf', fileName: 'certificate.pdf', image: false };
  if (isSupportedImage) return { contentType: 'image/jpeg', fileName: 'certificate.jpg', image: true };
  throw new Error('Formato não aceito. Envie PDF, JPG, PNG ou WebP.');
}

// Rollout is deliberately profile-based, not app-version-based. Drivers created
// before this policy have no marker and keep their already acquired workflow.
export function requiresCriminalCertificate(driver) {
  return driver?.driverDocumentPolicyVersion === DRIVER_DOCUMENT_POLICY_VERSION;
}

export function hasSubmittedCriminalCertificate(driver, driverId) {
  if (!requiresCriminalCertificate(driver)) return true;

  const version = driver?.criminalCertificateVersion;
  const contentType = driver?.criminalCertificateContentType;
  const expectedFileName = contentType === 'application/pdf'
    ? 'certificate.pdf'
    : 'certificate.jpg';
  const expectedPath = typeof version === 'string' && driverId
    ? `drivers/${driverId}/criminal-certificate/${version}/${expectedFileName}`
    : null;

  return ['submitted', 'approved'].includes(driver?.criminalCertificateStatus)
    && CRIMINAL_CERTIFICATE_STORED_MIME_TYPES.includes(contentType)
    && Number.isInteger(driver?.criminalCertificateSizeBytes)
    && driver.criminalCertificateSizeBytes > 0
    && driver.criminalCertificateSizeBytes < CRIMINAL_CERTIFICATE_MAX_SIZE_BYTES
    && driver?.criminalCertificatePath === expectedPath;
}
