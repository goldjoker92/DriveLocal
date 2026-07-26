# DriveLocal — alertas administrativos operacionais

## Objetivo

A caixa `adminAlerts` reúne incidentes que exigem ação humana sem substituir as
filas especializadas. Nenhuma decisão financeira, antifraude ou de suporte é
executada automaticamente por um alerta.

## Fontes monitoradas

| Fonte | Condição que abre alerta | Severidade | Fila relacionada |
|---|---|---:|---|
| `supportTickets` | `safety_concern` aberto/em análise | crítica | `/support-tickets` |
| `supportTickets` | pagamento, recarga ou assinatura aberto/em análise | alta | `/support-tickets` |
| `rideRequests` | corrida `disputed` | alta | `/ride-disputes` |
| `paymentRequests` | pagamento `manual_review` | alta | `/dashboard` |
| `fraudCases` | caso `high` ou `critical` aberto/em análise | alta/crítica | `/antifraud` |
| `accountDeletionRequests` | processamento `failed` | crítica | `/dashboard` |
| `clientErrorReports` | fatal imediato ou erro repetido pelo menos 3 vezes | alta/crítica | `/dashboard` |

Uma exclusão de conta apenas `blocked` por corrida/litígio ativo não é falha de
infraestrutura e não abre alerta. Um warning ou erro client isolé ne crée pas non
plus d’alerte administrateur.

## Deduplicação

O documento usa um ID determinístico:

```text
sha256(sourceType + sourceId)
```

Le même incident met à jour la même alerte. Une mise à jour de source qui ne
change ni type, ni sévérité, ni raison, ni montant, ni état ne produit aucune
nouvelle écriture.

Les rapports client sont déjà regroupés par empreinte, acteur hashé et fenêtre de
dix minutes avant d’entrer dans ce flux.

Les triggers vérifient la source avant et après :

```text
non actionnable avant + non actionnable après → aucun accès adminAlerts
actionnable avant ou après                  → synchronisation transactionnelle
```

## Cycle de vie

```text
open
→ acknowledged
→ in_progress
→ resolved
```

Transitions supplémentaires autorisées :

```text
open → in_progress
open → resolved
acknowledged → open
acknowledged → resolved
in_progress → open
resolved → open
```

Une alerte est automatiquement résolue avec `source_resolved` lorsque la source
ne correspond plus à une condition actionnable. Si l’admin avait déjà résolu
l’alerte, la fermeture de la source conserve la résolution admin et marque
uniquement `sourceActive=false`. Si le même incident redevient actionnable, la
même alerte est rouverte et son compteur augmente.

## Résolutions administratives

```text
action_completed
duplicate_alert
false_positive
reviewed_no_action
```

`source_resolved` est réservé à la fermeture automatique par le système.
Aucune note libre n’est acceptée par le callable ou l’écran.

## Données conservées

Une alerte peut contenir :

```text
alertType
severity
status
titleCode
actionCode
sourceType
sourceRefHash
sourceStatus
targetRoute
targetId opérationnel
reasonCode machine
amountCentavos optionnel
occurrenceCount
horodatages
resolutionCode
```

Elle ne contient jamais :

```text
UID passager/chauffeur
nom
email
téléphone
CPF
adresse
coordonnées GPS
photo/document
clé ou payload Pix
texte de webhook fournisseur
texte utilisateur libre
message ou stack de crash
componentStack
```

L’identifiant brut d’une demande de suppression de compte n’est pas stocké dans
`targetId`, car il peut être dérivé d’une identité. Le `reportId` client est déjà
composé d’un hash acteur, d’une empreinte et d’un bucket temporel, jamais d’un UID.

## Accès

`adminAlerts` reste inaccessible directement aux applications grâce au deny-by-
default Firestore. Les lectures et changements d’état utilisent uniquement :

```text
listAdminAlertsSecure
updateAdminAlertSecure
```

L’appartenance à `admins/{uid}` est vérifiée côté serveur.

## Indexes

Trois indexes `adminAlerts` sont versionnés :

```text
status + updatedAtMs DESC
severity + updatedAtMs DESC
status + severity + updatedAtMs DESC
```

Ils doivent être déployés avant la recette DEV de la file filtrée.

## Traces attendues

### Functions

```text
admin_alert.created
admin_alert.updated
admin_alert.reopened
admin_alert.resolved
admin_alert.source_inactive
admin_alert.listed
admin_alert.status_changed
admin_alert.status_replayed
admin_alert.audit_failed
admin_alert.source_sync_failed
```

### Application admin

```text
[ADMIN_ALERTS] alerts.loaded
[ADMIN_ALERTS] alerts.load_failed
[ADMIN_ALERTS] alert.update_requested
[ADMIN_ALERTS] alert.update_succeeded
[ADMIN_ALERTS] alert.update_failed
[ADMIN_ALERTS] alert.source_opened
```

## Recette manuelle DEV

1. Créer un ticket support `safety_concern`.
2. Vérifier une alerte critique unique dans `/admin-alerts`.
3. Modifier le ticket sans changer son état ou sa catégorie.
4. Vérifier qu’aucune deuxième alerte n’est créée.
5. Marquer l’alerte comme reconnue puis en traitement.
6. Ouvrir la file support depuis la carte.
7. Résoudre le ticket.
8. Vérifier la fermeture automatique `source_resolved`.
9. Ouvrir une course en litige et vérifier la route `/ride-disputes`.
10. Créer un dossier antifraude critique et vérifier `/antifraud`.
11. Passer un paiement à `manual_review` et vérifier que l’alerte ouvre le
    dashboard, jamais l’écran `/topups-pending` qui contient encore des mocks.
12. Simuler une suppression de compte `failed` et vérifier qu’aucun UID/request ID
    brut n’apparaît dans Firestore, l’écran ou les logs.
13. Créer un rapport client fatal et vérifier une alerte critique unique.
14. Créer deux erreurs client identiques et vérifier l’absence d’alerte haute.
15. Passer le compteur de cette empreinte à trois et vérifier l’alerte haute sans
    message, stack ou UID dans `adminAlerts`.

## Déploiement

Ce bloc ajoute des Functions et des indexes. Aucun déploiement n’est effectué par
le commit lui-même. Après tests locaux et autorisation explicite :

```text
DEV Functions + indexes
→ recette admin
→ corrections
→ retest complet
→ production uniquement après release gate
```
