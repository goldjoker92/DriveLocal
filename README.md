# DriveLocal

DriveLocal is a local ride-hailing MVP starting in **Horizonte, Ceará, Brazil**.

**Positioning:** _"Uber-level trust, local MVP simplicity."_

DriveLocal is built to be:

- **Local-first** — focused on one service area before expanding.
- **Android-first** for Passenger and Driver — the mobile app is the product.
- **Browser/web reserved for Admin operations** — not a passenger/driver channel.
- **Simple before complex** — focus the existing payments and tracking flows on the pilot.
- **Direct payment** — the passenger pays the driver directly by Pix.
- **Sustainably monetized** — DriveLocal earns commission on paid rides after each driver's 60-day launch period.

> **Release status:** This repository includes Firebase Functions, Firestore rules, Mercado Pago wallet recharges, and ride tracking. Their presence in source does not imply that this branch has been deployed or that the Android release has passed physical testing.

---

## 1. Overview

DriveLocal connects passengers with verified local drivers for moto and car rides in a single pilot city. The passenger confirms the server-calculated fare before a ride is created and pays the driver directly by Pix. DriveLocal charges commission on paid rides after the driver's first 60 days. V1 runs in Horizonte only.

| Item | Decision |
| --------------------- | ------------------------------------- |
| Pilot city | Horizonte, Ceará, Brazil |
| Service area ID | `HORIZONTE_CE_BR` |
| Product type | Local ride-hailing MVP |
| Passenger platform | Android app / mobile-first |
| Driver platform | Android app / mobile-first |
| Admin platform | Browser/web dashboard |
| Main payment model | Passenger pays Driver directly by Pix |
| Platform monetization | Commission on paid rides after 60 days |
| Backend | Firebase Functions and Firestore source implemented; rollout pending validation |
| Current priority | Simple market-ready MVP |

---

## 2. Product positioning

DriveLocal is **not** an over-engineered Uber clone. It aims to deliver cheaper rides for passengers, better net earnings for drivers, verified local drivers, direct Pix payment, admin-controlled operations, and an architecture that scales by service area.

| Promise | Meaning |
| ---------------------- | -------------------------------------------------------- |
| Cheaper for passengers | Transparent local pricing and no heavy platform overhead |
| Better for drivers | Lower commission and direct Pix payment |
| Local trust | Verified drivers, vehicle identity, admin approval |
| Simple MVP | Build only what is needed to test the market |
| Scalable | Service-area model for future cities |

---

## 3. Platform scope

| Actor | Platform | MVP decision |
| ---------------------- | ---------------- | ------------------------------------------------------------------- |
| Passenger / Passageiro | Android app | Mobile-first ride request, price, driver info, Pix payment |
| Driver / Motorista | Android app | Ride acceptance, navigation via Maps/Waze, Pix confirmation, wallet |
| Admin / Operação | Browser/web | Driver approval, documents, wallet/top-ups, rides, fraud review |
| Expo Web | Development only | Smoke testing and visual review, not passenger/driver product scope |

- Do **not** build passenger web/PWA flows for the MVP.
- Do **not** build driver web/PWA flows for the MVP.
- Browser product scope is **Admin only**.

---

## 4. Actors and responsibilities

| Actor | Main goal | Core responsibilities |
| ---------------------- | ---------------------------- | -------------------------------------------------------------------------------------- |
| Passenger / Passageiro | Request safe local rides | Choose route, see price, identify driver, pay by Pix, rate ride |
| Driver / Motorista | Earn from local rides | Register, get approved, accept rides, navigate, receive Pix, maintain Saldo DriveLocal |
| Admin / Operação | Control trust and operations | Approve drivers, validate documents, manage wallets/top-ups, review fraud |

---

## 5. Passenger / Passageiro

| Category | Rules |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| Product rules | Passenger must see price before confirming; passenger must see verified driver identity after acceptance |
| Business rules | Passenger pays Driver directly by Pix; Passenger does not pay DriveLocal in V1 |
| Payment rules | QR Code Pix is primary; Pix Copia e Cola is fallback; passenger should not manually type driver Pix key |
| Safety rules | Passenger should pay only through the QR Code displayed in DriveLocal; off-platform payment is a fraud/safety risk |
| Technical rules | Passenger app is Android/mobile-first; Expo Web only for testing |
| App files   | `src/app/(passenger)/select-route.jsx`, `confirm-price.jsx`, `driver-accepted.jsx`, `pix-payment.jsx`, `ride-completed.jsx` |

**Passenger safety copy (PT-BR):**

> _"Para sua segurança, pague somente pelo QR Code exibido no DriveLocal. Não envie Pix para outra chave informada fora do app."_

---

## 6. Driver / Motorista

| Category | Rules |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| Product rules | Driver must register, submit profile/vehicle/docs, and wait for admin approval before receiving rides |
| Business rules | 0% for 60 days from approval, then 12% Moto or 15% Carro on paid rides; cancellations carry no commission |
| Payment rules | Driver receives ride payment directly from Passenger by Pix; Driver pays DriveLocal by recharging Saldo DriveLocal |
| Wallet rules | Saldo DriveLocal is an internal prepaid balance, **not** a bank account |
| Safety rules | Driver must use only the Pix key registered and validated in DriveLocal |
| Technical rules | Driver app is Android/mobile-first; navigation uses Google Maps/Waze |
| App files   | `src/app/(driver)/onboarding.jsx`, `profile.jsx`, `documents.jsx`, `active-ride.jsx`, `wallet.jsx` |

**Driver warning copy (PT-BR):**

> _"Use apenas a chave Pix cadastrada e validada no DriveLocal. Solicitar pagamento por outra chave pode gerar bloqueio."_

---

## 7. Admin / Operação

| Category | Rules |
| --------------- | ------------------------------------------------------------------------------------------------------------------- |
| Product rules | Admin validates drivers, documents, vehicles, top-ups, ride issues, and fraud signals |
| Business rules | Admin approval activates driver status and founder eligibility; approval does not debit commission |
| Payment rules | Verified provider callbacks credit wallet recharges; Admin handles exceptions |
| Fraud rules | Admin reviews suspicious cancellations, off-platform payment signals, duplicate accounts |
| Technical rules | Admin platform is browser/web; admin routes should stay separate from passenger/driver flows |
| App files   | `src/app/(admin)/dashboard.jsx`, `drivers-pending.jsx`, `driver-detail.jsx`, `topups-pending.jsx`, `wallets.jsx`, `reports.jsx` |

The admin entry route is kept discreet at `/admin-login` and must not collide with a public `/login`.

---

## 8. Business model

| Revenue item | Rule |
| ---------------------------- | ------------------------------------------- |
| Ride commission | 0% for 60 days from approval, then 12% Moto or 15% Carro for paid rides |
| Passenger payment | Passenger pays Driver directly by Pix |
| Driver payment to DriveLocal | Driver recharges Saldo DriveLocal by Pix |
| Minimum ride price Moto | R$5,00 |
| Minimum ride price Carro | R$7,50 |
| Card payment | Not in V1 |
| Cash payment | Not in V1 |
| Pix split | Not in V1 |

---

## 9. Founder driver offer

| Driver group | Commission | Recognition |
| ----------------------------- | ----------------------------- | -------------------------------------- |
| Drivers #1–100 admin-approved | 0% for 60 days, then 12% Moto or 15% Carro | Permanent Motorista Fundador badge |
| Drivers #101 onward | 0% for 60 days, then 12% Moto or 15% Carro | Standard driver |

- The founder counter is based on **admin-approved** drivers, not registrations.
- Moto and Carro drivers count together.
- An app update never restarts the 60-day period.

---

## 10. Pix and Saldo DriveLocal

DriveLocal V1 has **two separate Pix flows**.

| Flow | Who pays | Who receives | Purpose |
| ------------------- | --------- | ------------ | ------------------------------------------- |
| Passenger → Driver | Passenger | Driver | Ride payment |
| Driver → DriveLocal | Driver | DriveLocal | Wallet recharge for ride commission |

### Passenger → Driver Pix

- QR Code Pix is the **primary** flow.
- Pix Copia e Cola is the **fallback**.
- The passenger does **not** manually type the Pix key.
- The QR Code should include the ride amount when possible.
- The driver must use the **registered/validated** Pix key only.

### Driver → DriveLocal Pix

- The driver recharges **Saldo DriveLocal**.
- Saldo DriveLocal is **not** a bank account — it is an internal prepaid ledger.
- Real money goes to DriveLocal via Pix.
- A verified Mercado Pago callback credits the driver's internal balance once.

**Example flow:**

| Step | Example |
| ---------------- | ----------------------------------- |
| Driver recharge | Carlos sends R$20 Pix to DriveLocal |
| Provider confirmation | A verified webhook confirms top-up |
| Internal balance | Carlos has R$20 Saldo DriveLocal |
| Ride completed | Passenger pays Carlos R$20 |
| Carro commission after day 60 | 15% = R$3 |
| Wallet debit | Carlos balance becomes R$17 |

The payment webhook and wallet ledger are implemented in Functions; production rollout still requires validation.

---

## 11. Saldo DriveLocal rules

| Rule | Value |
| ------------------- | ------------------------------------------------- |
| Minimum recharge | R$10 |
| Low balance warning | Around R$7 |
| General block | Saldo DriveLocal ≤ R$3 |
| Per-ride block | Saldo DriveLocal < estimated commission |
| Commission rate after day 60 | 12% Moto / 15% Carro |
| Initial period | No commission wallet block during every approved driver's 60 days at 0% |

**Per-ride commission coverage formula:**

```
estimatedCommission = estimatedRidePrice * (12% Moto or 15% Carro)
```

A driver past the 60-day window can accept a ride only if their available wallet balance covers the server-held estimate.

| Ride price | Moto (12%) | Carro (15%) |
| ---------- | ---------: | ----------: |
| R$20 | R$2,40 | R$3,00 |
| R$30 | R$3,60 | R$4,50 |
| R$40 | R$4,80 | R$6,00 |

**Driver-facing copy after the first 60 days (PT-BR):**

> _"Mantenha seu Saldo DriveLocal acima de R$3,00 para continuar recebendo corridas."_
>
> _"Para algumas corridas, o app pode solicitar um saldo maior para cobrir a taxa estimada da plataforma."_

---

## 12. Trust, safety, and anti-fraud

| Risk | Rule / response |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| Driver asks for another Pix key | Fraud signal |
| Fake cancellation after contact | Admin review |
| Repeated cancellations same pair | Fraud flag |
| Duplicate driver account | Check WhatsApp, email, CNH, plate, Pix key |
| Off-platform ride | Warning, suspension, financial review or account action after admin review |

Trust foundations:

- Verified drivers only (no rides before admin approval).
- Driver photo and vehicle info.
- Vehicle plate.
- Driver rating, or **"Novo motorista verificado"** for new drivers.
- Admin review before any sanction.

---

## 13. Navigation and live map

| Feature | MVP decision |
| -------------------------------- | ----------------------------------- |
| Driver navigation | Google Maps/Waze |
| Internal turn-by-turn navigation | Not in V1 |
| Passenger live map | Planned during accepted/active ride |
| Background tracking | Not in V1 unless approved |
| Location sharing | Only during accepted/active ride |

DriveLocal does not replace Google Maps/Waze in V1; the driver navigates with external apps while the passenger map exists for trust, visibility, and ride status.

---

## 14. Roadmap / iterations

| Iteration | Focus | Main actors |
| --------- | -------------------------------------------------- | ------------------------ |
| 0 | Documentation and landing lock | All |
| 1 | Driver onboarding + Admin approval + Founder rules | Driver, Admin |
| 2 | Passenger ride request + transparent price | Passenger |
| 3 | Driver accepted + trust card + live map MVP | Passenger, Driver |
| 4 | Active ride flow | Passenger, Driver |
| 5 | Wallet / commission MVP | Driver, Admin |
| 6 | Anti-fraud and cancellation review | Admin, Driver, Passenger |
| 7 | Firebase backend later | All |

**Recommended next major build:** Iteration 1 — Driver onboarding + Admin approval + Founder rule + basic anti-duplicate identity checks. DriveLocal must first build trusted local supply; passengers only trust the app when drivers are verified, visible, and admin-approved.

---

## 15. Tech stack

| Area | Decision |
| ----------------------- | ---------------------------------- |
| Framework | Expo React Native |
| Routing | Expo Router |
| Language | JavaScript / JSX only |
| Passenger/Driver target | Android-first |
| Admin target | Browser/web |
| Backend | Firebase planned later |
| Cloud Functions | JavaScript planned later |
| TypeScript | Not used |
| Payments | Pix planned; no PSP automation yet |

**Firebase — planned later (not implemented yet):**

- Auth
- Firestore
- Storage
- Cloud Functions (JavaScript)
- Security Rules
- Firebase Cloud Messaging (later)

> Backend, Firebase, Pix automation, wallet automation, and live tracking are **planned and not implemented** unless they are present in the codebase and have been explicitly approved.

---

## Android build strategy

DriveLocal uses **two Android build tracks** — nothing else.

| Build type | Purpose | Target users |
| ----------------------------------- | -------------------------------------------------- | ------------------------------- |
| Development Build / Expo Dev Client | Developer testing on a real Android phone | Project owner / developer |
| Production Build | Real-world installable app for field usage/testing | selected drivers and passengers |

### Development Build

The Development Build is used during active development.

Purpose:

- test DriveLocal on a real Android phone
- validate navigation
- validate screens
- test mobile behavior
- reproduce real device issues

This is similar to the previous VigiApp testing workflow using Expo Dev Build / Expo Dev Client.

### Production Build

The Production Build is used when DriveLocal needs to be tested or used in real-world conditions with selected drivers/passengers.

Purpose:

- install the real app on Android devices
- test with real local users
- test with real drivers
- validate the MVP in Horizonte-CE

**Important:**

- Production Build does **not** mean public Play Store release immediately.
- Public Play Store release must wait until MVP validation.
- Do **not** configure Play Store release, public distribution, production signing, or store deployment until explicitly approved.

### No preview track

Do **not** use a separate "preview APK" concept in DriveLocal documentation. The project only distinguishes:

1. **Development Build** for development testing.
2. **Production Build** for real-world usage/testing.

### Branding assets

Official DriveLocal branding assets are **pending** and will be provided by the project owner:

- DriveLocal logo
- app icon
- splash screen
- optional dark/light logo versions
- favicon for Admin web

Do **not** generate or replace official branding assets unless explicitly approved.

---

## V1 production-field plan (validated)

DriveLocal V1 is moving from a frontend-only mock toward a **real production-field MVP with controlled scope**. The goal is **not** a public Play Store launch — it is a controlled real-world build for **selected drivers** (and later selected passengers) in Horizonte-CE. Core positioning (`"Uber-level trust, local MVP simplicity."`) and all non-negotiable constraints are unchanged.

**Firebase is now approved for the real V1 foundation — in scoped phases only:**

| Phase | Scope | Notes |
| ------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Iteration 1A | Firebase project setup, Auth (email/password first), Firestore `drivers`, persistent verification statuses, admin pending-list + driver detail, real approve/reject, simple founder calc, basic duplicate warnings (CPF, phone, plate, Pix key) | No notifications required |
| Iteration 1B | Firebase Storage, real uploads (document, selfie/profile, CNH, CRLV, vehicle photo), admin view + manual approve/reject | No biometrics, no facial/auto doc verification |

**Excluded from Firebase V1 (until explicitly approved):** Cloud Functions (unless approved for a specific use), Pix API, PSP integration, wallet automation, commission-debit automation, automatic bank reconciliation, public Play Store release, multi-city launch, complex ride matching before passenger/ride iterations.

**Backend folder** (`backend/`) holds Firebase configuration and is **preparation/foundation only** — no secrets; security rules **start closed by default** and are opened progressively with explicit approval.

**Milestones:** MVP 1 (driver supply: Auth, driver records, statuses, approve/reject, founder rule, duplicate warnings — no notifications) → MVP 1B (verification: Storage uploads, documents, selfie, manual admin validation) → MVP 2 (passenger demand: ride request, transparent price, service-area polygon validation) → MVP 3 (real ride dispatch: minimal notifications, dispatch waves, accept/reject, trust card, external Maps/Waze navigation).

**Service area:** V1 operates only in Horizonte-CE (`HORIZONTE_CE_BR`). The boundary must be a GPS **polygon/multipolygon** (pickup and destination inside it for strict V1), with a ~50–100 m border buffer used **only** as GPS/address tolerance — not a commercial expansion. Borderline points (e.g. Horizonte/Pacajus) require manual pin confirmation; neighboring cities become separate service areas later.

**Notifications:** not required for the driver/admin onboarding MVP (Iteration 1A) — the driver opens the app and sees status copy. Minimal push notifications are required only for the later real ride MVP (e.g. "Nova corrida disponível", "Motorista aceitou sua corrida", "Motorista chegou ao local", "Corrida cancelada").

> See [`CLAUDE.md`](./CLAUDE.md) §3bis for the full validated V1 decisions, including the future ride-dispatch wave model and the per-status driver verification model.

---

## 16. Current status

| Item | Status |
| ----------------------------- | ------------------- |
| Landing page | Accepted for now |
| Frontend structure | Exists |
| Admin web scope | Planned/structured |
| Passenger/Driver mobile scope | Android-first |
| Backend (Firebase) | Approved for V1 foundation — scoped phases (1A/1B); config files are foundation only, not implemented |
| Real Pix integration | Not implemented yet |
| Wallet automation | Not implemented yet |
| PSP/webhooks | Not implemented yet |

---

## 17. Development

```bash
npm install
npx expo start
npx expo start --web --clear
```

- Expo Web is for **smoke testing / visual review** only.
- Use an incognito window if browser extensions cause errors.
- Do **not** treat browser-extension errors as app errors.

---

## 18. Repository rules

| Rule | Decision |
| ------------- | ----------------------------------------------- |
| Secrets | Never commit secrets |
| Language | JavaScript/JSX only |
| TypeScript | Do not add |
| Backend | Do not implement without approval |
| Firebase | Planned later |
| Payments | No real Pix/PSP implementation without approval |
| Scope control | Keep MVP simple and market-ready |

---

> For the full bilingual (EN/FR) product, business, technical, UX, and anti-fraud context that guides development and AI-assisted sessions, see [`CLAUDE.md`](./CLAUDE.md).
