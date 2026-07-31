# Closed test — Firebase PROD access gate

This runbook is the mandatory path before publishing a new DriveLocal closed-test AAB.

## What the guarded workflow changes

The workflow `.github/workflows/closed-test-prod-backend.yml` deploys the exact committed versions of:

- Firebase Functions
- Firestore rules
- Firestore indexes
- Storage rules
- canonical Horizonte public configuration

It then creates fresh passenger and driver email/password accounts in `drivelocal-prod`, writes and reads their exact Firestore role profiles, and cleans the temporary documents and Auth users.

It does **not** copy DEV users, rides, wallets, payments, counters or secrets into PROD.

## Required GitHub production secrets

Configure these in the protected GitHub environment named `production`:

- `FIREBASE_SERVICE_ACCOUNT_DRIVELOCAL_PROD`
- `GOOGLE_SERVICES_JSON_DRIVELOCAL_PROD`
- `PROD_AUTH_SMOKE_EMAIL_TEMPLATE`
- `PROD_AUTH_SMOKE_PASSWORD`

`PROD_AUTH_SMOKE_EMAIL_TEMPLATE` must contain `{{RUN_ID}}`, for example:

```text
qa+drivelocal-{{RUN_ID}}@your-test-domain.example
```

The test mailbox/domain must accept unique addresses generated from that template.

## Firebase console prerequisite

In project `drivelocal-prod`, Firebase Authentication must have **Email/Password** enabled. The smoke gate fails with `EMAIL_PASSWORD_PROVIDER_DISABLED` when it is disabled.

## How to run

1. Merge the reviewed pull request into `main`.
2. Open GitHub Actions.
3. Select **Closed test - deploy Firebase PROD**.
4. Run the workflow from `main`.
5. Enter `DRIVELOCAL_PRODUCTION` as the confirmation.
6. Do not build or upload the AAB unless the workflow ends green.

## Required final device check

After the workflow is green, install the closed-test build from Google Play and verify on a real device:

1. create a brand-new passenger account;
2. log out and log back in;
3. create a brand-new driver account;
4. log out and log back in;
5. confirm both role profiles exist in `drivelocal-prod`.

The release is blocked if any of these steps fails.
