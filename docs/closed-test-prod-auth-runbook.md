# Closed test — Firebase PROD access gate

This runbook is the mandatory path before publishing a new DriveLocal closed-test AAB.

## What the guarded workflow changes

The workflow `.github/workflows/closed-test-prod-backend.yml`:

- verifies that every credential targets `drivelocal-prod`;
- enables Email/Password authentication when it is disabled;
- enables end-user signup when it is disabled;
- deploys the exact committed Firebase Functions;
- deploys the exact committed Firestore rules and indexes;
- deploys the exact committed Storage rules;
- seeds the canonical Horizonte public configuration without resetting operational data;
- proves that the Google Play package and app-signing SHA-1 are accepted by the production API key;
- creates fresh passenger and driver accounts through the public Auth API;
- writes and reads the exact role profiles under production Firestore rules;
- deletes the temporary profiles and Auth users with the protected service account.

It does **not** copy DEV users, rides, wallets, payments, counters or secrets into PROD.

## Required GitHub production secrets

Configure these in the protected GitHub environment named `production`:

- `FIREBASE_SERVICE_ACCOUNT_DRIVELOCAL_PROD`
- `GOOGLE_SERVICES_JSON_DRIVELOCAL_PROD`
- `ANDROID_APP_SIGNING_SHA1`
- `PROD_AUTH_SMOKE_EMAIL_TEMPLATE`
- `PROD_AUTH_SMOKE_PASSWORD`

`ANDROID_APP_SIGNING_SHA1` must be the SHA-1 from **Google Play Console → App integrity → App signing key certificate**, not the local upload-key SHA-1.

`PROD_AUTH_SMOKE_EMAIL_TEMPLATE` must contain `{{RUN_ID}}`, for example:

```text
qa+drivelocal-{{RUN_ID}}@your-test-domain.example
```

The test mailbox/domain must accept unique addresses generated from that template.

## Required service-account permissions

The production service account must be allowed to:

- read and update Firebase Auth project configuration;
- delete the temporary Firebase Auth users;
- deploy Firebase Functions, Firestore rules/indexes and Storage rules;
- seed and delete the temporary Firestore documents.

The workflow stops before publishing anything when these permissions or secrets are missing.

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
