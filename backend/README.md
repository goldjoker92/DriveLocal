# DriveLocal Backend

This folder is reserved for Firebase backend configuration and future backend assets.
It is **preparation / foundation only**. These files must **never** contain secrets,
API keys, service-account JSON, or credentials.

Firebase is approved for the real V1 foundation, but **only in scoped phases**.

## Iteration 1A — driver/admin foundation

- Firebase project setup
- Firebase Auth (email/password first)
- Firestore `drivers` collection
- Persistent driver verification statuses
- Admin pending-drivers list (from Firestore)
- Admin driver detail (from Firestore)
- Real approve/reject flow
- Simple founder calculation
- Basic duplicate warnings (CPF, phone, vehicle plate, Pix key)
- No notifications required

## Iteration 1B — verification / file uploads

- Firebase Storage
- Real uploads: driver document, selfie/profile photo, CNH, CRLV / vehicle document, vehicle photo (if needed)
- Admin can view submitted files and approve/reject manually
- No biometric verification, no facial recognition, no automatic document-verification provider

## Security rules policy

- Rules **start closed by default** (`allow read, write: if false`).
- They are opened **progressively, with explicit approval**, as each phase is implemented.
- No secrets are stored in this folder.

## Not included yet (until explicitly approved)

- Cloud Functions (unless approved for a specific use)
- Pix API / PSP integration
- Wallet automation / commission-debit automation
- Automatic bank reconciliation
- Notifications (required only for the later real ride MVP, not for onboarding)
- Real ride matching / dispatch
- Public Play Store release
- Multi-city production launch
