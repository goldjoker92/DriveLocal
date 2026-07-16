# Google Play Readiness

Verify against the live Play Console + current official Google Play / Expo docs before submitting — policies change. Nothing here is submitted.

## Application identity
- Application name: MANUAL VALUE REQUIRED (proposed "DriveLocal").
- Package: `com.drivelocal.app` — READY (do not change).
- Version (human): from `app.config.js`/`app.json` — confirm before release.
- versionCode: monotonically increasing; `eas.json` `appVersionSource: local` (managed in native/app config). Strategy: bump versionCode on every store build; tie to a git tag `vX.Y.Z(+build)`.
- Default language: pt-BR. Category / launch region (Brazil/Ceará) / developer account owner: MANUAL VALUE REQUIRED.

## Store listing (MANUAL VALUE REQUIRED unless noted)
- Title, short PT-BR description, full PT-BR description, release notes.
- Icon, feature graphic, phone screenshots (real DriveLocal branding pending from owner — do not generate).
- Support email, support URL, privacy-policy URL.

## Policy checklist
- Privacy policy: LEGAL REVIEW REQUIRED. Data Safety: draft in `data-safety-inventory.md` — LEGAL REVIEW REQUIRED.
- Account creation + deletion: see `account-deletion-plan.md` (in-app + external URL) — LEGAL REVIEW REQUIRED.
- Location usage (foreground during accepted ride; background NOT used unless a real feature requires it): declare precisely.
- Notifications (ride offers/status), camera/media (driver documents/selfie) usage declarations.
- Ads: none declared. Target audience / content rating: MANUAL VALUE REQUIRED.
- App access instructions + reviewer test accounts (below). Permissions declarations. Transport/marketplace classification. Payments policy: PLAY PAYMENTS POLICY REVIEW REQUIRED.

## EAS build profiles (`eas.json`)
- `development`: dev client, APK, internal, `APP_ENV=dev` (DEV Firebase). Preserved.
- `preview`: internal distribution, APK, `APP_ENV=dev` (added; no accidental prod backend).
- `production`: App Bundle, `APP_ENV=prod` (future prod Firebase), store distribution, no debug/mocks/embedded secrets.
- Do NOT run a build in this block. Current queued build reflects only its submitted commit/config.

## Android permissions (verify in native config before build)
- POST_NOTIFICATIONS (ride offers/status) — PT-BR: "Usamos notificações para avisar sobre corridas e atualizações."
- Foreground location during accepted ride — PT-BR: "Usamos sua localização durante a corrida para acompanhar o trajeto e a chegada."
- Camera/media only for driver document + selfie upload — PT-BR: "Usamos a câmera para enviar seus documentos e foto de perfil."
- Background location: NOT used unless truly required. Microphone: absent.

## Reviewer instructions (prepare; no real passwords committed)
- Passenger test account + driver test account (approved driver) — MANUAL VALUE REQUIRED.
- Test city: Horizonte-CE. Safe ride scenario inside the polygon; Pix shown as QR + copia-e-cola. Admin workflow only if required.

## Release sequence (confirm real requirements in Play Console)
Internal testing → closed testing (if required) → production rollout after verification.
