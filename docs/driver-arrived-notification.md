# Notification « Motorista chegou »

## Objectif

Quand le chauffeur appuie sur `CHEGUEI AO LOCAL`, DriveLocal doit garantir trois effets indépendants :

1. la course passe à `driver_arrived` ;
2. l'écran passager reflète immédiatement ce statut via Firestore ;
3. un événement de notification passager est disponible pour Firebase Cloud Messaging.

La livraison push est une conséquence asynchrone. Elle ne fait jamais partie de la transaction qui valide l'arrivée.

## Source de vérité

Callable : `markDriverArrivedSecure`

Transaction Firestore :

- lit `rideRequests/{rideId}` ;
- vérifie que l'appelant est le chauffeur accepté ;
- écrit `status = driver_arrived` ;
- écrit les horaires d'attente serveur ;
- met à jour la projection privée `driverOffers/{rideId}_{driverId}` ;
- crée, si nécessaire, `notificationEvents/{rideId}_ride_arrived_passenger`.

L'identifiant de notification est déterministe. Une répétition du callable ne peut donc pas créer un deuxième événement.

## Reprise et double appui

Un replay sur une course déjà en `driver_arrived` :

- conserve l'heure d'arrivée originale ;
- restaure les horaires d'attente manquants ;
- recrée l'événement de notification uniquement s'il est absent ;
- ne remet jamais un événement `sent`, `failed` ou `partially_failed` à `pending`.

Le mobile bloque également un second appui tant que le premier appel est en cours. Les reprises réseau utilisent la clé d'idempotence existante de `runRecoverableAction`.

## Notification Android

Titre :

```text
Motorista chegou
```

Corps :

```text
Seu motorista chegou ao local de embarque.
```

Caractéristiques :

- Firebase Admin Messaging ;
- priorité Android `high` ;
- canal `ride_status` ;
- vibration et son par défaut hors application ;
- route sécurisée `/driver-accepted` ;
- `rideId` obligatoire ;
- aucun nom, téléphone, adresse, CPF, coordonnée ou contenu Pix dans le payload.

## États de l'application

### Application ouverte

Le handler Expo affiche la notification dans la bannière et la liste. En parallèle, le listener Firestore met l'écran actif à jour vers `MOTORISTA CHEGOU`.

### Arrière-plan ou écran verrouillé

Le payload `notification` FCM et le canal Android haute importance permettent l'affichage par le système.

### Application fermée

`getLastNotificationResponseAsync` récupère le tap au démarrage. La navigation attend que Firebase Auth soit prête avant d'ouvrir `/driver-accepted?rideId=...`.

## Aucun token push

Si aucun token Android actif n'existe :

- l'événement passe à `failed` avec `failureReason = no_active_tokens` ;
- aucun appel FCM n'est tenté ;
- la course reste `driver_arrived` ;
- l'écran passager est mis à jour lorsqu'il ouvre ou utilise l'application ;
- le chauffeur continue son flux normalement.

Le chauffeur voit une confirmation honnête :

```text
Maria recebeu o aviso de chegada
A tela do passageiro já mostra que você chegou ao local de embarque.
```

Une note précise que le push extérieur à l'application dépend des notifications activées sur le téléphone, mais que l'arrivée reste enregistrée même avec une connexion lente ou les notifications désactivées.

## Tests

Backend :

- transition et événement atomiques ;
- replay avec événement manquant ;
- double appui avec événement déjà envoyé ;
- ancienne course sans heure d'arrivée ;
- contenu exact du push ;
- canal Android et priorité ;
- aucun token ;
- redélivrance d'un événement déjà traité.

Mobile :

- copie personnalisée et fallback sûr ;
- application ouverte ;
- tap arrière-plan ;
- démarrage après tap sur écran verrouillé ;
- route avec `rideId` ;
- blocage du double appui ;
- reprise réseau idempotente ;
- mise à jour des écrans passager ;
- confirmation chauffeur.
