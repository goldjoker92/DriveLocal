const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('support workflow integration contracts', () => {
  it('exports four secure callables and the deletion cleanup trigger', () => {
    const callables = source('src/support/callables.js');
    const index = source('src/index.js');

    expect(callables).toContain("createSupportTicketSecure: bind('createSupportTicketSecure', createSupportTicket)");
    expect(callables).toContain("listMySupportTicketsSecure: bind('listMySupportTicketsSecure', listMySupportTickets)");
    expect(callables).toContain("listAdminSupportTicketsSecure: bind('listAdminSupportTicketsSecure', listAdminSupportTickets)");
    expect(callables).toContain("updateAdminSupportTicketSecure: bind('updateAdminSupportTicketSecure', updateAdminSupportTicket)");
    expect(callables).toContain('pseudonymizeSupportTicketsOnAccountDeletion');

    expect(index).toContain('exports.createSupportTicketSecure = supportCallables.createSupportTicketSecure');
    expect(index).toContain('exports.listMySupportTicketsSecure = supportCallables.listMySupportTicketsSecure');
    expect(index).toContain('exports.listAdminSupportTicketsSecure = supportCallables.listAdminSupportTicketsSecure');
    expect(index).toContain('exports.updateAdminSupportTicketSecure = supportCallables.updateAdminSupportTicketSecure');
    expect(index).toContain('exports.pseudonymizeSupportTicketsOnAccountDeletion');
  });

  it('derives role and context server-side without accepting free text', () => {
    const handler = source('src/support/tickets.js');
    expect(handler).toContain("required: ['categoryCode', 'idempotencyKey']");
    expect(handler).toContain("optional: ['rideId', 'sourceRoute']");
    expect(handler).toContain('const { role } = await actorRole(db, uid)');
    expect(handler).toContain('loadRideContext(db, uid, role, args.rideId)');
    expect(handler).toContain('latestDriverPayment(db, uid, definition.paymentPurpose)');
    expect(handler).not.toContain('messageText');
    expect(handler).not.toContain('userMessage');
    expect(handler).not.toContain('freeText');
  });

  it('uses deterministic indexed queues for payments, users and admins', () => {
    const handler = source('src/support/tickets.js');
    const indexes = JSON.parse(source('../backend/firebase/indexes/firestore.indexes.json'));
    const supportIndexes = indexes.indexes.filter((index) => index.collectionGroup === 'supportTickets');
    const paymentIndexes = indexes.indexes.filter((index) => index.collectionGroup === 'paymentRequests');

    expect(handler).toContain(".where('purpose', '==', purpose)");
    expect(handler).toContain(".orderBy('createdAtMs', 'desc')");
    expect(handler).toContain(".where('status', 'in', ACTIVE_STATUSES)");
    expect(handler).toContain('.limit(MAX_USER_TICKETS)');
    expect(handler).toContain("query.orderBy('createdAtMs', 'desc').limit(args.limit)");

    expect(paymentIndexes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fields: [
          { fieldPath: 'driverId', order: 'ASCENDING' },
          { fieldPath: 'purpose', order: 'ASCENDING' },
          { fieldPath: 'createdAtMs', order: 'DESCENDING' },
        ],
      }),
    ]));
    expect(supportIndexes).toHaveLength(3);
    expect(supportIndexes.map((index) => index.fields)).toEqual(expect.arrayContaining([
      [
        { fieldPath: 'actorUid', order: 'ASCENDING' },
        { fieldPath: 'status', order: 'ASCENDING' },
      ],
      [
        { fieldPath: 'actorUid', order: 'ASCENDING' },
        { fieldPath: 'createdAtMs', order: 'DESCENDING' },
      ],
      [
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'createdAtMs', order: 'DESCENDING' },
      ],
    ]));
  });

  it('keeps support tickets behind callable-only Firestore access', () => {
    const rules = source('../backend/firebase/rules/firestore.rules');
    expect(rules).not.toContain('match /supportTickets/{ticketId}');
    expect(rules).toContain('match /{document=**}');
    expect(rules).toContain('allow read, write: if false');
  });

  it('pseudonymizes support identity during account deletion', () => {
    const cleanup = source('src/support/accountDeletion.js');
    expect(cleanup).toContain(".where('actorUid', '==', uid)");
    expect(cleanup).toContain('actorUid: anonymousSubjectId');
    expect(cleanup).toContain('issueFingerprint: admin.firestore.FieldValue.delete()');
    expect(cleanup).toContain('accountDeleted: true');
    expect(cleanup).not.toContain('requestData.email');
    expect(cleanup).not.toContain('requestData.phone');
  });
});