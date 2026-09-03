# Horizonte competitive pilot pricing — V1.3

This release changes ride pricing only. It does not change subscriptions,
founder benefits, dispatch, wallet rules, driver approval, or payment flows.

## Passenger fares

All amounts are computed in integer BRL centavos with deterministic half-up
rounding.

- Moto: `max(R$5.00, R$2.00 + R$0.85/km + R$0.10/min)`
- Car: `max(R$7.50, R$3.00 + R$1.20/km + R$0.15/min)`

Dynamic pricing remains disabled by default.

## Commission interaction

After the commission-free benefit, every ride charges the advertised rate: 12%
for moto and 15% for car. At the minimum fare this produces R$0.60 commission
and R$4.40 driver net for moto, or R$1.13 commission and R$6.37 driver net for
car. The minimum platform commission is exactly the rounded percentage of the
minimum fare; it is not an additional fixed fee.

Every new ride persists `pricingConfigVersion = horizonte-1.3.0`; historical
ride snapshots remain unchanged.
