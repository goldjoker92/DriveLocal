# DriveLocal

> **Bilingual document — Document bilingue.** Each section is written in English (**EN**) and immediately followed by French (**FR**). Product/UI strings stay in Brazilian Portuguese on purpose.
>
> _Chaque section est rédigée en anglais (**EN**) puis suivie de sa traduction française (**FR**). Les libellés produit/UI restent en portugais brésilien volontairement._

---

## Project Overview — Vue d'ensemble

**EN:** DriveLocal is a local ride-hailing platform for small and medium cities, starting with Horizonte, Ceará, Brazil. It connects passengers with approved local drivers for moto and car rides. The product emphasizes simplicity, local trust, direct Pix payment, and a lower driver commission than large ride-hailing platforms.

**FR:** DriveLocal est une plateforme de VTC locale pour petites et moyennes villes, à commencer par Horizonte (Ceará, Brésil). Elle met en relation des passagers avec des chauffeurs locaux approuvés, en moto ou en voiture. Le produit met l'accent sur la simplicité, la confiance locale, le paiement direct par Pix et une commission chauffeur plus faible que les grandes plateformes.

---

## Product Vision — Vision produit

**EN:** Make local mobility feel premium and trustworthy in cities the big platforms underserve. Passengers get a fast, clear ride request and pay the driver directly by Pix. Drivers keep more of their earnings thanks to a low commission and a prepaid wallet model. The experience is mobile-first, calm, and credible — without copying any competitor's brand assets.

**FR:** Rendre la mobilité locale premium et digne de confiance dans des villes mal desservies par les grandes plateformes. Les passagers commandent une course rapide et claire et paient le chauffeur directement par Pix. Les chauffeurs conservent une plus grande part de leurs revenus grâce à une commission faible et un portefeuille prépayé. L'expérience est mobile-first, sobre et crédible — sans copier les éléments de marque d'un concurrent.

---

## MVP Scope — Périmètre du MVP

**EN:**
- Frontend Step 1 in progress / partially validated.
- Expo React Native app, Android-first, JavaScript / JSX only.
- UI is **mock-only**: no real auth, no real Google Auth, no real Pix processing, no real maps/GPS, no backend production logic.
- Service area limited to Horizonte (`HORIZONTE_CE_BR`) for V1.

**FR:**
- Frontend Step 1 en cours / partiellement validé.
- Appli Expo React Native, priorité Android, JavaScript / JSX uniquement.
- UI **mock uniquement** : pas d'auth réelle, pas de Google Auth réel, pas de traitement Pix réel, pas de cartes/GPS réels, pas de logique backend de production.
- Zone de service limitée à Horizonte (`HORIZONTE_CE_BR`) pour la V1.

---

## Business Model — Modèle économique

**EN:**
- **Monthly subscription:** Car driver R$19,90 / month; Moto driver R$9,90 / month.
- **Commission:** 15% per ride (moto and car), charged from the driver wallet.
- **Minimum ride price:** Moto R$5; Car R$8.
- **Founder promo** overrides commission/subscription during the promo period.

**FR:**
- **Abonnement mensuel :** voiture R$19,90 / mois ; moto R$9,90 / mois.
- **Commission :** 15 % par course (moto et voiture), prélevée sur le portefeuille du chauffeur.
- **Prix minimum :** moto R$5 ; voiture R$8.
- **Promo fondateur** : prime sur commission/abonnement pendant la période de promo.

---

## User Roles — Rôles utilisateurs

**EN:**
- **Passenger / Passageiro:** request a local ride quickly, pay the driver directly by Pix, avoid complex checkout, see clear ride status.
- **Driver / Motorista:** receive local ride requests, pay a lower commission, receive payment directly by Pix, manage a prepaid wallet for commission, benefit from the founder offer if among the first approved.
- **Admin / Operação:** approve/reject drivers, review documents, monitor rides and wallet balances, validate manual Pix top-ups, track the founder count, manage service-area operations.

**FR:**
- **Passager / Passageiro :** commander une course locale rapidement, payer le chauffeur directement par Pix, éviter un paiement complexe, suivre clairement le statut de la course.
- **Chauffeur / Motorista :** recevoir des demandes de courses locales, payer une commission plus faible, être payé directement par Pix, gérer un portefeuille prépayé pour la commission, profiter de l'offre fondateur s'il fait partie des premiers approuvés.
- **Admin / Operação :** approuver/refuser les chauffeurs, vérifier les documents, surveiller les courses et les soldes, valider les recharges Pix manuelles, suivre le compteur de fondateurs, gérer les opérations de la zone de service.

---

## Payment Model — Modèle de paiement

**EN:** V1 uses **direct Pix** from passenger to driver — no in-app card, no cash, no in-app Pix split. The passenger sees a Pix QR code / payment instructions in the mock flow. The app does **not** intercept passenger payment in V1; it only charges the 15% commission from the driver's prepaid wallet.

Wallet: prepaid, recharged via Pix, minimum top-up R$10. If balance ≤ R$3, the driver stops receiving new rides unless the founder promo is active. Transaction types: top-up requested, top-up approved, commission debited, adjustment, blocked/insufficient balance.

**FR:** La V1 utilise le **Pix direct** du passager au chauffeur — pas de carte intégrée, pas d'espèces, pas de split Pix intégré. Le passager voit un QR code Pix / des instructions de paiement dans le flux mock. L'appli n'intercepte **pas** le paiement passager en V1 ; elle prélève uniquement la commission de 15 % sur le portefeuille prépayé du chauffeur.

Portefeuille : prépayé, rechargé via Pix, recharge minimale R$10. Si le solde ≤ R$3, le chauffeur ne reçoit plus de nouvelles courses sauf si la promo fondateur est active. Types de transactions : recharge demandée, recharge approuvée, commission débitée, ajustement, bloqué/solde insuffisant.

---

## Founder Driver Offer — Offre chauffeur fondateur

**EN:** The first **100 admin-approved** drivers become "Motorista Fundador" (moto and car count together). Benefits: **0% commission** and **R$0 subscription for 60 days**. Founder status is assigned only after admin approval, and the count is tracked globally per service area.

**FR:** Les **100 premiers chauffeurs approuvés** par l'admin deviennent « Motorista Fundador » (moto et voiture comptés ensemble). Avantages : **0 % de commission** et **abonnement à R$0 pendant 60 jours**. Le statut fondateur n'est attribué qu'après approbation admin, et le compteur est suivi globalement par zone de service.

---

## Service Area Model — Modèle de zone de service

**EN:** The app must be scalable per service area, so future cities can be added without rewrites. Horizonte must **not** be hardcoded into business logic — use a `serviceArea` configuration instead. Pilot area:
- **ID:** `HORIZONTE_CE_BR`
- **City:** Horizonte — **State:** Ceará — **Country:** Brazil

MVP V1 is limited to Horizonte only.

**FR:** L'appli doit être extensible par zone de service, afin d'ajouter de futures villes sans réécriture. Horizonte ne doit **pas** être codée en dur dans la logique métier — utiliser une configuration `serviceArea`. Zone pilote :
- **ID :** `HORIZONTE_CE_BR`
- **Ville :** Horizonte — **État :** Ceará — **Pays :** Brésil

Le MVP V1 est limité à Horizonte uniquement.

---

## UX/UI Principles — Principes UX/UI

**EN:** Mobile-first, premium local-mobility feel. Inspired by product *principles* (not assets) from Uber, Bolt, 99, inDrive, Apple, Nubank, Revolut: map-first feeling, bottom-sheet action, clean Apple-like spacing, fintech-grade trust cards, strong CTA hierarchy, local trust signals, clear passenger-vs-driver motivation. Passenger CTA is primary; driver opportunity secondary but clear; admin access discreet; local anchoring shown as **Horizonte · CE**. Public UI never shows internal/technical labels.

Shape rules: cards `borderRadius` 22–24; buttons 16–18; pills/chips fully rounded; bottom sheets large rounded corners; generous spacing; calm premium UI. See `CLAUDE.md` for the full color palette.

**FR:** Mobile-first, ressenti d'une appli de mobilité locale premium. Inspiré des *principes* produit (pas des éléments de marque) d'Uber, Bolt, 99, inDrive, Apple, Nubank, Revolut : ressenti « carte d'abord », action en bottom-sheet, espacement épuré à la Apple, cartes de confiance dignes d'une fintech, hiérarchie de CTA forte, signaux de confiance locaux, motivation passager/chauffeur claire. CTA passager prioritaire ; offre chauffeur secondaire mais visible ; accès admin discret ; ancrage local **Horizonte · CE**. L'UI publique n'affiche jamais de libellés internes/techniques.

Règles de forme : cartes `borderRadius` 22–24 ; boutons 16–18 ; pills/chips totalement arrondis ; bottom sheets à grands coins arrondis ; espacement généreux ; UI premium et sobre. Voir `CLAUDE.md` pour la palette de couleurs complète.

---

## Technical Stack — Stack technique

**EN:**
- Expo React Native + Expo Router (file-based routing).
- JavaScript / JSX only — **no TypeScript files**.
- Android-first; web used for smoke testing and visual review.
- Expo SDK v56 — read the versioned docs at <https://docs.expo.dev/versions/v56.0.0/> before writing code.

**FR:**
- Expo React Native + Expo Router (routage par fichiers).
- JavaScript / JSX uniquement — **aucun fichier TypeScript**.
- Priorité Android ; web utilisé pour les tests rapides et la revue visuelle.
- Expo SDK v56 — lire la documentation versionnée sur <https://docs.expo.dev/versions/v56.0.0/> avant d'écrire du code.

---

## Current Frontend Status — État actuel du frontend

**EN:** Mock-only Step 1 UI. The landing page is accepted for now and should be kept as-is. The admin route stays discreet at `/admin-login`. No backend, auth, Pix processing, or maps/GPS are wired.

**FR:** UI Step 1 en mode mock uniquement. La landing page est acceptée pour l'instant et doit être conservée telle quelle. La route admin reste discrète sur `/admin-login`. Aucun backend, auth, traitement Pix ou cartes/GPS n'est branché.

---

## Planned Backend Architecture — Architecture backend prévue

**EN:** Planned but **not implemented**: Firebase Auth, Firestore, Firebase Storage, Cloud Functions (JavaScript, not TypeScript), Firebase Cloud Messaging, Firebase Security Rules.

Responsibilities: driver approval, founder assignment, wallet commission debit, wallet top-up approval, ride-lifecycle events, notifications, admin operational logs.

Planned Firestore collections: `serviceAreas`, `drivers`, `passengers`, `admins`, `rides`, `wallets`, `walletTransactions`, `driverDocuments`, `founderPromotions`, `topupRequests`, `adminLogs`, `notifications`.

Ride statuses: `requested`, `searching_driver`, `driver_assigned`, `driver_accepted`, `driver_arrived_pickup`, `passenger_onboard`, `in_progress`, `waiting_payment`, `payment_received`, `completed`, `cancelled`.

Driver statuses: `registered`, `onboarding_pending`, `documents_pending`, `pending_review`, `approved`, `rejected`, `suspended`.

Navigation/GPS: no in-app turn-by-turn in V1 — rides open Google Maps / Waze externally; every ride carries `pickup` and `destination` with `address`, `lat`, `lng`.

**FR:** Prévu mais **non implémenté** : Firebase Auth, Firestore, Firebase Storage, Cloud Functions (JavaScript, pas TypeScript), Firebase Cloud Messaging, Firebase Security Rules.

Responsabilités : approbation des chauffeurs, attribution du statut fondateur, débit de commission, approbation des recharges, événements du cycle de vie des courses, notifications, journaux opérationnels admin.

Collections Firestore prévues : voir la liste ci-dessus.

Statuts des courses et des chauffeurs : voir les listes ci-dessus.

Navigation/GPS : pas de navigation virage par virage intégrée en V1 — les courses ouvrent Google Maps / Waze en externe ; chaque course porte `pickup` et `destination` avec `address`, `lat`, `lng`.

---

## Main Routes — Routes principales

**EN:** (Expo Router, file-based; mock-only)
- `/` — landing page (passenger-first, driver opportunity, discreet admin link).
- `/select-route` — passenger destination / ride request (mock).
- `/onboarding` — driver onboarding entry (mock).
- `/admin-login` — discreet internal admin access.
- Route groups under `src/app/`: `(passenger)`, `(driver)`, `(admin)`, `(auth)`.

**FR :** (Expo Router, basé sur les fichiers ; mock uniquement)
- `/` — landing page (passager d'abord, offre chauffeur, lien admin discret).
- `/select-route` — destination passager / demande de course (mock).
- `/onboarding` — entrée d'onboarding chauffeur (mock).
- `/admin-login` — accès admin interne discret.
- Groupes de routes sous `src/app/` : `(passenger)`, `(driver)`, `(admin)`, `(auth)`.

---

## Development Commands — Commandes de développement

```bash
# Install dependencies / Installer les dépendances
npm install

# Start (Android-first) / Démarrer (priorité Android)
npx expo start

# Web smoke test / Test rapide web
npx expo start --web --clear
```

**EN:** Test in an incognito window if Chrome extension errors appear. JSHint / VS Code extension errors are not app errors. Do not run `npm run lint` or install packages without explicit approval.

**FR :** Tester en navigation privée si des erreurs d'extensions Chrome apparaissent. Les erreurs JSHint / extensions VS Code ne sont pas des erreurs d'appli. Ne pas exécuter `npm run lint` ni installer de paquets sans accord explicite.

---

## Known Limitations — Limitations connues

**EN:**
- Mock-only: no persistence, no real auth, no real Pix, no real maps/GPS.
- Single service area (Horizonte) in V1.
- No background location tracking and no in-app navigation engine.
- Web is for review only; the product is Android-first.

**FR:**
- Mock uniquement : pas de persistance, pas d'auth réelle, pas de Pix réel, pas de cartes/GPS réels.
- Une seule zone de service (Horizonte) en V1.
- Pas de suivi de localisation en arrière-plan ni de moteur de navigation intégré.
- Le web sert uniquement à la revue ; le produit est orienté Android.

---

## Roadmap — Feuille de route

**EN:**
1. **Step 1 (current):** mock-only landing + core screens, accepted for now.
2. **Auth screens (next, when approved):** passenger login, passenger create account, driver login, driver create account, admin login.
3. **Driver onboarding & documents** with admin approval flow.
4. **Backend (Firebase, when approved):** auth, Firestore data model, wallet/commission logic, founder assignment, ride lifecycle, notifications.
5. **External navigation handoff** (Google Maps / Waze) for active rides.
6. **Multi-service-area** expansion beyond Horizonte.

**FR:**
1. **Step 1 (actuel) :** landing + écrans clés en mock, acceptés pour l'instant.
2. **Écrans d'authentification (prochaine étape, après accord) :** connexion passager, création de compte passager, connexion chauffeur, création de compte chauffeur, connexion admin.
3. **Onboarding & documents chauffeur** avec flux d'approbation admin.
4. **Backend (Firebase, après accord) :** auth, modèle de données Firestore, logique portefeuille/commission, attribution fondateur, cycle de vie des courses, notifications.
5. **Relais de navigation externe** (Google Maps / Waze) pour les courses actives.
6. **Extension multi-zones** au-delà d'Horizonte.

---

> See `CLAUDE.md` for the full set of working rules and constraints for AI-assisted development.
> _Voir `CLAUDE.md` pour l'ensemble des règles et contraintes de développement assisté par IA._
