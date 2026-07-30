# Mercado Pago — DriveLocal MVP

Última revisão: 29 de julho de 2026.

## Escopo financeiro

O Mercado Pago é usado somente no fluxo **Motorista → DriveLocal** para:

- recarga do Saldo DriveLocal;
- pagamento da assinatura mensal do motorista.

O pagamento da corrida continua sendo **Passageiro → Motorista por Pix direto**. Dados pessoais do passageiro não entram nas orders Mercado Pago.

## Ambientes

| Ambiente | Firebase | Credencial | Webhook |
|---|---|---|---|
| Desenvolvimento | `drivelocal-dev` | Access Token de teste | `https://southamerica-east1-drivelocal-dev.cloudfunctions.net/mercadoPagoWebhook` |
| Produção | `drivelocal-prod` | Access Token de produção | `https://southamerica-east1-drivelocal-prod.cloudfunctions.net/mercadoPagoWebhook` |

Secrets exigidos em cada projeto:

```text
MERCADO_PAGO_ACCESS_TOKEN
MERCADO_PAGO_WEBHOOK_SECRET
```

Nunca colocar esses valores no aplicativo, GitHub, `app.json`, EAS public env ou logs.

## Campos enviados na criação da order

A Cloud Function cria uma única order digital com:

- `external_reference`: ID local imutável e sem PII;
- `items.quantity`: sempre `1`;
- `items.unit_price`: valor em BRL derivado de centavos validados no servidor;
- `items.title`, `description`, `category_id` e `external_code`;
- `payer.email`: perfil do motorista/Firebase Auth;
- `payer.first_name` e `payer.last_name`: derivados do nome do perfil, quando disponíveis;
- `payer.identification`: CPF do motorista somente quando o valor do perfil tem 11 dígitos e checksum válido;
- `additional_info.payer.registration_date`: data de criação do perfil, quando disponível;
- `payment_method.statement_descriptor`: `DRIVELOCAL`;
- `X-Idempotency-Key`: mesma chave segura em toda tentativa da mesma operação;
- `X-meli-session-id`: somente quando gerado pelo SDK/dispositivo oficial do Mercado Pago.

Não são enviados endereço, CEP ou dados de entrega porque o produto é digital.

## Device ID

O backend já aceita `deviceSessionId`, valida formato/tamanho e encaminha no header `X-meli-session-id`. O valor:

- deve ser gerado pelo SDK oficial de dispositivos do Mercado Pago;
- não é salvo em Firestore;
- não aparece nos logs;
- não pode ser substituído por Firebase UID, Android ID, IMEI ou UUID próprio.

A captura nativa ainda exige uma integração Expo/Android específica com o SDK oficial. Até ela existir, o app deve omitir o campo em vez de enviar um identificador falso.

## Webhook

Fluxo seguro:

1. validar `x-signature` com `MERCADO_PAGO_WEBHOOK_SECRET`;
2. extrair o Order ID;
3. buscar a order real em `GET /v1/orders/{id}`;
4. comparar referência, valor, moeda e ambiente;
5. aplicar crédito/assinatura de forma idempotente;
6. responder `200` para eventos concluídos, duplicados ou sem ação;
7. responder `500` somente para falhas transitórias que devem ser reenviadas.

O simulador oficial pode enviar uma order Point sintética. Depois de validar a assinatura, o endpoint responde `200` sem alterar Firestore nem saldo.

## Logs permitidos

- `traceId`;
- `localPaymentId`;
- `providerOrderId`;
- `purpose`;
- ambiente;
- status normalizado;
- resultado do webhook;
- código de erro;
- hash da chave de idempotência;
- indicadores booleanos de preenchimento dos campos.

Nunca registrar Access Token, secret webhook, CPF, e-mail, telefone, Device ID, QR Code completo, chave de idempotência bruta ou payload completo do provedor.

## Testes e implantação

```powershell
cd C:\Users\guill\DriveLocal
git fetch origin
git switch feat/mercado-pago-mvp-quality
git pull origin feat/mercado-pago-mvp-quality
cd functions
npm install
npm test
cd ..
```

Desenvolvimento:

```powershell
npx firebase-tools deploy --only "functions:createDriverPixPayment,functions:reprocessDriverPayment,functions:mercadoPagoWebhook" --project drivelocal-dev
```

Produção, somente depois dos testes e merge:

```powershell
$env:CONFIRM_PRODUCTION_DEPLOY="DRIVELOCAL_PRODUCTION"
npm run deploy:firebase:prod
```

Depois do deploy, criar uma nova order de teste/produção conforme o ambiente e usar **Medir novamente** no painel Mercado Pago. Uma order antiga não é recalculada com os novos campos.
