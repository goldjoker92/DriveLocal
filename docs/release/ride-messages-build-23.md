# Messagerie de course — 1.0.18 / Android 23

Branche : `feat/minimal-ride-messaging`. Base : `main` après la PR #87, commit `61881a0`.
Aucun déploiement, merge, broadcast ou build AAB n'est effectué par cette PR.

## Parcours

L'entrée « Mensagens da corrida » apparaît sur la course acceptée des deux rôles.
Elle ouvre le même composant, dans le groupe de navigation de chaque rôle : le
contexte chauffeur (disponibilité, suivi de la course) reste monté.

- Réponses rapides existantes conservées. Deux ajouts chauffeur : « Não estou vendo você » et « Onde você está esperando? ».
- Texte libre limité à 280 points de code Unicode, accents et emoji compris.
- Boutons de 48 points minimum, bulles contrastées, liste virtualisée, compositeur défilant avec hauteur bornée, champ multiligne et clavier géré par le layout racine existant.
- Historique paginé par fenêtres de 50 messages, du plus récent au plus ancien ; action « Mensagens anteriores ».
- Envoi autorisé uniquement en `assigned` et `driver_arrived`. Dès le début, l'annulation ou la fin de la course : lecture seule.
- Historique également accessible depuis les listes de courses chauffeur et passager.
- « Enviada » indique l'enregistrement confirmé par le serveur. Aucun accusé « reçu » ou « lu » n'est inventé.
- Un double appui est bloqué immédiatement. Après erreur ou timeout, la même tentative conserve sa clé ; le texte reste présent pendant que l'écran reste ouvert. Modifier le texte constitue une nouvelle tentative.
- Aucun envoi automatique différé. Les brouillons ne sont pas persistés sur le téléphone ; quitter l'écran ou changer de compte les efface. Un envoi déjà accepté par le serveur reste dans l'historique.

## Compatibilité avec les applications installées

`openRideConversationSecure` vérifie le participant et annonce sa capacité dans
`rideRequests/{rideId}/conversation/state`. L'entrée de la course appelle cette
fonction automatiquement : les deux personnes n'ont pas besoin d'ouvrir le chat.

Le serveur autorise le texte libre et les deux nouveaux codes seulement quand les
deux rôles ont annoncé cette capacité pour cette course. En attendant, l'interface
explique la situation et propose les anciens codes, toujours lisibles par une
ancienne application. Cette capacité est liée à la course et au compte, pas à une
preuve de présence ou de lecture ; elle ne garantit pas que la personne consulte
actuellement le même appareil. Ne pas la réutiliser pour mesurer la disponibilité.

Les six emplacements `quickMessages` restent alimentés pour les anciens clients.
Les nouveaux clients fusionnent ces emplacements avec l'historique permanent sans
doublon de séquence. Les messages déjà écrasés avant ce changement ne peuvent pas
être reconstitués. Les routes des notifications restent compatibles ; les nouveaux
clients ouvrent directement leur écran de conversation.

## Contrat serveur et diagnostic

- Nouveau `sendRideMessageSecure` : `{ rideId, text, idempotencyKey }`, acteur dérivé de Firebase Auth et de la course.
- Nouveau `openRideConversationSecure` : `{ rideId }`, projection minimale `{ rideId, role, status, traceId }`. Aucune adresse exacte ou identité du correspondant.
- `sendRideQuickMessageSecure` reste compatible avec son ancien contrat, ajoute un message immuable et conserve les six emplacements.
- `rideRequests/{rideId}/messages/{hash}` : type (`text` / `preset`), texte ou code, rôles émetteur/destinataire, séquence, horodatages serveur, `traceId`, référence de notification.
- Une transaction valide droits, étape, capacité et délai de 5 secondes par rôle, commun aux deux endpoints. Elle écrit message, séquence et événement de notification ensemble.
- Même clé + même contenu : résultat original, sans nouvel événement, y compris après fermeture. Même clé + autre contenu : `IDEMPOTENCY_CONFLICT`.
- Les règles permettent la lecture aux participants et aux administrateurs. Aucune écriture directe, aucun accès supplémentaire au document privé parent pour le chauffeur.
- Le texte libre ne part ni dans les logs, ni dans l'outbox, ni dans FCM. Notification : « Nova mensagem na corrida » / « Abra o DriveLocal para ver a mensagem. ».
- Aucun message ne change l'arrivée, le compteur d'attente, le prix, la commission, le paiement, le dispatch ou le statut de course. Le bouton « Cheguei » reste l'action métier officielle.

Chercher les événements `ride.conversation.opened`, `ride.message.started`,
`ride.message.succeeded`, `ride.message.replayed`, `ride.message.rejected` et les
anciens `ride.quick_message_sent/replayed`. Corrélation par `rideId`, `messageId`,
`sequence`, `traceId` et `notificationEventId`. Côté app : préfixe `[RIDE_MESSAGE]`,
`send.requested/succeeded/failed` et `conversation.failed`. Les logs client ont une
liste explicite de champs autorisés, sans texte ni erreur brute.

Codes : `MESSAGE_PEER_NOT_READY`, `MESSAGE_CLOSED`, `MESSAGE_INVALID_TEXT`,
`QUICK_MESSAGE_RATE_LIMIT` (+ `remainingMs`), `QUICK_MESSAGE_NOT_ALLOWED`,
`FORBIDDEN`, `IDEMPOTENCY_CONFLICT`. Les erreurs métier du texte libre renvoient une
référence de trace affichable à l'utilisateur.

L'historique nouveau n'a pas de purge périodique activée. La suppression de compte
purge les textes et capacités des courses concernées avant leur anonymisation,
avec pagination et reprise possible. Elle ne supprime pas les données financières
de la course. Ne pas annoncer une durée de conservation automatique inexistante.

## Vérification

La CI existante lance les suites application et Functions et exporte le JavaScript
Android via Metro/Hermes. L'export n'est pas un AAB. La nouvelle CI « Ride messages »
lance Firestore sur `demo-drivelocal-chat` (aucun accès production) pour tester droits,
concurrence transactionnelle et nettoyage du contenu.

| Scénario | Résultat attendu |
| --- | --- |
| Acceptée, deux clients compatibles | Réponses rapides et texte libre, mise à jour en direct |
| Ancien client en face | Anciens codes utilisables, texte libre expliqué et désactivé |
| Aucune affectation / tiers / mauvais rôle | Pas d'envoi ou d'accès indu |
| Double appui / deux requêtes simultanées avec même clé | Un seul message et un seul événement |
| Deux messages différents simultanés, même rôle | Un accepté, l'autre limité par le délai serveur |
| Timeout après commit | Nouvelle tentative avec la même clé : résultat original |
| Texte vide, invisible ou supérieur à 280 | Refus sans création |
| Arrivée officielle du chauffeur | Messagerie reste ouverte ; messages sans effet sur l'attente |
| Début, annulation, paiement, fin | Historique lisible, nouvel envoi refusé |
| Compte changé / écran quitté | Abonnements arrêtés, réponse tardive ignorée, brouillon effacé |
| Notification retardée après fermeture | Ouverture de l'historique, envoi toujours interdit |
| Compte supprimé | Texte purgé, course financière conservée/anonymisée |

Les tests de composants couvrent petits écrans, paysage et police à 200 % via les
dimensions simulées. Ils ne remplacent pas une validation physique Android.
Avant publication, tester sur deux téléphones : clavier et gestes retour, réception
réelle foreground/background, coupure réseau au moment de l'envoi, ancien/nouveau
client, démarrage et annulation pendant que le chat est ouvert.

## Mise en ligne, après validation

Depuis le `main` mergé et vérifié, déployer Functions et règles **avant** l'AAB :

```powershell
firebase deploy --only functions,firestore:rules --project drivelocal-prod
```

Fonctions de cette PR à inclure :

- **Nouvelles** : `openRideConversationSecure`, `sendRideMessageSecure`.
- **Modifiées** : `sendRideQuickMessageSecure`, `processRideNotificationEvent`, `processAccountDeletionRequest`.
- Règles : lectures `messages` et `conversation`, écritures client interdites.

Le déploiement groupé inclut aussi les changements déjà mergés de disponibilité
chauffeur. Aucun index composite nouveau. Ne pas déployer seulement les deux
nouvelles Functions : anciens codes, notifications et suppression de compte doivent
utiliser la même version.

Ensuite seulement : AAB distant depuis ce même `main`, version **1.0.18 / 23**,
test à deux appareils et publication. Ne relever aucun build minimum avant la
disponibilité Play. Cette PR ne change ni la politique de devis ni le minimum requis.

Retour arrière : le backend accepte toujours les codes des anciennes applications.
Conserver les endpoints/règles de messagerie tant que le build 23 est installé ; une
restauration serveur aveugle les retirerait à ces clients. Ne supprimer aucune
collection pour revenir à une ancienne interface.
