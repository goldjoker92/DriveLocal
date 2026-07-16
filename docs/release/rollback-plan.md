# Rollback Plan

Applies to DEV now; PROD once the production project exists. Rollback owner: MANUAL VALUE REQUIRED.

## Firestore Rules
- Rules are versioned in git and in the Firebase console.
- Rollback: `git checkout <prev> -- backend/firebase/rules/firestore.rules` then `firebase deploy --only firestore:rules --project <project>`; or re-release a previous version from the console. Rules default-deny, so a bad deploy fails closed (safer than open).

## Firestore indexes
- Additive; removing an index does not lose data. Revert `firestore.indexes.json` and redeploy. Index builds may take time — do not delete an index an active query depends on.

## Cloud Functions
- Functions are gen2, region `southamerica-east1`. Rollback: redeploy the previous git commit (`npm run deploy:firebase:<env>`). Keep the last known-good commit hash recorded per deploy.
- Secrets are unchanged by rollback; never rotate during rollback unless a secret is the incident.

## Service-area config / seed
- Seed is merge-only and idempotent; it never resets counters/pricing. Rollback = reseed the previous artifact version (`boundaryVersion`). Never hand-edit the operational polygon in the console.

## Data
- `walletTransactions` and `auditLogs` are immutable/append-only — never edited on rollback. Financial corrections use the admin wallet compensating-entry flow, not a data rollback.

## Sequence
1. Identify the concrete blocker (one traceId; see debugging doc).
2. Apply the smallest fix or revert the smallest artifact.
3. Redeploy only the failed component; verify with `verify:firebase:<env>`.
4. Record the incident + resolution.

## Backups
- Firestore scheduled export/backup: MANUAL VALUE REQUIRED (configure before production).
