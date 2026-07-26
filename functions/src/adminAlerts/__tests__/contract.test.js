const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('admin alert integration contracts', () => {
  it('exports two callables and five independent retryable triggers', () => {
    const callables = source('src/adminAlerts/callables.js');
    const index = source('src/index.js');

    expect(callables).toContain("listAdminAlertsSecure: bind('listAdminAlertsSecure', listAdminAlerts)");
    expect(callables).toContain("updateAdminAlertSecure: bind('updateAdminAlertSecure', updateAdminAlert)");
    expect(callables).toContain('supportTicketAdminAlertTrigger');
    expect(callables).toContain('rideDisputeAdminAlertTrigger');
    expect(callables).toContain('paymentReviewAdminAlertTrigger');
    expect(callables).toContain('riskCaseAdminAlertTrigger');
    expect(callables).toContain('accountDeletionAdminAlertTrigger');
    expect(callables).toContain('retry: true');

    expect(index).toContain('exports.listAdminAlertsSecure');
    expect(index).toContain('exports.updateAdminAlertSecure');
    expect(index).toContain('exports.supportTicketAdminAlertTrigger');
    expect(index).toContain('exports.accountDeletionAdminAlertTrigger');
  });

  it('uses deterministic source hashing and never stores source identity fields', () => {
    const alerts = source('src/adminAlerts/alerts.js');
    const policy = source('src/adminAlerts/policy.js');

    expect(alerts).toContain("return `aa_${hash(`${sourceType}:${sourceId}`)}`");
    expect(alerts).toContain('sourceRefHash: shortHash(`${sourceType}:${sourceId}`)');
    expect(alerts).not.toContain('subjectUid:');
    expect(alerts).not.toContain('actorUid:');
    expect(policy).not.toContain('passengerId:');
    expect(policy).not.toContain('acceptedDriverId:');
    expect(policy).not.toContain('phone:');
    expect(policy).not.toContain('cpf:');
    expect(policy).not.toContain('pixKey:');
  });

  it('versions every deterministic queue index used by listAdminAlerts', () => {
    const alerts = source('src/adminAlerts/alerts.js');
    const indexes = JSON.parse(source('../backend/firebase/indexes/firestore.indexes.json'));
    const alertIndexes = indexes.indexes.filter((index) => index.collectionGroup === 'adminAlerts');

    expect(alerts).toContain("query.where('status', '==', args.status)");
    expect(alerts).toContain("query.where('severity', '==', args.severity)");
    expect(alerts).toContain("query.orderBy('updatedAtMs', 'desc').limit(args.limit)");
    expect(alertIndexes).toHaveLength(3);
    expect(alertIndexes.map((index) => index.fields)).toEqual(expect.arrayContaining([
      [
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'updatedAtMs', order: 'DESCENDING' },
      ],
      [
        { fieldPath: 'severity', order: 'ASCENDING' },
        { fieldPath: 'updatedAtMs', order: 'DESCENDING' },
      ],
      [
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'severity', order: 'ASCENDING' },
        { fieldPath: 'updatedAtMs', order: 'DESCENDING' },
      ],
    ]));
  });

  it('keeps adminAlerts server-only through the existing deny-by-default rules', () => {
    const rules = source('../backend/firebase/rules/firestore.rules');
    expect(rules).not.toContain('match /adminAlerts/{alertId}');
    expect(rules).toContain('match /{document=**}');
    expect(rules).toContain('allow read, write: if false');
  });
});
