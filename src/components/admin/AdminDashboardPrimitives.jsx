// Reusable visual primitives for the mobile admin command center.
//
// The dashboard deliberately uses the existing DriveLocal color tokens only. Tone
// communicates priority, but every state also has text and an icon so meaning never
// depends on color alone.

import { Pressable, Text, View } from 'react-native';

import { colors } from '../../constants/colors';
import { radius, spacing } from '../../constants/spacing';
import { fontFamily, typography } from '../../constants/typography';

const TONES = Object.freeze({
  neutral: {
    background: colors.card,
    border: colors.border,
    foreground: colors.text,
    muted: colors.textMuted,
  },
  primary: {
    background: colors.primaryTint,
    border: colors.primary,
    foreground: colors.primary,
    muted: colors.textMuted,
  },
  success: {
    background: colors.successBg,
    border: colors.success,
    foreground: colors.success,
    muted: colors.textMuted,
  },
  warning: {
    background: colors.warningBg,
    border: colors.warning,
    foreground: colors.warning,
    muted: colors.textMuted,
  },
  danger: {
    background: colors.dangerBg,
    border: colors.danger,
    foreground: colors.danger,
    muted: colors.textMuted,
  },
});

function palette(tone) {
  return TONES[tone] || TONES.neutral;
}

export function IconBubble({ icon, tone = 'primary', compact = false }) {
  const selected = palette(tone);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: compact ? 32 : 40,
        height: compact ? 32 : 40,
        borderRadius: radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: selected.background,
        borderWidth: 1,
        borderColor: selected.border,
      }}
    >
      <Text style={{ fontSize: compact ? 16 : 19 }}>{icon}</Text>
    </View>
  );
}

export function SectionHeading({ icon, title, subtitle, actionLabel, onAction }) {
  return (
    <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        {icon ? <IconBubble icon={icon} compact /> : null}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>{title}</Text>
          {subtitle ? (
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {actionLabel && onAction ? (
          <Pressable
            accessibilityRole="button"
            onPress={onAction}
            style={({ pressed }) => ({
              paddingHorizontal: spacing.sm,
              paddingVertical: spacing.sm,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={[{ fontFamily, color: colors.primary }, typography.small]}>
              {actionLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function StatusBanner({ icon, tone = 'primary', eyebrow, title, message, actionLabel, onPress }) {
  const selected = palette(tone);
  const content = (
    <View
      style={{
        padding: spacing.lg,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: selected.border,
        backgroundColor: selected.background,
        gap: spacing.md,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
        <IconBubble icon={icon} tone={tone} />
        <View style={{ flex: 1, gap: spacing.xs }}>
          {eyebrow ? (
            <Text style={[{ fontFamily, color: selected.foreground }, typography.caption]}>
              {eyebrow.toUpperCase()}
            </Text>
          ) : null}
          <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>{title}</Text>
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>{message}</Text>
          {actionLabel ? (
            <Text style={[{ fontFamily, color: selected.foreground }, typography.bodyBold]}>
              {actionLabel} →
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}>
      {content}
    </Pressable>
  );
}

export function InsightCard({ icon = '✨', tone = 'primary', title, message, footer }) {
  const selected = palette(tone);
  return (
    <View
      accessibilityRole="summary"
      style={{
        padding: spacing.lg,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: selected.border,
        backgroundColor: colors.background,
        gap: spacing.md,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
        <IconBubble icon={icon} tone={tone} compact />
        <View style={{ flex: 1, gap: spacing.xs }}>
          <Text style={[{ fontFamily, color: selected.foreground }, typography.caption]}>
            LEITURA AUTOMÁTICA
          </Text>
          <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>{title}</Text>
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>{message}</Text>
          {footer ? (
            <Text style={[{ fontFamily, color: colors.textFaint }, typography.caption]}>{footer}</Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

export function KpiCard({ icon, label, value, hint, tone = 'neutral', onPress }) {
  const selected = palette(tone);
  const content = (
    <View
      style={{
        width: '100%',
        padding: spacing.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: selected.border,
        backgroundColor: selected.background,
        gap: spacing.sm,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
        <Text style={{ fontSize: 18 }}>{icon}</Text>
        {onPress ? (
          <Text style={[{ fontFamily, color: selected.foreground }, typography.bodyBold]}>›</Text>
        ) : null}
      </View>
      <Text
        style={[{ fontFamily, color: colors.text }, typography.h2]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      <Text style={[{ fontFamily, color: selected.foreground }, typography.small]}>{label}</Text>
      {hint ? (
        <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>{hint}</Text>
      ) : null}
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}>
      {content}
    </Pressable>
  );
}

export function ActionRow({ icon, title, count, detail, tone = 'warning', onPress }) {
  const selected = palette(tone);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        opacity: pressed ? 0.68 : 1,
        padding: spacing.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: selected.border,
        backgroundColor: selected.background,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <IconBubble icon={icon} tone={tone} compact />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>{title}</Text>
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>{detail}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Text style={[{ fontFamily, color: selected.foreground }, typography.h3]}>{count}</Text>
          <Text style={[{ fontFamily, color: selected.foreground }, typography.caption]}>ABRIR ›</Text>
        </View>
      </View>
    </Pressable>
  );
}

export function MetricRow({ label, value, strong = false, hint, tone = 'neutral' }) {
  const selected = palette(tone);
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
        <Text style={[{ fontFamily, color: colors.textMuted, flex: 1 }, typography.small]}>{label}</Text>
        <Text
          style={[
            { fontFamily, color: strong ? selected.foreground : colors.textMuted, textAlign: 'right' },
            strong ? typography.bodyBold : typography.small,
          ]}
        >
          {value}
        </Text>
      </View>
      {hint ? (
        <Text style={[{ fontFamily, color: colors.textFaint }, typography.caption]}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function ProgressMetric({ label, value, total, valueLabel, tone = 'primary' }) {
  const selected = palette(tone);
  const safeTotal = Math.max(0, Number(total || 0));
  const safeValue = Math.max(0, Number(value || 0));
  const progress = safeTotal > 0 ? Math.min(1, safeValue / safeTotal) : 0;
  return (
    <View style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
        <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>{label}</Text>
        <Text style={[{ fontFamily, color: selected.foreground }, typography.bodyBold]}>{valueLabel}</Text>
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: safeTotal || 1, now: safeValue }}
        style={{ height: 10, borderRadius: radius.full, overflow: 'hidden', backgroundColor: colors.border }}
      >
        <View
          style={{
            width: `${Math.round(progress * 100)}%`,
            height: '100%',
            borderRadius: radius.full,
            backgroundColor: selected.foreground,
          }}
        />
      </View>
    </View>
  );
}

export function DisclosureSection({ icon, title, subtitle, badge, expanded, onToggle, children }) {
  return (
    <View
      style={{
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.background,
        overflow: 'hidden',
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={({ pressed }) => ({
          opacity: pressed ? 0.7 : 1,
          padding: spacing.lg,
          backgroundColor: expanded ? colors.primaryTint : colors.background,
        })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <IconBubble icon={icon} compact />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>{title}</Text>
            {subtitle ? (
              <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>{subtitle}</Text>
            ) : null}
          </View>
          {badge ? (
            <View style={{ borderRadius: radius.full, backgroundColor: colors.primary, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}>
              <Text style={[{ fontFamily, color: colors.onPrimary }, typography.caption]}>{badge}</Text>
            </View>
          ) : null}
          <Text style={[{ fontFamily, color: colors.primary }, typography.h3]}>{expanded ? '⌃' : '⌄'}</Text>
        </View>
      </Pressable>
      {expanded ? (
        <View style={{ padding: spacing.lg, gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }}>
          {children}
        </View>
      ) : null}
    </View>
  );
}
