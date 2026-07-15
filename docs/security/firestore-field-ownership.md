# Firestore Field Ownership — BLOCK 04

Classification of every relevant field for **client SDK** access. The Admin SDK
bypasses Rules and owns all `server write` / `forbidden client access` fields.

Legend: **C-create** client may set on create · **C-update** client may change ·
**read(self)** owner may read · **read(admin)** admin may read · **server** written
by Admin SDK / callable Functions only · **private** never client-readable ·
**forbidden** no client access.

## drivers/{driverId}
Read: owner or admin. Delete: never (client).

| Field | Client access |
|---|---|
| uid, email, serviceAreaId | C-create; read(self/admin) |
| displayName, fullName, whatsApp, cpf, pixKeyType, pixKey | C-create, C-update; read(self/admin) |
| vehicleType, vehicleBrand, vehicleModel, vehicleColor, vehiclePlate, vehicleYear | C-create, C-update; read(self/admin) |
| profilePhotoUrl, profileStatus, vehicleStatus | C-create, C-update |
| documentsStatus, selfieStatus, cnhFrenteStatus, cnhVersoStatus, crlvStatus, vehiclePhotoStatus, motofreteStatus | C-update (client sets `submitted` during onboarding) |
| selfieUrl, cnhFrenteUrl, cnhVersoUrl, crlvUrl, vehiclePhotoUrl, motofreteUrl | C-update |
| availabilityStatus, availabilityUpdatedAt | C-update |
| updatedAt | C-create, C-update |
| **verificationStatus, duplicateCheckStatus** | **server** (client create/update denied) |
| **isBlocked, blockReason, blockedAt, blockedBy, unblockedAt, unblockedBy** | **server** |
| **approvedAt, approvalNumber, reviewedAt, reviewedBy, rejectionReason, correctionReason, correctionRequestedAt, submittedAt, statusHistory** | **server** |
| **founderEligible, founderNumber, founderGrantedAt, founderExpiresAt, founderFreeUntil** | **server** |
| **commissionFreeUntil, commissionRateBps, commissionPromoStatus** | **server** |
| **subscriptionActive, subscriptionStatus, subscriptionFreeUntil, subscriptionExpiresAt, subscriptionActivatedAt, subscriptionPaymentMode, subscriptionLastConfirmedAt, subscriptionLastAmountCentavos** | **server** |
| **walletBalanceCentavos, walletHeldCentavos, walletAvailableCentavos, walletStatus, freeRideCountUsed** | **server** |
| **canReceiveRides, canReceiveRidesReason, activeRideId** | **server** |

Admin (client SDK) may currently update the driver document (approve/reject/block)
via the `isAdmin()` gate; this moves to a callable in a later block.

## privateDriverData/{driverId}
All client access **forbidden** (private Pix / document data). Admin SDK only.

## passengers/{passengerId}
Read: owner or admin. Delete: never.

| Field | Client access |
|---|---|
| uid, email, fullName, whatsApp, role, serviceAreaId, createdAt, updatedAt | C-create; read(self/admin) |
| fullName, whatsApp, displayName, updatedAt | C-update |
| any admin/counter/financial field | **forbidden** (not in allowlists) |

`role` is stored but **never** used for authorization (authz = admins/ membership).

## rideRequests/{rideId}
Create: passenger owner, with neutral assignment/settlement. Read: owner or admin.
Update/Delete: **forbidden** (client).

| Field | Client access |
|---|---|
| passengerId (== auth.uid), passengerName, passengerPhone | C-create; read(self/admin) |
| originText, originReferenceText, originLat, originLng, originCity, originState, destinationText, destinationLat, destinationLng | C-create; read(self/admin) |
| vehicleType, serviceAreaId, paymentMethod, distanceKm, pricingVersion | C-create; read(self/admin) |
| status (must be `pending` at create) | C-create; **server** thereafter |
| driverId, acceptedDriverId, assignedDriverId (must be null at create) | **server** |
| ridePriceCentavos, driverAmountCentavos, platformFeeCentavos | **server** (settlement) |
| commissionSettled (false at create), commissionSettledAt, acceptedAt, completedAt | **server** |

## driverOffers/{offerId}
Read: only when `resource.data.driverId == auth.uid` (or admin). Query must be
constrained to own driverId. Create/Update/Delete: **forbidden** (Admin SDK only).

## cityPublicConfig/{serviceAreaId}
Read: any authenticated client. Write: **forbidden**.
Safe fields only: serviceAreaId, isActive, operatingMode, operatingHours,
pricingConfigVersion, public pricing values, enabledVehicleTypes,
searchTimeoutSeconds, display metadata. No secrets.

## cityPrivateConfig/{serviceAreaId}
All client access **forbidden** (operational/provider/financial controls).

## counters/{counterId}
Read: any authenticated client (founder progress). Write: admin client SDK only.

## Server-only collections (all client read + write forbidden)
- idempotencyOperations/{docId}
- auditLogs/{docId}
- walletTransactions/{docId}
- paymentRequests/{docId}
- subscriptionPayments/{docId}

## admins/{adminId}
Read: any authenticated client. Write: **forbidden** (server-provisioned).

## Fallback
Any path not listed above: deny read and write.
