// Universal clipboard helper used by Pix copy actions.
import * as Clipboard from 'expo-clipboard';

export async function copyToClipboard(text) {
  const value = String(text || '');
  if (!value) return false;

  try {
    return (await Clipboard.setStringAsync(value)) !== false;
  } catch (_error) {
    return false;
  }
}
