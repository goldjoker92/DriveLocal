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

  it('requires every document and prevents driver self-approval', () => {
    const rules = source('backend/firebase/rules/firestore.rules');

    expect(rules).toContain("request.resource.data.selfieStatus == 'submitted'");
    expect(rules).toContain("request.resource.data.cnhFrenteStatus == 'submitted'");
    expect(rules).toContain("request.resource.data.cnhVersoStatus == 'submitted'");
    expect(rules).toContain("request.resource.data.crlvStatus == 'submitted'");
    expect(rules).toContain("request.resource.data.vehiclePhotoStatus == 'submitted'");
    expect(rules).toContain("request.resource.data.motofreteStatus == 'submitted'");
    expect(rules).toContain("resource.data.verificationStatus in ['draft', 'correction_requested']");
    expect(rules).not.toContain("request.resource.data.verificationStatus == 'approved'");
  });
});
