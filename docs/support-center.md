# Centre de support minimal — pilote Horizonte

## Objectif

Le support DriveLocal doit permettre de retrouver rapidement une course ou un paiement sans demander à l'utilisateur de copier des données sensibles.

Le pilote utilise uniquement :

- catégories prédéfinies ;
- références jointes côté serveur ;
- statuts prédéfinis ;
- résolutions prédéfinies ;
- historique utilisateur limité ;
- file administrative privée.

Il n'existe aucun chat libre, champ de note, pièce jointe, téléphone, WhatsApp ou email dans ce flux.

## Accès utilisateur

### Passager

- accueil passager ;
- course avec chauffeur ;
- écran de paiement Pix.

### Chauffeur

- cockpit chauffeur ;
- course active ;
- écran de paiement de la course.

Les écrans opérationnels transmettent uniquement :

```text
rideId
sourceRoute
```

Le serveur détermine le rôle réel depuis les profils Firestore et vérifie que l'utilisateur appartient à la course.

## Catégories

```text
ride_status_issue
cancellation_issue
safety_concern
fare_payment_issue
driver_or_vehicle_mismatch
passenger_no_show_review
wallet_topup_issue
previous_payment_issue (paiement antérieur, y compris les paiements historiques)
document_review_issue
account_access_issue
technical_error
```

Chaque catégorie possède une liste de rôles autorisés et indique si une course ou un paiement est nécessaire.

## Contexte de course autorisé

Le ticket peut conserver uniquement :

```text
status
vehicleType
serviceAreaId
createdAtMs
acceptedAtMs
driverArrivedAtMs
completedAtMs
paymentAmountCentavos
passengerMarkedPaid
commissionSettlementStatus
cancelReasonCode
cancellationStage
disputeReasonCode
```

Le support ne copie jamais :

- pickup ou destination ;
- coordonnées GPS ;
- nom du passager ou du chauffeur ;
- téléphone, email ou CPF ;
- photo, plaque ou documents ;
- clé Pix ou payload Pix ;
- texte fourni par l'utilisateur.

## Contexte de paiement chauffeur

Pour `wallet_topup_issue` et `previous_payment_issue` (paiement déjà enregistré), le serveur recherche :

```text
driverId == utilisateur authentifié
purpose == catégorie demandée
orderBy createdAtMs desc
limit 1
```

Les tickets historiques sous le code `subscription_issue` restent consultables et
continuent de déclencher une alerte administrative si leur résolution est en attente.
Le nouveau client ne propose plus ce code et le serveur refuse sa création.

L'index composite requis est versionné dans :

```text
backend/firebase/indexes/firestore.indexes.json
```

Le contexte administratif peut contenir :

```text
paymentRequestId
purpose
status
amountCentavos
provider
providerOrderId
createdAtMs
expiresAtMs
```

Il ne contient jamais le QR Code, l'image QR, la clé d'idempotence ou les réponses brutes du fournisseur.

## Création d'un ticket

```text
utilisateur authentifié
→ rôle dérivé côté serveur
→ catégorie validée
→ appartenance à la course contrôlée
→ dernier paiement utile recherché
→ doublon actif recherché
→ limite de tickets contrôlée
→ transaction Firestore
→ ticket privé créé
```

### Déduplication

Un ticket actif identique pendant 24 heures est réutilisé.

Le fingerprint tient compte de :

```text
utilisateur
catégorie
rideId éventuel
paymentRequestId éventuel
```

Il est stocké sous forme de hash non réversible.

### Limites

```text
5 tickets ouverts maximum par utilisateur
10 tickets maximum renvoyés à l'application
100 tickets maximum par lecture admin
```

## Stockage

Collection privée :

```text
supportTickets/{ticketId}
```

Aucune règle Firestore cliente ne donne accès à cette collection. Toutes les opérations passent par les Functions authentifiées.

### Projection utilisateur

```text
ticketId
actorRole
categoryCode
status
rideId
paymentRequestId
resolutionCode
createdAtMs
updatedAtMs
```

### Projection administrateur

La projection admin ajoute seulement :

```text
actorHash
sourceRoute
contextSnapshot
providerOrderId
adminUpdatedAtMs
```

L'UID brut n'est jamais envoyé au tableau de bord.

## Statuts

```text
open
in_review
resolved
closed
```

Transitions autorisées :

```text
open      → in_review | resolved | closed
in_review → open | resolved | closed
resolved  → closed | open
closed    → open
```

## Résolutions administratives

```text
guidance_provided
payment_under_review
operation_corrected
no_adjustment_required
safety_escalated
duplicate_ticket
resolved_by_system
```

Un statut `resolved` ou `closed` exige une résolution. Les statuts actifs n'acceptent aucune résolution anticipée.

Aucune note libre n'est enregistrée par l'administration.

## Audit

Une modification administrative crée un audit :

```text
action: support_ticket_status_changed
targetType: support_ticket
targetId: ticketId
beforeSummary: status + resolutionCode
afterSummary: status + resolutionCode + categoryCode
```

Une panne secondaire de l'audit ne revient pas sur la transaction déjà validée. Elle produit le log `support.ticket_audit_failed`.

## Logs attendus

### Application utilisateur

```text
[SUPPORT] ticket.create_requested
[SUPPORT] ticket.create_succeeded
[SUPPORT] ticket.create_failed
[SUPPORT] tickets.list_requested
[SUPPORT] tickets.list_succeeded
[SUPPORT] tickets.list_failed
```

### Administration

```text
[ADMIN_SUPPORT] tickets.loaded
[ADMIN_SUPPORT] tickets.load_failed
[ADMIN_SUPPORT] ticket.update_requested
[ADMIN_SUPPORT] ticket.update_succeeded
[ADMIN_SUPPORT] ticket.update_failed
```

### Functions

```text
support.ticket_created
support.ticket_replayed
support.ticket_duplicate_reused
support.ticket_status_changed
support.ticket_status_replayed
support.ticket_audit_failed
support.account_deletion_completed
support.account_deletion_skipped
```

Les logs utilisent des codes, statuts, références techniques et booléens de contexte. Ils ne contiennent ni texte utilisateur, adresse, coordonnées, contact, CPF ou clé Pix.

## Suppression de compte

Un trigger indépendant écoute la demande de suppression :

```text
actorUid → anonymousSubjectId
actorHash → nouveau hash anonyme
issueFingerprint → supprimé
accountDeleted → true
```

Le ticket et son contexte financier minimal peuvent rester disponibles pour les obligations opérationnelles, comptables, de fraude ou de litige, sans conserver le lien vers le compte Firebase supprimé.

Le trigger est idempotent, paginé et configuré avec retry.

## Déploiement DEV requis après validation

Le bloc ajoute :

- quatre callables ;
- un trigger de pseudonymisation ;
- un index composite Firestore ;
- du code JavaScript mobile.

Activation DEV, uniquement après autorisation :

```powershell
firebase deploy --only functions,firestore:indexes --project drivelocal-dev
npx expo start --dev-client -c
```

Aucun rebuild natif n'est requis pour ce bloc.

## Recette manuelle deux téléphones

### Passager — course active

1. créer et faire accepter une course ;
2. ouvrir `Ajuda e suporte` ;
3. vérifier que les catégories liées à la course apparaissent ;
4. envoyer `Problema com o pagamento da corrida` ;
5. vérifier que la référence courte de course apparaît ;
6. vérifier qu'aucun champ texte ou contact n'existe.

### Chauffeur — portefeuille

1. créer une recharge Pix DEV ;
2. ouvrir le support depuis le cockpit ;
3. envoyer `Problema com recarga do saldo` ;
4. vérifier que le dernier `paymentRequestId` correspondant est joint ;
5. vérifier que le QR et le payload Pix ne sont pas affichés.

### Doublon

1. ouvrir deux fois la même catégorie avec le même contexte en moins de 24 heures ;
2. vérifier que le ticket existant est réutilisé ;
3. vérifier qu'un seul document reste ouvert.

### Administration

1. ouvrir `Tickets de suporte` ;
2. filtrer `Abertos` ;
3. vérifier le hash acteur et les références techniques ;
4. passer le ticket `Em análise` ;
5. résoudre avec un code prédéfini ;
6. vérifier le nouveau statut côté utilisateur.

### LGPD

1. créer un ticket utilisateur ;
2. exécuter une demande de suppression DEV ;
3. vérifier que l'UID du ticket est remplacé ;
4. vérifier que `issueFingerprint` disparaît ;
5. vérifier que le contexte minimal reste exploitable sans identité directe.

## Hors périmètre

- chat libre ;
- pièce jointe ;
- appel téléphonique ;
- WhatsApp ou email ;
- réponse textuelle de l'administration ;
- remboursement automatique ;
- ajustement automatique du wallet ;
- décision automatique de sécurité ou de fraude.
