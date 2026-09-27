# Revue fonctionnelle et UX — PR 87

Périmètre : disponibilité chauffeur, reprise de session, exclusion des sessions
non joignables, notification personnelle et diagnostic. Version 1.0.17 / Android 22.
Revue du 27 septembre 2026. Aucun déploiement, merge ou AAB effectué par cette revue.

## Modèle cohérent

Se connecter au compte ne démarre pas une journée de travail. Ouvrir une session
ne garantit pas non plus de recevoir une offre : le serveur doit avoir une position
récente liée à cette session, et les critères du compte doivent être satisfaits.
La même politique pure est utilisée par le serveur et l'interface. L'interface
ajoute les contrôles de confirmation serveur, de session locale et de l'appareil.

Le dispatch contrôle à nouveau la session dans la transaction de création des
offres. L'acceptation vérifie encore la validité de la session et de la position.
Le nettoyage relit la session avant d'agir et laisse les courses acceptées intactes.

## Matrice des scénarios

| Situation | Interface / action chauffeur | Comportement serveur |
| --- | --- | --- |
| Connecté au compte, travail non démarré | Indisponible ; commencer à travailler | Aucune nouvelle offre |
| Démarrage, première position en cours | Vérification jusqu'aux confirmations | Pas d'offre avant une position liée à la nouvelle session ; grâce de 90 s avant une alerte du moniteur |
| Toutes les confirmations sont bonnes | Disponible, attente de demandes proches | Éligible, sous réserve du véhicule, de la zone, de la distance et des exigences propres à la course |
| Données en cache ou serveur non confirmé | Vérification, jamais un nouveau vert issu du cache | Décision indépendante avec ses données confirmées |
| Petite coupure réseau | Vérification ; réessais de suivi existants | Tolérance bornée, sans fermer immédiatement le travail |
| Position ou heartbeat de plus de 3 min | Avertissement préventif | Peut encore être éligible selon les autres limites |
| Position entre 5 et 7 min | Avertissement ; vérifier et réactiver | Position de secours temporaire, après les candidats frais |
| Position de plus de 7 min, heartbeat encore récent | Indisponibilité expliquée | Exclu des nouvelles offres ; heartbeat seul ne renouvelle pas le GPS |
| Heartbeat de plus de 20 min | Indisponible, possibilité de reprise | Exclu, session encore récupérable jusqu'à 45 min |
| Plus de 45 min sans heartbeat | Session fermée ; commencer à nouveau | Fermeture transactionnelle si aucune course active |
| GPS coupé ou permission révoquée | Cause précise et accès aux réglages | Garde appareil et fraîcheur serveur empêchent une disponibilité durablement fictive |
| Notifications désactivées | Avertissement appareil et réglages | Le contrôle appareil demande l'arrêt de la session inactive ; l'exclusion GPS reste le filet serveur si le téléphone ne communique plus |
| App en arrière-plan ou écran verrouillé | Notification de session et suivi natif ; ouvrir pour vérifier l'état détaillé | Éligibilité conservée tant que les preuves restent fraîches |
| Android tue le suivi, téléphone éteint / sans réseau | Pas de promesse d'alerte instantanée ; statut réévalué au retour | Exclusion au dépassement des délais ; notification courte si livrable |
| Retour du GPS / réseau | Récupération automatique existante ou bouton explicite | Reprise seulement avec un point récent confirmé ; l'ancienne alerte est abandonnée avant envoi si devenue inutile |
| Plusieurs appuis / timeout UI | Bouton occupé ; délai compréhensible à 20 s | Une seule tentative de récupération en cours par compte ; l'appui suivant la rejoint |
| Changement de compte pendant la vérification | Ancienne tentative rejetée | Pas de publication déclenchée après le changement observé du compte |
| Ancienne session remplacée | Indisponibilité / retour au début | Anciennes écritures et offres ne réactivent pas la nouvelle session |
| Course acceptée pendant un balayage de nettoyage | Écran course prioritaire | Transaction relit `activeRideId` et ne ferme pas la session |
| Chauffeur arrêté / occupé entre sélection et création | Pas de nouvelle offre périmée | Revalidation transactionnelle avant écriture et notification |
| Ancienne notification après arrêt / reprise | Navigation réévalue le contexte | Acceptation liée à la session et aux délais ; aucun droit accordé par la notification |
| Compte non approuvé, bloqué, Pix invalide ou restriction | Explication et accès au profil / support | Exclusion selon les règles existantes |
| Solde insuffisant après la période gratuite | Accès au portefeuille | Filtre financier ; aucun changement aux commissions |
| Chauffeur dans ses 60 jours gratuits, même après le 100e | Pas de blocage par le solde minimum post-promotion | 0 % selon la date d'approbation existante ; badge sans privilège financier |
| Version insuffisante | Mise à jour demandée | Politique de build existante appliquée |
| Aucun chauffeur éligible / tous refusent | Aucun changement au parcours passager | La PR ne crée pas de disponibilité humaine et ne garantit pas une acceptation |

Une alerte serveur est prévue par interruption détectée, avec 15 minutes de
refroidissement et 60 secondes de validité. Elle reste distincte des broadcasts.
Le moniteur parcourt 100 profils par minute avec curseur ; une flotte plus grande
peut demander plusieurs passages. Le filtre du dispatch n'attend pas ce moniteur.
Une notification déjà livrée peut rester dans Android après une reprise : son
texte invite à vérifier la situation, et le statut de l'application fait référence.

## Corrections ajoutées pendant cette revue

- Une tentative GPS/Firestore qui dépasse le délai UI reste partagée, pour éviter
  que des appuis successifs lancent plusieurs récupérations concurrentes.
- Logs de début/résultat de récupération corrélés et transitions serveur journalisées
  après commit, avec raison et identifiants hachés.
- Deux zones d'alertes défilantes et bornées à 28 % de la hauteur utile chacune,
  avec adaptation à la rotation. Cela conserve de la place pour le cockpit même
  si une alerte réseau, une alerte GPS et une annonce coexistent.
- Les textes complets et le réglage de police système sont conservés. Boutons de
  disponibilité d'au moins 48 points, état occupé accessible, libellés explicites.
- Petits textes de statut vert et rouge assombris : contrastes testés à au moins
  4,5:1 sur leurs fonds. Un arrêt volontaire est présenté avec une couleur neutre.

## Preuves et limites de validation

Les tests existants couvrent le dispatch, les transitions course, les commissions,
les versions, les sessions périmées et les notifications. Les régressions ajoutées
couvrent les courses concurrentes, les récupérations tardives, la confidentialité
des logs et le rendu des alertes.

Le rendu React est testé en simulant 320×568 à police 100 % et 200 %, 568×320 à
200 %, et 768×1024 à 150 %. Ces tests vérifient les contraintes de hauteur,
l'absence de troncature forcée, les actions et les états occupés. **Ce n'est pas
une mesure visuelle du rendu Android ni un test de lecteur d'écran sur appareil.**

La CI dédiée vérifie l'export JavaScript Android et les 8 tests des règles Firestore
dans l'émulateur. Les cinq workflows existants doivent être verts sur le dernier
commit de la PR. Les logs de Jest conservent l'avertissement Expo de fermeture déjà
documenté ; la CI utilise son option `--forceExit` existante.

Avant publication, vérifier sur deux téléphones : premier démarrage ; 12 minutes
immobile en arrière-plan ; réception puis acceptation ; GPS coupé / mode avion ;
reprise ; arrêt volontaire ; notification ancienne ; course active et paiement ;
police Android maximale et petit écran. Les restrictions batterie des fabricants
et la réception FCM réelle ne peuvent pas être certifiées par les tests unitaires.

## Bénéfice attendu

Le chauffeur comprend s'il peut recevoir une demande et sait quelle action faire.
Le serveur gaspille moins d'offres sur des sessions devenues inutilisables. Le
support peut distinguer panne de GPS, problème de session, absence de demande et
refus humain grâce aux raisons et traces. Aucun gain de taux d'acceptation n'est
encore mesuré : il faudra le comparer après mise en service.

Ordre de release : voir `driver-availability-build-22.md`. Functions + règles
Firestore + prochain AAB sont nécessaires ; relever le minimum seulement après
la disponibilité Google Play.
