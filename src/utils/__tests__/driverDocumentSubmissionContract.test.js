const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('driver document submission contract', () => {
  it('allows the two exact writes performed by the documents screen', () => {
    const rules = source('backend/firebase/rules/firestore.rules');
    const documents = source('src/app/(driver)/documents.jsx');
    const driverService = source('src/services/driverService.js');

    expect(documents).toContain("documentsStatus: 'submitted'");
    expect(documents).toContain('submittedAt: serverTimestamp()');
    expect(documents).toContain('await submitForReview(uid)');

    expect(driverService).toContain("verificationStatus: 'pending_review'");
    expect(driverService).toContain("duplicateCheckStatus: 'pending_admin_review'");

    expect(rules).toContain('driverDocumentsSubmissionValid');
    expect(rules).toContain('driverReviewTransitionValid');
    expect(rules).toContain("changed.hasOnly(['documentsStatus', 'submittedAt', 'updatedAt'])");
    expect(rules).toContain("request.resource.data.verificationStatus == 'pending_review'");
    expect(rules).toContain("request.resource.data.duplicateCheckStatus == 'pending_admin_review'");
  });

  it('reloads persisted document and selfie statuses after returning from capture', () => {
    const documents = source('src/app/(driver)/documents.jsx');

    expect(documents).toContain("import { useFocusEffect, useRouter } from 'expo-router'");
    expect(documents).toContain('useFocusEffect(');
    expect(documents).toContain('getDriver(uid)');
    expect(documents).toContain("initial.selfie = { status: 'done'");
  });

  it('requires every uploaded document and prevents driver self-approval', () => {
    const rules = source('backend/firebase/rules/firestore.rules');

    expect(rules).toContain("request.resource.data.selfieStatus == 'submitted'");
    expect(rules).toContain('request.resource.data.selfieUrl is string');
    expect(rules).toContain("request.resource.data.cnhFrenteStatus == 'submitted'");
    expect(rules).toContain('request.resource.data.cnhFrenteUrl is string');
    expect(rules).toContain("request.resource.data.cnhVersoStatus == 'submitted'");
    expect(rules).toContain('request.resource.data.cnhVersoUrl is string');
    expect(rules).toContain("request.resource.data.crlvStatus == 'submitted'");
    expect(rules).toContain('request.resource.data.crlvUrl is string');
    expect(rules).toContain("request.resource.data.vehiclePhotoStatus == 'submitted'");
    expect(rules).toContain('request.resource.data.vehiclePhotoUrl is string');
    expect(rules).toContain("resource.data.verificationStatus in ['draft', 'correction_requested']");
    expect(rules).not.toContain("request.resource.data.verificationStatus == 'approved'");
  });

  it('lets a motorcycle package reach admin review without a specialized certificate', () => {
    const applicationFiles = [
      'src/app/(driver)/documents.jsx',
      'src/app/(admin)/driver-detail.jsx',
      'src/services/driverService.js',
      'src/services/storageService.js',
    ];

    applicationFiles.forEach((file) => {
      expect(source(file)).not.toMatch(/motofrete|motofretista/i);
    });

    const rules = source('backend/firebase/rules/firestore.rules');
    expect(rules).not.toContain("request.resource.data.motofreteStatus == 'submitted'");
    expect(rules).not.toContain('request.resource.data.motofreteUrl is string');
  });

  it('keeps package submission out of the generic driver update allowlist', () => {
    const rules = source('backend/firebase/rules/firestore.rules');
    const safeFunction = rules.slice(
      rules.indexOf('function driverUpdateSafe()'),
      rules.indexOf('function requiredDriverDocumentsSubmitted()')
    );

    expect(safeFunction).not.toContain("'documentsStatus'");
    expect(safeFunction).not.toContain("'submittedAt'");
    expect(safeFunction).not.toContain("'verificationStatus'");
    expect(safeFunction).not.toContain("'duplicateCheckStatus'");
  });
});
