// Firestore Rules tests — BLOCK 04 (server-authoritative boundaries).
//
// These exercise backend/firebase/rules/firestore.rules against the Firestore
// Rules emulator via @firebase/rules-unit-testing. They run ONLY when the
// emulator is configured (FIRESTORE_EMULATOR_HOST) AND JDK 21+ is available for
// the emulator; otherwise they self-skip so the deterministic Node suite stays
// green. Run with: firebase emulators:exec --only firestore "npm test" (JDK 21+).
//
// Scope: 12 representative critical invariants (least privilege + fail closed).

const fs = require('fs');
const path = require('path');

const RULES_PATH = path.resolve(
  __dirname,
  '../../../backend/firebase/rules/firestore.rules'
);

// Always-run guard: the rules file must exist and declare a deny-by-default tail.
describe('firestore rules source', () => {
  it('exists and ends with a deny-by-default fallback', () => {
    const src = fs.readFileSync(RULES_PATH, 'utf8');
    expect(src).toMatch(/rules_version = '2'/);
    expect(src).toMatch(/match \/\{document=\*\*\}[\s\S]*allow read, write: if false/);
  });
});

const RUN = !!process.env.FIRESTORE_EMULATOR_HOST;
const describeEmu = RUN ? describe : describe.skip;

describeEmu('firestore rules (emulator)', () => {
  const rut = require('@firebase/rules-unit-testing');
  const {
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    collection,
    query,
    where,
    serverTimestamp,
  } = require('firebase/firestore');

  let testEnv;
  const DRIVER_A = 'driverA';
  const DRIVER_B = 'driverB';
  const PASS_A = 'passengerA';
  const PASS_B = 'passengerB';

  beforeAll(async () => {
    testEnv = await rut.initializeTestEnvironment({
      projectId: 'drivelocal-rules-test',
      firestore: { rules: fs.readFileSync(RULES_PATH, 'utf8') },
    });
  });

  afterAll(async () => {
    if (testEnv) await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    // Seed server-owned documents with the Rules bypassed.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'drivers', DRIVER_A), {
        uid: DRIVER_A,
        verificationStatus: 'pending_review',
        availabilityStatus: 'offline',
        walletBalanceCentavos: 0,
        founderEligible: false,
      });
      await setDoc(doc(db, 'passengers', PASS_B), { uid: PASS_B, fullName: 'B' });
      await setDoc(doc(db, 'rideRequests', 'rideB'), {
        passengerId: PASS_B,
        status: 'pending',
      });
      await setDoc(doc(db, 'driverOffers', 'offerA'), { driverId: DRIVER_A });
      await setDoc(doc(db, 'driverOffers', 'offerB'), { driverId: DRIVER_B });
      await setDoc(doc(db, 'privateDriverData', DRIVER_A), { pixKey: 'secret' });
    });
  });

  function asDriverA() {
    return testEnv.authenticatedContext(DRIVER_A).firestore();
  }
  function asPassengerA() {
    return testEnv.authenticatedContext(PASS_A).firestore();
  }

  async function seedCompleteMotoApplication(overrides = {}) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'drivers', DRIVER_A), {
        uid: DRIVER_A,
        vehicleType: 'moto',
        verificationStatus: 'draft',
        duplicateCheckStatus: 'clear',
        profileStatus: 'complete',
        vehicleStatus: 'complete',
        documentsStatus: 'missing',
        selfieStatus: 'submitted',
        selfieUrl: 'https://example.test/selfie.jpg',
        cnhFrenteStatus: 'submitted',
        cnhFrenteUrl: 'https://example.test/cnh-front.jpg',
        cnhVersoStatus: 'submitted',
        cnhVersoUrl: 'https://example.test/cnh-back.jpg',
        crlvStatus: 'submitted',
        crlvUrl: 'https://example.test/crlv.jpg',
        vehiclePhotoStatus: 'submitted',
        vehiclePhotoUrl: 'https://example.test/motorcycle.jpg',
        ...overrides,
      });
    });
  }

  // 1. Driver cannot self-approve.
  it('driver cannot set verificationStatus=approved', async () => {
    await rut.assertFails(
      updateDoc(doc(asDriverA(), 'drivers', DRIVER_A), { verificationStatus: 'approved' })
    );
  });

  it('motorcycle driver can submit the standard document package for admin review', async () => {
    await seedCompleteMotoApplication();
    const driverRef = doc(asDriverA(), 'drivers', DRIVER_A);

    await rut.assertSucceeds(updateDoc(driverRef, {
      documentsStatus: 'submitted',
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    await rut.assertSucceeds(updateDoc(driverRef, {
      verificationStatus: 'pending_review',
      duplicateCheckStatus: 'pending_admin_review',
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  });

  it('motorcycle document submission still fails when CRLV is missing', async () => {
    await seedCompleteMotoApplication({ crlvStatus: 'missing' });

    await rut.assertFails(updateDoc(doc(asDriverA(), 'drivers', DRIVER_A), {
      documentsStatus: 'submitted',
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  });

  it('keeps an installed legacy motorcycle app unblocked during rollout', async () => {
    await seedCompleteMotoApplication();
    const driverRef = doc(asDriverA(), 'drivers', DRIVER_A);

    await rut.assertSucceeds(updateDoc(driverRef, {
      motofreteStatus: 'submitted',
      motofreteUrl: 'https://example.test/legacy-certificate.jpg',
      updatedAt: serverTimestamp(),
    }));
    await rut.assertSucceeds(updateDoc(driverRef, {
      documentsStatus: 'submitted',
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  });

  it('requires and accepts certificate metadata only for a new-policy driver', async () => {
    await seedCompleteMotoApplication({
      driverDocumentPolicyVersion: 'criminal-certificate-v1',
      criminalCertificateStatus: 'missing',
    });
    const driverRef = doc(asDriverA(), 'drivers', DRIVER_A);

    await rut.assertFails(updateDoc(driverRef, {
      documentsStatus: 'submitted',
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));

    const version = 'certificate_12345678_abcd1234';
    await rut.assertSucceeds(updateDoc(driverRef, {
      criminalCertificatePath: `drivers/${DRIVER_A}/criminal-certificate/${version}/certificate.pdf`,
      criminalCertificateVersion: version,
      criminalCertificateContentType: 'application/pdf',
      criminalCertificateSizeBytes: 2048,
      criminalCertificateStatus: 'submitted',
      criminalCertificateUploadedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    await rut.assertSucceeds(updateDoc(driverRef, {
      documentsStatus: 'submitted',
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  });

  // 2. Driver cannot edit wallet.
  it('driver cannot edit walletBalanceCentavos', async () => {
    await rut.assertFails(
      updateDoc(doc(asDriverA(), 'drivers', DRIVER_A), { walletBalanceCentavos: 100000 })
    );
  });

  // 3. Driver cannot edit founder/subscription fields.
  it('driver cannot edit founder/subscription fields', async () => {
    await rut.assertFails(
      updateDoc(doc(asDriverA(), 'drivers', DRIVER_A), {
        founderEligible: true,
        subscriptionStatus: 'active',
      })
    );
  });

  // 4. Safe availability update succeeds.
  it('driver can update availabilityStatus', async () => {
    await rut.assertSucceeds(
      updateDoc(doc(asDriverA(), 'drivers', DRIVER_A), { availabilityStatus: 'available' })
    );
  });

  // 5. Mixed safe + forbidden update fails.
  it('mixed safe + forbidden update fails', async () => {
    await rut.assertFails(
      updateDoc(doc(asDriverA(), 'drivers', DRIVER_A), {
        availabilityStatus: 'available',
        walletBalanceCentavos: 999,
      })
    );
  });

  // 6. Passenger cannot read another passenger profile.
  it('passenger cannot read another passenger profile', async () => {
    await rut.assertFails(getDoc(doc(asPassengerA(), 'passengers', PASS_B)));
  });

  // 7. Passenger cannot read another passenger ride.
  it('passenger cannot read another passenger ride', async () => {
    await rut.assertFails(getDoc(doc(asPassengerA(), 'rideRequests', 'rideB')));
  });

  // 8. Driver cannot read/list pending rides.
  it('driver cannot read or list pending ride requests', async () => {
    await rut.assertFails(getDoc(doc(asDriverA(), 'rideRequests', 'rideB')));
    await rut.assertFails(getDocs(collection(asDriverA(), 'rideRequests')));
  });

  // 9. Driver can read only their own driverOffer.
  it('driver reads own offer, not another driver offer', async () => {
    await rut.assertSucceeds(getDoc(doc(asDriverA(), 'driverOffers', 'offerA')));
    await rut.assertFails(getDoc(doc(asDriverA(), 'driverOffers', 'offerB')));
    // Constrained own-offer query succeeds; unconstrained query fails.
    const db = asDriverA();
    await rut.assertSucceeds(
      getDocs(query(collection(db, 'driverOffers'), where('driverId', '==', DRIVER_A)))
    );
    await rut.assertFails(getDocs(collection(db, 'driverOffers')));
  });

  // 10. Client cannot create/update driverOffers.
  it('client cannot create or update driverOffers', async () => {
    await rut.assertFails(
      setDoc(doc(asDriverA(), 'driverOffers', 'newOffer'), { driverId: DRIVER_A })
    );
    await rut.assertFails(
      updateDoc(doc(asDriverA(), 'driverOffers', 'offerA'), { status: 'claimed' })
    );
  });

  // 11. Client cannot access privateDriverData.
  it('client cannot read privateDriverData', async () => {
    await rut.assertFails(getDoc(doc(asDriverA(), 'privateDriverData', DRIVER_A)));
  });

  // 12. Client cannot write server-only auditLogs / idempotencyOperations.
  it('client cannot write auditLogs or idempotencyOperations', async () => {
    await rut.assertFails(
      setDoc(doc(asDriverA(), 'auditLogs', 'x'), { event: 'forged' })
    );
    await rut.assertFails(
      setDoc(doc(asDriverA(), 'idempotencyOperations', 'x'), { key: 'forged' })
    );
  });
});
