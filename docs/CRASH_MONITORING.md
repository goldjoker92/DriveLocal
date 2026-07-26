# Crash and client-error monitoring

This block captures React render failures, unhandled JavaScript exceptions and
explicit non-fatal errors without copying arbitrary application state.

## Privacy invariant

A report may contain only:

```text
error name
redacted message and stack
route without query string
role
short ride/payment/trace references
app version
environment
platform
fatal/source/severity
```

Never add CPF, phone, email, Pix key, token, exact coordinates, complete UID,
complete ride/payment identifiers, raw provider payloads or arbitrary context.
The client applies an allow-list and redaction; the server repeats both checks.

## Normal React render failure

```text
[CLIENT_ERROR] report.requested
[CLIENT_ERROR] report.succeeded
```

The user sees a recovery screen with:

```text
TENTAR NOVAMENTE
VOLTAR AO INÍCIO
```

The original technical message and stack are never rendered to the user.

## Global JavaScript exception

```text
[CLIENT_ERROR] global_handler.installed
[CLIENT_ERROR] report.requested source=javascript_global
```

After scheduling the report, DriveLocal calls React Native's previous global
handler. Do not remove that call: swallowing the original handler would hide
fatal crashes and change normal React Native behavior.

## Report not sent

```text
[CLIENT_ERROR] report.not_sent reason=unauthenticated
[CLIENT_ERROR] report.failed code=<safe Firebase code>
[CLIENT_ERROR] report.skipped reason=duplicate_window
[CLIENT_ERROR] report.skipped reason=rate_limited
```

Reporting failure must never trigger another report or block the recovery UI.
An unauthenticated startup error remains visible in local device logs but is not
sent to the server, preventing an anonymous spam endpoint.

## Server storage

Authenticated reports are written by `reportClientErrorSecure` to the private
`clientErrorReports` collection. Direct application reads/writes remain denied by
the Firestore catch-all rule; the Admin SDK callable is the only write path.

The document ID groups the same actor and server fingerprint into a ten-minute
bucket. Repeated failures increment `occurrenceCount` and refresh `lastSeenAt`
instead of generating unlimited documents.

Normal structured logs contain fingerprint, route, version and short report
reference only. Message and stack stay in the private report document.

## Manual DEV verification

1. Pull `feat/prod-readiness-foundation` and run both automated suites.
2. Deploy Functions to `drivelocal-dev` only when explicitly authorized.
3. Temporarily throw an Error inside a DEV-only test component after login.
4. Confirm the recovery screen appears and both buttons respond.
5. Confirm the logs contain `report.requested` then `report.succeeded`.
6. Confirm one `clientErrorReports` document exists and its message is redacted.
7. Trigger the same failure twice inside 30 seconds and confirm the client skips
   the duplicate submission.
8. Trigger the same report later inside the same server ten-minute bucket and
   confirm `occurrenceCount` increments rather than creating a second document.
9. Remove the temporary test throw before committing or building an APK.

## Automated verification

```powershell
npm test
npm --prefix functions test
```

No lint or preview build is part of the agreed production gate.
