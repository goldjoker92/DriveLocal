import { forwardRef, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import AppInput from './AppInput';
import { colors } from '../constants/colors';
import { radius, spacing } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';
import {
  createPlacesSessionToken,
  resolveAddressSuggestion,
  searchAddressSuggestions,
} from '../services/placeAutocompleteService';
import { ACTIVE_SERVICE_AREA_ID } from '../constants/serviceAreaIds';

const SEARCH_DEBOUNCE_MS = 350;

function sourceLabel(source) {
  return source === 'google_places' ? 'Google' : 'DriveLocal';
}

const AddressAutocompleteInput = forwardRef(function AddressAutocompleteInput(
  {
    value,
    onChangeText,
    onSuggestionSelected,
    serviceAreaId = ACTIVE_SERVICE_AREA_ID,
    disabled = false,
    allowExternal = true,
    ...inputProps
  },
  ref
) {
  const sessionTokenRef = useRef(createPlacesSessionToken());
  const searchVersionRef = useRef(0);
  const blurTimerRef = useRef(null);
  const [focused, setFocused] = useState(false);
  const [items, setItems] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectingId, setSelectingId] = useState(null);
  const [providerUnavailable, setProviderUnavailable] = useState(false);
  const [selectionError, setSelectionError] = useState('');

  useEffect(() => () => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
  }, []);

  useEffect(() => {
    const clean = String(value || '').trim();
    const version = searchVersionRef.current + 1;
    searchVersionRef.current = version;
    setSelectionError('');

    if (!focused || disabled || clean.length < 2) {
      setItems([]);
      setSearching(false);
      setProviderUnavailable(false);
      return undefined;
    }

    setSearching(true);
    const timer = setTimeout(() => {
      searchAddressSuggestions({
        query: clean,
        serviceAreaId,
        sessionToken: sessionTokenRef.current,
        allowExternal,
      }).then((result) => {
        if (searchVersionRef.current !== version) return;
        setItems(result.items || []);
        setProviderUnavailable(result.externalCalled && !result.providerAvailable);
      }).finally(() => {
        if (searchVersionRef.current === version) setSearching(false);
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [allowExternal, disabled, focused, serviceAreaId, value]);

  function handleFocus(event) {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    setFocused(true);
    inputProps.onFocus?.(event);
  }

  function handleBlur(event) {
    inputProps.onBlur?.(event);
    blurTimerRef.current = setTimeout(() => setFocused(false), 180);
  }

  function handleChange(text) {
    onChangeText?.(text);
    setSelectionError('');
    if (!focused) setFocused(true);
  }

  async function selectSuggestion(item) {
    if (disabled || selectingId) return;
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    setFocused(true);
    setSelectingId(item.id);
    setSelectionError('');

    const result = await resolveAddressSuggestion({
      suggestion: item,
      serviceAreaId,
      sessionToken: sessionTokenRef.current,
    });

    if (result.status === 'ok') {
      onSuggestionSelected?.(result, item);
      setItems([]);
      setFocused(false);
      sessionTokenRef.current = createPlacesSessionToken();
    } else {
      setSelectionError(
        item.source === 'google_places'
          ? 'Não foi possível confirmar este local. Digite mais detalhes ou escolha outra opção.'
          : 'Não foi possível usar esta sugestão agora.'
      );
    }
    setSelectingId(null);
  }

  const visible = focused && (searching || items.length > 0 || providerUnavailable || selectionError);
  const hasExternal = items.some((item) => item.source === 'google_places');

  return (
    <View style={styles.wrapper}>
      <AppInput
        {...inputProps}
        ref={ref}
        value={value}
        onChangeText={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        editable={!disabled && inputProps.editable !== false}
        autoCorrect={false}
      />

      {visible ? (
        <View style={styles.panel} accessibilityLiveRegion="polite">
          {searching && items.length === 0 ? (
            <View style={styles.feedbackRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.feedbackText}>Buscando locais em Horizonte…</Text>
            </View>
          ) : null}

          {items.map((item, index) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={`${item.label}. ${item.secondaryLabel || ''}`}
              onPress={() => selectSuggestion(item)}
              disabled={Boolean(selectingId)}
              style={({ pressed }) => [
                styles.suggestion,
                index < items.length - 1 && styles.suggestionBorder,
                pressed && styles.suggestionPressed,
              ]}
            >
              <View style={styles.suggestionCopy}>
                <Text numberOfLines={1} style={styles.suggestionTitle}>{item.label}</Text>
                {item.secondaryLabel ? (
                  <Text numberOfLines={1} style={styles.suggestionSecondary}>
                    {item.secondaryLabel}
                  </Text>
                ) : null}
              </View>
              {selectingId === item.id ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={[
                  styles.sourceBadge,
                  item.source === 'google_places' && styles.sourceBadgeExternal,
                ]}>
                  {sourceLabel(item.source)}
                </Text>
              )}
            </Pressable>
          ))}

          {providerUnavailable ? (
            <Text style={styles.providerNotice}>
              A busca externa está indisponível. As sugestões locais continuam funcionando.
            </Text>
          ) : null}
          {selectionError ? <Text style={styles.errorText}>{selectionError}</Text> : null}
          {hasExternal ? (
            <Text style={styles.attribution}>Resultados externos fornecidos pelo Google Maps</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

export default AddressAutocompleteInput;

const styles = StyleSheet.create({
  wrapper: { gap: spacing.xs },
  panel: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  suggestion: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  suggestionBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  suggestionPressed: { backgroundColor: colors.primaryTint },
  suggestionCopy: { flex: 1, gap: 2 },
  suggestionTitle: { fontFamily, color: colors.text, ...typography.bodyBold },
  suggestionSecondary: { fontFamily, color: colors.textMuted, ...typography.caption },
  sourceBadge: {
    overflow: 'hidden',
    fontFamily,
    color: colors.primary,
    backgroundColor: colors.primaryTint,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
    ...typography.caption,
    fontWeight: '700',
  },
  sourceBadgeExternal: { color: colors.text, backgroundColor: colors.card },
  feedbackRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  feedbackText: { flex: 1, fontFamily, color: colors.textMuted, ...typography.small },
  providerNotice: {
    fontFamily,
    color: colors.warning,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.caption,
  },
  errorText: {
    fontFamily,
    color: colors.danger,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.caption,
  },
  attribution: {
    fontFamily,
    color: colors.textFaint,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    textAlign: 'right',
    ...typography.caption,
  },
});
