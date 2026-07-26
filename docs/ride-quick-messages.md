# Messages prédéfinis sécurisés — pilote Horizonte

## Objectif

Permettre au chauffeur et au passager de se coordonner pendant l'embarquement sans exposer de téléphone, email, WhatsApp ou chat libre.

Le téléphone envoie uniquement un code stable. Le backend valide le rôle et la phase, puis résout lui-même le texte visible.

## Périmètre

Les messages sont disponibles uniquement pendant :

```text
assigned
 driver_arrived
```

Ils disparaissent lorsque la course :

```text
commence
est annulée
passe au paiement
est terminée
est contestée
```

## Catalogue chauffeur

### Chauffeur en route

```text
driver_arriving
→ Estou chegando ao local.

driver_traffic_delay
→ O trânsito está mais lento que o previsto.
```

### Chauffeur arrivé

```text
driver_at_pickup
→ Estou no local indicado.

driver_cannot_stop_here
→ Não consigo parar exatamente no ponto. Procure o veículo próximo.
```

## Catalogue passager

```text
passenger_waiting
→ Estou aguardando no local indicado.

passenger_coming
→ Estou indo ao encontro do veículo.

passenger_needs_minute
→ Preciso de mais um minuto.

passenger_cannot_find_vehicle
→ Não encontrei o veículo.
```

Le backend contrôle quelles phrases sont valides pour chaque phase. Une application modifiée ne peut pas utiliser un code passager comme chauffeur ni envoyer un message après le début de la course.

## Flux

```text
utilisateur choisit une phrase
→ sendRideQuickMessageSecure
→ authentification obligatoire
→ relecture serveur de la course
→ rôle dérivé de passengerId / acceptedDriverId
→ validation du code et du statut
→ contrôle anti-spam
→ écriture dans un des six slots
→ création atomique de notificationEvents
→ FCM résout la phrase depuis le catalogue serveur
→ les deux écrans lisent la sous-collection sûre
```

## Stockage borné

```text
rideRequests/{rideId}/quickMessages/slot_0
...
rideRequests/{rideId}/quickMessages/slot_5
```

Le septième message remplace le plus ancien slot. La collection ne peut donc pas croître indéfiniment.

Chaque document contient uniquement :

```text
rideId
sequence
messageCode
senderRole
recipientRole
createdAtMs
expiresAtMs
notificationEventId
```

Il ne contient pas :

```text
UID utilisateur
nom
numéro de téléphone
email
CPF
adresse
coordonnée GPS
texte libre
clé Pix
```

L'application masque les messages de plus de deux heures.

## Sécurité Firestore

- écriture client interdite ;
- lecture autorisée au passager de la course ;
- lecture autorisée au chauffeur accepté ;
- lecture autorisée à l'administration ;
- le chauffeur reste interdit de lecture sur le document parent `rideRequests/{rideId}` ;
- aucune destination n'est copiée dans les messages.

## Anti-spam

```text
minimum entre deux messages du même rôle = 5 secondes
historique visible = 6 messages maximum
reçus d'idempotence = 10 opérations maximum
```

Même clé et même action : replay sans nouvel envoi.

Même clé et autre action :

```text
IDEMPOTENCY_CONFLICT
```

## Notifications

Événement :

```text
ride_quick_message
```

Payload data :

```text
notificationId
eventType
rideId
messageCode
recipientRole
route
traceId
```

Le texte visible n'est jamais lu depuis le document ou le téléphone. `processRideNotificationEvent` le résout depuis `quickMessageCatalog.js`.

Les événements classiques conservent leur forme précédente et ne reçoivent pas de champ `messageCode` vide.

## Logs attendus

### Application

```text
[RIDE_MESSAGE] panel.opened
[RIDE_MESSAGE] send.requested
[RIDE_MESSAGE] send.succeeded
[RIDE_MESSAGE] send.failed
```

### Functions

```text
ride.quick_message_sent
ride.quick_message_replayed
notification.sent
notification.failed
```

Les logs utilisent uniquement :

```text
rideId
senderRole
recipientRole
rideStatus
messageCode
sequence
résultat
```

Aucun texte visible, nom, téléphone, adresse ou coordonnée n'est journalisé.

## Recette DEV avec deux téléphones

### A. Chauffeur en route

1. créer et accepter une course ;
2. ouvrir `Mensagens rápidas` côté chauffeur ;
3. envoyer `Estou chegando ao local.` ;
4. vérifier l'apparition côté passager ;
5. vérifier la notification si l'application passager est en arrière-plan ;
6. toucher la notification et vérifier l'ouverture de la bonne course.

### B. Passager avant l'arrivée

1. côté passager, envoyer `Estou aguardando no local indicado.` ;
2. vérifier l'apparition et la notification côté chauffeur ;
3. vérifier qu'aucun numéro ou bouton d'appel n'est affiché.

### C. Après arrivée

1. appuyer sur `CHEGUEI AO LOCAL` ;
2. vérifier les nouvelles phrases disponibles ;
3. envoyer `Preciso de mais um minuto.` côté passager ;
4. envoyer `Não consigo parar exatamente no ponto...` côté chauffeur ;
5. vérifier que l'historique reste limité à six lignes.

### D. Anti-spam et phases

1. envoyer deux messages à moins de cinq secondes ;
2. vérifier le refus et le compteur d'attente ;
3. démarrer la course ;
4. vérifier la disparition complète du panneau ;
5. tenter le callable manuellement après démarrage ;
6. vérifier `QUICK_MESSAGE_NOT_ALLOWED`.

## Activation DEV ultérieure

Ce bloc contient :

```text
JavaScript application
Cloud Function callable
règle Firestore
pipeline FCM existant modifié
```

Après tests verts et autorisation explicite :

```powershell
firebase deploy --only functions,firestore:rules --project drivelocal-dev
npx expo start --dev-client -c
```

Aucun déploiement n'est lancé automatiquement depuis cette branche.

## Hors périmètre

- chat libre ;
- pièces jointes ;
- messages vocaux ;
- partage de téléphone ou WhatsApp ;
- appel masqué ;
- modération de texte, puisqu'aucun texte libre n'existe ;
- messages après le démarrage de la course.
