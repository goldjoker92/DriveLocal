// Web-safe alert helpers.
// React Native's Alert.alert works on native but multi-button dialogs are
// unreliable on React Native Web. These helpers use Alert on native and
// window.alert / window.confirm on web, failing gracefully if window is absent.

import { Alert, Platform } from 'react-native';

// Joins title + message for the single-string web APIs.
function joinText(title, message) {
  return [title, message].filter(Boolean).join('\n\n');
}

// Simple informational alert. Optional onClose runs after the user dismisses it
// (native: OK button; web: right after window.alert returns).
export function showAppAlert(title, message, onClose) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(joinText(title, message));
      if (onClose) onClose();
      return;
    }
    console.warn('[ALERT] window.alert unavailable:', joinText(title, message));
    if (onClose) onClose();
    return;
  }
  Alert.alert(title || '', message || '', [{ text: 'OK', onPress: onClose }]);
}

// Confirmation dialog. onConfirm runs only when the user accepts.
export function showConfirmAlert({
  title,
  message,
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  onConfirm,
  destructive = false,
}) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      const accepted = window.confirm(joinText(title, message));
      if (accepted && onConfirm) onConfirm();
      return;
    }
    console.warn('[ALERT] window.confirm unavailable; confirmation skipped');
    return;
  }
  Alert.alert(title || '', message || '', [
    { text: cancelText, style: 'cancel' },
    { text: confirmText, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}
