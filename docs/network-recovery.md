# DriveLocal — réseau et restauration

## Objectif

Le bloc réseau protège les courses contre les coupures Android, les retours au
premier plan et les résultats de callable incertains. Il ne remplace jamais le
serveur comme source de vérité et ne rejoue aucune mutation automatiquement.

## États réseau

```text
unknown
online
offline
reconnecting
```

Une activité est considérée confirmée en ligne après :

- un callable Firebase réussi ;
- un snapshot Firestore qui ne vient pas du cache ;
- une actualisation forcée du token Firebase Auth.

Un snapshot `fromCache=true` peut restaurer l’affichage, mais ne remet pas l’état
global à `online`.

## Détection sans dépendance native

Aucun package `expo-network` ou NetInfo n’est ajouté. Au retour au premier plan,
l’application force une actualisation bornée du token Firebase Auth :

```text
getIdToken(true)
timeout 12 secondes
sonde espacée de 8 secondes minimum
```

Cette sonde reste dans l’infrastructure Firebase déjà utilisée et n’appelle aucun
service tiers.

## Bandeau global

Le composant `NetworkRecoveryGuard` affiche :

```text
offline      → aucune action incertaine ne sera répétée
reconnecting → état serveur en cours de vérification
online       → connexion restaurée et listeners en actualisation
```

Le bouton `TENTAR` relance uniquement la sonde. Il ne crée pas de course, ne
confirme pas un Pix et ne remet pas le chauffeur disponible.

## Callables et idempotence

Pour les actions de course, l’application conserve localement une clé
d’idempotence pendant dix minutes :

```text
résultat confirmé            → clé supprimée
erreur métier confirmée      → clé supprimée
offline / timeout incertain  → clé conservée
nouvel appui manuel          → même clé
absence de nouvel appui      → aucun nouvel appel
```

Les paramètres de l’action ne sont pas stockés dans la file locale. Elle contient
seulement :

```text
hash local de action + ressource
clé d’idempotence
createdAtMs
expiresAtMs
```

Il n’existe aucun worker, timer ou `setInterval` capable de rejouer une action.

Actions protégées :

- acceptation d’offre ;
- arrivée chauffeur ;
- embarquement/démarrage ;
- fin de course ;
- confirmation Pix passager/chauffeur ;
- annulation ;
- passager introuvable ;
- message prédéfini ;
- signalement de paiement.

La création de course conserve déjà sa clé dans l’écran de demande. Si le serveur
a créé la course avant une coupure, `activeRideId` et le listener la restaurent.

## Indice local de course

Un seul indice minimal est enregistré dans AsyncStorage :

```text
version
rôle driver/passenger
rideId
hash local du propriétaire
statut
recordedAtMs
expiresAtMs
```

Il ne contient pas :

- nom ou contact ;
- pickup/destination ;
- coordonnées GPS ;
- montant ;
- clé ou payload Pix ;
- photo ou véhicule.

Expiration : 24 heures. Un indice d’un autre compte ou trop ancien est supprimé.

## Routes de restauration

```text
passager  → /searching
chauffeur → /active-ride
```

`/searching` relit la course puis redirige selon son statut vers chauffeur accepté,
Pix, litige ou course terminée. L’état local ne choisit jamais directement le
résultat métier.

La restauration automatique est autorisée uniquement depuis :

```text
/
/index
/landing
/passenger-home
/driver-home
```

Elle n’écrase jamais un écran support, confidentialité, inscription ou admin.

## Statuts

Indices supprimés :

```text
completed
cancelled
no_driver_available
dispatch_failed
```

`disputed` reste récupérable. Le GPS peut être arrêté pour ce statut, mais le
passager et le chauffeur doivent encore pouvoir consulter le litige et son suivi.

## Chauffeur

Le guard réseau ne crée jamais une session de travail. Le cockpit existant peut
restaurer une session distante déjà ouverte uniquement quand :

- le serveur indique `online` ;
- l’identifiant de session correspond ;
- le lease serveur est encore frais ;
- les permissions GPS sont toujours valides.

Une erreur réseau temporaire ne stoppe pas immédiatement le GPS local. Le lease
serveur de sept minutes empêche néanmoins un chauffeur fantôme d’être dispatché.

## Cache Firestore

Le profil passager utilise explicitement :

```text
getDoc
→ en erreur réseau : getDocFromCache
```

Le cache sert à la présentation et à la navigation. Les mutations restent des
callables serveur et ne sont jamais autorisées par une copie locale.

## Traces

```text
[NETWORK_RECOVERY] connection.unavailable
[NETWORK_RECOVERY] connection.recovered
[NETWORK_RECOVERY] probe.failed
[NETWORK_RECOVERY] action.started
[NETWORK_RECOVERY] action.succeeded
[NETWORK_RECOVERY] action.failed
[NETWORK_RECOVERY] idempotency.prepared
[NETWORK_RECOVERY] ride_hint.saved
[NETWORK_RECOVERY] ride_hint.cleared
[NETWORK_RECOVERY_UI] probe.requested
[NETWORK_RECOVERY_UI] ride_route.restored
[FIRESTORE_RECOVERY] read.succeeded
[FIRESTORE_RECOVERY] read.cache_fallback_succeeded
```

Aucune adresse, coordonnée, identité, clé Pix ou charge utile de paiement n’est
journalisée par ces traces.

## Recette manuelle DEV

### Passager — recherche

1. Créer une vraie demande de course.
2. Activer le mode avion pendant `searching`.
3. Vérifier le bandeau rouge.
4. Tenter une annulation une seule fois.
5. Vérifier le message réseau et l’absence de navigation fictive vers l’accueil.
6. Réactiver la connexion et toucher `TENTAR`.
7. Vérifier le bandeau de restauration et le statut réel de la course.

### Passager — redémarrage

1. Fermer de force l’application pendant `assigned`, `in_progress` et
   `awaiting_payment`.
2. Rouvrir l’application avec le même compte.
3. Vérifier la reprise via `/searching`, puis la redirection serveur correcte.
4. Répéter avec `disputed` et vérifier l’ouverture de `/pix-payment`.

### Chauffeur — course acceptée

1. Accepter une vraie offre.
2. Fermer de force l’application.
3. Rouvrir sur `driver-home`.
4. Vérifier la restauration vers `/active-ride`.
5. Vérifier que le GPS reprend uniquement pour un statut de déplacement.

### Résultat incertain

1. Couper la connexion juste après `FINALIZAR CORRIDA`.
2. Attendre le timeout sans appuyer plusieurs fois.
3. Réactiver la connexion.
4. Vérifier le snapshot de la course.
5. Si le serveur n’a pas confirmé, appuyer une seule fois de nouveau.
6. Vérifier dans les logs `idempotency.prepared` avec `reused: true`.
7. Vérifier une seule transition/commission côté serveur.

### Chauffeur disponible sans course

1. Passer online et confirmer la première position GPS.
2. Couper brièvement la connexion.
3. Vérifier que le guard ne crée aucune nouvelle session.
4. Vérifier que le GPS local n’est pas arrêté par un simple snapshot cache.
5. Après expiration réelle du lease, vérifier le retour offline serveur.

### Changement de compte

1. Enregistrer une course active avec un compte de test.
2. Se déconnecter.
3. Se connecter avec un autre compte.
4. Vérifier qu’aucune course du premier compte n’est restaurée.

## Déploiement

Ce bloc est uniquement mobile JavaScript et ne change ni Functions, ni règles, ni
indexes. Aucun rebuild natif n’est nécessaire pour ces fichiers, mais la recette
deux téléphones reste obligatoire avant le build de production.
