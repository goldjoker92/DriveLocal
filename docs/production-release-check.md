# DriveLocal — contrôle avant production

## Commande unique

```powershell
npm run release:check
```

Cette commande est **non mutative**. Elle ne lance jamais :

- un déploiement Firebase ;
- un build APK ou AAB ;
- une soumission Google Play ;
- le lint ;
- un build preview.

## Variables nécessaires

Avant le contrôle, définir les valeurs de production dans le terminal PowerShell :

```powershell
$env:GOOGLE_SERVICES_JSON="C:\chemin\google-services-prod.json"
$env:GOOGLE_MAPS_ANDROID_API_KEY="CLE_ANDROID_MAPS_PROD"

$env:PRIVACY_POLICY_URL="https://drivelocal.com.br/privacidade"
$env:TERMS_OF_USE_URL="https://drivelocal.com.br/termos"
$env:ACCOUNT_DELETION_WEB_URL="https://drivelocal.com.br/excluir-conta"

$env:RELEASE_CONFIRM_PROD_SECRETS="YES"
$env:RELEASE_CONFIRM_DEV_APK="YES"

npm run release:check
```

Ne jamais committer le fichier Firebase PROD, la clé Maps ou un secret backend.

## Les deux confirmations manuelles

### `RELEASE_CONFIRM_PROD_SECRETS=YES`

Confirme que les trois secrets suivants existent dans Firebase Secret Manager pour
`drivelocal-prod` :

```text
ROUTING_PROVIDER_API_KEY
MERCADO_PAGO_ACCESS_TOKEN
MERCADO_PAGO_WEBHOOK_SECRET
```

Le script ne lit et n’affiche jamais leurs valeurs.

### `RELEASE_CONFIRM_DEV_APK=YES`

Confirme que la dernière APK DEV a été installée et que les flux essentiels ont
été vérifiés avant de préparer l’AAB.

Aucune confirmation « deux téléphones » n’est demandée par le gate.

## Contrôles automatiques

Le script vérifie d’abord :

```text
configuration Firebase drivelocal-prod
fichier google-services PROD
clé Android Google Maps
URLs publiques HTTPS
version et versionCode Android
profil EAS app-bundle production
Robot Driver désactivé
notifications Android configurées
règles Firestore et Storage
indexes Firestore
absence de données MOCK_ dans l’application
absence des anciennes fausses recargas
```

Puis il exécute :

```text
npm test
npm --prefix functions test
npm run validate:env:prod
```

## Résultat attendu

```text
[RELEASE] ✅ GATE VERT
```

Un gate vert autorise seulement la préparation de l’étape suivante. Il ne lance
pas l’AAB automatiquement.

## Version Android

Première version :

```text
version: 1.0.0
versionCode: 1
```

Pour chaque nouvel AAB envoyé à Google Play, augmenter `android.versionCode` :

```text
1 → 2 → 3 → ...
```

La version visible `expo.version` peut suivre le rythme produit, par exemple
`1.0.0`, `1.0.1`, `1.1.0`.
