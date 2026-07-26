# DriveLocal — politique commerciale chauffeur

## Version

```text
commercial-policy-v2-2026-07
```

Cette politique est calculée côté serveur. L’application mobile possède un miroir
pur pour l’affichage, mais ne peut jamais autoriser une course, fixer un taux,
modifier un abonnement ou décider d’un paiement.

## Date de départ

La date de référence est l’approbation administrative immuable :

```text
approvedAt / approvedAtMs
```

Une nouvelle connexion, un renouvellement, une correction de profil ou un replay
d’approbation ne redémarre jamais la période gratuite.

## Règle finale

### Tous les chauffeurs approuvés

Pendant 60 jours depuis l’approbation :

```text
commission = 0%
```

Après 60 jours :

```text
moto = 12%
carro = 15%
```

Après 60 jours, un abonnement payé et non expiré est obligatoire pour recevoir
ou accepter une nouvelle offre.

### Fondateurs nº 1 à 100

Pendant les mêmes 60 jours :

```text
commission = 0%
abonnement = gratuit
```

Ils n’utilisent pas la grâce des cinq courses. Après le jour 60, ils doivent avoir
un abonnement actif comme les autres chauffeurs.

### Chauffeurs nº 101 et suivants

Pendant la fenêtre de 60 jours :

```text
commission = 0%
maximum 5 courses completed sans abonnement
```

La cinquième course reste autorisée lorsque `freeRideCountUsed = 4`. Dès que cette
course passe réellement à `completed`, le compteur devient 5. La prochaine offre
nécessite alors un abonnement actif.

La grâce se termine au premier événement suivant :

```text
course nº 5 completed
OU
fin du jour 60
```

Le jour 60 gagne toujours, même si le chauffeur n’a utilisé qu’une ou deux courses.
Après la cinquième course mais avant le jour 60, l’abonnement est requis, tandis
que la commission reste à 0% jusqu’à l’échéance de la période.

## Matrice de décision

| Chauffeur | Moment | Courses utilisées | Abonnement actif | Peut recevoir | Commission |
|---|---:|---:|---:|---:|---:|
| Fondateur #1–100 | avant jour 60 | quelconque | non | oui | 0% |
| Fondateur #1–100 | jour 60 ou après | quelconque | non | non | 12% moto / 15% car |
| Fondateur #1–100 | jour 60 ou après | quelconque | oui | oui | 12% moto / 15% car |
| #101+ | avant jour 60 | 0–4 | non | oui | 0% |
| #101+ | avant jour 60 | 5 | non | non | 0% |
| #101+ | avant jour 60 | 5 | oui | oui | 0% |
| #101+ | jour 60 ou après | 0–5 | non | non | 12% moto / 15% car |
| #101+ | jour 60 ou après | 0–5 | oui | oui | 12% moto / 15% car |

## Sources de couverture

La politique expose un code fermé :

```text
founder_free_window
non_founder_ride_grace
paid_subscription
none
```

Ces codes sont utilisables dans les logs, l’audit et les tests. Ils ne contiennent
aucune identité ou information de paiement.

## Champs chauffeur

Écrits à l’approbation :

```text
approvedAt
approvedAtMs
approvalNumber
founderEligible
founderNumber
commissionFreeUntil
subscriptionFreeUntil
freeRideCountUsed
commercialPolicyVersion
commercialPolicyAssignedAtMs
```

`subscriptionFreeUntil` est défini uniquement pour les fondateurs. Les chauffeurs
nº 101+ utilisent `freeRideCountUsed` et la date `commissionFreeUntil`.

## Snapshot à l’acceptation

Une course acceptée stocke une projection interne immuable :

```text
commercialPolicySnapshot.policyVersion
commercialPolicySnapshot.acceptedAtMs
commercialPolicySnapshot.approvalNumber
commercialPolicySnapshot.founder
commercialPolicySnapshot.vehicleType
commercialPolicySnapshot.freePeriodUntilMs
commercialPolicySnapshot.commissionBpsAtAcceptance
commercialPolicySnapshot.commissionFreeAtAcceptance
commercialPolicySnapshot.subscriptionCoverageSource
commercialPolicySnapshot.freeRideCountUsedAtAcceptance
commercialPolicySnapshot.freeRideLimit
```

Cette projection ne contient ni UID, ni téléphone, ni email, ni CPF, ni adresse,
ni coordonnées, ni clé ou payload Pix.

Le snapshot financier historique `commissionPolicySnapshot` reste séparé. Il
contient le hold et la version de tarification. Cette séparation facilite la
réconciliation :

```text
commercialPolicySnapshot = pourquoi le chauffeur était éligible
commissionPolicySnapshot = combien pouvait être réservé/capturé
```

## Comptage des cinq courses

Le compteur existant augmente seulement dans la transaction qui confirme :

```text
payment reçu
→ ride status = completed
→ completedRideCount + 1
→ freeRideCountUsed + 1, plafonné à 5 pour un non-fondateur
```

Une offre, une acceptation, une arrivée, une fin de trajet en attente de paiement,
un litige ou une annulation ne consomme pas de course.

L’idempotence de la transition `completed` empêche un double comptage après un
double appui ou un retry réseau.

## Paiements

### Abonnement

Le backend refuse de créer un QR Pix lorsque le chauffeur est encore couvert par :

```text
founder_free_window
non_founder_ride_grace
```

Le paiement devient possible :

```text
après la 5e course pour #101+
au jour 60 pour tous
```

Un abonnement payé déjà actif ne bloque pas un renouvellement anticipé. La règle
d’extension reste :

```text
max(now, subscriptionExpiresAt) + 30 jours
```

### Wallet

Aucune recharge n’est nécessaire pendant les 60 jours à 0%. Le backend bloque donc
la création Pix wallet pour tous les chauffeurs pendant cette période.

Après la période, les règles de solde et de hold s’appliquent normalement.

## Affichage chauffeur

Pourcentage autorisé :

```text
Comissão 0%
Comissão 12%
Comissão 15%
```

Ne jamais afficher :

```text
DriveLocal recebeu R$ X
Taxa da plataforma R$ X
Comissão cobrada R$ X
```

Le chauffeur peut voir le prix de la course, le montant qu’il reçoit, son solde,
le statut de paiement et le statut d’abonnement. Les centavos exacts de commission
restent backend, ledger et administration.

## Logs structurés

### Approbation

```text
driver.commercial_policy_assigned
driver.approval.duplicate_ignored
```

### Acceptation

```text
ride.accept.started
ride.accept.commercial_policy_frozen
ride.accept.duplicate_ignored
ride.accept.won
```

### Paiement

```text
payment.create.started
payment.create.commercial_policy_resolved
payment.create.not_required
payment.create.duplicate_ignored
payment.create.provider_success
payment.create.provider_failure
```

Métadonnées sûres :

```text
policyVersion
approvalNumber
founder
vehicleType
commissionBps
subscriptionCoverageSource
freeRidesRemaining
reasonCode
traceId
```

Ne jamais logguer :

```text
nom complet
téléphone
email
CPF
clé Pix
QR code
payload Pix
adresse
coordonnées GPS
```

## Compatibilité des profils existants

Lorsque `commissionFreeUntil` manque, la politique peut recalculer la date depuis
`approvedAtMs` ou `approvedAt`.

Lorsque `founderEligible` manque sur un ancien profil, un `approvalNumber` entre 1
et 100 peut être utilisé comme compatibilité. Un `founderEligible: false` explicite
garde toujours la priorité.

Les Timestamp Firestore sont normalisés avec `toMillis()` ; ils ne sont jamais
convertis avec `Number(timestamp)`.

## Recette manuelle DEV

Créer ou préparer quatre profils :

```text
A = fondateur #100, jour 59, sans abonnement
B = chauffeur #101, jour 20, 4 courses utilisées
C = chauffeur #101, jour 20, 5 courses utilisées
D = chauffeur #101, jour 60, 2 courses utilisées
```

Résultat attendu :

```text
A → éligible, 0%, paiement abonnement refusé car inutile
B → éligible, 0%, 1 course restante, paiement abonnement refusé car inutile
C → non éligible sans abonnement, 0%, paiement abonnement autorisé
D → non éligible sans abonnement, 12% moto ou 15% car, paiement autorisé
```

Puis activer un abonnement payé pour C et D : ils redeviennent éligibles. C reste à
0% jusqu’au jour 60 ; D utilise immédiatement 12% ou 15%.

## Tests automatisés

```text
functions/src/drivers/__tests__/commercialPolicy.test.js
functions/src/payments/__tests__/commercialPolicyPayment.test.js
functions/src/rides/__tests__/commercialPolicySnapshot.test.js
src/utils/__tests__/commercialPolicy.test.js
src/services/__tests__/commercialPolicyContract.test.js
```

Validation locale :

```powershell
npm test
npm --prefix functions test
```

Aucun déploiement ou migration n’est déclenché par ces tests.
