const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('account deletion integration contracts', () => {
  it('exports both the authenticated request and the retryable server processor', () => {
    const index = source('src/index.js');
    const bindings = source('src/accounts/callables.js');

    expect(index).toContain('requestAccountDeletionSecure');
    expect(index).toContain('processAccountDeletionRequest');
    expect(bindings).toContain('onDocumentCreated');
    expect(bindings).toContain('ACCOUNT_DELETION_REQUESTS');
    expect(bindings).toContain('retry: true');
    expect(bindings).toContain('timeoutSeconds: 540');
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

  it('pseudonymizes the actual audit and risk-engine identity fields', () => {
    const processor = source('src/accounts/processDeletion.js');

    expect(processor).toContain("[infraC.AUDIT_LOGS, 'actorUid']");
    expect(processor).toContain("[infraC.AUDIT_LOGS, 'targetId']");
    expect(processor).toContain("[riskC.COLLECTIONS.RISK_EVENTS, 'actorId']");
    expect(processor).toContain("[riskC.COLLECTIONS.RISK_EVENTS, 'sourceId']");
    expect(processor).toContain("[riskC.COLLECTIONS.FRAUD_CASES, 'actorId']");
    expect(processor).toContain("[riskC.COLLECTIONS.FRAUD_CASES, 'sourceId']");
    expect(processor).toContain("[riskC.COLLECTIONS.FINANCIAL_ALERTS, 'sourceId']");
    expect(processor).not.toContain("[riskC.COLLECTIONS.RISK_EVENTS, 'actorUid']");
  });

  it('migrates the role-prefixed risk profile so its document id no longer contains the uid', () => {
    const processor = source('src/accounts/processDeletion.js');

    expect(processor).toContain('doc(`${role}_${uid}`)');
    expect(processor).toContain('doc(`${role}_${anonymousSubjectId}`)');
    expect(processor).toContain('batch.delete(oldRef)');
    expect(processor).toContain('actorId: anonymousSubjectId');
    expect(processor).not.toContain('RISK_PROFILES).doc(uid)');
  });

  it('keeps financial records only after pseudonymization and secret removal', () => {
    const processor = source('src/accounts/processDeletion.js');
    const policy = source('src/accounts/deletionPolicy.js');

    expect(processor).toContain('pseudonymizeFinancialRecords');
    expect(policy).toContain('qrCode: deleteField');
    expect(policy).toContain('qrCodeBase64: deleteField');
    expect(policy).toContain('idempotencyKey: deleteField');
    expect(policy).toContain('driverId: anonymousSubjectId');
    expect(policy).toContain("update.status = 'cancelled'");
  });

  it('blocks late provider callbacks from recreating a deleted wallet', () => {
    const verification = source('src/payments/verifyAndApply.js');
    const barrierIndex = verification.indexOf('if (accountDeletedPayment(pay))');
    const walletIndex = verification.indexOf('applyWalletTopup({');

    expect(barrierIndex).toBeGreaterThan(-1);
    expect(barrierIndex).toBeLessThan(walletIndex);
    expect(verification).not.toContain('applySubscription({');
    expect(verification).toContain('payment.account_deleted_ignored');
    expect(verification).toContain('account_deleted_provider_payment');
    expect(verification).toContain('updatedAt: clock.now()');
  });

  it('blocks new ride and Pix creation before external work starts', () => {
    const rideCreation = source('src/rides/createRideRequest.js');
    const pixCreation = source('src/payments/createPixPayment.js');
    const rideBarrier = rideCreation.indexOf('if (accountDeletionPending(passenger))');
    const routeWork = rideCreation.indexOf('validateServiceArea({');
    const pixBarrier = pixCreation.indexOf('if (accountDeletionPending(driver))');
    const providerWork = pixCreation.indexOf('adapter.createPixOrder({');

    expect(rideBarrier).toBeGreaterThan(-1);
    expect(rideBarrier).toBeLessThan(routeWork);
    expect(pixBarrier).toBeGreaterThan(-1);
    expect(pixBarrier).toBeLessThan(providerWork);
    expect(rideCreation).toContain("reason: 'ACCOUNT_DELETION_PENDING'");
    expect(pixCreation).toContain("reason: 'ACCOUNT_DELETION_PENDING'");
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
