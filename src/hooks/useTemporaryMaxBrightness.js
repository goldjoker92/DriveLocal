import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Brightness from 'expo-brightness';

export default function useTemporaryMaxBrightness(enabled) {
  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;
    let changed = false;
    let previousBrightness = null;

    async function maximize() {
      try {
        if (!(await Brightness.isAvailableAsync())) return;
        previousBrightness = await Brightness.getBrightnessAsync();
        if (cancelled) return;
        await Brightness.setBrightnessAsync(1);
        changed = true;
      } catch (_error) {
        // Copy-and-paste remains available if brightness cannot be changed.
      }
    }

    maximize();

    return () => {
      cancelled = true;
      if (!changed) return;
      if (Platform.OS === 'android') {
        Brightness.restoreSystemBrightnessAsync().catch(() => undefined);
      } else if (Number.isFinite(previousBrightness)) {
        Brightness.setBrightnessAsync(previousBrightness).catch(() => undefined);
      }
    };
  }, [enabled]);
}
