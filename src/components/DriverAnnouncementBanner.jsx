// DriverAnnouncementBanner
//
// The reliable channel to the driver fleet.
//
// A push notification is a single shot: swiped, lost on reboot, invisible if
// notifications are muted, and impossible to confirm as read. This banner lives
// in the app, so any driver who opens DriveLocal sees the message until he taps
// "Entendi". Publishing a new message gives it a new announcementId, so it
// reappears for everyone, including drivers who dismissed the previous one.
//
// Acknowledgement is stored on the device on purpose: dismissing a banner is
// not worth one Firestore write per driver, and losing it (reinstall, cleared
// data) only means the driver sees an important message a second time.

import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { colors } from '../constants/colors';
import { spacing, radius } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';

const ACK_KEY = '@drivelocal/driver-announcement-ack-v1';
export const ANNOUNCEMENTS_COLLECTION = 'driverAnnouncements';
export const CURRENT_ANNOUNCEMENT_ID = 'current';

// Long messages must not push the cockpit off screen.
const MAX_BODY_HEIGHT = 160;

const TONE_STYLES = {
  info: { accent: colors.primary, background: '#EAF2FF' },
  warning: { accent: colors.warning, background: colors.warningBg },
  critical: { accent: colors.danger, background: colors.dangerBg },
};

/**
 * Should this announcement be shown to this driver right now?
 * Pure, so the rule is testable without Firestore or storage.
 *
 * @param {object|null} announcement document data
 * @param {string|null} acknowledgedId last id this device acknowledged
 * @param {{hasActiveRide?:boolean}} [args]
 */
export function shouldShowAnnouncement(announcement, acknowledgedId, args = {}) {
  if (args.hasActiveRide === true) return false;
  if (!announcement || announcement.active !== true) return false;
  if (!announcement.announcementId || !announcement.title) return false;
  return announcement.announcementId !== acknowledgedId;
}

export function toneStyle(tone) {
  return TONE_STYLES[tone] || TONE_STYLES.info;
}

export default function DriverAnnouncementBanner({ hasActiveRide }) {
  const [announcement, setAnnouncement] = useState(null);
  const [acknowledgedId, setAcknowledgedId] = useState(undefined);

  useEffect(() => {
    let disposed = false;
    AsyncStorage.getItem(ACK_KEY)
      .then((value) => { if (!disposed) setAcknowledgedId(value || null); })
      // Unreadable storage must not hide a platform message: show it again.
      .catch(() => { if (!disposed) setAcknowledgedId(null); });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    // One shared document for the whole fleet: a single listener per session,
    // no per-driver read.
    return onSnapshot(
      doc(db, ANNOUNCEMENTS_COLLECTION, CURRENT_ANNOUNCEMENT_ID),
      (snapshot) => setAnnouncement(snapshot.exists() ? snapshot.data() : null),
      () => {
        // A rules or network error must never break the cockpit. The message is
        // informational; the next snapshot recovers it.
        setAnnouncement(null);
      }
    );
  }, []);

  // Undefined means storage has not answered yet: staying silent for that tick
  // avoids flashing a banner the driver already dismissed.
  if (acknowledgedId === undefined) return null;
  if (!shouldShowAnnouncement(announcement, acknowledgedId, { hasActiveRide })) return null;

  const { accent, background } = toneStyle(announcement.tone);

  async function acknowledge() {
    const id = announcement.announcementId;
    setAcknowledgedId(id);
    await AsyncStorage.setItem(ACK_KEY, id).catch(() => undefined);
  }

  return (
    <View
      accessibilityRole="alert"
      accessibilityLabel={`${announcement.title}. ${announcement.body || ''}`}
      style={{
        backgroundColor: background,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: accent,
        padding: spacing.md,
        gap: spacing.xs,
      }}
    >
      <Text style={[{ fontFamily, color: accent, fontWeight: '800' }, typography.body]}>
        {announcement.title}
      </Text>

      {announcement.body ? (
        <ScrollView style={{ maxHeight: MAX_BODY_HEIGHT }} nestedScrollEnabled>
          <Text style={[{ fontFamily, color: colors.text }, typography.small]}>
            {announcement.body}
          </Text>
        </ScrollView>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Entendi"
        onPress={acknowledge}
        style={{
          marginTop: spacing.xs,
          minHeight: 44,
          borderRadius: radius.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: accent,
        }}
      >
        <Text style={[{ fontFamily, color: '#FFFFFF', fontWeight: '800' }, typography.small]}>
          ENTENDI
        </Text>
      </Pressable>
    </View>
  );
}
