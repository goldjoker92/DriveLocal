@AGENTS.md

# DriveLocal — Master Context for Claude Code

> **Bilingual document — Document bilingue.** Narrative/rules are written in English (**EN**) then French (**FR**). Language-neutral artifacts (file paths, route maps, Firestore collection names, shell commands) and Brazilian-Portuguese product/UI strings are kept **once** and not translated.
>
> _Document bilingue. Le texte et les règles sont en anglais (**EN**) puis en français (**FR**). Les éléments neutres (chemins de fichiers, routes, noms de collections Firestore, commandes shell) et les libellés produit/UI en portugais brésilien sont conservés **une seule fois** et non traduits._

---

## 1. Project Mission — Mission du projet

**EN:** DriveLocal is a local ride-hailing platform starting in Horizonte, Ceará, Brazil. The goal is **not** to copy Uber as a full technical system. The goal is a simple, market-ready local MVP that delivers: cheaper rides for passengers, better net earnings for drivers, local trust, direct Pix payment from passenger to driver, lower commission than big platforms, admin-controlled operations, and architecture scalable by service area.

Core product promise: **"Uber-level trust, local MVP simplicity."**

DriveLocal must feel: local, safe, simple, cheaper for passengers, more profitable for drivers, and serious enough for real market testing.

The user explicitly wants to avoid the mistake made with VigiApp: **overbuilding complexity before validating the market.**

**FR:** DriveLocal est une plateforme de VTC locale démarrant à Horizonte (Ceará, Brésil). L'objectif n'est **pas** de copier Uber comme système technique complet. L'objectif est un MVP local simple et prêt pour le marché qui offre : des courses moins chères pour les passagers, de meilleurs revenus nets pour les chauffeurs, de la confiance locale, un paiement Pix direct du passager au chauffeur, une commission plus faible que les grandes plateformes, des opérations contrôlées par l'admin, et une architecture extensible par zone de service.

Promesse produit centrale : **« Confiance niveau Uber, simplicité d'un MVP local. »**

DriveLocal doit donner une impression : locale, sûre, simple, moins chère pour les passagers, plus rentable pour les chauffeurs, et assez sérieuse pour un vrai test de marché.

L'utilisateur veut explicitement éviter l'erreur de VigiApp : **trop construire de complexité avant de valider le marché.**

---

## 2. Non-Negotiable Technical Constraints — Contraintes techniques non négociables

**EN:**
- Expo React Native; Android-first; **JavaScript / JSX only** — never introduce TypeScript.
- Expo Router. Firebase planned. Cloud Functions must be JavaScript, not TypeScript.
- Keep code simple, readable, debuggable; avoid over-engineered abstractions.
- Do **not** install packages, run `npm run lint`, or proceed to backend without explicit approval.
- Do **not** modify unrelated files.
- Avoid mojibake / corrupted characters such as `â`. If an edit preview shows mojibake, **do not apply it.**

**FR:**
- Expo React Native ; priorité Android ; **JavaScript / JSX uniquement** — ne jamais introduire TypeScript.
- Expo Router. Firebase prévu. Les Cloud Functions doivent être en JavaScript, pas en TypeScript.
- Garder un code simple, lisible, déboguable ; éviter les abstractions sur-conçues.
- Ne **pas** installer de paquets, lancer `npm run lint`, ni passer au backend sans accord explicite.
- Ne **pas** modifier de fichiers non concernés.
- Éviter le mojibake / caractères corrompus comme `â`. Si un aperçu de modification montre du mojibake, **ne pas l'appliquer.**

---

## 3. Current Project Status — État actuel du projet

**EN:** Frontend Step 1. The landing page is **accepted for now**, mobile-first and premium enough for Step 1. Do **not** redesign the landing page without explicit approval.

Current landing direction: DriveLocal wordmark, "Horizonte · CE" pill, hero copy, fake map/mobility visual, passenger CTA, driver founder card, discreet admin access.

Admin route decision: keep admin route at `/admin-login`. Do **not** create another public admin login route that collides with `/login`.

**FR:** Frontend Step 1. La landing page est **acceptée pour l'instant**, mobile-first et assez premium pour le Step 1. Ne **pas** la redessiner sans accord explicite.

Direction actuelle de la landing : logo texte DriveLocal, pastille « Horizonte · CE », accroche, visuel de fausse carte/mobilité, CTA passager, carte fondateur chauffeur, accès admin discret.

Décision sur la route admin : conserver `/admin-login`. Ne **pas** créer une autre route de connexion admin publique qui entrerait en collision avec `/login`.

Current known landing files / Fichiers de landing connus:
```
src/app/index.jsx
src/components/MobileShell.jsx
src/components/MockMapCard.jsx
src/components/TrustChip.jsx
```

---

## 3bis. DriveLocal V1 — Validated Production-Field MVP Decisions / Décisions validées du MVP de terrain V1

> **EN:** This section captures the validated V1 plan and **takes precedence** over older notes where they conflict. DriveLocal V1 is moving from a frontend-only mock toward a **real production-field MVP with controlled scope**. The goal is **not** a public Play Store launch — it is a real-world, controlled field build for **selected drivers** (and later selected passengers) in Horizonte-CE. Core positioning is unchanged: **"Uber-level trust, local MVP simplicity."** All non-negotiable constraints in §2 still apply (Expo RN, Expo Router, Android-first for Passenger/Driver, Admin browser/web, JavaScript/JSX only, no TypeScript, keep code simple, don't overbuild, no Pix/wallet automation or Uber-like matching before the driver/admin foundation is ready).
>
> **FR:** Cette section décrit le plan V1 validé et **prévaut** sur les notes antérieures en cas de conflit. La V1 de DriveLocal passe d'un mock front-only vers un **vrai MVP de terrain à périmètre contrôlé**. L'objectif n'est **pas** une publication publique sur le Play Store — c'est un build de terrain réel et contrôlé pour des **chauffeurs sélectionnés** (puis des passagers sélectionnés) à Horizonte-CE. Le positionnement central est inchangé : **« Confiance niveau Uber, simplicité d'un MVP local. »** Toutes les contraintes non négociables du §2 s'appliquent encore.

### A. Firebase decision — now approved in scoped phases / décision Firebase — approuvée par phases

**EN:** Firebase is now **explicitly approved** for the real V1 foundation, but **only in scoped phases**. Do not jump ahead of the current phase.

**Iteration 1A (driver/admin foundation):**
- Firebase project setup
- Firebase **Auth with email/password first**
- Firestore `drivers` collection
- persistent driver verification statuses
- admin **pending drivers list** from Firestore
- admin **driver detail** from Firestore
- real **approve/reject** flow
- simple founder calculation
- basic **duplicate warnings** for CPF, phone, vehicle plate, Pix key

**Iteration 1B (verification / file uploads):**
- Firebase **Storage**
- real driver document upload, selfie/profile photo upload, CNH upload, CRLV / vehicle document upload, vehicle photo upload if needed
- admin can **view** submitted files and **approve/reject manually**
- **no** biometric verification, **no** facial recognition, **no** automatic document-verification provider

**Firebase V1 exclusions (do NOT do until explicitly approved):** no Cloud Functions until explicitly approved for a specific use; no Pix API; no PSP integration; no wallet automation; no commission-debit automation; no automatic bank reconciliation; no Play Store public release; no multi-city production launch; no complex ride matching before the passenger/ride iterations.

**FR:** Firebase est désormais **explicitement approuvé** pour la vraie fondation V1, mais **uniquement par phases**. Ne pas anticiper la phase en cours.
- **Itération 1A (fondation chauffeur/admin) :** setup du projet Firebase ; **Auth e-mail/mot de passe d'abord** ; collection Firestore `drivers` ; statuts de vérification persistants ; **liste admin des chauffeurs en attente** depuis Firestore ; **détail chauffeur** depuis Firestore ; vrai flux **approuver/refuser** ; calcul fondateur simple ; **avertissements de doublon** de base pour CPF, téléphone, plaque, clé Pix.
- **Itération 1B (vérification / uploads) :** Firebase **Storage** ; upload réel des documents, du selfie/photo de profil, de la CNH, du CRLV / document du véhicule, de la photo du véhicule si besoin ; l'admin peut **voir** les fichiers et **approuver/refuser manuellement** ; **pas** de biométrie, **pas** de reconnaissance faciale, **pas** de fournisseur de vérification automatique de documents.
- **Exclusions V1 (interdit sans accord explicite) :** pas de Cloud Functions tant qu'un usage précis n'est pas approuvé ; pas d'API Pix ; pas d'intégration PSP ; pas d'automatisation de portefeuille ; pas d'automatisation du débit de commission ; pas de réconciliation bancaire automatique ; pas de publication publique Play Store ; pas de lancement multi-villes ; pas de matching complexe avant les itérations passager/course.

### B. Backend folder decision / décision dossier backend

**EN:** The repository now contains a `backend/` folder reserved for Firebase configuration and future backend assets. These files are **preparation / foundation only** — they must **not** contain secrets. Security rules **start closed by default** (`allow read, write: if false`) and are opened **progressively, with explicit approval**, as each phase is implemented.
```
backend/README.md
backend/firebase/rules/firestore.rules
backend/firebase/rules/storage.rules
backend/firebase/indexes/firestore.indexes.json
```

**FR:** Le dépôt contient désormais un dossier `backend/` réservé à la configuration Firebase et aux futurs éléments backend. Ces fichiers sont **préparation / fondation uniquement** — ils ne doivent **pas** contenir de secrets. Les règles de sécurité **démarrent fermées par défaut** (`allow read, write: if false`) et s'ouvrent **progressivement, avec accord explicite**, au fur et à mesure de chaque phase.

### C. Driver / Admin V1 foundation / fondation chauffeur-admin V1

**EN:** The first production-field foundation must validate **trusted local driver supply**. Build driver/admin onboarding first.

Driver onboarding required data / Données requises à l'onboarding chauffeur:
```
fullName, displayName, whatsApp, email, cpf,
vehicleType: moto | car,
serviceAreaId: HORIZONTE_CE_BR,
pixKeyType, pixKey,
selfie/profile photo, CNH, CRLV / vehicle document, vehicle photo (if needed),
vehiclePlate, vehicleBrand, vehicleModel, vehicleColor
```

Driver verification statuses / Statuts de vérification (persistent):
```
verificationStatus: draft | pending_review | approved | rejected | suspended
```
Verification sub-statuses / Sous-statuts:
```
profileStatus:        incomplete | complete
vehicleStatus:        incomplete | complete
documentsStatus:      missing | submitted | approved | rejected
selfieStatus:         missing | submitted | approved | rejected
duplicateCheckStatus: clear | warning | blocked
```
Admin approval fields / Champs d'approbation admin:
```
reviewedAt, reviewedBy, rejectionReason,
approvalNumber, founderEligible, founderGrantedAt, founderExpiresAt,
statusHistory
```

**FR:** La première fondation de terrain doit valider une **offre locale de chauffeurs de confiance**. Construire d'abord l'onboarding chauffeur/admin (données, statuts et champs ci-dessus, conservés une seule fois).

### D. Founder rule (validated, unchanged) / règle fondateur (validée, inchangée)

**EN:** The founder counter is based on **admin-approved** drivers (not registrations); moto and car count together; founder is **service-area based**. The first **100 admin-approved** drivers in `HORIZONTE_CE_BR` are **Motoristas Fundadores** → 0% commission for 60 days + R$0 subscription for 60 days. Drivers **#101 onward** → standard **15% commission from the first completed ride** + R$0 subscription for the first 60 days. **No commission is taken at driver approval.** Founder benefits can be removed after confirmed fraud via admin review.

**FR:** Le compteur fondateur se base sur les chauffeurs **approuvés par l'admin** (pas les inscriptions) ; moto et voiture comptés ensemble ; fondateur **par zone de service**. Les **100 premiers approuvés** dans `HORIZONTE_CE_BR` sont **Motoristas Fundadores** → 0 % pendant 60 jours + abonnement R$0 pendant 60 jours. Les chauffeurs **#101+** → **15 % dès la première course terminée** + abonnement R$0 les 60 premiers jours. **Aucune commission n'est prélevée à l'approbation.** Les avantages fondateur peuvent être retirés après fraude confirmée en revue admin.

### E. Notifications decision / décision notifications

**EN:** Distinguish clearly by phase.
- **Driver/Admin onboarding MVP (Iteration 1A): push notifications are NOT required.** The driver simply opens the app and sees status: "Cadastro em andamento", "Aguardando aprovação", "Motorista aprovado", "Cadastro recusado", "Documento pendente".
- **Real ride MVP (passenger + driver): minimal notifications ARE required** — without them a driver will not reliably know a ride request arrived if the app is closed or the phone is locked. Minimum future ride notification scope: driver "Nova corrida disponível"; passenger "Motorista aceitou sua corrida"; passenger "Motorista chegou ao local"; passenger/driver "Corrida cancelada". Driver/admin status notifications may come later (not first priority).
- **Do NOT implement notifications in Iteration 1A.** Document them as required for the future ride MVP, not for onboarding.

**FR:** Distinguer clairement par phase.
- **MVP onboarding chauffeur/admin (Itération 1A) : les notifications push ne sont PAS requises.** Le chauffeur ouvre l'app et voit son statut (libellés PT-BR ci-dessus).
- **MVP course réelle (passager + chauffeur) : des notifications minimales SONT requises** — sans elles, un chauffeur ne saura pas de façon fiable qu'une demande est arrivée si l'app est fermée ou le téléphone verrouillé. Périmètre minimal futur : chauffeur « Nova corrida disponível » ; passager « Motorista aceitou sua corrida » ; passager « Motorista chegou ao local » ; passager/chauffeur « Corrida cancelada ». Les notifications de statut chauffeur/admin viendront plus tard (pas la priorité).
- **Ne PAS implémenter de notifications en Itération 1A.** Les documenter comme requises pour le futur MVP course, pas pour l'onboarding.

### F. Ride dispatch model — future ride MVP (document, do NOT implement now) / modèle de dispatch — futur MVP course (documenter, NE PAS implémenter)

**EN:** This is the approved MVP dispatch model for the later passenger/ride MVP. **Do NOT implement during Iteration 1A.**

Driver eligibility for dispatch: admin approved; available; in the correct service area; correct vehicle type; not already in a ride; not suspended; recent location; wallet/saldo rules later when the wallet is implemented.

Dispatch model:
- Prioritize the **nearest eligible available driver** first; do not wait forever for the nearest.
- Try up to **2 nearby drivers sequentially** within ~1 km, then expand by progressive waves: ~2.5 km → ~5 km → emergency wider range ~8 km or the whole service area.
- Automatic search lasts **~70–90 seconds**, then show the passenger "Continuar procurando"; extended search stays **~3 minutes maximum**.
- Do **not** re-offer the same ride to a driver who rejected or expired it.
- Penalize stale locations.
- After repeated missed ride offers, temporarily mark the driver **unavailable** until they tap available again.
- Use **transactional locking** so only one driver can accept a ride.

**FR:** Modèle de dispatch MVP approuvé pour le futur MVP passager/course. **Ne PAS implémenter en Itération 1A.** Éligibilité chauffeur : approuvé admin ; disponible ; bonne zone de service ; bon type de véhicule ; pas déjà en course ; non suspendu ; localisation récente ; règles de portefeuille plus tard. Modèle : privilégier le **chauffeur éligible disponible le plus proche** ; essayer jusqu'à **2 chauffeurs proches en séquence** dans ~1 km, puis vagues progressives ~2,5 km → ~5 km → ~8 km/zone entière ; recherche auto **~70–90 s** puis « Continuar procurando » ; recherche étendue **~3 min max** ; ne pas re-proposer une course à un chauffeur qui l'a refusée/expirée ; pénaliser les localisations périmées ; après plusieurs offres manquées, marquer le chauffeur **indisponible** jusqu'à réactivation ; **verrouillage transactionnel** pour qu'un seul chauffeur accepte.

### G. Service area / polygon decision / zone de service & polygone

**EN:** DriveLocal V1 operates **only** in Horizonte-CE (`serviceAreaId: HORIZONTE_CE_BR`). Do not hardcode Horizonte everywhere — use service-area configuration. The V1 boundary must be a **polygon/multipolygon** from an official or curated source, and the service-area check must be based on **GPS coordinates**, not only address text.

Rules:
- Pickup must be **inside** the `HORIZONTE_CE_BR` polygon.
- Destination must be **inside** the polygon for the strict first V1.
- A border buffer of ~50–100 m may be used **only** as technical tolerance for GPS/address imprecision — it is **not** a commercial expansion area.
- A point clearly outside Horizonte is outside V1 service area.
- A point very close to the boundary requires **manual pin confirmation**.
- For a street on the Horizonte/Pacajus border, accept the ride only if the confirmed pin is inside the Horizonte polygon; if the pin is on the Pacajus side, show out-of-area for V1.
- Future expansion: Pacajus / other neighbors become **separate service areas** later, never ad-hoc exceptions inside Horizonte logic.

PT-BR copy — out of area: _"Ainda não atendemos esta área. No momento o DriveLocal funciona apenas em Horizonte."_ Borderline confirmation: _"Este ponto está muito perto do limite de Horizonte. Confirme o local exato no mapa."_

Suggested future service-area structure / Structure future suggérée — `serviceAreas/{serviceAreaId}`:
```
id, name, city, state, country, active, center, boundary, borderBufferMeters,
allowedVehicleTypes,
rules.pickupMustBeInside, rules.destinationMustBeInside, rules.allowBorderlineManualConfirm
```

**FR:** La V1 fonctionne **uniquement** à Horizonte-CE (`serviceAreaId: HORIZONTE_CE_BR`). Ne pas coder Horizonte en dur partout — utiliser la configuration de zone. La frontière V1 doit être un **polygone/multipolygone** d'une source officielle ou curée, et la vérification doit se baser sur les **coordonnées GPS**, pas seulement le texte d'adresse. Règles : prise en charge **dans** le polygone ; destination **dans** le polygone pour la première V1 stricte ; tampon de bordure ~50–100 m **uniquement** comme tolérance technique (pas une zone d'expansion commerciale) ; point clairement hors Horizonte = hors zone ; point très proche de la limite = **confirmation manuelle du pin** ; rue à la frontière Horizonte/Pacajus acceptée seulement si le pin confirmé est dans le polygone Horizonte, sinon hors-zone V1 ; expansion future : Pacajus/voisins deviennent des **zones de service séparées**, jamais des exceptions ad hoc. (Copies PT-BR et structure ci-dessus.)

### H. Production-field build strategy & milestones / stratégie de build de terrain & jalons

**EN:** "Production Build" means a **controlled real-world installable build for selected users**, **not** a public Play Store release (see also the Android Build Strategy section). Validated milestones:
- **MVP 1 / Driver supply:** Firebase Auth; Firestore driver records; persistent statuses; admin approve/reject; founder rule; duplicate warnings; **no notifications required**.
- **MVP 1B / Verification:** Storage uploads; documents; selfie; admin manual validation.
- **MVP 2 / Passenger demand:** passenger ride request; transparent price; service-area polygon validation; no complex dispatch yet if not ready.
- **MVP 3 / Real ride dispatch:** minimal notifications required; dispatch waves; driver accept/reject; passenger trust card; Google Maps/Waze external navigation.

**FR:** « Production Build » = build installable réel **contrôlé pour utilisateurs sélectionnés**, **pas** une publication Play Store publique (voir aussi la section Stratégie de build Android). Jalons validés : **MVP 1 / Offre chauffeur** (Auth, records Firestore, statuts, approuver/refuser, fondateur, doublons, **aucune notification requise**) ; **MVP 1B / Vérification** (uploads Storage, documents, selfie, validation manuelle admin) ; **MVP 2 / Demande passager** (demande de course, prix transparent, validation polygone de zone, pas de dispatch complexe si pas prêt) ; **MVP 3 / Dispatch réel** (notifications minimales requises, vagues de dispatch, accept/refus chauffeur, carte de confiance passager, navigation externe Google Maps/Waze).

### I. Pix rule (unchanged) / règle Pix (inchangée)

**EN:** Passenger pays the driver directly by Pix; DriveLocal does **not** hold passenger ride money in V1; no Pix automation until explicitly approved; no card; no cash; no Pix split in V1.

**FR:** Le passager paie le chauffeur directement par Pix ; DriveLocal ne **détient pas** l'argent de la course en V1 ; pas d'automatisation Pix sans accord explicite ; pas de carte ; pas d'espèces ; pas de split Pix en V1.

### J. Do NOT build yet / NE PAS construire pour l'instant

**EN / FR — do not build yet:** wallet automation; Pix automation; PSP integration; Cloud Functions unless specifically approved; public Play Store release; production multi-city rollout; biometric verification; facial recognition; complex anti-fraud ML; full Uber-like matching; heavy background tracking; passenger/driver web flows; notification system during Iteration 1A.

---

## 4. Service Area Model — Modèle de zone de service

**EN:** DriveLocal must be local-first but scalable. MVP V1 operates only in Horizonte. Do **not** hardcode Horizonte into business logic everywhere — use a `serviceArea` configuration so future cities are addable without rewriting core logic.

**FR:** DriveLocal doit être local d'abord mais extensible. Le MVP V1 ne fonctionne qu'à Horizonte. Ne **pas** coder Horizonte en dur partout dans la logique métier — utiliser une configuration `serviceArea` pour pouvoir ajouter de futures villes sans réécrire le cœur.

Pilot area / Zone pilote:
- `serviceAreaId: HORIZONTE_CE_BR`
- city: Horizonte — state: Ceará — country: Brazil

Planned files / Fichiers prévus:
```
src/constants/serviceAreas.js
src/constants/serviceAreaIds.js
src/config/serviceAreas.js   (or equivalent)
```

---

## 5. Actors — Acteurs

**EN:** Three main actors: Passenger / Passageiro, Driver / Motorista, Admin / Operação.

- **Passenger** wants: a cheaper local ride, clear price before confirming, verified driver identity, driver photo, vehicle details, plate, driver rating, live map of the approaching driver, Pix direct payment, safety and traceability.
- **Driver** wants: more net earnings, fewer platform fees, local demand, direct Pix payment, clear commission rules, founder promotion if eligible, simple onboarding, a clear approval process, Google Maps/Waze navigation, fair anti-fraud rules.
- **Admin** wants: approve/reject drivers, verify documents, prevent duplicate driver accounts, track founder count, manage service-area operations, monitor rides and cancellations, review suspicious activity, validate wallet top-ups, manage commission/wallet logic.

**FR:** Trois acteurs principaux : Passager / Passageiro, Chauffeur / Motorista, Admin / Operação.

- **Le passager** veut : une course locale moins chère, un prix clair avant de confirmer, l'identité vérifiée du chauffeur, sa photo, les détails du véhicule, la plaque, la note du chauffeur, une carte en direct du chauffeur qui approche, le paiement Pix direct, sécurité et traçabilité.
- **Le chauffeur** veut : plus de revenus nets, moins de frais de plateforme, de la demande locale, le paiement Pix direct, des règles de commission claires, la promo fondateur s'il est éligible, un onboarding simple, un processus d'approbation clair, la navigation Google Maps/Waze, des règles anti-fraude justes.
- **L'admin** veut : approuver/refuser les chauffeurs, vérifier les documents, empêcher les comptes chauffeurs en double, suivre le compteur de fondateurs, gérer les opérations de la zone, surveiller courses et annulations, examiner les activités suspectes, valider les recharges, gérer la logique commission/portefeuille.

---

## 6. Business Model — Modèle économique

**EN:**
- **Passenger payment:** passenger pays the driver directly by Pix. No in-app card, no cash, no Pix split in V1. DriveLocal does **not** hold passenger money in V1.
- **Commission:** standard 15% per **completed** ride, charged to the driver from the DriveLocal balance / wallet. Not taken at approval; due only on rides performed through the platform.
- **Subscription:** Moto driver R$9,90/month; Car driver R$19,90/month.
- **Minimum ride price:** Moto R$5; Carro R$8.

**FR:**
- **Paiement passager :** le passager paie le chauffeur directement par Pix. Pas de carte intégrée, pas d'espèces, pas de split Pix en V1. DriveLocal ne **détient pas** l'argent du passager en V1.
- **Commission :** 15 % standard par course **terminée**, prélevée au chauffeur sur le solde / portefeuille DriveLocal. Non prélevée à l'approbation ; due uniquement sur les courses réalisées via la plateforme.
- **Abonnement :** moto R$9,90/mois ; voiture R$19,90/mois.
- **Prix minimum :** moto R$5 ; voiture R$8.

---

## 7. Founder Promotion Rule — Règle de promotion fondateur

**EN:** The first **100 admin-approved** drivers are "Motoristas Fundadores". The counter is based on admin-approved drivers — registration alone does not count. Moto and car count together. Founder status is **service-area based**.

- Drivers approved **#1–#100:** 0% commission for 60 days; R$0 subscription for 60 days.
- Drivers approved **#101 onward:** 15% commission from the first ride; R$0 subscription for the first 60 days.
- **After 60 days:** standard 15% commission applies; subscription applies (Moto R$9,90/month, Carro R$19,90/month).
- **Fraud consequence:** founder benefit can be removed if fraud is confirmed after admin review.

**FR:** Les **100 premiers chauffeurs approuvés par l'admin** sont « Motoristas Fundadores ». Le compteur se base sur les chauffeurs approuvés par l'admin — la simple inscription ne compte pas. Moto et voiture comptés ensemble. Le statut fondateur est **par zone de service**.

- Chauffeurs approuvés **n°1 à n°100 :** 0 % de commission pendant 60 jours ; abonnement R$0 pendant 60 jours.
- Chauffeurs approuvés **à partir du n°101 :** 15 % de commission dès la première course ; abonnement R$0 les 60 premiers jours.
- **Après 60 jours :** commission standard de 15 % ; abonnement applicable (moto R$9,90/mois, voiture R$19,90/mois).
- **Conséquence fraude :** l'avantage fondateur peut être retiré si une fraude est confirmée après revue admin.

Planned files / Fichiers prévus:
```
src/constants/founderRules.js
src/services/founderService.js
functions/index.js                                  (later)
Firestore: founderCounters  OR  serviceAreas/{id}/counters/founders
```

---

## 8. Wallet / Saldo DriveLocal — Portefeuille

**EN:** Use user-facing language "Saldo DriveLocal" or "Créditos DriveLocal". Avoid making the driver feel charged before working.

Driver explanation (PT-BR): _"Você recebe o pagamento da corrida diretamente do passageiro por Pix. O Saldo DriveLocal é usado apenas para pagar a taxa da plataforma quando uma corrida é concluída."_

Rules: no commission at approval; for standard drivers, commission is debited from the wallet after a completed ride. Recommended later: commission **hold** when ride accepted, final **debit** on completion, **release** hold on legitimate cancellation, **admin review** on suspicious cancellation. Minimum top-up R$10. Standard drivers must keep balance > R$3 to receive new rides. Founder drivers in the free-commission period are not blocked by the wallet rule; after the free period ends, the wallet rule applies.

**FR:** Utiliser le langage destiné à l'utilisateur « Saldo DriveLocal » ou « Créditos DriveLocal ». Éviter de donner au chauffeur le sentiment d'être facturé avant de travailler.

Explication chauffeur (PT-BR) : voir ci-dessus.

Règles : pas de commission à l'approbation ; pour les chauffeurs standard, la commission est débitée du portefeuille après une course terminée. Recommandé plus tard : **réservation** de commission à l'acceptation, **débit** final à la fin, **libération** en cas d'annulation légitime, **revue admin** en cas d'annulation suspecte. Recharge minimale R$10. Les chauffeurs standard doivent garder un solde > R$3 pour recevoir de nouvelles courses. Les fondateurs en période de commission gratuite ne sont pas bloqués par la règle de portefeuille ; après la période gratuite, la règle s'applique.

Planned files / Fichiers prévus:
```
src/app/(driver)/wallet.jsx
src/components/WalletCard.jsx
src/services/walletService.js
src/constants/walletRules.js
Firestore: wallets, walletTransactions, topupRequests
```

---

## Pix and Saldo DriveLocal — Money Flow / Flux d'argent

> **EN:** DriveLocal V1 has **two separate Pix flows**: (1) the passenger pays the driver directly, and (2) the driver pays DriveLocal through "Saldo DriveLocal". This whole section is **planned business rule only** — do not implement Pix, wallet logic, commission debit, backend, PSP integration, webhooks, automatic reconciliation, or real payment logic until explicitly approved.
>
> **FR:** La V1 de DriveLocal a **deux flux Pix distincts** : (1) le passager paie le chauffeur directement, et (2) le chauffeur paie DriveLocal via le « Saldo DriveLocal ». Toute cette section est une **règle métier planifiée uniquement** — ne pas implémenter Pix, la logique de portefeuille, le débit de commission, le backend, l'intégration PSP, les webhooks, la réconciliation automatique ni de logique de paiement réelle avant accord explicite.

### 1. Passenger pays Driver directly / Le passager paie le chauffeur directement

**EN:** The passenger pays the driver directly by Pix.
- The passenger does **not** pay DriveLocal for the ride in V1.
- The passenger does **not** manually type the driver's Pix key during a ride.
- Passenger payment uses **Pix QR Code** as the primary flow; **Pix Copia e Cola** is the fallback.
- The QR Code should include the ride amount when possible.
- The passenger sees: ride amount, driver short name, verified driver badge, ride reference / short ride ID, QR Code Pix, "Copiar código Pix" button.
- Driver rule: the driver must use **only** the Pix key registered and validated in DriveLocal. Asking the passenger to pay another Pix key outside the app is a **fraud signal**.

**FR:** Le passager paie le chauffeur directement par Pix.
- Le passager ne paie **pas** DriveLocal pour la course en V1.
- Le passager ne saisit **pas** manuellement la clé Pix du chauffeur pendant une course.
- Le paiement passager utilise le **QR Code Pix** comme flux principal ; le **Pix Copia e Cola** est le repli.
- Le QR Code doit inclure le montant de la course si possible.
- Le passager voit : montant, prénom du chauffeur, badge chauffeur vérifié, référence / ID court de course, QR Code Pix, bouton « Copiar código Pix ».
- Règle chauffeur : le chauffeur doit utiliser **uniquement** la clé Pix enregistrée et validée dans DriveLocal. Demander au passager de payer une autre clé Pix hors de l'app est un **signal de fraude**.

Passenger safety copy (PT-BR): _"Para sua segurança, pague somente pelo QR Code exibido no DriveLocal. Não envie Pix para outra chave informada fora do app."_
Driver warning copy (PT-BR): _"Use apenas a chave Pix cadastrada e validada no DriveLocal. Solicitar pagamento por outra chave pode gerar bloqueio."_

```
Passenger Pix planned files:
  src/app/(passenger)/pix-payment.jsx
  src/components/PixQRCodeCard.jsx

Driver Pix profile planned fields:
  pixKeyType
  pixKey
  pixOwnerName
  pixStatus: pending / verified / rejected
```

### 2. Driver pays DriveLocal through Saldo DriveLocal / Le chauffeur paie DriveLocal via le Saldo DriveLocal

**EN:** The driver does **not** connect their bank account to DriveLocal. The driver pays DriveLocal by recharging an internal balance called **"Saldo DriveLocal"**. Key concept:
- Saldo DriveLocal is **not** a bank account and **not** a financial account owned by the driver.
- It is an internal ledger / credit balance inside DriveLocal.
- Real money goes to DriveLocal when the driver sends Pix to DriveLocal; the app then credits the driver's internal Saldo DriveLocal.
- The wallet is a prepaid internal balance used to pay platform fees.
- Simple: _"The client pays the driver. The driver pays DriveLocal by recharging Saldo DriveLocal."_

**FR:** Le chauffeur ne **connecte pas** son compte bancaire à DriveLocal. Le chauffeur paie DriveLocal en rechargeant un solde interne appelé **« Saldo DriveLocal »**. Concept clé :
- Le Saldo DriveLocal n'est **pas** un compte bancaire ni un compte financier détenu par le chauffeur.
- C'est un grand livre interne / solde de crédit dans DriveLocal.
- L'argent réel va à DriveLocal quand le chauffeur lui envoie un Pix ; l'app crédite alors le Saldo DriveLocal interne du chauffeur.
- Le portefeuille est un solde interne prépayé servant à payer les frais de plateforme.
- En clair : _« Le client paie le chauffeur. Le chauffeur paie DriveLocal en rechargeant le Saldo DriveLocal. »_

Driver-facing explanation (PT-BR): _"Você recebe o pagamento da corrida diretamente do passageiro por Pix. O Saldo DriveLocal é usado apenas para pagar a taxa da plataforma quando uma corrida é concluída."_

### 3. Driver wallet top-up flow / Flux de recharge du portefeuille chauffeur

**EN (MVP flow):**
1. Driver opens "Saldo DriveLocal".
2. Driver chooses a recharge amount: R$10, R$20, R$50 (custom amount later).
3. DriveLocal shows a Pix QR Code and Pix Copia e Cola for DriveLocal's Pix account.
4. Driver pays from their bank app.
5. A `topupRequest` is created with status `pending`.
6. Admin checks DriveLocal's real Pix/bank account manually.
7. Admin approves or rejects the top-up.
8. If approved, the driver's internal Saldo DriveLocal increases.
9. If rejected, the balance does not change.

Minimum top-up: **R$10,00**. Each recharge has a unique reference, e.g. `DL-TOPUP-4831`.
- Driver top-up screen shows: amount, DriveLocal Pix QR Code, Pix Copia e Cola, top-up reference, status (pending / approved / rejected).
- Admin top-up screen shows: top-up reference, driver name, driver ID, amount, `createdAt`, proof/status if available, buttons approve / reject.
- **MVP validation rule:** manual admin validation first. Do **not** implement Pix API, PSP webhooks, automatic reconciliation, or banking integration until explicitly approved.

**FR (flux MVP) :**
1. Le chauffeur ouvre « Saldo DriveLocal ».
2. Il choisit un montant de recharge : R$10, R$20, R$50 (montant libre plus tard).
3. DriveLocal affiche un QR Code Pix et un Pix Copia e Cola du compte Pix de DriveLocal.
4. Le chauffeur paie depuis son app bancaire.
5. Un `topupRequest` est créé au statut `pending`.
6. L'admin vérifie manuellement le vrai compte Pix/bancaire de DriveLocal.
7. L'admin approuve ou refuse la recharge.
8. Si approuvée, le Saldo DriveLocal interne du chauffeur augmente.
9. Si refusée, le solde ne change pas.

Recharge minimale : **R$10,00**. Chaque recharge a une référence unique, ex. `DL-TOPUP-4831`.
- Écran recharge chauffeur : montant, QR Code Pix DriveLocal, Pix Copia e Cola, référence, statut (pending / approved / rejected).
- Écran recharge admin : référence, nom du chauffeur, ID chauffeur, montant, `createdAt`, preuve/statut si disponible, boutons approuver / refuser.
- **Règle de validation MVP :** validation manuelle par l'admin d'abord. Ne **pas** implémenter d'API Pix, de webhooks PSP, de réconciliation automatique ni d'intégration bancaire avant accord explicite.

### 4. How DriveLocal gets paid / Comment DriveLocal est payé

**EN:** DriveLocal gets paid **before** commission is used, through driver wallet recharge. Example:
1. Driver Carlos recharges R$20.
2. Carlos sends Pix R$20 to DriveLocal.
3. Admin approves.
4. Carlos now has R$20 in Saldo DriveLocal.
5. Carlos completes a R$20 ride.
6. Passenger pays Carlos directly R$20 by Pix.
7. DriveLocal commission is 15% = R$3.
8. DriveLocal debits R$3 from Carlos's Saldo DriveLocal.
9. Carlos's Saldo DriveLocal becomes R$17.

So: passenger payment goes to the driver; driver recharge goes to DriveLocal; commission is deducted from the internal balance after rides; DriveLocal does not need to chase the driver after every ride.

**FR:** DriveLocal est payé **avant** que la commission ne soit utilisée, via la recharge du portefeuille chauffeur. Exemple :
1. Le chauffeur Carlos recharge R$20.
2. Carlos envoie un Pix de R$20 à DriveLocal.
3. L'admin approuve.
4. Carlos a maintenant R$20 de Saldo DriveLocal.
5. Carlos termine une course à R$20.
6. Le passager paie Carlos directement R$20 par Pix.
7. La commission DriveLocal est de 15 % = R$3.
8. DriveLocal débite R$3 du Saldo DriveLocal de Carlos.
9. Le Saldo DriveLocal de Carlos passe à R$17.

Donc : le paiement passager va au chauffeur ; la recharge du chauffeur va à DriveLocal ; la commission est déduite du solde interne après les courses ; DriveLocal n'a pas à relancer le chauffeur après chaque course.

### 5. Commission debit rule / Règle de débit de commission

**EN:** Do **not** take commission at driver approval.
- **At driver approval:** activate driver, assign founder/standard status, set promo dates, set commission rules — **do not debit money.**
- **At ride completion:** founder within promo period → commission = R$0; standard or promo expired → commission = 15% of ride amount, debited from Saldo DriveLocal.
- **Recommended later:** create a `commissionHold` when the driver accepts a ride; capture/debit on completion; release the hold on legitimate cancellation; send suspicious cancellation to admin review.

**FR:** Ne **pas** prélever de commission à l'approbation du chauffeur.
- **À l'approbation :** activer le chauffeur, attribuer le statut fondateur/standard, fixer les dates de promo, définir les règles de commission — **ne débiter aucun argent.**
- **À la fin de la course :** fondateur en période de promo → commission = R$0 ; standard ou promo expirée → commission = 15 % du montant, débitée du Saldo DriveLocal.
- **Recommandé plus tard :** créer un `commissionHold` à l'acceptation ; capturer/débiter à la fin ; libérer en cas d'annulation légitime ; envoyer les annulations suspectes en revue admin.

### 6. Saldo DriveLocal minimum balance rule / Règle de solde minimum

**EN:** Saldo DriveLocal is an internal prepaid balance for driver platform fees. The R$3 rule is a general minimum threshold, but it is **not** the only rule.

**General rule:** standard drivers must keep `Saldo DriveLocal > R$3,00` to keep receiving new ride requests. If `Saldo DriveLocal <= R$3,00`, the driver is blocked from new rides until they recharge. Minimum recharge **R$10,00**. Show a "saldo baixo" warning around **R$7,00**.

**Per-ride commission coverage rule:** in addition to the R$3 threshold, the driver must have enough Saldo DriveLocal to cover the estimated commission of the ride about to be accepted.
- `estimatedCommission = estimatedRidePrice * 15%`
- A standard driver can accept a ride only if `Saldo DriveLocal >= estimatedCommission`.
- Examples: ride R$20 → commission R$3,00 (needs ≥ R$3,00); ride R$30 → commission R$4,50 (R$3,50 is **not** enough); ride R$40 → commission R$6,00 (needs ≥ R$6,00).

**FR:** Le Saldo DriveLocal est un solde interne prépayé pour les frais de plateforme du chauffeur. La règle des R$3 est un seuil minimum général, mais **pas** la seule règle.

**Règle générale :** les chauffeurs standard doivent garder `Saldo DriveLocal > R$3,00` pour continuer à recevoir des demandes. Si `Saldo DriveLocal <= R$3,00`, le chauffeur est bloqué jusqu'à recharge. Recharge minimale **R$10,00**. Afficher un avertissement « saldo baixo » autour de **R$7,00**.

**Règle de couverture de commission par course :** en plus du seuil de R$3, le chauffeur doit avoir un Saldo suffisant pour couvrir la commission estimée de la course sur le point d'être acceptée.
- `estimatedCommission = estimatedRidePrice * 15%`
- Un chauffeur standard ne peut accepter une course que si `Saldo DriveLocal >= estimatedCommission`.
- Exemples : course R$20 → commission R$3,00 (besoin ≥ R$3,00) ; course R$30 → commission R$4,50 (R$3,50 **insuffisant**) ; course R$40 → commission R$6,00 (besoin ≥ R$6,00).

Driver-facing copy (PT-BR): _"Mantenha seu Saldo DriveLocal acima de R$3,00 para continuar recebendo corridas."_ / _"Para algumas corridas, o app pode solicitar um saldo maior para cobrir a taxa estimada da plataforma."_

### 7. Founder driver exception / Exception chauffeur fondateur

**EN:** For Motoristas Fundadores during the 60-day 0% commission period: commission = R$0; no commission wallet blocking applies; no per-ride commission coverage is required. After the 60-day founder/free period ends: normal wallet rules apply, the commission coverage rule applies, and monthly subscription rules apply.

Drivers approved from **#101 onward:** pay 15% commission from the first completed ride; receive R$0 subscription for the first 60 days; must keep Saldo DriveLocal active; must satisfy the R$3 general threshold; must satisfy the per-ride commission coverage rule.

**FR:** Pour les Motoristas Fundadores pendant la période de 60 jours à 0 % : commission = R$0 ; aucun blocage de portefeuille lié à la commission ; aucune couverture de commission par course requise. Après les 60 jours fondateur/gratuits : les règles normales de portefeuille s'appliquent, la règle de couverture de commission s'applique, et les règles d'abonnement mensuel s'appliquent.

Chauffeurs approuvés à partir du **n°101 :** 15 % de commission dès la première course terminée ; abonnement R$0 les 60 premiers jours ; doivent garder le Saldo DriveLocal actif ; doivent satisfaire le seuil général de R$3 ; doivent satisfaire la règle de couverture de commission par course.

### 8. Subscription payment later / Paiement de l'abonnement (plus tard)

**EN:** Subscription starts **only after** the free 60-day period.
- Drivers #1–#100 approved: 0% commission for 60 days; R$0 subscription for 60 days.
- Drivers #101+ approved: 15% commission from the first ride; R$0 subscription for 60 days.
- After 60 days: 15% commission; Moto subscription R$9,90/month; Carro subscription R$19,90/month.
- **MVP subscription collection:** use Saldo DriveLocal for subscription debit after the trial period. If insufficient balance after trial, restrict new rides until recharge. Do **not** implement automatic card billing or bank debit in MVP.

**FR:** L'abonnement ne démarre **qu'après** la période gratuite de 60 jours.
- Chauffeurs n°1–n°100 approuvés : 0 % de commission pendant 60 jours ; abonnement R$0 pendant 60 jours.
- Chauffeurs n°101+ approuvés : 15 % dès la première course ; abonnement R$0 pendant 60 jours.
- Après 60 jours : 15 % de commission ; abonnement moto R$9,90/mois ; abonnement voiture R$19,90/mois.
- **Collecte d'abonnement MVP :** utiliser le Saldo DriveLocal pour débiter l'abonnement après l'essai. Si le solde est insuffisant après l'essai, restreindre les nouvelles courses jusqu'à recharge. Ne **pas** implémenter de facturation carte automatique ni de prélèvement bancaire en MVP.

### 9. Anti-fraud payment rules / Règles anti-fraude paiement

**EN — Fraud signals:** driver asks the passenger to pay a different Pix key; driver and passenger cancel then complete the ride off-platform; repeated suspicious cancellations with the same passenger/driver pair; driver avoids the Saldo DriveLocal commission flow; fake cancellation after pickup or after contact; passenger reports that the driver requested off-platform payment. **Possible sanctions after admin review:** warning, temporary suspension, founder-benefit removal, commission recovery/debit, account removal.

**FR — Signaux de fraude :** le chauffeur demande au passager de payer une autre clé Pix ; chauffeur et passager annulent puis font la course hors plateforme ; annulations suspectes répétées avec le même duo passager/chauffeur ; le chauffeur évite le flux de commission Saldo DriveLocal ; fausse annulation après prise en charge ou après contact ; le passager signale que le chauffeur a demandé un paiement hors plateforme. **Sanctions possibles après revue admin :** avertissement, suspension temporaire, retrait de l'avantage fondateur, récupération/débit de commission, suppression du compte.

### 10. MVP rule summary / Récapitulatif des règles MVP

**EN:**
- Passenger pays the driver directly by Pix.
- Passenger uses QR Code Pix as the primary payment flow; Pix Copia e Cola is fallback.
- Passenger should not manually type the driver Pix key during a ride.
- Driver pays DriveLocal by recharging Saldo DriveLocal (internal prepaid ledger, **not** a bank account).
- Minimum recharge: R$10,00. Low-balance warning: around R$7,00.
- General ride-availability block: `Saldo DriveLocal <= R$3,00`.
- Per-ride block: `Saldo DriveLocal < estimated commission for that ride`.
- Founder exception: no commission wallet block during the 60-day 0% commission promo.
- Manual admin validation of driver top-ups first.
- No Pix API/webhook/PSP automation until explicitly approved.

**FR:**
- Le passager paie le chauffeur directement par Pix.
- Le passager utilise le QR Code Pix comme flux principal ; le Pix Copia e Cola en repli.
- Le passager ne doit pas saisir manuellement la clé Pix du chauffeur pendant une course.
- Le chauffeur paie DriveLocal en rechargeant le Saldo DriveLocal (grand livre interne prépayé, **pas** un compte bancaire).
- Recharge minimale : R$10,00. Avertissement de solde bas : autour de R$7,00.
- Blocage général de disponibilité : `Saldo DriveLocal <= R$3,00`.
- Blocage par course : `Saldo DriveLocal < commission estimée de cette course`.
- Exception fondateur : pas de blocage de portefeuille lié à la commission pendant la promo 60 jours à 0 %.
- Validation manuelle par l'admin des recharges chauffeur d'abord.
- Aucune automatisation API Pix/webhook/PSP avant accord explicite.

### 11. Planned files — not implemented yet / Fichiers prévus — non implémentés

```
Passenger Pix:
  src/app/(passenger)/pix-payment.jsx
  src/components/PixQRCodeCard.jsx

Driver wallet:
  src/app/(driver)/wallet.jsx
  src/components/WalletCard.jsx
  src/constants/walletRules.js

Admin top-up:
  src/app/(admin)/topups-pending.jsx
  src/app/(admin)/wallets.jsx

Future services (PLANNED, NOT IMPLEMENTED YET):
  src/services/pixService.js
  src/services/walletService.js
  src/services/topupService.js
  src/services/commissionService.js

Future Firestore (PLANNED, NOT IMPLEMENTED YET):
  wallets
  walletTransactions
  topupRequests
  commissionHolds
```

> **EN — Important:** This is a planned Pix/wallet/business rule. Do **not** implement wallet automation, commission debit, Firebase logic, backend services, Pix API, PSP integration, webhooks, automatic bank reconciliation, or real payment logic until explicitly approved.
>
> **FR — Important :** Ceci est une règle Pix/portefeuille/métier planifiée. Ne **pas** implémenter d'automatisation de portefeuille, de débit de commission, de logique Firebase, de services backend, d'API Pix, d'intégration PSP, de webhooks, de réconciliation bancaire automatique ni de logique de paiement réelle avant accord explicite.

---

## 9. Pricing Strategy — Stratégie de prix

**EN:** Do **not** implement Uber-like automatic surge pricing in MVP. Positioning: cheaper and clearer than big platforms; local transparent pricing; passenger sees price before confirming; driver sees clear commission.

MVP pricing: `price = minimum price + distance-based estimate + optional local adjustment`. Moto and car have different pricing. Admin-controlled adjustments may be added later (night, rain, high demand, local event). Avoid opaque dynamic pricing in V1.

**FR:** Ne **pas** implémenter de surge automatique façon Uber dans le MVP. Positionnement : moins cher et plus clair que les grandes plateformes ; prix local transparent ; le passager voit le prix avant de confirmer ; le chauffeur voit une commission claire.

Tarif MVP : `prix = prix minimum + estimation selon distance + ajustement local optionnel`. Tarifs distincts moto/voiture. Des ajustements contrôlés par l'admin pourront être ajoutés plus tard (nuit, pluie, forte demande, événement local). Éviter une tarification dynamique opaque en V1.

User-facing copy (PT-BR): "Preço claro", "Preço local estimado", "Você vê o preço antes de confirmar", "Pagamento direto por Pix ao motorista".

Planned files / Fichiers prévus:
```
src/constants/pricing.js
src/services/pricingService.js
src/app/(passenger)/confirm-price.jsx
Firestore (later): pricingRules, serviceAreas/{id}/pricing
```

---

## 10. Driver Verification and Trust — Vérification et confiance chauffeur

**EN:** Central to DriveLocal. No driver can receive rides unless admin-approved and verified.

Minimum data: full name, display name, WhatsApp, email, vehicle type (moto/carro), city/service area, Pix key, selfie/profile photo, CNH, vehicle document / CRLV, vehicle photo, plate, brand/model/color.

Moto may require additional local documents depending on city rules: mototaxi authorization, specialized course, safety equipment confirmation, configurable checklist. Do **not** hardcode all legal assumptions — keep document requirements configurable by vehicle type and service area.

**FR:** Élément central de DriveLocal. Aucun chauffeur ne peut recevoir de courses sans être approuvé par l'admin et vérifié.

Données minimales : nom complet, nom affiché, WhatsApp, e-mail, type de véhicule (moto/carro), ville/zone de service, clé Pix, selfie/photo de profil, CNH, document du véhicule / CRLV, photo du véhicule, plaque, marque/modèle/couleur.

La moto peut exiger des documents locaux supplémentaires selon les règles de la ville : autorisation mototaxi, formation spécialisée, confirmation d'équipement de sécurité, checklist configurable. Ne **pas** coder en dur toutes les hypothèses légales — garder les exigences documentaires configurables par type de véhicule et zone de service.

Planned files / Fichiers prévus:
```
src/constants/driverDocuments.js
src/constants/vehicleTypes.js
src/app/(driver)/profile.jsx
src/app/(driver)/documents.jsx
src/app/(driver)/verification-status.jsx
src/app/(driver)/onboarding.jsx
src/services/driverService.js
src/services/documentService.js
src/services/storageService.js
Firestore: drivers, driverDocuments, vehicles
```

---

## 11. Passenger Trust Card — Carte de confiance passager

**EN:** After a driver accepts a ride, the passenger must see a trust card following the safety pattern of the industry (without copying Uber branding).

Show: driver photo, short name, badge "Motorista verificado", rating average or "Novo motorista verificado", number of rides if available, "Motorista desde março 2026"-style date, vehicle type (Moto/Carro), brand/model/color, plate, Pix payment note, approximate ETA.

Do **not** show: CPF, full CNH number, driver address, raw document images, private document details.

**FR:** Après qu'un chauffeur accepte une course, le passager doit voir une carte de confiance suivant le standard de sécurité du secteur (sans copier la marque Uber).

Afficher : photo du chauffeur, prénom court, badge « Motorista verificado », note moyenne ou « Novo motorista verificado », nombre de courses si disponible, date type « Motorista desde março 2026 », type de véhicule (Moto/Carro), marque/modèle/couleur, plaque, mention de paiement Pix, ETA approximatif.

Ne **pas** afficher : CPF, numéro complet de CNH, adresse du chauffeur, images brutes de documents, détails privés des documents.

Planned files / Fichiers prévus:
```
src/components/DriverIdentityCard.jsx
src/app/(passenger)/driver-accepted.jsx
src/mock/mockDrivers.js          (initially)
Firestore driver/vehicle profile (later)
```

---

## 12. Rating System — Système de notation

**EN:** Passenger can rate the driver after a completed ride. MVP: 1–5 stars, quick tags, optional comment later.

Suggested tags (PT-BR): "Motorista educado", "Veículo limpo", "Chegou no horário", "Condução segura".

Driver display: if enough ratings, show average + count; if new, show "Novo motorista verificado".

**FR:** Le passager peut noter le chauffeur après une course terminée. MVP : 1 à 5 étoiles, tags rapides, commentaire optionnel plus tard.

Tags suggérés (PT-BR) : voir ci-dessus.

Affichage chauffeur : assez d'avis → moyenne + nombre ; nouveau → « Novo motorista verificado ».

Planned files / Fichiers prévus:
```
src/app/(passenger)/ride-completed.jsx
src/components/RatingCard.jsx
src/services/ratingService.js
Firestore: ratings, drivers/{id}.ratingAverage, drivers/{id}.ratingCount
```

---

## 13. Passenger Live Map — Carte en direct passager

**EN:** The passenger sees the driver arriving on a map after the ride is accepted. The passenger map is for **trust, visibility, and ride status**. Live location is active only during an accepted/active ride and stops when the ride is completed or cancelled. The driver still uses Google Maps/Waze for navigation. V1 does **not** implement full internal turn-by-turn navigation.

MVP live location: driver position updates every 5–10 seconds or after meaningful movement; pickup/destination/driver markers; approximate ETA; no advanced snap-to-road; no Uber-level ETA engine; no heavy background tracking in V1 unless explicitly approved.

**FR:** Le passager voit le chauffeur arriver sur une carte après l'acceptation. La carte passager sert à la **confiance, la visibilité et le statut de la course**. La localisation en direct n'est active que pendant une course acceptée/active et s'arrête à la fin ou à l'annulation. Le chauffeur utilise toujours Google Maps/Waze pour naviguer. La V1 n'implémente **pas** de navigation virage par virage interne complète.

Localisation MVP : position du chauffeur mise à jour toutes les 5–10 s ou après un mouvement significatif ; marqueurs prise en charge/destination/chauffeur ; ETA approximatif ; pas de snap-to-road avancé ; pas de moteur d'ETA niveau Uber ; pas de suivi en arrière-plan lourd en V1 sauf accord explicite.

Privacy copy (PT-BR) — Passenger: _"Para sua segurança, acompanhe a corrida pelo DriveLocal."_ Driver: _"Sua localização será compartilhada com o passageiro apenas durante corridas aceitas."_

Planned files / Fichiers prévus:
```
src/components/RideMap.jsx
src/app/(passenger)/driver-accepted.jsx
src/app/(driver)/active-ride.jsx
src/services/locationService.js
Firestore: rides/{rideId}.driverLiveLocation
```

---

## 14. Navigation / GPS Policy — Politique navigation / GPS

**EN:** DriveLocal does **not** replace Google Maps/Waze in V1. Driver navigation uses Google Maps and Waze. Every ride must carry `ride.pickup` and `ride.destination`, each with `address`, `lat`, `lng`.

Driver active-ride phases:
1. **Buscar passageiro:** show pickup address; open pickup in Google Maps; open pickup in Waze; action "Cheguei ao local"; action "Passageiro embarcou".
2. **Levar passageiro ao destino:** show destination address; open destination in Google Maps; open destination in Waze; action "Pagamento recebido"; action "Finalizar corrida".

**FR:** DriveLocal ne **remplace pas** Google Maps/Waze en V1. La navigation chauffeur utilise Google Maps et Waze. Chaque course doit porter `ride.pickup` et `ride.destination`, chacun avec `address`, `lat`, `lng`.

Phases de la course active côté chauffeur :
1. **Buscar passageiro :** afficher l'adresse de prise en charge ; ouvrir dans Google Maps ; ouvrir dans Waze ; action « Cheguei ao local » ; action « Passageiro embarcou ».
2. **Levar passageiro ao destino :** afficher l'adresse de destination ; ouvrir dans Google Maps ; ouvrir dans Waze ; action « Pagamento recebido » ; action « Finalizar corrida ».

Planned files / Fichiers prévus:
```
src/utils/maps.js
src/app/(driver)/active-ride.jsx
src/components/RideRequestCard.jsx
```

---

## 15. Anti-Fraud and Off-Platform Protection — Anti-fraude et protection hors plateforme

**EN:** Core business requirement. Risks: a driver creates multiple accounts; a driver avoids commission; driver and passenger cancel then complete the ride off-platform; fake cancellations; repeated suspicious cancellation patterns; same vehicle/plate/Pix key across accounts; a suspended driver returns with a new account.

Anti-duplicate checks: unique WhatsApp, unique email, CPF/identity document if used, unique CNH, unique vehicle plate, unique Pix key, selfie/manual admin review, vehicle-document manual review.

Sanctions after admin review: warning, temporary suspension, founder-benefit removal, commission recovery/debit, account removal.

MVP fraud tools: ride event logs, cancellation reasons, an admin fraud-review screen (later), duplicate-identity checks, status history.

**FR:** Exigence métier centrale. Risques : un chauffeur crée plusieurs comptes ; un chauffeur évite la commission ; chauffeur et passager annulent puis font la course hors plateforme ; fausses annulations ; schémas d'annulation suspects répétés ; même véhicule/plaque/clé Pix sur plusieurs comptes ; un chauffeur suspendu revient avec un nouveau compte.

Contrôles anti-doublon : WhatsApp unique, e-mail unique, CPF/document d'identité le cas échéant, CNH unique, plaque unique, clé Pix unique, revue admin manuelle du selfie, revue manuelle du document du véhicule.

Sanctions après revue admin : avertissement, suspension temporaire, retrait de l'avantage fondateur, récupération/débit de commission, suppression du compte.

Outils anti-fraude MVP : journaux d'événements de course, motifs d'annulation, écran admin de revue fraude (plus tard), contrôles d'identité en double, historique des statuts.

Anti-platform-exit copy (PT-BR) — Passenger: _"Para sua segurança, mantenha a corrida dentro do DriveLocal. Fora da plataforma, não conseguimos acompanhar o trajeto, identificar o motorista ou ajudar em caso de problema."_ Driver: _"Corridas iniciadas no DriveLocal devem ser concluídas no app. Cancelamentos falsos ou corridas feitas fora da plataforma podem gerar bloqueio, perda de benefícios e cobrança da comissão devida."_

Cancellation reasons (PT-BR): "Motorista demorou", "Errei o endereço", "Não preciso mais", "Motorista pediu para cancelar", "Vou continuar fora do app", "Outro motivo".

Planned files / Fichiers prévus:
```
src/constants/cancellationReasons.js
src/constants/fraudRules.js
src/services/fraudService.js
src/services/rideEventService.js
src/app/(admin)/reports.jsx
src/app/(admin)/rides.jsx
Firestore: rideEvents, fraudFlags, adminLogs
```

---

## 16. Actor-Based Iteration Roadmap — Feuille de route par acteur

> **EN:** Build trusted local **supply** first (drivers + admin), then passenger demand, then rides, then monetization, then anti-fraud, then backend. **FR:** Construire d'abord l'**offre** locale de confiance (chauffeurs + admin), puis la demande passager, puis les courses, puis la monétisation, puis l'anti-fraude, puis le backend.

### Iteration 0 — Documentation & landing lock / Documentation et verrouillage de la landing
**EN:** Keep the current landing accepted; document business + technical rules; prevent drift. No source code changes. **FR:** Garder la landing actuelle acceptée ; documenter les règles métier + techniques ; éviter la dérive. Aucun changement de code source.
Files: `CLAUDE.md`, `README.md` (later if approved).

### Iteration 1 — Driver onboarding + Admin approval + Founder rule
**EN:** Actors: Motorista, Admin. Goal: recruit and verify the first local drivers in Horizonte. Driver: create account, fill profile, choose moto/carro, add vehicle info + Pix key, upload selfie/document placeholders (real Firebase Storage later), submit for review, view status, see founder/free-trial explanation. Admin: view pending drivers, open detail, review identity/vehicle/documents, approve/reject, assign founder if within first 100 approved, see founder counter and approval logs. Rules: no ride access before approval; founder status only after approval; #1–100 → 0% commission + R$0 subscription for 60 days; #101+ → 15% from first ride + R$0 subscription for 60 days.
**FR:** Acteurs : Motorista, Admin. Objectif : recruter et vérifier les premiers chauffeurs locaux à Horizonte. Chauffeur : créer un compte, remplir le profil, choisir moto/carro, ajouter infos véhicule + clé Pix, téléverser selfie/documents (Firebase Storage réel plus tard), soumettre, voir le statut, lire l'explication fondateur/essai gratuit. Admin : voir les chauffeurs en attente, ouvrir le détail, examiner identité/véhicule/documents, approuver/refuser, attribuer le statut fondateur si dans les 100 premiers approuvés, voir le compteur et les journaux. Règles : pas d'accès course avant approbation ; statut fondateur seulement après approbation ; n°1–100 → 0 % + abonnement R$0 pendant 60 jours ; n°101+ → 15 % dès la 1re course + abonnement R$0 pendant 60 jours.
```
src/app/(driver)/onboarding.jsx        src/app/(admin)/drivers-pending.jsx
src/app/(driver)/profile.jsx           src/app/(admin)/driver-detail.jsx
src/app/(driver)/documents.jsx         src/components/DriverStatusBadge.jsx
src/app/(driver)/verification-status.jsx  src/components/FounderOfferBadge.jsx
src/constants/driverDocuments.js       src/constants/founderRules.js
src/constants/vehicleTypes.js          src/services/driverService.js   (later)
src/services/founderService.js (later) firebase files (later, when approved)
```

### Iteration 2 — Passenger ride request + transparent price
**EN:** Actor: Passageiro. Goal: request a local ride with a clear estimated price. Passenger: choose pickup, choose destination, choose moto/carro, see estimated price, see local/Pix/trust messaging, confirm request. Rules: price clear before confirmation; no automatic surge; no card; no cash; Pix direct to driver later; show verified-driver promise.
**FR:** Acteur : Passageiro. Objectif : demander une course locale avec un prix estimé clair. Passager : choisir départ, destination, moto/carro, voir le prix estimé, voir les messages local/Pix/confiance, confirmer. Règles : prix clair avant confirmation ; pas de surge auto ; pas de carte ; pas d'espèces ; Pix direct au chauffeur plus tard ; afficher la promesse de chauffeur vérifié.
```
src/app/(passenger)/select-route.jsx   src/app/(passenger)/confirm-price.jsx
src/constants/pricing.js               src/services/pricingService.js (later)
src/mock/mockRides.js                  src/components/AppInput.jsx
src/components/AppButton.jsx
```

### Iteration 3 — Driver accepted + trust card + live map MVP
**EN:** Actors: Passageiro, Motorista. Goal: passenger sees who is coming and feels safe. Passenger sees driver photo, verified badge, rating / new-driver label, vehicle type, model/color, plate, "driver since" date, approximate ETA, map with approaching driver, pickup/destination. Driver uses Google Maps/Waze externally; location shared only during accepted/active ride.
**FR:** Acteurs : Passageiro, Motorista. Objectif : le passager voit qui arrive et se sent en sécurité. Le passager voit photo, badge vérifié, note / mention nouveau chauffeur, type de véhicule, modèle/couleur, plaque, date « chauffeur depuis », ETA approximatif, carte avec le chauffeur qui approche, départ/destination. Le chauffeur utilise Google Maps/Waze en externe ; localisation partagée seulement pendant la course acceptée/active.
```
src/app/(passenger)/driver-accepted.jsx  src/components/DriverIdentityCard.jsx
src/components/RideMap.jsx                src/services/locationService.js (later)
src/mock/mockDrivers.js                   src/mock/mockRides.js
```

### Iteration 4 — Active ride flow
**EN:** Actors: Motorista, Passageiro. Goal: complete a ride end-to-end. Driver: receive request, accept, open Maps/Waze to pickup, confirm arrival, confirm onboard, open Maps/Waze to destination, confirm Pix received, finalize. Passenger: see ride status, driver/vehicle/map, Pix payment info, rate driver after completion.
**FR:** Acteurs : Motorista, Passageiro. Objectif : réaliser une course de bout en bout. Chauffeur : recevoir la demande, accepter, ouvrir Maps/Waze vers le départ, confirmer l'arrivée, confirmer l'embarquement, ouvrir Maps/Waze vers la destination, confirmer le Pix reçu, finaliser. Passager : voir le statut, chauffeur/véhicule/carte, infos Pix, noter le chauffeur après la fin.
```
src/app/(driver)/ride-request.jsx       src/app/(passenger)/pix-payment.jsx
src/app/(driver)/active-ride.jsx        src/app/(passenger)/ride-completed.jsx
src/app/(driver)/finish-ride.jsx        src/components/PixQRCodeCard.jsx
src/components/RatingCard.jsx            src/utils/maps.js
src/constants/rideStatuses.js           src/services/rideService.js      (later)
src/services/rideEventService.js (later)
```

### Iteration 5 — Wallet / commission MVP
**EN:** Actors: Motorista, Admin. Goal: start monetization safely. Driver: see Saldo DriveLocal, understand commission, recharge by Pix, see top-up status and commission debits. Admin: validate top-ups, see balances, see low-balance drivers, review commission issues. Rules: no commission at approval; standard 15% per completed ride; founder #1–100 = 0% for 60 days; #101+ = 15% from first ride; all get free subscription for 60 days, then subscription applies; balance > R$3 for standard drivers; minimum recharge R$10.
**FR:** Acteurs : Motorista, Admin. Objectif : démarrer la monétisation en sécurité. Chauffeur : voir le Saldo DriveLocal, comprendre la commission, recharger par Pix, voir le statut de recharge et les débits. Admin : valider les recharges, voir les soldes, repérer les soldes faibles, examiner les problèmes de commission. Règles : pas de commission à l'approbation ; 15 % standard par course terminée ; fondateurs n°1–100 = 0 % pendant 60 jours ; n°101+ = 15 % dès la 1re course ; tous ont l'abonnement gratuit 60 jours puis payant ; solde > R$3 pour les chauffeurs standard ; recharge minimale R$10.
```
src/app/(driver)/wallet.jsx             src/app/(admin)/topups-pending.jsx
src/components/WalletCard.jsx           src/app/(admin)/wallets.jsx
src/constants/walletRules.js            src/services/walletService.js (later)
src/services/topupService.js (later)    Firestore: wallets, walletTransactions, topupRequests
```

### Iteration 6 — Anti-fraud and cancellation review
**EN:** Actors: Admin, Motorista, Passageiro. Goal: protect DriveLocal from off-platform fraud and fake cancellations. Capabilities: cancellation reasons, ride event logs, suspicious-cancellation flags, admin review, driver/passenger warnings, sanctions after review.
**FR:** Acteurs : Admin, Motorista, Passageiro. Objectif : protéger DriveLocal de la fraude hors plateforme et des fausses annulations. Capacités : motifs d'annulation, journaux d'événements, marqueurs d'annulation suspecte, revue admin, avertissements chauffeur/passager, sanctions après revue.
```
src/constants/cancellationReasons.js    src/services/fraudService.js (later)
src/constants/fraudRules.js             src/services/rideEventService.js (later)
src/app/(admin)/rides.jsx               src/app/(admin)/reports.jsx
src/components/AdminTableRow.jsx
```

### Iteration 7 — Firebase backend implementation
**EN:** Only after explicit approval. Stack: Firebase Auth, Firestore, Storage, Cloud Functions (JavaScript), Firebase Cloud Messaging (later), Security Rules. Do **not** implement backend before approval.
**FR:** Uniquement après accord explicite. Stack : Firebase Auth, Firestore, Storage, Cloud Functions (JavaScript), Firebase Cloud Messaging (plus tard), Security Rules. Ne **pas** implémenter le backend avant accord.
```
firebase.json   .firebaserc   firestore.rules   storage.rules
firestore.indexes.json   functions/index.js
src/lib/firebase.js  OR  src/config/firebase.js
src/services/*.js
```

---

## 17. Main Route Map — Carte des routes principales

```
Landing:
  src/app/index.jsx

Auth:
  src/app/(auth)/login.jsx
  src/app/(auth)/email-login.jsx
  src/app/(auth)/email-register.jsx
  src/app/(auth)/verify-whatsapp.jsx

Passenger:
  src/app/(passenger)/passenger-home.jsx
  src/app/(passenger)/select-route.jsx
  src/app/(passenger)/confirm-price.jsx
  src/app/(passenger)/searching.jsx
  src/app/(passenger)/driver-accepted.jsx
  src/app/(passenger)/pix-payment.jsx
  src/app/(passenger)/ride-completed.jsx

Driver:
  src/app/(driver)/driver-home.jsx
  src/app/(driver)/onboarding.jsx
  src/app/(driver)/profile.jsx
  src/app/(driver)/documents.jsx
  src/app/(driver)/verification-status.jsx
  src/app/(driver)/ride-request.jsx
  src/app/(driver)/active-ride.jsx
  src/app/(driver)/finish-ride.jsx
  src/app/(driver)/wallet.jsx
  src/app/(driver)/subscription-plans.jsx

Admin:
  src/app/admin-login.jsx
  src/app/(admin)/admin-home.jsx
  src/app/(admin)/dashboard.jsx
  src/app/(admin)/drivers-pending.jsx
  src/app/(admin)/driver-detail.jsx
  src/app/(admin)/topups-pending.jsx
  src/app/(admin)/rides.jsx
  src/app/(admin)/wallets.jsx
  src/app/(admin)/reports.jsx
```

---

## 18. Testing Rules — Règles de test

**EN:** Use Expo Web for quick smoke tests: `npx expo start --web --clear`, then test in incognito at `http://localhost:8081`. If normal Chrome shows `displayName` errors from `chrome-extension` URLs, treat it as a browser-extension issue, not an app issue, and verify in incognito. Do **not** treat VS Code JSHint extension errors as app errors. Avoid `npm run lint` unless explicitly approved.

**FR:** Utiliser Expo Web pour des tests rapides : `npx expo start --web --clear`, puis tester en navigation privée sur `http://localhost:8081`. Si Chrome normal affiche des erreurs `displayName` venant d'URL `chrome-extension`, c'est un problème d'extension du navigateur, pas de l'appli — vérifier en navigation privée. Ne **pas** considérer les erreurs de l'extension JSHint de VS Code comme des erreurs d'appli. Éviter `npm run lint` sauf accord explicite.

Useful checks / Vérifications utiles:
```bash
find src -type f \( -name "*.ts" -o -name "*.tsx" \) | sort
grep -R "mport " src || true
grep -R "xport " src || true
grep -R "â" src || true
```

---

## Android Build Strategy — Stratégie de build Android

**EN:** DriveLocal uses **exactly two Android build tracks** — no separate "preview APK" track.

| Build type | Purpose | Target users |
| ----------------------------------- | -------------------------------------------------- | ------------------------------- |
| Development Build / Expo Dev Client | Developer testing on a real Android phone | Project owner / developer |
| Production Build | Real-world installable app for field usage/testing | selected drivers and passengers |

- **Development Build / Expo Dev Client:** used during active development to test DriveLocal on a real Android phone, validate navigation and screens, test mobile behavior, and reproduce real device issues. Similar to the previous VigiApp workflow using Expo Dev Build / Expo Dev Client.
- **Production Build:** used to install the real app on Android devices and test with real local users/drivers, validating the MVP in Horizonte-CE. Production Build does **not** mean an immediate public Play Store release — public release waits until MVP validation. Do **not** configure Play Store release, public distribution, production signing, or store deployment until explicitly approved.
- **No preview track:** do **not** introduce a separate "preview APK" concept. Only Development Build (development testing) and Production Build (real-world usage/testing) exist.
- **Branding assets (pending):** official DriveLocal logo, app icon, splash screen, optional dark/light logo versions, and the Admin-web favicon will be provided by the project owner. Do **not** generate or replace official branding assets unless explicitly approved.

> Documentation only here — do **not** configure EAS Build, create Android build files, or set up signing/distribution until explicitly approved.

**FR:** DriveLocal utilise **exactement deux pistes de build Android** — pas de piste « preview APK » séparée.

| Type de build | Objectif | Utilisateurs cibles |
| ----------------------------------- | -------------------------------------------------- | ------------------------------- |
| Development Build / Expo Dev Client | Tests développeur sur un vrai téléphone Android | Propriétaire du projet / dev |
| Production Build | App installable réelle pour usage/test sur le terrain | chauffeurs et passagers sélectionnés |

- **Development Build / Expo Dev Client :** utilisé pendant le développement actif pour tester DriveLocal sur un vrai téléphone Android, valider la navigation et les écrans, tester le comportement mobile et reproduire les problèmes réels d'appareil. Similaire à l'ancien workflow VigiApp avec Expo Dev Build / Expo Dev Client.
- **Production Build :** utilisé pour installer l'app réelle sur des appareils Android et tester avec de vrais utilisateurs/chauffeurs locaux, afin de valider le MVP à Horizonte-CE. Le Production Build ne signifie **pas** une publication immédiate sur le Play Store — la publication publique attend la validation du MVP. Ne **pas** configurer la publication Play Store, la distribution publique, la signature de production ni le déploiement en store avant accord explicite.
- **Pas de piste preview :** ne **pas** introduire de concept « preview APK » séparé. Seuls existent le Development Build (tests de dev) et le Production Build (usage/test réel).
- **Éléments de marque (en attente) :** le logo officiel DriveLocal, l'icône d'app, l'écran de démarrage, les versions de logo clair/sombre optionnelles et le favicon du web Admin seront fournis par le propriétaire du projet. Ne **pas** générer ni remplacer les éléments de marque officiels sans accord explicite.

> Documentation uniquement ici — ne **pas** configurer EAS Build, créer de fichiers de build Android, ni mettre en place la signature/distribution avant accord explicite.

---

## 19. Approval Discipline — Discipline d'approbation

**EN:** Use "Yes" only for expected, focused commands. Do not use broad "always allow" permissions casually. Be cautious with: `git checkout`, `rm`, package installation, PowerShell process-killing commands, and commands that modify `package.json` / `package-lock.json`. Read-only checks are generally fine to approve. For source edits, the preview must be clean and free of mojibake.

**FR:** Répondre « Oui » uniquement pour des commandes attendues et ciblées. Ne pas utiliser à la légère les permissions larges « toujours autoriser ». Être prudent avec : `git checkout`, `rm`, l'installation de paquets, les commandes PowerShell qui tuent des processus, et celles qui modifient `package.json` / `package-lock.json`. Les vérifications en lecture seule peuvent généralement être approuvées. Pour les modifications de code, l'aperçu doit être propre et sans mojibake.

---

## 20. What NOT To Do — Ce qu'il ne faut PAS faire

**EN:** Do not: build Uber-complete complexity in the MVP; add real payments yet; add Pix split yet; add card processing; add cash flow; add complex matching; add full background GPS tracking; add heavy fraud ML; add automated subscriptions; activate multi-city production flow; create complex design systems; over-engineer simple screens; hide business rules in the UI only; hardcode Horizonte in business logic everywhere; apply edits with corrupted characters; create duplicate admin login routes.

**FR:** Ne pas : construire une complexité complète façon Uber dans le MVP ; ajouter des paiements réels pour l'instant ; ajouter le split Pix pour l'instant ; ajouter le traitement par carte ; ajouter un flux d'espèces ; ajouter du matching complexe ; ajouter un suivi GPS complet en arrière-plan ; ajouter du ML anti-fraude lourd ; ajouter des abonnements automatisés ; activer un flux de production multi-villes ; créer des design systems complexes ; sur-concevoir des écrans simples ; cacher les règles métier uniquement dans l'UI ; coder Horizonte en dur partout dans la logique métier ; appliquer des modifications avec caractères corrompus ; créer des routes de connexion admin en double.

---

## 21. Next Recommended Work — Prochain travail recommandé

**EN:** The next major build should start with **Iteration 1** — driver onboarding (real) + admin approval + founder rule + basic anti-duplicate identity checks. Reason: DriveLocal must first build trusted local supply. Passengers will only trust the app if drivers are verified, visible, and admin-approved. Do **not** start with passenger demand or complex ride matching until the driver/admin trust foundation is ready.

**FR:** Le prochain grand chantier doit commencer par l'**Itération 1** — onboarding chauffeur (réel) + approbation admin + règle fondateur + contrôles d'identité anti-doublon de base. Raison : DriveLocal doit d'abord constituer une offre locale de confiance. Les passagers ne feront confiance à l'appli que si les chauffeurs sont vérifiés, visibles et approuvés par l'admin. Ne **pas** commencer par la demande passager ni le matching complexe tant que la base de confiance chauffeur/admin n'est pas prête.
