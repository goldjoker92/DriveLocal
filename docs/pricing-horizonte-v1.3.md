# Horizonte competitive pilot pricing — V1.3

Historical reference: superseded by `pricing-horizonte-v1.7.md` for new quotes.

The V1.3 fare grid was restored for new quotes under `horizonte-1.6.0`, so
V1.5 rides retained their original price snapshot. The current driver
commission rule is in `commercial-policy.md`.

## Passenger fares

All amounts are computed in integer BRL centavos with deterministic half-up
rounding.

- Moto: `max(R$5.00, R$2.00 + R$0.85/km + R$0.10/min)`
- Car: `max(R$7.50, R$3.00 + R$1.20/km + R$0.15/min)`

The evening surcharge is disabled: the same route has the same price at 14h
and 19h. Long routes use the same per-km rate throughout.

## Commission interaction

After the commission-free benefit, every ride charges the advertised rate: 12%
for moto and 15% for car. At the minimum fare this produces R$0.60 commission
and R$4.40 driver net for moto, or R$1.13 commission and R$6.37 driver net for
car. The minimum platform commission is exactly the rounded percentage of the
minimum fare; it is not an additional fixed fee.

Rides created while this grid was active persisted
`pricingConfigVersion = horizonte-1.6.0`; historical ride snapshots remain
unchanged.
