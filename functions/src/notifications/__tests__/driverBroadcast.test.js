// @ts-check
// Admin fleet broadcast. The tool exists because there is no other server-side
// way to reach drivers who never update the app, so the tests focus on the two
// things that would make it harmful: sending to the wrong people, and sending
// too often. A muted DriveLocal app also loses its ride offers.

const {
  sendDriverBroadcast,
  isBroadcastRecipient,
  validateCampaignId,
  validateMessageText,
  BROADCAST_CAMPAIGNS,
  MIN_INTERVAL_MS,
  MAX_TITLE_LENGTH,
  MAX_BODY_LENGTH,
} = require('../broadcast');
const { presentationForEvent, androidNotificationForEvent } = require('../processEvent');
const C = require('../../rides/constants');

const T0 = 1_760_000_000_000;
const clock = { now: () => T0 };

function fakeDb({ admins = ['admin_1'], drivers = {}, campaigns = {} } = {}) {
  const store = new Map();
  admins.forEach((uid) => store.set(`admins/${uid}`, { uid }));
  Object.entries(drivers).forEach(([id, data]) => store.set(`${C.DRIVERS}/${id}`, data));
  Object.entries(campaigns).forEach(([id, data]) => {
    store.set(`${BROADCAST_CAMPAIGNS}/${id}`, data);
  });

  function snapOf(path) {
    const data = store.get(path);
    return { exists: Boolean(data), data: () => data };
  }

  function collectionOf(name) {
    const rows = () => [...store.entries()]
      .filter(([path]) => path.startsWith(`${name}/`))
      .map(([path, data]) => ({ id: path.split('/').pop(), data: () => data }));

    const query = {
      _rows: rows,
      where(field, _op, value) {
        const parent = this;
        return {
          ...query,
          _rows: () => parent._rows().filter((r) => (r.data() || {})[field] === value),
          get() { return Promise.resolve({ forEach: (cb) => this._rows().forEach(cb) }); },
        };
      },
      orderBy(field, dir) {
        const parent = this;
        return {
          ...query,
          _rows: () => [...parent._rows()].sort((a, b) => (
            dir === 'desc'
              ? Number(b.data()?.[field] || 0) - Number(a.data()?.[field] || 0)
              : Number(a.data()?.[field] || 0) - Number(b.data()?.[field] || 0)
          )),
          limit(n) {
            const p = this;
            return {
              get() {
                const taken = p._rows().slice(0, n);
                return Promise.resolve({ forEach: (cb) => taken.forEach(cb) });
              },
            };
          },
        };
      },
      get() { return Promise.resolve({ forEach: (cb) => this._rows().forEach(cb) }); },
      doc(id) {
        const path = `${name}/${id}`;
        return {
          path,
          get: () => Promise.resolve(snapOf(path)),
          set: (data) => { store.set(path, { ...(store.get(path) || {}), ...data }); return Promise.resolve(); },
        };
      },
    };
    return query;
  }

  return {
    _store: store,
    collection: collectionOf,
    batch() {
      const ops = [];
      return {
        set(ref, data) { ops.push([ref.path, data]); },
        commit() {
          ops.forEach(([path, data]) => store.set(path, { ...(store.get(path) || {}), ...data }));
          return Promise.resolve();
        },
      };
    },
  };
}

const approved = (extra = {}) => ({ verificationStatus: 'approved', ...extra });

function req(uid, data) {
  return { auth: uid ? { uid } : null, data };
}

const message = {
  campaignId: 'nova_versao_2026_09',
  title: 'DriveLocal — nova versão',
  body: 'Atualize na Play Store para receber mais corridas.',
};

function events(db) {
  return [...db._store.entries()].filter(([p]) => p.startsWith(`${C.NOTIFICATION_EVENTS}/`));
}

describe('broadcast authorization', () => {
  it('refuses an unauthenticated caller', async () => {
    const db = fakeDb({ drivers: { d1: approved() } });
    await expect(
      sendDriverBroadcast({ db, request: req(null, message), context: {}, clock })
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(events(db)).toHaveLength(0);
  });

  it('refuses a signed-in non-admin', async () => {
    const db = fakeDb({ drivers: { d1: approved() } });
    await expect(
      sendDriverBroadcast({ db, request: req('driver_1', message), context: {}, clock })
    ).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
    expect(events(db)).toHaveLength(0);
  });
});

describe('broadcast recipients', () => {
  it('includes an approved driver whatever his commercial state', () => {
    // A driver who cannot currently take rides still needs to hear that a new
    // version exists - that is often exactly why he cannot take rides.
    expect(isBroadcastRecipient(approved({ subscriptionActive: false }))).toBe(true);
    expect(isBroadcastRecipient(approved({ walletAvailableCentavos: 0 }))).toBe(true);
    expect(isBroadcastRecipient(approved({ availabilityStatus: 'offline' }))).toBe(true);
  });

  it('excludes blocked, unapproved and deleting accounts', () => {
    expect(isBroadcastRecipient(approved({ isBlocked: true }))).toBe(false);
    expect(isBroadcastRecipient({ verificationStatus: 'pending' })).toBe(false);
    expect(isBroadcastRecipient({ verificationStatus: 'rejected' })).toBe(false);
    expect(isBroadcastRecipient(approved({ accountDeletionStatus: 'requested' }))).toBe(false);
    expect(isBroadcastRecipient(approved({ accountDeletionStatus: 'processing' }))).toBe(false);
    expect(isBroadcastRecipient({})).toBe(false);
  });

  it('creates exactly one event per eligible driver', async () => {
    const db = fakeDb({
      drivers: {
        d1: approved(),
        d2: approved({ availabilityStatus: 'offline' }),
        d3: approved({ isBlocked: true }),
        d4: { verificationStatus: 'pending' },
        d5: approved({ accountDeletionStatus: 'requested' }),
      },
    });

    const result = await sendDriverBroadcast({
      db, request: req('admin_1', message), context: {}, clock,
    });

    expect(result.recipientCount).toBe(2);
    expect(result.replay).toBe(false);

    const created = events(db);
    expect(created).toHaveLength(2);
    created.forEach(([, data]) => {
      expect(data.eventType).toBe(C.NOTIFICATION_EVENT.DRIVER_BROADCAST);
      expect(data.recipientRole).toBe('driver');
      // Allowed on every shipped client and needs no rideId, so old builds route
      // the tap instead of dropping it.
      expect(data.route).toBe('/driver-home');
      expect(data.status).toBe(C.NOTIFICATION_STATUS.PENDING);
      expect(data.broadcastTitle).toBe(message.title);
    });
  });

  it('records the campaign without notifying when nobody is eligible', async () => {
    const db = fakeDb({ drivers: { d1: { verificationStatus: 'rejected' } } });
    const result = await sendDriverBroadcast({
      db, request: req('admin_1', message), context: {}, clock,
    });

    expect(result.recipientCount).toBe(0);
    expect(events(db)).toHaveLength(0);
  });
});

describe('broadcast safety limits', () => {
  it('ignores a replayed campaign instead of notifying twice', async () => {
    const db = fakeDb({ drivers: { d1: approved(), d2: approved() } });

    const first = await sendDriverBroadcast({
      db, request: req('admin_1', message), context: {}, clock,
    });
    const replay = await sendDriverBroadcast({
      db, request: req('admin_1', message), context: {}, clock,
    });

    expect(first.replay).toBe(false);
    expect(replay.replay).toBe(true);
    expect(replay.recipientCount).toBe(2);
    // Deterministic ids: the same two documents, never four.
    expect(events(db)).toHaveLength(2);
  });

  it('refuses a different campaign sent within the hour', async () => {
    const db = fakeDb({
      drivers: { d1: approved() },
      campaigns: { previous: { campaignId: 'previous', createdAtMs: T0 - 60_000 } },
    });

    await expect(
      sendDriverBroadcast({
        db,
        request: req('admin_1', { ...message, campaignId: 'outra_campanha' }),
        context: {},
        clock,
      })
    ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });

    // Rejected before any write: nothing left behind.
    expect(events(db)).toHaveLength(0);
  });

  it('allows a new campaign once the interval has elapsed', async () => {
    const db = fakeDb({
      drivers: { d1: approved() },
      campaigns: { previous: { campaignId: 'previous', createdAtMs: T0 - MIN_INTERVAL_MS - 1 } },
    });

    const result = await sendDriverBroadcast({
      db,
      request: req('admin_1', { ...message, campaignId: 'outra_campanha' }),
      context: {},
      clock,
    });
    expect(result.recipientCount).toBe(1);
  });
});

describe('broadcast message validation', () => {
  it('accepts a well-formed campaign id and rejects unsafe ones', () => {
    expect(validateCampaignId(' nova_versao-1 ')).toBe('nova_versao-1');
    [' ', 'ab', 'a/b', 'a b', 'x'.repeat(65), 42, null].forEach((bad) => {
      expect(() => validateCampaignId(bad)).toThrow();
    });
  });

  it('collapses whitespace and enforces the length bounds', () => {
    expect(validateMessageText('  Nova   versão  ', 'title', MAX_TITLE_LENGTH))
      .toBe('Nova versão');
    expect(() => validateMessageText('', 'title', MAX_TITLE_LENGTH)).toThrow();
    expect(() => validateMessageText('   ', 'title', MAX_TITLE_LENGTH)).toThrow();
    expect(() => validateMessageText('x'.repeat(MAX_BODY_LENGTH + 1), 'body', MAX_BODY_LENGTH))
      .toThrow();
  });

  it('rejects a payload missing a required field', async () => {
    const db = fakeDb({ drivers: { d1: approved() } });
    await expect(
      sendDriverBroadcast({
        db, request: req('admin_1', { campaignId: 'x_y_z_w', title: 'Oi' }), context: {}, clock,
      })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(events(db)).toHaveLength(0);
  });
});

describe('broadcast presentation', () => {
  const event = {
    eventType: C.NOTIFICATION_EVENT.DRIVER_BROADCAST,
    rideId: 'nova_versao_2026_09',
    recipientRole: 'driver',
    broadcastTitle: message.title,
    broadcastBody: message.body,
  };

  it('renders the admin copy', () => {
    expect(presentationForEvent(event)).toEqual({
      title: message.title,
      body: message.body,
    });
  });

  it('falls back to neutral copy rather than an empty notification', () => {
    const bare = { eventType: C.NOTIFICATION_EVENT.DRIVER_BROADCAST };
    const presentation = presentationForEvent(bare);
    expect(presentation.title.length).toBeGreaterThan(0);
    expect(presentation.body.length).toBeGreaterThan(0);
  });

  it('uses the status channel, never the ride-offer one', () => {
    // The offer sound and its interrupting banner are what earn money. Spending
    // them on an operational message devalues the only alert that must always
    // cut through.
    const android = androidNotificationForEvent(event);
    expect(android.channelId).toBe(C.NOTIFICATION_CHANNELS.RIDE_STATUS);
    expect(android.priority).toBeUndefined();
    expect(android.sound).toBe('default');
  });
});
