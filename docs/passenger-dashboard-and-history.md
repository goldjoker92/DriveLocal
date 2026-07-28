# Dashboard et historique passager — Bloc 21

## Objectif

L’accueil passager devient un tableau de bord réel et compact :

- la course active est toujours prioritaire ;
- sans course active, le passager peut saisir départ, destination et véhicule directement ;
- les trois dernières courses sont visibles sur l’accueil ;
- un écran paginé permet de consulter tout l’historique disponible.

Aucune valeur financière ou donnée de course n’est simulée sur le mobile.

## Course active prioritaire

Source d’autorité :

```text
passengers/{uid}.activeRideId
```

Le profil passager est écouté en temps réel avec les métadonnées Firestore. Dès que `activeRideId` change, l’accueil :

1. ouvre un listener sécurisé sur `rideRequests/{rideId}` ;
2. ouvre le listener de position `activeRideLocations/{rideId}` ;
3. affiche la carte correspondant au statut serveur ;
4. masque la nouvelle demande de course afin d’empêcher une double sollicitation visuelle.

Le backend conserve également son contrôle `RIDE_IN_PROGRESS` : modifier le mobile ne permet pas de créer une deuxième course.

### Routes de reprise

| Statut | Route |
|---|---|
| `searching` | `/searching` |
| `assigned` | `/driver-accepted` |
| `driver_arrived` | `/driver-accepted` |
| `in_progress` | `/driver-accepted` |
| `awaiting_payment` | `/pix-payment` |
| `payment_marked_sent` | `/pix-payment` |
| `disputed` | `/pix-payment` |
| `completed` | `/ride-completed` |

### Informations de la carte active

La carte affiche selon le statut :

- état de la course ;
- prénom public du chauffeur ;
- type, marque, modèle, couleur et plaque du véhicule ;
- pickup ;
- destination ;
- montant final, montant de paiement ou estimation serveur ;
- rappel du Pix direct passager → chauffeur ;
- position chauffeur et estimation via `RideTrackingMap` lorsque le statut le permet.

La carte utilise uniquement `acceptedDriverPublic`, projection publique déjà validée côté serveur.

## Demande compacte

Sans course active, l’accueil affiche :

```text
Olá 👋
Para onde vamos?
📍 Local de partida
🏁 Para onde?
🏍 Moto
🚗 Carro
```

Le bouton `PEDIR CORRIDA` :

1. géocode les deux textes dans le contexte de Horizonte ;
2. transmet les coordonnées et libellés à `requestRide` ;
3. conserve le véhicule réellement choisi ;
4. conserve la même clé d’idempotence en cas de retry sans modification des champs ;
5. laisse le backend valider la zone, calculer le prix et effectuer le dispatch ;
6. route vers `/searching` avec le résumé serveur.

Le mobile ne fournit jamais le prix, la commission, la distance officielle ou la zone de service.

## Historique sécurisé

Callable :

```text
getPassengerRideHistorySecure
```

Query serveur :

```text
rideRequests
where passengerId == uid authentifié
orderBy createdAtMs desc
orderBy document id desc
limit 20 + 1
```

Le curseur contient uniquement :

- `beforeCreatedAtMs` ;
- `beforeRideId`.

L’accueil demande trois éléments. L’écran complet demande vingt éléments par page.

## Projection retournée au mobile

Chaque élément contient uniquement :

- identifiant de course ;
- date et heure ;
- prénom public du chauffeur ou `Motorista não atribuído` ;
- véhicule public ;
- libellé pickup ;
- libellé destination ;
- montant final ou estimé ;
- statut de la course ;
- statut du Pix.

Sont explicitement exclus :

- UID du chauffeur ;
- téléphone, email, CPF ;
- coordonnées GPS brutes ;
- photo et chemin Storage ;
- clé ou payload Pix ;
- commission exacte, hold et écritures wallet ;
- données privées de vérification chauffeur.

## États historiques

L’historique inclut également les recherches sans chauffeur et les annulations. Cela évite de donner au passager une vision artificiellement incomplète de ses demandes.

Lorsqu’aucun chauffeur n’a été attribué :

```text
Motorista não atribuído
```

Lorsqu’un montant n’existe pas :

```text
Valor indisponível
```

Le mobile n’invente jamais un chauffeur, un véhicule ou un montant.

## Index Firestore

Le bloc ajoute l’index :

```text
passengerId ASC
createdAtMs DESC
__name__ DESC
```

## Déploiement requis plus tard

Le code ajoute :

- le callable `getPassengerRideHistorySecure` ;
- l’index composite de l’historique passager.

Aucun déploiement Firebase ou d’index ne doit être réalisé sans autorisation explicite.