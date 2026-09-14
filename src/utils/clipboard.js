// Cross-platform clipboard helper. Expo owns the native implementation on
// Android/iOS; callers must honor the boolean result before claiming success.

import * as Clipboard from 'expo-clipboard';

export async function copyToClipboard(text) {
  const value = String(text || '');
  if (!value) return false;

  try {
    return (await Clipboard.setStringAsync(value)) === true;
  } catch (_error) {
    return false;
  }
}
