# DriveLocal — politique commerciale chauffeur

Version `commercial-policy-v3-2026-09`. Le serveur calcule l'éligibilité et les commissions. Le téléphone affiche seulement ces données.

| Chauffeur approuvé | Jour 0 à 59 depuis l'approbation | À partir du jour 60 | Badge |
|---|---|---|---|
| Nº 1 à 100 | 0 % sur chaque course | 12 % Moto ou 15 % Voiture sur une course payée | Motorista Fundador permanent |
| Nº 101 et suivants | 0 % sur chaque course | 12 % Moto ou 15 % Voiture sur une course payée | Aucun |

- La date `approvedAtMs` ou `approvedAt` est attribuée lors de l'approbation administrative et ne change pas lors d'une mise à jour de l'application ou d'une reconnexion. La fin est exclusive : `approvedAt + 60 jours`.
- Le badge ne donne aucun taux préférentiel. Une course annulée ne crée jamais de commission. Aucun compteur de courses n'interrompt la période à 0 %.
- Le compteur des fondateurs est partagé par Moto, Voiture et toutes les zones. Il reprend le compteur pilote `counters/HORIZONTE_CE_BR` pour ne pas renuméroter les chauffeurs existants.
- Après les 60 jours, le chauffeur peut recevoir des courses si son profil est approuvé, son appareil autorisé, sa session de travail valide et son solde suffisant pour les retenues de commission.
- Les champs historiques relatifs à l'ancienne offre restent en base pour conservation, mais sont ignorés par la politique et ne sont jamais remis à zéro ni modifiés lors de l'approbation.
- Les anciennes tentatives de paiement sont rejetées avant tout appel au prestataire. Un paiement historique confirmé par le prestataire est signalé pour traitement manuel et ne modifie ni la date d'approbation ni le portefeuille.

La politique figée à l'acceptation de la course conserve `policyVersion`, `approvalNumber`, `founder`, `freePeriodUntilMs` et `commissionBpsAtAcceptance`. La confirmation du paiement capture uniquement la commission calculée sur cette course; l'annulation libère la retenue. Le montant précis de la commission n'est pas communiqué au client chauffeur.

## Mise en service

1. Exécuter les tests et l'audit en lecture seule des anciens paiements encaissés. Traiter chaque cas avec une décision humaine vérifiable.
   Vérifier aussi que le compteur des approbations correspond aux chauffeurs déjà approuvés avant toute ouverture d'une nouvelle zone.
2. Publier la nouvelle AAB et confirmer sa disponibilité sur Google Play.
3. Augmenter ensuite la version minimale obligatoire dans la configuration serveur. Les anciens chauffeurs voient un message de mise à jour et ouvrent Google Play. Leur session Firebase est conservée.
4. Vérifier sur Android le devis passager, le premier et le 101e chauffeur, les frontières du jour 60, l'annulation et le paiement.

Aucun changement de build minimal ni déploiement ne fait partie de cette modification de code.
