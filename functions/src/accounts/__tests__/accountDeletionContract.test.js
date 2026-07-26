const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('account deletion integration contracts', () => {
  it('exports both the authenticated request and the server processor', () => {
    const index = source('src/index.js');
    const bindings = source('src/accounts/callables.js');

    expect(index).toContain('requestAccountDeletionSecure');
    expect(index).toContain('processAccountDeletionRequest');
    expect(bindings).toContain('onDocumentCreated');
    expect(bindings).toContain('ACCOUNT_DELETION_REQUESTS');
  });

  it('deletes operational PII and both private/public driver storage prefixes', () => {
    const processor = source('src/accounts/processDeletion.js');

    expect(processor).toContain("[C.NOTIFICATION_TOKENS, 'uid']");
    expect(processor).toContain("[C.NOTIFICATION_EVENTS, 'recipientUid']");
    expect(processor).toContain("[C.DRIVER_OFFERS, 'driverId']");
    expect(processor).toContain("['clientErrorReports', 'actorUid']");
    expect(processor).toContain('`drivers/${uid}/`');
    expect(processor).toContain('`publicDriverPhotos/${uid}/`');
    expect(processor).toContain('C.PRIVATE_DRIVER_DATA');
  });

  it('keeps financial records only after pseudonymization and secret removal', () => {
    const processor = source('src/accounts/processDeletion.js');
    const policy = source('src/accounts/deletionPolicy.js');

    expect(processor).toContain('pseudonymizeFinancialRecords');
    expect(policy).toContain('qrCode: deleteField');
    expect(policy).toContain('qrCodeBase64: deleteField');
    expect(policy).toContain('idempotencyKey: deleteField');
    expect(policy).toContain('driverId: anonymousSubjectId');
  });

  it('deletes Firebase Auth only after profile, storage and record cleanup', () => {
    const processor = source('src/accounts/processDeletion.js');
    const cleanupIndex = processor.indexOf('const counts = {');
    const profileIndex = processor.indexOf('const profileBatch = db.batch()', cleanupIndex);
    const storageIndex = processor.indexOf('deleteStorageForSubject(uid)', profileIndex);
    const authIndex = processor.indexOf('deleteAuthUser(uid)', storageIndex);
    const auditIndex = processor.indexOf('ACCOUNT_DELETION_AUDITS', authIndex);
    const requestDeleteIndex = processor.indexOf('await requestRef.delete()', auditIndex);

    expect(cleanupIndex).toBeGreaterThan(-1);
    expect(profileIndex).toBeGreaterThan(cleanupIndex);
    expect(storageIndex).toBeGreaterThan(profileIndex);
    expect(authIndex).toBeGreaterThan(storageIndex);
    expect(auditIndex).toBeGreaterThan(authIndex);
    expect(requestDeleteIndex).toBeGreaterThan(auditIndex);
  });

  it('never puts email, password, CPF or phone into the deletion request', () => {
    const request = source('src/accounts/requestDeletion.js');
    const createStart = request.indexOf('batch.create(requestRef');
    const createEnd = request.indexOf(');', createStart);
    const requestDocument = request.slice(createStart, createEnd);

    expect(requestDocument).toContain('subjectUid: uid');
    expect(requestDocument).not.toMatch(/email/i);
    expect(requestDocument).not.toMatch(/password/i);
    expect(requestDocument).not.toMatch(/cpf/i);
    expect(requestDocument).not.toMatch(/phone|telefone/i);
  });

  it('keeps deletion collections server-only through the deny-all Firestore boundary', () => {
    const rules = source('../backend/firebase/rules/firestore.rules');

    expect(rules).toContain('match /{document=**}');
    expect(rules).toContain('allow read, write: if false;');
    expect(rules).not.toContain('accountDeletionRequests/{');
  });
});
