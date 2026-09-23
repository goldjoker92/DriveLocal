#!/usr/bin/env node
'use strict';
// Read-only release gate. Run with an explicitly selected Firebase project after
// approval to access that environment. Only opaque payment/driver IDs are printed.
const admin = require('../../functions/node_modules/firebase-admin');
const { classifyLegacyPaidPlans } = require('./legacy-paid-plan-audit');

const projectArg = process.argv.find((arg) => arg.startsWith('--project-id='));
const projectId = projectArg?.slice('--project-id='.length);
if (!projectId || !/^[a-z][a-z0-9-]{4,50}$/.test(projectId)) {
  process.stderr.write('Usage: node scripts/release/audit-legacy-paid-plans.js --project-id=FIREBASE_PROJECT\n');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });
const db = admin.firestore();

async function allDocs(collectionName) {
  const result = [];
  let last;
  while (true) {
    let query = db.collection(collectionName)
      .orderBy(admin.firestore.FieldPath.documentId()).limit(300);
    if (last) query = query.startAfter(last);
    const snap = await query.get();
    result.push(...snap.docs);
    if (snap.size < 300) return result;
    last = snap.docs[snap.size - 1];
    if (result.length > 10000) throw new Error('AUDIT_LIMIT_EXCEEDED');
  }
}

async function main() {
  const [requests, previousPayments, drivers] = await Promise.all([
    allDocs('paymentRequests'), allDocs('subscriptionPayments'), allDocs('drivers'),
  ]);
  const { needsReview, ...report } = classifyLegacyPaidPlans({ requests, previousPayments, drivers });
  process.stdout.write(`${JSON.stringify({ projectId, ...report }, null, 2)}\n`);
  if (needsReview) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`Legacy payment audit failed: ${error.code || error.message}\n`);
  process.exitCode = 1;
});
