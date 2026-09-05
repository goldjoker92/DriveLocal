const DRIVER_DOCUMENT_POLICY_VERSION = 'criminal-certificate-v1';
const CRIMINAL_CERTIFICATE_MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_CONTENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
]);

function requiresCriminalCertificate(driver = {}) {
  return driver.driverDocumentPolicyVersion === DRIVER_DOCUMENT_POLICY_VERSION;
}

// The backend repeats the client/admin check so a stale or modified application
// cannot approve a new-policy driver without a registered private document.
function hasSubmittedCriminalCertificate(driver = {}, driverId) {
  if (!requiresCriminalCertificate(driver)) return true;

  const version = driver.criminalCertificateVersion;
  const contentType = driver.criminalCertificateContentType;
  const expectedFileName = contentType === 'application/pdf'
    ? 'certificate.pdf'
    : 'certificate.jpg';
  const expectedPath = typeof version === 'string' && driverId
    ? `drivers/${driverId}/criminal-certificate/${version}/${expectedFileName}`
    : null;

  return ['submitted', 'approved'].includes(driver.criminalCertificateStatus)
    && ACCEPTED_CONTENT_TYPES.has(contentType)
    && Number.isInteger(driver.criminalCertificateSizeBytes)
    && driver.criminalCertificateSizeBytes > 0
    && driver.criminalCertificateSizeBytes < CRIMINAL_CERTIFICATE_MAX_SIZE_BYTES
    && driver.criminalCertificatePath === expectedPath;
}

module.exports = {
  DRIVER_DOCUMENT_POLICY_VERSION,
  hasSubmittedCriminalCertificate,
  requiresCriminalCertificate,
};
