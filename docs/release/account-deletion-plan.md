# Account Deletion Plan

Prepared, not implemented as a callable in this block. **LEGAL/PRIVACY REVIEW REQUIRED** for retention exceptions. No real accounts deleted.

## Requirements
- In-app deletion request (passenger + driver) from the profile screen.
- External deletion URL for Play listing (Google requires a web route): MANUAL VALUE REQUIRED.
- Reauthentication before deletion (Firebase Auth recent-login).
- Backend-authoritative deletion callable (future): validates identity, runs the workflow, writes an immutable deletion audit record.

## Workflow (proposed)
1. User requests deletion; reauthenticate.
2. Backend anonymizes/removes personal identifiers: name, email, phone/WhatsApp, CPF, documents (Storage), Pix key/owner, precise location, device/FCM tokens.
3. **Retention exceptions (do NOT delete):** immutable `walletTransactions` and `auditLogs`, and financial/dispute records required for legal, tax, security and anti-fraud purposes — de-identified where possible.
4. Ride history de-identified (drop personal fields; keep aggregate/financial references).
5. Disable Auth account; disable/remove FCM tokens.
6. Write an immutable `auditLogs` record of the deletion (no PII).

## Blockers / decisions
- Exact retention windows: LEGAL REVIEW REQUIRED.
- Web deletion URL + hosting: MANUAL VALUE REQUIRED.
- PT-BR user explanation copy: draft — _"Ao excluir sua conta, seus dados pessoais são removidos ou anonimizados. Alguns registros financeiros e de segurança são mantidos pelo período exigido por lei."_
