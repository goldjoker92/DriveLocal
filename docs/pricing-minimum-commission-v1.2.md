# Pricing Horizonte V1.2 — commission minimale par course

## Règle commerciale

La seule période pendant laquelle DriveLocal accepte une commission de zéro est le bénéfice de lancement de 60 jours, calculé depuis l'approbation du chauffeur et gelé au moment où il accepte la course.

Après expiration de ce bénéfice :

```text
Moto  : commission = max(12 % du tarif, R$ 1,00)
Carro : commission = max(15 % du tarif, R$ 1,43)
```

Aucune course standard ne doit produire une commission inférieure à ces montants.

## Prix minimums passager

| Véhicule | Minimum passager | Commission DriveLocal minimale | Minimum net chauffeur |
|---|---:|---:|---:|
| Moto | R$ 6,00 | R$ 1,00 | R$ 5,00 |
| Carro | R$ 9,50 | R$ 1,43 | R$ 8,00 |

Exemples minimums hors promotion :

```text
Moto
Passager  : R$ 6,00
DriveLocal: R$ 1,00
Chauffeur : R$ 5,00

Carro
Passager  : R$ 9,50
DriveLocal: R$ 1,43
Chauffeur : R$ 8,07
```

## Fenêtre des 60 jours

Pendant la fenêtre de commission gratuite :

```text
commissionBps                 = 0
commissionHoldCentavos        = 0
minimumPlatformCommission     = non appliqué
wallet requis pour commission = non
```

Le tarif passager reste le tarif V1.2. Le chauffeur conserve la totalité du prix de la course.

À l'instant exact d'expiration, la course devient commissionnable. La politique est évaluée et figée à l'acceptation : une course acceptée avant l'expiration reste gratuite même si elle se termine après ; une course acceptée après l'expiration porte la commission minimale ou le pourcentage normal.

## Calcul et garde-fous

Le backend suit cet ordre :

1. calcul du tarif selon base + distance + durée ;
2. application du minimum passager ;
3. calcul de la commission au pourcentage ;
4. application du minimum de commission ;
5. vérification du minimum net chauffeur ;
6. écriture du devis versionné ;
7. à l'acceptation, remplacement du hold par zéro uniquement si le bénéfice de 60 jours est actif.

Une configuration future est refusée si le minimum passager ne peut pas financer simultanément la commission minimale et le minimum net chauffeur. Le système ne dégrade jamais silencieusement la commission à zéro.

## Version financière

```text
pricingConfigVersion = horizonte-1.2.0
```

Les courses déjà créées sous une ancienne version conservent leur snapshot historique. Les nouvelles courses enregistrent :

```text
estimatedFareCentavos
estimatedCommissionCentavos
minimumPlatformCommissionCentavos
pricingConfigVersion
```

À l'acceptation, la course conserve également le hold exact et les snapshots de politique commerciale.

## Promotions passager

Une promotion passager ne doit pas consommer la commission minimale. Elle peut utiliser :

1. uniquement la partie de commission supérieure au minimum ;
2. puis un budget marketing explicite.

Le minimum chauffeur et la commission minimale restent protégés.

## Tests obligatoires

```text
Moto minimum hors promotion  → tarif 600, commission 100, net 500
Carro minimum hors promotion → tarif 950, commission 143, net 807
Moto 3 km / 10 min           → tarif 655, commission/hold 100
Fenêtre 60 jours              → commission/hold 0
Double acceptation            → un seul hold
Jour 60 exact                 → commission standard active
```

Aucun déploiement PROD ou build Android n'est inclus dans cette modification.