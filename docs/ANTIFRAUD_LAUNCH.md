# DriveLocal — antifraude de lancement

Ce document décrit les protections actives au lancement, les invariants financiers,
les collections, les journaux et la procédure de diagnostic. Il complète le code :
les décisions métier restent implémentées et testées côté serveur.

## Principes non négociables

1. Le client mobile ne calcule ni ne modifie un solde, une retenue ou une capture.
2. Une commission est figée et retenue dans la transaction d'acceptation.
3. Une retenue finit dans un seul état : `captured`, `released` ou `disputed`.
4. Une capture ne dépasse jamais la retenue initiale.
5. Une promotion modifiée après l'acceptation ne change pas la commission de la course.
6. Une course ou un paiement rejoué produit le même résultat, sans double débit.
7. Un litige conserve la retenue ; il ne la supprime pas.
8. Un paiement non résolu depuis plus de 24 h bloque uniquement les **nouvelles**
   acceptations du chauffeur, sans interrompre la course ni modifier son argent.
9. Les règles automatiques ouvrent des signaux/dossiers. Le blocage permanent reste
   une décision admin explicite, motivée et auditée.
10. CPF, CNH, CRLV, clé Pix, documents privés et coordonnées précises ne doivent
    jamais apparaître dans les logs ou les métadonnées antifraude.

## Flux financier d'une course

```text
searching
  -> assigned
     commissionPolicySnapshot figé
     commission_hold créé
     available -= hold
     held += hold

assigned -> driver_arrived -> in_progress -> awaiting_payment

awaiting_payment/payment_marked_sent
  -> completed
     captured = min(finalCommission, originalHold)
     released = originalHold - captured
     balance -= captured
     held -= originalHold
     available += released

ou

assigned/driver_arrived -> cancelled
  hold intégralement libéré

ou

awaiting_payment/payment_marked_sent -> disputed
  hold conservé jusqu'à décision admin
```

## États financiers de la course

- `held` : commission réservée.
- `free` : gratuité valide au moment de l'acceptation.
- `captured` : commission acquise par DriveLocal.
- `released` : retenue rendue selon une annulation/résolution valide.
- `disputed` : retenue gelée en attente d'une décision.

Le document de course conserve :

- `commissionPolicySnapshot.policyVersion` ;
- `commissionPolicySnapshot.pricingConfigVersion` ;
- `commissionPolicySnapshot.estimatedCommissionCentavos` ;
- `commissionPolicySnapshot.holdAmountCentavos` ;
- `commissionPolicySnapshot.commissionFreeAtAcceptance` ;
- `commissionCapturedCentavos` ;
- `holdReleasedCentavos` ;
- `commissionSettlementStatus`.

## Collections serveur

| Collection | Usage | Écriture mobile |
|---|---|---|
| `walletTransactions` | Journal financier déterministe | interdite |
| `riskEvents` | Signaux unitaires idempotents | interdite |
| `riskProfiles` | Résumé de risque par acteur | interdite |
| `fraudCases` | Dossiers de révision admin | interdite |
| `financialAlerts` | Anomalies de rapprochement | interdite |
| `systemHealth` | Santé des scans | interdite |
| `operationalSnapshots` | Offre chauffeur agrégée par heure | interdite |

## Identifiants financiers déterministes

Pour une course `rideId` :

- `${rideId}_hold` ;
- `${rideId}_capture` ;
- `${rideId}_release`.

Ces identifiants empêchent un deuxième mouvement logique pour la même course.

## Scans et déclencheurs

### `financialReconciliationTask` — toutes les heures

Détecte notamment :

- course terminée sans règlement ;
- capture supérieure à la retenue ;
- capture + libération différente de la retenue ;
- commission à zéro sans gratuité figée ;
- retenue/paiement non résolu depuis plus de 24 h ;
- solde négatif ;
- `walletBalance != walletAvailable + walletHeld`.

Il crée/réouvre/résout des alertes. Il ne corrige jamais un montant tout seul.

### `operationalRiskScanTask` — toutes les six heures

Détecte des motifs explicables sur 14 jours :

- annulations répétées ;
- faux paiements confirmés par plusieurs résolutions admin ;
- déclarations répétées de non-réception ;
- paire chauffeur/passager inhabituellement fréquente ;
- durée de course physiquement peu plausible ;
- répétition anormale de gratuités.

Ces motifs déclenchent une révision, pas un bannissement automatique.

### `driverLocationRiskTrigger`

Compare uniquement deux positions courantes successives. Il ne conserve pas un
historique de trajet. Un événement contient la distance et la vitesse agrégées,
jamais les coordonnées.

### `ridePaymentRestrictionTrigger`

Lie une restriction financière au `rideId` exact. Une course finalisée ne peut pas
lever une restriction plus récente créée par une autre course.

### `supplySnapshotTask` — toutes les heures

Enregistre seulement les nombres de chauffeurs moto/voiture : approuvés, en ligne,
disponibles et occupés. Aucun UID ni point GPS n'est conservé.

## Validation chauffeur

Avant approbation, le serveur recherche les doublons structurés disponibles :

- CPF ;
- plaque ;
- clé Pix ;
- téléphone ;
- e-mail.

Un doublon ouvre un dossier `REQUIRE_REVIEW`. Après fermeture de tous les dossiers
concernés avec `close_no_evidence`, l'approbation peut reprendre normalement.

Les photos CNH/CRLV restent vérifiées humainement au lancement. Une détection fiable
de doublon CNH/CRLV nécessitera des **numéros structurés** dédiés ; comparer des URL
ou des chemins de fichiers serait incorrect et produirait de faux résultats.

## Restrictions progressives

### Chauffeur

- litige/paiement ancien : blocage des nouvelles acceptations ;
- restriction temporaire admin : blocage jusqu'à expiration ;
- fraude confirmée manuellement : `isBlocked=true`, mise hors ligne.

Une restriction ne modifie jamais un solde et n'interrompt pas une course active.

### Passager

- avertissement ;
- restriction temporaire des nouvelles demandes ;
- révision financière ;
- fraude confirmée manuellement.

Le serveur applique la restriction avant le calcul d'itinéraire et le dispatch.

## Écran admin

### Tableau de bord

- recette confirmée = commissions capturées + abonnements payés ;
- commissions attendues, retenues, capturées, libérées et litigieuses ;
- séparation moto/voiture ;
- abonnements payants/gratuits et MRR théorique ;
- wallets faibles ;
- pics horaires, jours actifs et demande non satisfaite ;
- demande par chauffeur disponible ;
- tunnel demandes -> courses terminées ;
- montant financier à risque.

Une recharge wallet n'est jamais comptée comme revenu DriveLocal.

### File antifraude

Décisions disponibles :

- `mark_under_review` ;
- `warning_recorded` ;
- `temporary_restriction` ;
- `close_no_evidence` ;
- `fraud_confirmed`.

Chaque décision contient un code de raison, une note éventuelle, l'admin, l'heure et
la durée de restriction le cas échéant.

## Journaux utiles

Filtrer Cloud Logging / Metro sur :

```text
risk.
finance.reconciliation
wallet.hold
wallet.commission
ride.disputed
admin.risk
admin.analytics
analytics.supply_snapshot
```

Côté application admin :

```text
[ADMIN_ANALYTICS]
[ADMIN_RISK]
[ADMIN_RIDE_DETAIL]
```

Les logs doivent contenir `operation`, `traceId`, `rideId` ou un identifiant haché,
`reasonCode`, `result` et les montants en centavos lorsque nécessaire.

## Diagnostic d'une commission manquante

1. Ouvrir la course dans **Admin -> Détail de la course**.
2. Vérifier `commissionPolicySnapshot.holdAmountCentavos`.
3. Vérifier `commissionSettlementStatus`.
4. Vérifier `commissionCapturedCentavos` et `holdReleasedCentavos`.
5. Rechercher `${rideId}_hold`, `${rideId}_capture`, `${rideId}_release`.
6. Rechercher le `rideId` et le `traceId` dans les logs.
7. Consulter `financialAlerts` puis la file antifraude.
8. Ne jamais modifier directement `walletBalanceCentavos` : utiliser l'ajustement
   admin, qui crée une écriture compensatoire auditée.

## Validation avant merge

```powershell
cd C:\Users\guill\DriveLocal
git fetch origin
git checkout feat/anti-fraud-foundation
git pull --ff-only origin feat/anti-fraud-foundation

cd functions
npm test
cd ..
npm test
npm run lint
git status
```

Le déploiement DEV et le test physique viennent uniquement après ces trois résultats
verts et un working tree propre.

## Scénarios physiques obligatoires

1. Course normale avec commission standard.
2. Course gratuite valide au moment de l'acceptation.
3. Annulation après acceptation et libération intégrale.
4. Course avec commission finale inférieure à la retenue.
5. Double clic/rejeu sur acceptation, paiement et confirmation.
6. Litige ouvert : retenue conservée et nouvelles acceptations bloquées.
7. Résolution admin en faveur du chauffeur : capture unique.
8. Résolution admin sans commission due : libération unique.
9. Passager temporairement restreint : aucune route ni dispatch créé.
10. Tableau admin : recette, moto/voiture, abonnements, pics et offre chauffeur.
11. Doublon chauffeur : dossier créé, aucune approbation silencieuse.
12. GPS impossible : signal de révision sans stockage des coordonnées.
