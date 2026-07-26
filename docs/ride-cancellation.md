# Annulations et passager introuvable — pilote Horizonte

## Objectif

Le flux d'annulation doit rester explicite, traçable et financièrement neutre pendant le pilote :

- motifs prédéfinis uniquement ;
- aucun texte libre envoyé au backend ;
- aucun frais automatique d'annulation ;
- aucune commission capturée ;
- totalité du hold de commission libérée ;
- état de notification visible pour l'exploitation ;
- aucune ouverture des données privées de la course au chauffeur.

## Politique V1

```text
cancellationFeeCentavos = 0
cancellationFeePolicyVersion = no-cancellation-fee-v1
passengerNoShowWaitMs = 180000
```

Le chauffeur doit avoir confirmé son arrivée et attendre trois minutes complètes avant de pouvoir confirmer `passenger_no_show`.

## Motifs chauffeur

```text
passenger_no_show
pickup_address_incorrect
unsafe_pickup
vehicle_problem
driver_other
```

## Motifs passager

```text
no_longer_needed
driver_delayed
driver_not_moving
driver_or_vehicle_mismatch
passenger_safety_concern
passenger_other
```

Les deux anciennes constantes sont acceptées uniquement pendant la transition de version :

```text
motorista_cancelou  -> driver_other
passageiro_cancelou -> passenger_other
```

Tout autre texte arbitraire est refusé par la Function.

## Flux chauffeur — passager introuvable

```text
CHEGUEI AO LOCAL
→ backend enregistre driverArrivedAtMs
→ backend calcule passengerNoShowEligibleAtMs
→ notification “motorista chegou” mise en file
→ timestamps sûrs copiés dans driverOffers/{rideId}_{driverId}
→ compteur visible dans l'application chauffeur
→ bouton bloqué pendant trois minutes
→ confirmation chauffeur
→ transaction d'annulation
```

Le chauffeur ne lit jamais directement `rideRequests/{rideId}`. Le document complet reste réservé au passager et à l'administration afin de ne pas exposer la destination avant le démarrage.

## Transaction d'annulation

Dans une seule transaction Firestore :

1. relecture de la course ;
2. vérification de l'acteur authentifié ;
3. validation du statut annulable ;
4. validation du motif selon le rôle ;
5. validation du délai `passenger_no_show` ;
6. libération complète du hold ;
7. remise à zéro de la commission détenue ;
8. nettoyage des `activeRideId` ;
9. suppression de la position active ;
10. mise à jour de l'offre gagnante ;
11. création de l'événement de notification ;
12. passage de la course à `cancelled`.

## Champs enregistrés sur la course

```text
cancelledBy
cancelReasonCode
cancelledAtMs
cancellationPriorStatus
cancellationStage
cancellationElapsedSinceCreatedMs
cancellationElapsedSinceAssignedMs
cancellationWaitAfterArrivalMs
driverHadArrived
driverArrivedAtMs
passengerNoShowEligibleAtMs
cancellationFeeCentavos
cancellationFeePolicyVersion
cancellationNotificationEventId
cancellationNotificationStatus
cancellationNotificationAttemptCount
commissionOriginalHoldCentavos
commissionHoldCentavos
holdReleasedCentavos
commissionCapturedCentavos
commissionSettlementStatus
```

Aucune coordonnée GPS, adresse supplémentaire, téléphone, CPF, nom complet ou clé Pix n'est ajouté aux logs d'annulation.

## États de notification

```text
pending
sent
partially_failed
failed
not_required
```

Le trigger `cancellationNotificationStatusTrigger` recopie le résultat final du worker FCM sur la course. Il est rejouable et ne met à jour que la course qui référence exactement l'événement concerné.

## Logs attendus

### Client chauffeur

```text
[RIDE_CANCELLATION] passenger_no_show.requested
[RIDE_CANCELLATION] passenger_no_show.succeeded
[RIDE_CANCELLATION] passenger_no_show.failed
```

### Functions

```text
ride.arrived
ride.arrived_replayed
ride.cancelled
wallet.hold_released
ride.cancellation_audit_failed
ride.cancellation_notification_status_updated
ride.cancellation_notification_status_failed
```

Les erreurs secondaires d'audit ne font jamais croire au client que la transaction d'annulation a échoué après son commit.

## Recette manuelle DEV

### A. Annulation passager avant arrivée

1. créer une course ;
2. faire accepter la course ;
3. appuyer sur `Cancelar corrida` côté passager ;
4. fermer la première boîte : la course doit rester active ;
5. recommencer et choisir un motif ;
6. vérifier le statut `cancelled` ;
7. vérifier le retour de la totalité du hold chauffeur ;
8. vérifier `cancellationFeeCentavos = 0` ;
9. vérifier la notification chauffeur.

### B. Annulation chauffeur normale

1. accepter une course ;
2. appuyer sur `Cancelar corrida` ;
3. choisir `Problema com o veículo` ;
4. vérifier le nettoyage de la course active des deux côtés ;
5. vérifier la notification passager ;
6. vérifier qu'aucune commission n'a été capturée.

### C. Passager introuvable

1. accepter une course ;
2. appuyer sur `CHEGUEI AO LOCAL` ;
3. vérifier le compteur ;
4. vérifier le bouton désactivé avant trois minutes ;
5. tenter un appel manuel trop tôt : le serveur doit refuser avec `PASSENGER_NO_SHOW_WAIT_REQUIRED` ;
6. attendre trois minutes ;
7. confirmer `PASSAGEIRO NÃO APARECEU` ;
8. vérifier le statut annulé et le motif `passenger_no_show` ;
9. vérifier l'état réel de livraison de la notification.

### D. Restauration

1. arriver au point d'embarquement ;
2. fermer puis relancer l'application chauffeur ;
3. rouvrir la course active ;
4. vérifier que le compteur reprend avec les timestamps serveur ;
5. vérifier que la destination n'est pas ajoutée à l'offre avant `PASSAGEIRO EMBARCOU`.

## Hors périmètre

- frais automatiques d'annulation ;
- indemnité automatique chauffeur ;
- remboursement ou débit de carte ;
- chat libre ;
- décision automatique de fraude ou bannissement permanent.
