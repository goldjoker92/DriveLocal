# Horizonte fare grid — V1.7

The balanced pilot grid applies to new quotes under `horizonte-1.7.0`.
Existing quotes and rides retain their stored fare and pricing version, including
the previous `horizonte-1.6.0` grid. The authoritative quote is calculated by
Functions; the app mirrors the constants but cannot supply or change the fare.

## Passenger fare

Amounts are rounded to integer BRL centavos, half-up.

- Moto: `max(R$5.00, R$2.00 + R$0.85/km + R$0.15/min)`
- Car: `max(R$8.50, R$3.00 + R$1.20/km + R$0.20/min)`

There is no evening surcharge or higher marginal kilometre rate on long routes.
The base fares and per-kilometre rates are unchanged from V1.6. Examples:

| Vehicle | Route | Passenger | Driver after day 60 | DriveLocal after day 60 |
| --- | --- | ---: | ---: | ---: |
| Moto | 2 km / 6 min | R$5.00 | R$4.40 | R$0.60 |
| Moto | 5 km / 15 min | R$8.50 | R$7.48 | R$1.02 |
| Moto | 10 km / 25 min | R$14.25 | R$12.54 | R$1.71 |
| Car | 2 km / 6 min | R$8.50 | R$7.22 | R$1.28 |
| Car | 5 km / 15 min | R$12.00 | R$10.20 | R$1.80 |
| Car | 10 km / 25 min | R$20.00 | R$17.00 | R$3.00 |

The DriveLocal column is gross commission before operating expenses. Every
approved driver keeps the full fare for 60 days from approval. Afterward,
DriveLocal charges 12% Moto or 15% Car on paid rides. An annulled ride has no
commission; no subscription or five-ride limit applies. The permanent founder
badge for the first 100 approved drivers has no effect on the fare or commission.

No production deployment or Google Play publication is performed by this change.
