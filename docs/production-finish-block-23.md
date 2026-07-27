# Bloc 23 — Logs et finition production

## Objectif

Le bloc 23 ferme les risques transversaux avant une décision de build production :

- traces cohérentes et filtrables ;
- aucune donnée privée dans les logs ;
- aucun mock financier dans les sources exécutables ;
- reprise réseau et idempotence conservées ;
- CTA utilisables sur petit Android et avec police agrandie ;
- notifications, navigation et Mercado Pago présents dans la gate ;
- `release:check` non mutatif et bloquant.

Ce bloc ne déploie rien, ne génère aucun APK/AAB et ne soumet rien au Play Store.

---

## Vocabulaire de phase

Les loggers mobile et Functions normalisent les événements existants avec :

```text
requested
started
succeeded
failed
restored
duplicate_ignored
```

Les noms métier restent précis, par exemple :

```text
work_session.start_requested
ride.accept.started
ride.accept.won
ride.arrived_replayed
notification.duplicate_ignored
navigation.external_open_failed
```

Le champ commun `phase` permet de filtrer tous les domaines avec le même vocabulaire sans renommer les événements historiques.

Domaines couverts :

```text
disponibilité
GPS
offre
acceptation
arrivée
embarquement
fin de course
Pix
wallet
abonnement
notification
Waze / Google Maps
restauration
```

---

## Confidentialité des logs

### Mobile

Le logger mobile conserve uniquement :

- codes d’erreur stables ;
- statut et résultat ;
- durée ;
- identifiant de course/trace ;
- montants utiles côté passager ;
- présence ou absence d’une projection.

Il exclut :

- message libre d’erreur ;
- stack et cause ;
- coordonnées ;
- libellés d’adresse ;
- nom, téléphone, email et CPF ;
- UID de la contrepartie ;
- payload Pix ;
- montant interne de commission/hold ;
- inventaire arbitraire des champs reçus.

### Functions

Le redactor récursif remplace par `[REDACTED]` les clés d’identité, de localisation exacte, de contact, de secrets et de payloads fournisseur.

Les hash non réversibles comme `actorUidHash` et `driverIdHash` restent visibles pour la corrélation opérationnelle.

---

## Audit source automatique

`scripts/release/production-source-audit.js` bloque notamment :

- retour de `mockDrivers`, `MOCK_TX`, faux wallets/paiements/abonnements ;
- `allowFontScaling=false` dans les sources mobiles ;
- disparition des six phases opérationnelles ;
- retour du texte libre `errorMessage` dans le logger mobile ;
- couverture insuffisante du redactor Functions ;
- disparition des traces Waze/Google Maps ;
- disparition de l’idempotence/récupération réseau ;
- disparition des handlers de notifications foreground/background/cold start ;
- disparition du cas `no_active_tokens` ;
- disparition des secrets/adapters/webhook Mercado Pago ;
- régression de la cible tactile ou de l’accessibilité du bouton commun.

L’audit est appelé :

1. par la suite Jest mobile via `releaseGate.test.js` ;
2. par `npm run release:check` avant les tests complets.

---

## Accessibilité et petits écrans

`AppButton` impose :

```text
hauteur tactile minimale : 48 px
accessibilityRole : button
accessibilityState.disabled
texte centré et repliable
```

Aucun écran source ne doit désactiver `allowFontScaling`.

La validation physique reste obligatoire, car une analyse statique ne peut pas prouver le rendu exact d’un téléphone réel.

---

## Checklist automatique

À exécuter sur la branche :

```powershell
npm test
npm --prefix functions test
```

Puis, uniquement lorsque les variables et preuves PROD sont prêtes :

```powershell
npm run release:check
```

`release:check` vérifie :

- configuration Android/EAS/Firebase PROD ;
- secrets requis par leur nom, jamais leur valeur ;
- URLs légales publiques ;
- règles et indexes Firebase versionnés ;
- simulateur DEV désactivé en production ;
- audit source du bloc 23 ;
- tests application ;
- tests Functions ;
- validation de configuration Firebase PROD.

Il ne lance jamais :

```text
firebase deploy
eas build
eas submit
```

---

## Checklist APK DEV — deux téléphones

La variable existante `RELEASE_CONFIRM_DEV_APK=YES` ne doit être renseignée qu’après cette validation réelle.

### Appareils

- un téléphone chauffeur ;
- un téléphone passager ;
- Android petit écran si disponible ;
- taille de police système normale puis agrandie.

### Parcours complet

1. connexion des deux comptes ;
2. chauffeur online avec GPS et notifications ;
3. demande passager Moto puis Carro ;
4. offre reçue et chrono ;
5. double appui sur accepter ;
6. Waze et Google Maps vers pickup ;
7. retour dans DriveLocal et restauration du contexte ;
8. `CHEGUEI AO LOCAL` ;
9. notification avec application ouverte ;
10. notification en arrière-plan ;
11. notification écran verrouillé ;
12. arrivée sans token/notifications désactivées ;
13. `PASSAGEIRO EMBARCOU` ;
14. navigation vers destination ;
15. fin de course ;
16. QR Pix et copia e cola ;
17. paiement signalé ;
18. confirmation chauffeur ;
19. historique chauffeur et passager ;
20. wallet et abonnement réels.

### Réseau

Répéter une action critique avec :

- réseau lent ;
- coupure avant réponse ;
- retour réseau ;
- nouvel appui manuel ;
- vérification qu’aucune opération n’est doublée.

Les actions ne sont jamais rejouées automatiquement. La clé d’idempotence est conservée seulement lorsque la confirmation serveur est incertaine.

### UI

Vérifier avec police agrandie :

- aucun CTA critique inaccessible ;
- texte des boutons replié proprement ;
- footer fixe visible ;
- scroll possible jusqu’au dernier contenu ;
- QR Pix non masqué ;
- cartes d’offre et de course lisibles.

---

## État de sortie

Le bloc 23 est techniquement prêt lorsque :

```text
npm test                     → vert
npm --prefix functions test  → vert
APK DEV deux téléphones      → validé manuellement
secrets/config PROD          → confirmés
npm run release:check        → GATE VERT
```

Même avec une gate verte, le build AAB et le déploiement Firebase exigent une autorisation explicite séparée.
