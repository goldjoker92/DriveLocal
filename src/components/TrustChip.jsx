// TrustChip
// Small fully-rounded trust chip (e.g. "Pix direto") for the landing page.
// A tiny green dot adds a touch of polish without clutter.

import { View, Text } from 'react-native';

const C = { surface: '#FFFFFF', border: '#E5E7EB', text: '#0F172A', green: '#16A34A' };

export default function TrustChip({ label }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        backgroundColor: C.surface,
        borderWidth: 1,
        borderColor: C.border,
        borderRadius: 999,
        paddingVertical: 9,
        paddingHorizontal: 14,
      }}
    >
      <View style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: C.green }} />
      <Text style={{ fontSize: 12.5, fontWeight: '600', color: C.text }}>{label}</Text>
    </View>
  );
}
