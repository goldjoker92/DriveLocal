// @ts-check
// publishDriverAnnouncementSecure — the persistent fleet message.
//
// Unlike a push, this one is guaranteed to be seen by any driver who opens the
// app, so the risks are different: a forged message would reach everyone, and a
// message that cannot be replaced would be permanent. Both are covered here.

const {
  publishDriverAnnouncement,
  clearDriverAnnouncement,
  validateAnnouncementText,
  validateTone,
  DRIVER_ANNOUNCEMENTS,
  CURRENT_ANNOUNCEMENT_ID,
  MAX_TITLE_LENGTH,
  MAX_BODY_LENGTH,
} = require('../announcement');

const T0 = 1_760_000_000_000;
const clock = { now: () => T0 };

function fakeDb({ admins = ['admin_1'] } = {}) {
  const store = new Map();
  admins.forEach((uid) => store.set(`admins/${uid}`, { uid }));
  return {
    _store: store,
    collection: (name) => ({
      doc: (id) => {
        const path = `${name}/${id}`;
        return {
          path,
          get: () => Promise.resolve({
            exists: store.has(path),
            data: () => store.get(path),
          }),
          set: (data, options) => {
            store.set(
              path,
              options?.merge ? { ...(store.get(path) || {}), ...data } : data
            );
            return Promise.resolve();
          },
        };
      },
    }),
  };
}

const CURRENT = `${DRIVER_ANNOUNCEMENTS}/${CURRENT_ANNOUNCEMENT_ID}`;
const req = (uid, data) => ({ auth: uid ? { uid } : null, data });
const message = { title: 'Nova versão', body: 'Atualize na Play Store.' };

describe('announcement authorization', () => {
  it('refuses an unauthenticated caller', async () => {
    const db = fakeDb();
    await expect(
      publishDriverAnnouncement({ db, request: req(null, message), context: {}, clock })
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(db._store.has(CURRENT)).toBe(false);
  });

  it('refuses a signed-in non-admin', async () => {
    // A forged announcement would speak for the platform to every driver.
    const db = fakeDb();
    await expect(
      publishDriverAnnouncement({ db, request: req('driver_1', message), context: {}, clock })
    ).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
    expect(db._store.has(CURRENT)).toBe(false);
  });

  it('refuses a non-admin trying to clear the message', async () => {
    const db = fakeDb();
    await expect(
      clearDriverAnnouncement({ db, request: req('driver_1', {}), context: {}, clock })
    ).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
  });
});

describe('publishing', () => {
  it('writes one shared document drivers can read', async () => {
    const db = fakeDb();
    const result = await publishDriverAnnouncement({
      db, request: req('admin_1', message), context: {}, clock,
    });

    const stored = db._store.get(CURRENT);
    expect(stored.active).toBe(true);
    expect(stored.title).toBe(message.title);
    expect(stored.body).toBe(message.body);
    expect(stored.tone).toBe('info');
    expect(stored.publishedByAdminUid).toBe('admin_1');
    expect(result.announcementId).toBe(stored.announcementId);
  });

  it('accepts the exact admin-screen payload, including the selected tone', async () => {
    const db = fakeDb();
    const result = await publishDriverAnnouncement({
      db,
      request: req('admin_1', { ...message, tone: 'warning' }),
      context: {},
      clock,
    });

    const stored = db._store.get(CURRENT);
    expect(stored.tone).toBe('warning');
    expect(result.tone).toBe('warning');
  });

  it('mints a new id on every publish so a dismissed message cannot silence the fleet', async () => {
    const db = fakeDb();
    const first = await publishDriverAnnouncement({
      db, request: req('admin_1', message), context: {}, clock,
    });
    const second = await publishDriverAnnouncement({
      db,
      request: req('admin_1', { ...message, title: 'Outro aviso' }),
      context: {},
      clock: { now: () => T0 + 60_000 },
    });

    expect(second.announcementId).not.toBe(first.announcementId);
    // Replaces rather than accumulates: there is only ever one live message.
    expect(db._store.get(CURRENT).title).toBe('Outro aviso');
  });

  it('accepts the declared tones and rejects anything else', async () => {
    expect(validateTone(undefined)).toBe('info');
    expect(validateTone('')).toBe('info');
    ['info', 'warning', 'critical'].forEach((tone) => {
      expect(validateTone(tone)).toBe(tone);
    });
    expect(() => validateTone('shout')).toThrow();
  });

  it('clears the message without destroying the document', async () => {
    // Keeping the document lets the client tell "nothing to show" apart from
    // "never loaded".
    const db = fakeDb();
    await publishDriverAnnouncement({ db, request: req('admin_1', message), context: {}, clock });
    await clearDriverAnnouncement({ db, request: req('admin_1', {}), context: {}, clock });

    const stored = db._store.get(CURRENT);
    expect(stored.active).toBe(false);
    expect(stored.announcementId).toBeTruthy();
    expect(stored.clearedByAdminUid).toBe('admin_1');
  });
});

describe('message validation', () => {
  it('strips control characters and collapses spacing', () => {
    expect(validateAnnouncementText('  Nova\u0000  versão \t ', 'title', MAX_TITLE_LENGTH))
      .toBe('Nova versão');
  });

  it('keeps paragraph breaks in the body', () => {
    // The banner scrolls, so a multi-line message stays readable.
    const text = validateAnnouncementText('Linha 1\nLinha 2', 'body', MAX_BODY_LENGTH);
    expect(text).toContain('\n');
  });

  it('rejects empty and oversized copy', () => {
    expect(() => validateAnnouncementText('', 'title', MAX_TITLE_LENGTH)).toThrow();
    expect(() => validateAnnouncementText('   ', 'title', MAX_TITLE_LENGTH)).toThrow();
    expect(() => validateAnnouncementText('x'.repeat(MAX_TITLE_LENGTH + 1), 'title', MAX_TITLE_LENGTH))
      .toThrow();
    expect(() => validateAnnouncementText('x'.repeat(MAX_BODY_LENGTH + 1), 'body', MAX_BODY_LENGTH))
      .toThrow();
  });

  it('rejects a payload missing a required field', async () => {
    const db = fakeDb();
    await expect(
      publishDriverAnnouncement({
        db, request: req('admin_1', { title: 'Só título' }), context: {}, clock,
      })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(db._store.has(CURRENT)).toBe(false);
  });
});
