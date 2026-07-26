# DriveLocal — privacidade e exclusão de conta

## Objetivo

Este fluxo oferece um caminho de exclusão dentro do aplicativo e exige três
recursos públicos HTTPS antes de qualquer build EAS de produção:

- `PRIVACY_POLICY_URL`
- `TERMS_OF_USE_URL`
- `ACCOUNT_DELETION_WEB_URL`

As URLs não são inventadas nem mantidas como placeholders no código. DEV continua
utilizável sem elas; PROD falha no `app.config.js` até todas estarem configuradas.

## Fluxo do usuário

1. Passageiro ou motorista abre **Privacidade e conta**.
2. Consulta política, termos ou a página web externa de exclusão.
3. Digita `EXCLUIR` e a senha atual.
4. O app reautentica com Firebase Auth e força um ID token novo.
5. `requestAccountDeletionSecure` verifica `auth_time` (máximo de 10 minutos).
6. A solicitação é recusada quando existe corrida operacional ou disputa aberta.
7. Para motorista, a disponibilidade é congelada como `offline`.
8. A Function cria um documento privado em `accountDeletionRequests`.
9. O trigger retryable processa a exclusão e o app encerra a sessão local.

## Dados removidos

O processador elimina ou desvincula:

- perfil `drivers/{uid}` ou `passengers/{uid}`;
- `privateDriverData/{uid}`;
- fotos e documentos em `drivers/{uid}/`;
- foto pública em `publicDriverPhotos/{uid}/`;
- tokens e eventos de notificação do usuário;
- ofertas pendentes do motorista;
- localização ativa da corrida;
- operações de idempotência do usuário;
- relatórios de erro do cliente vinculados ao usuário;
- Firebase Auth, sempre por último.

## Dados minimizados/pseudonimizados

Alguns registros transacionais ou de segurança podem precisar permanecer para
integridade financeira, prevenção à fraude, suporte ou disputa. O código não fixa
um prazo jurídico: os prazos devem ser aprovados antes de PROD e publicados na
política de privacidade.

### Corridas

- UID substituído por um identificador aleatório `deleted_<role>_<uuid>`;
- pickup e destino substituídos por `Local removido`;
- telefone/chave Pix/detalhes exatos removidos quando presentes;
- nome/foto/placa substituídos por um snapshot neutro;
- status, valores e campos necessários à transação permanecem.

### Financeiro

- `driverId` substituído pelo identificador aleatório;
- QR Code e chave/fingerprint de idempotência removidos;
- pagamento ainda `pending` passa a `cancelled/account_deleted`;
- callback Mercado Pago tardio nunca recria wallet ou assinatura;
- callback pago tardio vira `manual_review` para tratamento administrativo.

### Antifraude e auditoria

- `actorUid`, `targetId`, `actorId` e `sourceId` são pseudonimizados quando iguais
  ao UID excluído;
- `riskProfiles` é migrado de `<role>_<uid>` para
  `<role>_<anonymousSubjectId>`;
- logs estruturados mascaram IDs brutos e expõem apenas hashes não reversíveis.

## Reprise et idempotence

`processAccountDeletionRequest` utilise :

```text
retry: true
timeoutSeconds: 540
memory: 512MiB
```

Chaque étape accepte une nouvelle exécution :

- les requêtes modifient le champ utilisé par leur pagination ;
- les suppressions de documents/fichiers absents sont sans effet ;
- un utilisateur Auth déjà supprimé est accepté comme `already_missing` ;
- l’audit anonymisé est écrit avant la suppression du mapping temporaire UID ;
- le document `accountDeletionRequests` n’est supprimé qu’après succès complet.

## Logs attendus

```text
[ACCOUNT_DELETION] reauthentication.requested
[ACCOUNT_DELETION] reauthentication.succeeded
[ACCOUNT_DELETION] request.started
[ACCOUNT_DELETION] request.succeeded
```

Cloud Functions :

```text
account_deletion.requested
account_deletion.request_replayed
account_deletion.processing_started
account_deletion.processing_blocked
account_deletion.processing_succeeded
account_deletion.processing_failed
payment.account_deleted_ignored
ride.create.account_deletion_blocked
```

Ne jamais journaliser :

- mot de passe ;
- email ;
- CPF/CNH ;
- téléphone ;
- clé Pix ;
- token FCM ;
- UID Firebase brut ;
- pickup/destination exacts.

## Recette DEV obligatoire

### Passager sans course

1. Ouvrir **Privacidade e conta**.
2. Vérifier que les trois liens affichent le message DEV lorsqu’ils ne sont pas configurés.
3. Entrer une mauvaise confirmation : aucun appel.
4. Entrer un mauvais mot de passe : aucune demande Firestore.
5. Entrer `EXCLUIR` + bon mot de passe.
6. Vérifier déconnexion locale.
7. Vérifier suppression du profil, Auth et tokens.
8. Vérifier anonymisation des anciennes courses.

### Chauffeur

1. Essayer pendant disponibilité/aucune course : demande acceptée, passage offline.
2. Essayer pendant une course active : refus `ACTIVE_RIDE_PRESENT`.
3. Essayer avec une dispute : refus `OPEN_DISPUTE_PRESENT`.
4. Vérifier suppression des documents et photos Storage.
5. Vérifier qu’un paiement Pix `pending` devient `cancelled`.
6. Simuler un webhook payé tardif : `manual_review`, aucun crédit wallet.

### Reprise

1. Provoquer une erreur Storage temporaire.
2. Vérifier `account_deletion.processing_failed`.
3. Autoriser le retry.
4. Vérifier un unique audit final et aucune duplication financière.

## Avant production

- publier les trois ressources HTTPS ;
- configurer les trois variables EAS ;
- faire valider les textes et durées de conservation par un professionnel compétent
  au Brésil ;
- compléter Google Play Data safety avec les traitements réels ;
- tester la page de suppression externe sans connexion à l’application ;
- déployer les nouvelles Functions seulement après autorisation explicite.
