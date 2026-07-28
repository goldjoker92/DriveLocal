# Historique et statistiques chauffeur — Bloc 20

## Objectif

Le cockpit chauffeur présente des données réelles, personnelles et compréhensibles :

- courses et gains du jour ;
- courses et gains de la semaine ;
- total des courses conclues ;
- taux d’acceptation ;
- taux de complétion ;
- trois dernières courses ;
- historique paginé complet.

Aucun chiffre n’est simulé sur le mobile.

## Sources Firestore

### Revenus du jour et de la semaine

`drivers/{uid}.cockpitStats`

Mise à jour par `driverCockpitStatsTrigger` après le premier passage d’une course à `completed`.

Dans DriveLocal V1, le passager paie directement le chauffeur par Pix. Les « gains » affichés correspondent donc au prix final de la course reçu par le chauffeur, et non au prix diminué de la commission. La commission DriveLocal est gérée séparément dans le wallet.

### Taux de performance

`drivers/{uid}.driverPerformanceStats`

Mise à jour par trois projections idempotentes :

1. création de `driverOffers/{offerId}` → `offersReceivedCount` ;
2. passage de l’offre à `accepted` → `offersAcceptedCount` ;
3. passage d’une course acceptée à `completed` ou `cancelled` → classification du résultat.

Chaque document source reçoit un marqueur de version. Une relivraison Firestore ne peut donc pas compter deux fois le même événement.

## Définitions affichées

### Taux d’acceptation

```text
nombre d’offres acceptées / nombre d’offres reçues
```

Une offre expirée ou refusée reste dans le dénominateur puisqu’elle a réellement été proposée au chauffeur.

### Taux de complétion

```text
courses conclues / (courses conclues + annulations imputables au chauffeur)
```

Entrent dans le taux :

- une course `completed` ;
- une course `cancelled` par le chauffeur pour une raison qui lui est imputable.

N’entrent pas dans le dénominateur :

- une annulation faite par le passager ;
- une annulation chauffeur avec le motif valide `passenger_no_show` ;
- une course encore active.

Ces annulations exclues restent comptabilisées séparément dans `excludedCancellationCount` pour l’audit, mais elles ne pénalisent jamais le chauffeur.

### Absence de données

Avant qu’un vrai dénominateur existe, le mobile affiche :

```text
—
```

Il n’affiche jamais un faux `0 %`.

Pour les profils antérieurs à l’activation de cette projection, le total historique des courses conclues reste disponible via `completedRideCount`. Les taux commencent à être suivis à partir du premier événement traité par `driver-performance-stats-v1`, et l’écran l’explique au chauffeur.

## Historique sécurisé

Callable :

```text
getDriverRideHistorySecure
```

Query serveur :

```text
rideRequests
where acceptedDriverId == uid authentifié
orderBy acceptedAtMs desc
orderBy document id desc
limit 20 + 1
```

Le curseur contient uniquement :

- `beforeAcceptedAtMs` ;
- `beforeRideId`.

Le cockpit demande trois éléments. L’écran complet demande vingt éléments par page.

## Projection retournée au mobile

Chaque course contient uniquement :

- identifiant de course ;
- date et heure ;
- prénom public du passager ;
- libellé pickup raccourci ;
- libellé destination raccourci ;
- type de véhicule ;
- prix final ou estimé ;
- commission en pourcentage : `0 %`, `12 %`, `15 %` ou indisponible ;
- statut de la course ;
- statut du Pix.

Sont explicitement exclus :

- uid passager ;
- téléphone, email, CPF ;
- coordonnées GPS ;
- photo et chemin Storage ;
- clé ou payload Pix ;
- montant exact de la commission ou du hold ;
- écritures du ledger wallet.

## États Pix présentés

| Code | Affichage |
|---|---|
| `not_started` | Pix ainda não iniciado |
| `awaiting_payment` | Aguardando pagamento |
| `sent_by_passenger` | Passageiro informou o envio |
| `received` | Pix recebido |
| `disputed` | Pagamento em análise |
| `not_applicable` | Pix não aplicável |

## UX cockpit

Le cockpit affiche :

```text
HOJE
corridas • recebidos

ESTA SEMANA
corridas • recebidos

SEU DESEMPENHO
corridas concluídas • taxa de conclusão • taxa de aceitação

ÚLTIMAS 3 CORRIDAS
[ VER TODAS ]
```

Chaque ligne récente affiche le passager, la date, le trajet, le véhicule, le prix, le pourcentage de commission, le statut course et le statut Pix.

## Déploiement requis plus tard

Le code ajoute :

- un index composite `acceptedDriverId + acceptedAtMs + __name__` ;
- le callable `getDriverRideHistorySecure` ;
- trois triggers `driverPerformanceStats`.

Aucun déploiement ne doit être réalisé sans autorisation explicite.
