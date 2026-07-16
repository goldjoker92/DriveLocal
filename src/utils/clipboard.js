// Minimal clipboard helper with no extra dependency. On web it uses the
// Clipboard API; on native there is no clipboard package installed, so the copy
// UI pairs this with `selectable` text (long-press to copy). Returns true when a
// programmatic copy succeeded.
import { Platform } from 'react-native';

export async function copyToClipboard(text) {
  try {
    if (Platform.OS === 'web' && globalThis.navigator && globalThis.navigator.clipboard) {
      await globalThis.navigator.clipboard.writeText(String(text || ''));
      return true;
    }
  } catch (_e) {
    // ignore — fall back to selectable text
  }
  return false;
}
