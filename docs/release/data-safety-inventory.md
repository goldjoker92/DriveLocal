# Data Safety Inventory (Play Data Safety draft)

Built from actual code/schema. Legal classification is **LEGAL/PRIVACY REVIEW REQUIRED** — this is not a compliance statement. No legal claim is automatic.

| Category | Collected | Purpose | Required | User | Storage | Access | Retention | Deletion | Sharing | Likely Play class |
|---|---|---|---|---|---|---|---|---|---|---|
| Name / display name | Yes | Account, ride trust card | Req | Both | Firestore | Owner + admin | Account life | On deletion (audit exception) | None | Personal info |
| Email | Yes | Auth, contact | Req | Both | Firebase Auth + Firestore | Owner + admin | Account life | On deletion | None | Personal info |
| WhatsApp / phone | Yes | Contact, verification | Req | Both | Firestore | Owner + admin | Account life | On deletion | None | Personal info |
| CPF | Yes | Driver identity/anti-fraud | Req (driver) | Driver | `privateDriverData` (server-only) | Admin/backend | Account life + legal | Restricted (fraud/legal retention) | None | Personal / gov id |
| Driver documents (CNH/CRLV/photos) | Yes | Verification | Req (driver) | Driver | Firebase Storage (protected) | Admin/backend | Account life + legal | Restricted | None | Personal docs |
| Vehicle data | Yes | Matching, trust card | Req (driver) | Driver | Firestore | Owner + admin | Account life | On deletion | Shown to matched passenger | App activity |
| Precise location | Yes | Geofence, dispatch, live ride | Req during ride | Both | Firestore (ride/driver) | Backend + ride parties | Ride record retention | Anonymized on deletion | Between ride parties | Location (precise) |
| Ride history | Yes | Operations, disputes, audit | Req | Both | Firestore `rideRequests` | Backend + parties + admin | Financial/audit retention | Anonymized (financial exception) | None | App activity |
| Payment metadata (wallet top-up and retained past payments) | Yes | Wallet and financial retention | Req (driver) | Driver | Firestore + Mercado Pago | Backend + admin | Financial retention | Retained (financial/legal) | Mercado Pago (processor) | Financial info |
| Pix key/owner | Yes | Direct ride payment | Req (driver) | Driver | `privateDriverData` (server-only) | Backend/admin | Account life | Restricted | Shown as QR to passenger at pay time | Financial info |
| Wallet / commission ledger | Yes | Platform fees | Req (driver) | Driver | `walletTransactions` (server-only, immutable) | Backend/admin | Financial/audit retention | Retained (immutable ledger) | None | Financial info |
| Notification (FCM) token | Yes | Push notifications | Req | Both | `notificationTokens` (server-only) | Backend | Until logout/invalid | Deleted/disabled on logout/deletion | Google FCM | Device id |
| Device / app metadata | Yes | Diagnostics | Optional | Both | Logs | Backend | Short | N/A | None | App info/diagnostics |
| Logs / diagnostics | Yes | Debug, security | — | Both | Cloud Logging | Backend | Short-medium | N/A (masked) | None | Diagnostics |

## Notes
- Server-only collections (`privateDriverData`, `walletTransactions`, `auditLogs`, `notificationTokens`) are never client-readable (Firestore Rules).
- Logs never contain coordinates, addresses, route polylines, CPF, Pix, tokens, or secrets.
- Mercado Pago processes wallet recharges only. Ride payment is direct passenger→driver Pix (no processor holds ride money).
- Financial and audit records have retention exceptions to account deletion — LEGAL REVIEW REQUIRED.
