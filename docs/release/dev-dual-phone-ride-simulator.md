# DriveLocal DEV — simulateur manuel de course à deux téléphones

## Objectif

Tester le flux réel passager + chauffeur avec le même APK development installé sur deux téléphones, sans déplacer physiquement le véhicule.

- téléphone A : compte passager DEV ;
- téléphone B : compte chauffeur DEV ;
- Firebase réel : `drivelocal-dev` ;
- écrans, Cloud Functions, notifications, wallet, commission et Pix direct : flux réels ;
- seule la position du véhicule est synthétique.

## Activation et disparition en production

Le panneau existe uniquement lorsque les deux conditions natives sont vraies :

```text
APP_ENV=dev
ENABLE_DEV_RIDE_SIMULATOR=1
```

Le profil EAS `development` active le flag. Les profils `preview` et `production` le forcent à `0`. `APP_ENV=prod` ou `APP_ENV=production` désactive toujours le simulateur, même si quelqu'un tente de forcer le second flag.

Il n'existe aucun réglage Firestore, geste caché ou Remote Config capable de l'activer après le build.

## Flux manuel

1. Le passager demande une course normalement.
2. Le chauffeur se met disponible et accepte normalement.
3. Dans `Corrida ativa`, le chauffeur utilise `Simular trajeto até o passageiro`.
4. La voiture/moto avance sur la carte du passager.
5. Le chauffeur appuie manuellement sur `Cheguei ao local`.
6. Le chauffeur appuie manuellement sur `Passageiro embarcou`.
7. La destination devient visible côté chauffeur.
8. Le chauffeur utilise `Simular trajeto até o destino`.
9. Le chauffeur appuie manuellement sur `Finalizar corrida`.
10. Le passager marque le Pix envoyé.
11. Le chauffeur confirme manuellement `Pagamento recebido` ou signale un problème.

Le simulateur ne change jamais le statut métier de la course et ne touche jamais aux données financières.

## Fonctionnement technique

- le GPS natif est suspendu explicitement pendant la simulation ;
- une route courbe déterministe est calculée uniquement en mémoire ;
- un point est publié toutes les 1,5 seconde ;
- `drivers/{uid}` reçoit la présence courante utilisée par le dispatch ;
- `activeRideLocations/{rideId}` reçoit uniquement le point courant visible par le passager ;
- aucun historique de trajet synthétique n'est écrit dans Firestore ou AsyncStorage ;
- la session DEV empêche un re-render de cycle de vie de réactiver le GPS natif au milieu du trajet ;
- `Encerrar simulação e restaurar GPS real` annule l'override et republie immédiatement une vraie position ;
- fin, annulation, paiement ou litige nettoient la simulation avant de détacher la course.

## Traçage et débogage

Le panneau affiche un identifiant :

```text
Trace: ride-sim-...
```

Metro reçoit des lignes JSON structurées :

```text
[DriveLocal][DEV_TRACE] {"scope":"dev_ride_simulator","eventName":"simulation_started",...}
[DriveLocal][DEV_TRACE] {"scope":"dev_ride_simulator","eventName":"simulation_step_published",...}
[DriveLocal][DEV_TRACE] {"scope":"dev_ride_simulator","eventName":"simulation_route_completed",...}
```

Les traces ne contiennent jamais : coordonnées, adresse, UID, rideId, téléphone, CPF, clé Pix, token ou secret.

Codes principaux :

| Code | Diagnostic |
|---|---|
| `DEV_SIMULATION_SESSION_MISMATCH` | la session GPS de la course n'est pas encore attachée |
| `DEV_SIMULATION_OVERRIDE_MISSING` | l'override a expiré ou a été nettoyé |
| `DEV_SIMULATION_LOCATION_REJECTED` | Firestore/Auth a refusé la publication |
| `DEV_SIMULATION_PROCESS_RESTARTED` | Android ou Metro a redémarré le processus |
| `DEV_SIMULATION_ROUTE_INVALID` | point de destination invalide |

Après un redémarrage, le trajet n'est jamais repris automatiquement. Le panneau affiche `interrupted` et demande une action explicite : relancer le trajet ou restaurer le GPS réel.

## Validation avant APK

```powershell
git pull --ff-only origin feature/dev-dual-phone-ride-simulator
npm test
npm --prefix functions test
npx expo-doctor
$env:APP_ENV="dev"
$env:ENABLE_DEV_RIDE_SIMULATOR="1"
npx expo config --type public
git diff --check
```

Dans la sortie Expo development :

```text
extra.appEnvironment = development
extra.devRideSimulatorEnabled = true
```

Validation production obligatoire :

```powershell
$env:APP_ENV="prod"
$env:ENABLE_DEV_RIDE_SIMULATOR="1"
npx expo config --type public
```

Résultat exigé :

```text
extra.appEnvironment = production
extra.devRideSimulatorEnabled = false
```

## Smoke test physique

- installer le même nouvel APK development sur les deux appareils ;
- utiliser deux comptes distincts ;
- vérifier les permissions GPS du chauffeur ;
- vérifier l'offre, l'acceptation et la notification passager ;
- lancer le trajet simulé vers l'embarquement ;
- vérifier mouvement, fraîcheur et recentrage côté passager ;
- pause/reprise ;
- arrivée et démarrage manuels ;
- trajet simulé vers destination ;
- fin, Pix envoyé, confirmation chauffeur ;
- vérifier la capture de commission et le nettoyage de `activeRideLocations/{rideId}` ;
- construire un profil production et confirmer l'absence totale du panneau DEV.
