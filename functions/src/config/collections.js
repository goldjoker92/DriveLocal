// @ts-check
// Server-only Firestore collection names for backend infrastructure records.
//
// SECURITY: these collections are server-authoritative. The client must never
// read or write them. Firestore rules enforcing server-only access will be added
// in BLOCK 04 (this block does NOT modify Firestore rules).
module.exports = Object.freeze({
  IDEMPOTENCY_OPERATIONS: 'idempotencyOperations',
  AUDIT_LOGS: 'auditLogs',
});
