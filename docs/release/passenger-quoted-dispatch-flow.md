# DriveLocal — fluxo passageiro com preço e busca real

## Fluxo

1. Passageiro confirma origem, complemento e destino.
2. O app obtém coordenadas reais por GPS ou geocodificação nativa.
3. `createRideRequestSecure` valida autenticação, geofence de Horizonte, rota,
   preço, comissão e despacho.
4. O retorno seguro abre `/searching` com preço, distância, duração e veículo.
5. A tela escuta `rideRequests/{rideId}` e muda somente por status do backend:
   - `searching` → mantém busca e permite cancelamento seguro;
   - `assigned`, `driver_arrived`, `in_progress` → `/driver-accepted`;
   - `awaiting_payment`, `payment_marked_sent` → `/pix-payment`;
   - `completed` → `/ride-completed`;
   - `cancelled` → `/passenger-home`;
   - `no_driver_available`, `dispatch_failed` → permite nova tentativa.

O fluxo antigo que gravava uma solicitação `pending` diretamente no Firestore e
voltava para a home foi removido da tela de pedido. A home não contém mais o
quadrado `Sua localização (placeholder)`.

## Logs do cliente

Em build de desenvolvimento, filtre o Metro por:

```text
[DriveLocal][RIDE_CLIENT]
```

Eventos principais:

```text
ride.request.pickup_gps_started
ride.request.pickup_gps_succeeded
ride.request.geocode_started
ride.request.geocode_succeeded
ride.request.submit_started
ride.request.callable_started
ride.request.callable_succeeded
ride.request.navigation_to_searching
ride.snapshot.listener_started
ride.snapshot.received
ride.searching.status_processed
ride.lifecycle.callable_started
ride.lifecycle.callable_succeeded
```

Cada linha é JSON e inclui, quando disponível:

- `rideId` e `traceId`;
- status e reasonCode;
- tipo de veículo;
- preço estimado/final;
- distância e duração;
- versões de pricing/geofence;
- timestamps de criação/expiração;
- presença de origem, destino, motorista e payload Pix;
- lista dos campos recebidos do backend;
- código, mensagem segura e retryable em erros.

Por privacidade, os logs nunca imprimem coordenadas, endereços, payload Pix,
telefone, token, placa, nome ou UID do motorista. Eles indicam a presença desses
campos sem expor seu conteúdo. Builds de produção não emitem esses logs.

## Smoke test Android

1. Abrir a home do passageiro e confirmar que não existe mapa placeholder.
2. Tocar `Pedir corrida`.
3. Usar GPS ou informar uma origem completa em Horizonte.
4. Informar um destino completo em Horizonte e escolher moto/carro.
5. Tocar `Pedir corrida` e confirmar que a tela muda para `Procurando motorista`.
6. Confirmar preço, distância, duração, origem, destino e pagamento Pix no resumo.
7. Verificar no Metro a sequência `[DriveLocal][RIDE_CLIENT]` para o mesmo rideId.
8. Sem motorista elegível: confirmar `Nenhum motorista disponível` e `Tentar novamente`.
9. Com motorista elegível: aceitar no segundo telefone e confirmar a navegação automática para `/driver-accepted`.
10. Cancelar durante `searching` e confirmar que o backend recebe `cancelRideSecure` antes de voltar à home.
