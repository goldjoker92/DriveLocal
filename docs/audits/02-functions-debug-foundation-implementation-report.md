# BLOCK 02 — functions-debug-foundation — Implementation Report

- **Block id:** 02-functions-debug-foundation
- **Date:** 2026-07-14
- **Branch:** `feature/block-02-functions-debug-foundation`
- **Status:** COMPLETE (with one documented, acceptable blocker: emulator smoke NOT RUN — see below)
- **Deploy status:** NOT DEPLOYED

## 1. Objective

Create only the Firebase Cloud Functions JavaScript foundation: structured
logging, stable errors, boundary validation, time/determinism, an idempotency
foundation, an append-only audit-log writer, explicit environment + secret-name
handling, a safe diagnostic function, and deterministic backend tests. No
Mercado Pago, driver approval, wallet, ride acceptance, notifications, or
Firestore rule changes.

## 2. Functions structure

```
functions/
  package.json            (own deps + lockfile; engines node 20)
  package-lock.json
  .gitignore              (node_modules, .firebase)
  jest.config.js          (testEnvironment: node)
  src/
    index.js              (admin init once; exports health)
    config/
      environment.js      (explicit env resolver, fail-closed)
      secrets.js          (secret NAMES only)
      collections.js      (idempotencyOperations, auditLogs)
      emulatorGuard.js    (assertEmulator / isEmulatorConfigured)
    errors/
      appError.js         (AppError + stable codes + PT-BR + callable mapping)
      boundary.js         (single callable error boundary)
    logging/
      logger.js           (traceId, context, recursive redaction, measureDuration)
    validation/
      validators.js       (small explicit boundary validators)
    time/
      clock.js            (systemClock, fixedClock, serverTimestamp, durationMs)
    idempotency/
      idempotency.js      (fingerprint + acquire/complete/recordFailure)
    audit/
      auditLog.js         (append-only writer)
    diagnostics/
      healthHandler.js    (pure, testable handler)
      health.js           (v2 callable wrapper)
    __tests__/            (9 suites; helpers/fakeFirestore.js)
```

Decision: functions use **CommonJS** in their **own package** (isolated deps +
lockfile), and their **own jest** (`testEnvironment: node`), separate from the
app's `jest-expo` (React Native) preset. The root jest now ignores `/functions/`
so the two suites never cross-contaminate.

## 3. Node runtime & generation

- Runtime: **Node 20** (`functions/package.json` engines).
- Generation: **Firebase Functions v2 (gen 2)** — `firebase-functions/v2/https` `onCall`, region `southamerica-east1`.

## 4. Dependencies added (functions/package.json only)

| Package | Type | Reason |
|---|---|---|
| `firebase-admin ^13` (13.10.0) | runtime | Firestore access + `FieldValue.serverTimestamp` |
| `firebase-functions ^6` (6.6.0) | runtime | v2 callables + official structured logger |
| `jest ^29` (29.7.0) | dev | deterministic Node test runner (isolated from the app's jest-expo) |

Not installed: TypeScript, ESLint, Prettier, Express, Zod, Mercado Pago SDK, notification packages.

## 5. Structured logging / event format

Official `firebase-functions/logger`. Every entry is built from a logger context
+ eventName and passed through redaction. Fields: `severity`, `traceId`,
`eventName`, `functionName`, `environment`, `actorType`, `actorUid`, plus safe
event metadata (`rideId`, `driverId`, `offerId`, `paymentRequestId`,
`providerOrderId`, `result`, `errorCode`, `durationMs`, ...). Helpers:
`createTraceId`, `createLoggerContext`, `logInfo/logWarning/logError`,
`measureDuration`, `redactSensitiveData`.

## 6. Redaction policy

Recursive, deterministic, non-mutating. Sensitive keys (case-insensitive
substring) are replaced with `[REDACTED]`: access tokens, authorization, generic
token, fcm token, webhook secret / secret, password, verification code / otp,
cpf/cnpj/cnh/rg/identity, phone/telefone/whatsapp, email, pix key, address,
raw/provider payload. Dates → ISO; Errors → `[Error: name]` (no stack). Depth-limited.

## 7. Stable error codes

`UNAUTHENTICATED, FORBIDDEN, ADMIN_REQUIRED, INVALID_ARGUMENT,
INVALID_STATE_TRANSITION, CONFIGURATION_MISSING, IDEMPOTENCY_CONFLICT,
INTERNAL_ERROR, PROVIDER_TIMEOUT, PROVIDER_UNAVAILABLE`. Each maps to a safe
PT-BR client message and a callable (HttpsError) status. Unknown throwables →
`INTERNAL_ERROR`. `toClient()` never includes stack/internalCause/internalMessage.

## 8. Validation coverage

Small explicit validators: `assertShape` (required + unknown-field rejection for
sensitive payloads), `validateNonEmptyString`, `validateIdentifier` (no slash,
bounded), `validateEnum`, `validatePositiveCentavos` / `validateNonNegativeCentavos`
(reject NaN/Infinity/float/negative), `validateTimestampMs`,
`validateIdempotencyKey`. Validators never mutate the payload.

## 9. Idempotency design

`idempotencyOperations/{idempotencyKey}` with states `started`, `completed`,
`failed_retryable`, `failed_final`. `fingerprintPayload` = SHA-256 of a canonical
(recursively sorted-key) payload, excluding identifiers and secret-ish keys →
deterministic, order-independent, secret-free. `acquireOperation` runs in a
Firestore transaction: creates `started`, replays `completed` (same fingerprint),
or throws `IDEMPOTENCY_CONFLICT` on fingerprint/type mismatch.
`completeOperation` / `recordFailure` update state. No wallet/MP logic.

## 10. Audit-log schema

`auditLogs/{autoId}` append-only: `actorUid, actorType, action, targetType,
targetId, reason?, beforeSummary (redacted), afterSummary (redacted), traceId,
createdAtMs, createdAt (serverTimestamp)`. Required fields enforced (fail closed);
reason required for `wallet_manual_adjustment`, `founder_benefit_override`,
`payment_reprocess`, `dispute_resolution`. Summaries are redacted deep copies
(inputs never mutated). Helper only appends; failed writes throw.

## 11. Environment & secret-name handling

`resolveEnvironment` is explicit (never NODE_ENV): emulator detection →
project-id mapping (`drivelocal-dev`→development, `drivelocal-prod`→production) →
APP_ENV must not contradict. Unknown project id / missing config throws
`CONFIGURATION_MISSING`; unknown is NEVER defaulted to production. `secrets.js`
exposes NAMES only (`MERCADO_PAGO_ACCESS_TOKEN_TEST/PROD`,
`MERCADO_PAGO_WEBHOOK_SECRET_TEST/PROD`); dev/emulator → TEST names, production →
PROD names. No secret value is read, printed, or committed.

## 12. Diagnostic function behavior

Callable `health` (v2). Pure `healthHandler` returns only `status, environment,
functionVersion, serverTimeMs, serverTimeIso, traceId`. **Disabled in production
by default** (throws FORBIDDEN) — no unrestricted public production diagnostic.
Never returns secrets, env vars, Firebase config, or data.

## 13. Commands executed & exit codes

| Command | Exit |
|---|---|
| `npm install --prefix functions` | 0 |
| `npm test --prefix functions` (functions suite) | 0 — 50 passed, 1 skipped |
| `npm test` (root app suite) | 0 — 45 passed |
| `npx expo-doctor` | 0 — 21/21 |
| `firebase emulators:exec --only functions,firestore ...` | **1 — NOT RUN (Java 21 required; JDK 17 installed)** |
| `git diff --check` | 0 |

## 14. Emulator / smoke result

**NOT RUN.** Blocker: `firebase-tools@15.14.0` requires **JDK ≥ 21**; the machine
has **JDK 17** (`Error: firebase-tools no longer supports Java version before 21`).
No software was installed. Backend logic is fully covered by 50 deterministic
unit tests using an in-memory fake Firestore; the emulator-gated integration test
(`integration.emulator.test.js`) stays skipped and is deferred to BLOCK 04, which
owns full emulator coverage. Recommended fix: install a JDK ≥ 21 for the emulator.

## 15. Security review

- Financial/infra collections (`idempotencyOperations`, `auditLogs`) are
  server-only by design; **Firestore rules unchanged this block** — BLOCK 04 will
  enforce server-only access.
- Secrets: names only; no values anywhere; no service-account file.
- Errors: no stack/cause returned to the client; unknown → INTERNAL_ERROR.
- Logs: recursive redaction of secrets/PII; structured logger only.
- Diagnostic: disabled in production by default.
- Tests: integration paths fail closed without `FIRESTORE_EMULATOR_HOST`.

## 16. Known limitations

- Emulator smoke deferred (JDK 21 needed).
- No Firestore rules for the new server-only collections yet (BLOCK 04).
- Idempotency/audit helpers are foundations; no financial operation uses them yet.
- Diagnostic has no admin-gated production mode yet (intentionally disabled in prod).

## 17. Deploy status

**NOT DEPLOYED.** No push, no merge, no Firebase deploy.

## 18. Recommendation for BLOCK 04

Proceed to BLOCK 04 (Firestore security) next per the sequence. BLOCK 04 must add
server-only rules for `idempotencyOperations` and `auditLogs`, keep the
`rideRequests` containment, and — once a JDK ≥ 21 is available — implement the
Firestore Rules emulator test coverage that was deferred here.
