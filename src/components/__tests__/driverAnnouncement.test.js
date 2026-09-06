// Isolated from native storage and Firestore: the rules under test are pure and
// must not need a device or a network to be verified.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../config/firebase', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  onSnapshot: jest.fn(() => () => undefined),
}));

// Admin announcement to the driver fleet.
//
// This is the channel that has to work when nothing else does: no phone numbers
// in reach, drivers who never update the app, notifications that may be muted.
// So the rules worth pinning are about reaching the driver, not about styling.

const {
  shouldShowAnnouncement,
  toneStyle,
  ANNOUNCEMENTS_COLLECTION,
  CURRENT_ANNOUNCEMENT_ID,
} = require('../../components/DriverAnnouncementBanner');

const live = (overrides = {}) => ({
  announcementId: 'ann_abc123',
  title: 'Nova versão disponível',
  body: 'Atualize na Play Store.',
  tone: 'info',
  active: true,
  ...overrides,
});

describe('announcement visibility', () => {
  it('shows a live announcement the driver has not acknowledged', () => {
    expect(shouldShowAnnouncement(live(), null)).toBe(true);
    expect(shouldShowAnnouncement(live(), 'ann_older')).toBe(true);
  });

  it('hides it once this device acknowledged that exact message', () => {
    expect(shouldShowAnnouncement(live(), 'ann_abc123')).toBe(false);
  });

  it('reappears for everyone when a new message is published', () => {
    // publishDriverAnnouncement mints a new id on every publish, so dismissing
    // one message can never silence the platform for good.
    const next = live({ announcementId: 'ann_def456' });
    expect(shouldShowAnnouncement(next, 'ann_abc123')).toBe(true);
  });

  it('disappears as soon as the admin clears it', () => {
    expect(shouldShowAnnouncement(live({ active: false }), null)).toBe(false);
  });

  it('never covers an accepted ride', () => {
    // Navigation and the Pix confirmation own the screen at that point.
    expect(shouldShowAnnouncement(live(), null, { hasActiveRide: true })).toBe(false);
  });

  it('ignores an absent or malformed document instead of rendering an empty banner', () => {
    expect(shouldShowAnnouncement(null, null)).toBe(false);
    expect(shouldShowAnnouncement(undefined, null)).toBe(false);
    expect(shouldShowAnnouncement({}, null)).toBe(false);
    expect(shouldShowAnnouncement(live({ title: '' }), null)).toBe(false);
    expect(shouldShowAnnouncement(live({ announcementId: null }), null)).toBe(false);
  });

  it('still shows a title-only message', () => {
    // The body is optional; a headline alone must not be swallowed.
    expect(shouldShowAnnouncement(live({ body: '' }), null)).toBe(true);
  });
});

describe('announcement tone', () => {
  it('maps every backend tone and falls back safely', () => {
    ['info', 'warning', 'critical'].forEach((tone) => {
      const style = toneStyle(tone);
      expect(style.accent).toBeTruthy();
      expect(style.background).toBeTruthy();
    });
    // An unknown tone from a future backend must render, not crash.
    expect(toneStyle('unknown')).toEqual(toneStyle('info'));
    expect(toneStyle(undefined)).toEqual(toneStyle('info'));
  });
});

describe('announcement wiring', () => {
  it('reads the single shared document', () => {
    // One document for the whole fleet: one listener per session instead of one
    // read per driver.
    expect(ANNOUNCEMENTS_COLLECTION).toBe('driverAnnouncements');
    expect(CURRENT_ANNOUNCEMENT_ID).toBe('current');
  });

  it('is mounted for every driver screen and outside an active ride', () => {
    const fs = require('fs');
    const layout = fs.readFileSync('src/app/(driver)/_layout.jsx', 'utf8');
    expect(layout).toContain('DriverAnnouncementBanner');
    expect(layout).toContain('hasActiveRide={Boolean(activeRideId)}');
  });

  it('is reachable from the admin dashboard, not just by URL', () => {
    // An admin screen nobody can navigate to is an admin screen that does not
    // exist. It sits in Operations, next to the other day-to-day actions.
    const fs = require('fs');
    const dashboard = fs.readFileSync('src/app/(admin)/dashboard.jsx', 'utf8');
    expect(dashboard).toContain("'/driver-message'");
    expect(dashboard).toContain('Avisar motoristas');
    // Its own section: communicating with drivers is not an administrative
    // queue, it is the only direct channel to the fleet.
    expect(dashboard).toContain('Comunicação');
    expect(dashboard).toContain('communication_driver_message');
    expect(fs.existsSync('src/app/(admin)/driver-message.jsx')).toBe(true);
  });

  it('is readable by drivers but writable only by the backend', () => {
    const fs = require('fs');
    const rules = fs.readFileSync('backend/firebase/rules/firestore.rules', 'utf8');
    const block = rules.slice(rules.indexOf('match /driverAnnouncements/'));
    expect(block).toContain('allow read: if isSignedIn();');
    // A client must never be able to forge a platform message.
    expect(block.slice(0, 200)).toContain('allow write: if false;');
  });
});
