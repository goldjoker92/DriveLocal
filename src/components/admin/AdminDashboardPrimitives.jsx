// Reusable visual primitives for the mobile admin command center.
//
// The admin uses a stronger cockpit hierarchy than passenger/driver screens:
// solid status surfaces, prominent KPIs, left priority rails and elevated sections.
// Business data and navigation remain owned by the dashboard screen.

import { Pressable, Text, View } from 'react-native';

import { colors } from '../../constants/colors';
import { radius, spacing } from '../../constants/spacing';
import { fontFamily, typography } from '../../constants/typography';
import AdminBusinessPulse from './AdminBusinessPulse';

const TONES = Object.freeze({
  neutral: {
    background: colors.card,
    border: colors.border,
    foreground: colors.text,
    muted: colors.textMuted,
    solid: colors.text,
    onSolid: colors.onPrimary,
  },
  primary: {
    background: colors.primaryTint,
    border: colors.primary,
    foreground: colors.primary,
    muted: colors.textMuted,
    solid: colors.primary,
    onSolid: colors.onPrimary,
  },
  success: {
    background: colors.successBg,
    border: colors.success,
    foreground: colors.success,
    muted: colors.textMuted,
    solid: colors.success,
    onSolid: colors.onPrimary,
  },
  warning: {
    background: colors.warningBg,
    border: colors.warning,
    foreground: colors.warning,
    muted: colors.textMuted,
    solid: colors.warning,
    onSolid: colors.onPrimary,
  },
  danger: {
    background: colors.dangerBg,
    border: colors.danger,
    foreground: colors.danger,
    muted: colors.textMuted,
    solid: colors.danger,
    onSolid: colors.onPrimary,
  },
});

function palette(tone) {
  return TONES[tone] || TONES.neutral;
}

function elevatedSurface(borderColor) {
  return {
    borderWidth: 1,
    borderColor,
    backgroundColor: colors.background,
    shadowColor: colors.black,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  };
}

export function IconBubble({ icon, tone = 'primary', compact = false, solid = false }) {
  const selected = palette(tone);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: compact ? 34 : 44,
        height: compact ? 34 : 44,
        borderRadius: radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: solid ? 'rgba(255,255,255,0.16)' : selected.background,
        borderWidth: 1,
        borderColor: solid ? 'rgba(255,255,255,0.28)' : selected.border,
      }}
    >
      <Text style={{ fontSize: compact ? 17 : 21 }}>{icon}</Text>
    </View>
  );
}

export function SectionHeading({ icon, title, subtitle, actionLabel, onAction }) {
  return (
    <View style={{ marginTop: spacing.md, gap: spacing.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: spacing.sm }}>
        <View style={{ width: 4, borderRadius: radius.full, backgroundColor: colors.primary }} />
        <View style={{ flex: 1, gap: spacing.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            {icon ? <IconBubble icon={icon} compact /> : null}
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[{ fontFamily, color: colors.text }, typography.h2]}>{title}</Text>
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
                  minHeight: 38,
                  justifyContent: 'center',
                  borderRadius: radius.full,
                  backgroundColor: colors.primaryTint,
                  borderWidth: 1,
                  borderColor: colors.primary,
                  paddingHorizontal: spacing.md,
                  opacity: pressed ? 0.62 : 1,
                })}
              >
                <Text style={[{ fontFamily, color: colors.primary }, typography.small]}>
                  {actionLabel}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
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
        backgroundColor: selected.solid,
        gap: spacing.md,
        shadowColor: selected.solid,
        shadowOpacity: 0.2,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 7 },
        elevation: 6,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
        <IconBubble icon={icon} tone={tone} solid />
        <View style={{ flex: 1, gap: spacing.xs }}>
          {eyebrow ? (
            <Text style={[{ fontFamily, color: 'rgba(255,255,255,0.72)', letterSpacing: 0.8 }, typography.caption]}>
              {eyebrow.toUpperCase()}
            </Text>
          ) : null}
          <Text style={[{ fontFamily, color: selected.onSolid }, typography.h2]}>{title}</Text>
          <Text style={[{ fontFamily, color: 'rgba(255,255,255,0.82)' }, typography.small]}>{message}</Text>
          {actionLabel ? (
            <View style={{ alignSelf: 'flex-start', marginTop: spacing.xs, borderRadius: radius.full, backgroundColor: 'rgba(255,255,255,0.16)', paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
              <Text style={[{ fontFamily, color: selected.onSolid }, typography.bodyBold]}>
                {actionLabel} →
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.76 : 1, transform: [{ scale: pressed ? 0.99 : 1 }] })}>
      {content}
    </Pressable>
  );
}

export function InsightCard({ icon = '✨', tone = 'primary', title, message, footer }) {
  const selected = palette(tone);
  return (
    <View style={{ gap: spacing.md }}>
      <View
        accessibilityRole="summary"
        style={{
          padding: spacing.lg,
          borderRadius: radius.lg,
          borderLeftWidth: 5,
          borderLeftColor: selected.border,
          backgroundColor: colors.background,
          gap: spacing.md,
          shadowColor: colors.black,
          shadowOpacity: 0.07,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 2,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
          <IconBubble icon={icon} tone={tone} compact />
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text style={[{ fontFamily, color: selected.foreground, letterSpacing: 0.7 }, typography.caption]}>
              LEITURA AUTOMÁTICA
            </Text>
            <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>{title}</Text>
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>{message}</Text>
            {footer ? (
              <Text style={[{ fontFamily, color: colors.textFaint }, typography.caption]}>{footer}</Text>
            ) : null}
          </View>
        </View>
      </View>
      <AdminBusinessPulse />
    </View>
  );
}

export function KpiCard({ icon, label, value, hint, tone = 'neutral', onPress }) {
  const selected = palette(tone);
  const content = (
    <View
      style={{
        width: '100%',
        minHeight: 142,
        padding: spacing.md,
        borderRadius: radius.lg,
        ...elevatedSurface(selected.border),
        overflow: 'hidden',
        gap: spacing.sm,
      }}
    >
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 5, backgroundColor: selected.solid }} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
        <IconBubble icon={icon} tone={tone} compact />
        {onPress ? (
          <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: selected.background }}>
            <Text style={[{ fontFamily, color: selected.foreground }, typography.bodyBold]}>›</Text>
          </View>
        ) : null}
      </View>
      <Text
        style={[{ fontFamily, color: selected.foreground }, typography.h1]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>{label}</Text>
      {hint ? (
        <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>{hint}</Text>
      ) : null}
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.76 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] })}>
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
        opacity: pressed ? 0.72 : 1,
        transform: [{ translateY: pressed ? 1 : 0 }],
        padding: spacing.md,
        borderRadius: radius.lg,
        borderLeftWidth: 5,
        borderLeftColor: selected.solid,
        ...elevatedSurface(colors.border),
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <IconBubble icon={icon} tone={tone} compact />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>{title}</Text>
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>{detail}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Text style={[{ fontFamily, color: selected.foreground }, typography.h2]}>{count}</Text>
          <Text style={[{ fontFamily, color: selected.foreground }, typography.caption]}>ABRIR ›</Text>
        </View>
      </View>
    </Pressable>
  );
}

export function MetricRow({ label, value, strong = false, hint, tone = 'neutral' }) {
  const selected = palette(tone);
  return (
    <View style={{ gap: 3, paddingVertical: spacing.xs }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
        <Text style={[{ fontFamily, color: colors.textMuted, flex: 1 }, typography.small]}>{label}</Text>
        <Text
          style={[
            { fontFamily, color: strong ? selected.foreground : colors.text, textAlign: 'right' },
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
        style={{ height: 12, borderRadius: radius.full, overflow: 'hidden', backgroundColor: colors.border }}
      >
        <View
          style={{
            width: `${Math.round(progress * 100)}%`,
            height: '100%',
            borderRadius: radius.full,
            backgroundColor: selected.solid,
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
        ...elevatedSurface(colors.border),
        overflow: 'hidden',
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={({ pressed }) => ({
          opacity: pressed ? 0.72 : 1,
          padding: spacing.lg,
          backgroundColor: expanded ? colors.primary : colors.background,
        })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <IconBubble icon={icon} compact solid={expanded} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={[{ fontFamily, color: expanded ? colors.onPrimary : colors.text }, typography.bodyBold]}>{title}</Text>
            {subtitle ? (
              <Text style={[{ fontFamily, color: expanded ? 'rgba(255,255,255,0.74)' : colors.textMuted }, typography.caption]}>{subtitle}</Text>
            ) : null}
          </View>
          {badge ? (
            <View style={{ borderRadius: radius.full, backgroundColor: expanded ? 'rgba(255,255,255,0.16)' : colors.primaryTint, borderWidth: 1, borderColor: expanded ? 'rgba(255,255,255,0.25)' : colors.primary, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}>
              <Text style={[{ fontFamily, color: expanded ? colors.onPrimary : colors.primary }, typography.caption]}>{badge}</Text>
            </View>
          ) : null}
          <Text style={[{ fontFamily, color: expanded ? colors.onPrimary : colors.primary }, typography.h3]}>{expanded ? '⌃' : '⌄'}</Text>
        </View>
      </Pressable>
      {expanded ? (
        <View style={{ padding: spacing.lg, gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background }}>
          {children}
        </View>
      ) : null}
    </View>
  );
}
