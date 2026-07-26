# Accepted passenger public identity

## Objective

Before a driver accepts a ride, the offer remains anonymous:

- no passenger name;
- no passenger photo;
- coarsened pickup region only;
- no destination.

After assignment, the accepted driver may receive exactly:

```js
acceptedPassengerPublic: {
  firstName: 'Maria',
  photoStoragePath: 'publicPassengerPhotos/photo_v20260726.jpg',
  photoVerified: true,
}
```

The projection never contains a passenger uid, full name, email, phone, WhatsApp,
CPF, Pix key or private storage path.

## Source and projection

The private source remains `passengers/{uid}`. Firestore rules allow only the
owner and admins to read it.

`acceptedPassengerIdentityTrigger` runs after a ride has an accepted driver. It
reads the private passenger document with the Admin SDK, builds the closed public
projection and writes the same immutable identity snapshot to:

- `rideRequests/{rideId}.acceptedPassengerPublic`;
- `driverOffers/{rideId}_{acceptedDriverId}.acceptedPassengerPublic`.

The driver reads only their own `driverOffers` document. The private ride document
remains unavailable to the driver.

## First-name policy

The server publishes only the first valid name token:

```text
Maria Clara de Souza -> Maria
João-Pedro Silva     -> João-Pedro
```

Email-like, phone-like, empty or invalid values become the generic label:

```text
Passageiro
```

The public first name is limited to 40 Unicode letters/marks with apostrophe or
hyphen support.

## Photo policy

A photo is exposed only when all three private approval fields agree:

```text
passengerPhotoPublicVerified = true
passengerPhotoPublicVersion  = opaque id, 12–80 characters
passengerPhotoPublicPath     = publicPassengerPhotos/{opaque id}.jpg
```

The path contains no Firebase uid or account-derived identifier. Generic URLs,
private paths, mismatched versions and unverified photos are ignored.

Authenticated users may read a correctly shaped object under
`publicPassengerPhotos`, but client writes are always denied. The opaque path is
revealed to the driver only through the post-acceptance offer projection.

## Trigger behavior

Events:

```text
ride.passenger_identity_projection.started
ride.passenger_identity_projection.completed
ride.passenger_identity_projection.duplicate_ignored
ride.passenger_identity_projection.offer_missing
ride.passenger_identity_projection.failed
```

Logs may contain:

- ride id;
- projection version;
- result code;
- whether the generic first name was used;
- whether a verified photo exists.

Logs never contain the first name itself, photo path, passenger uid or private
profile data.

The trigger is retryable and idempotent. A valid projection prevents a redundant
trigger cycle. A malformed legacy projection is replaced by the exact three-field
shape.

## Mobile preparation

`AcceptedPassengerIdentityCard` and `passengerPublicPhotoService` are ready for the
permanent active-ride card. They consume only the three public fields. The visual
mounting is intentionally deferred to the active-ride card refactor so the GPS,
navigation and payment screen is not rewritten twice.

## Manual verification

1. Inspect a newly created `driverOffers` document before acceptance:
   - no `acceptedPassengerPublic`;
   - no name or photo field.
2. Accept a ride whose passenger has `fullName = Maria Clara` and no approved photo:
   - winning offer eventually contains `firstName = Maria`;
   - `photoStoragePath = null`;
   - `photoVerified = false`.
3. Accept a ride with a valid opaque approved photo:
   - winning offer contains the opaque public path;
   - path does not contain passenger uid.
4. Replay or update the assigned ride:
   - projection remains identical;
   - no duplicate write loop.
5. Try a private or mismatched photo path:
   - photo is omitted.
6. Confirm the driver cannot read `passengers/{uid}` directly.

## Deployment rule

This block adds one Gen 2 Firestore trigger and one Storage Rules path. Do not
deploy Functions or Storage Rules to production without explicit validation. Both
Jest suites must pass first.
