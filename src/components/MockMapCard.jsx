// MockMapCard
// A fake-but-polished "map" so the landing feels like a ride is about to
// happen. No real map dependency — only styled Views:
//   - faint neighborhood blocks + streets for depth
//   - a soft pickup radius circle around the origin
//   - an angled route with small stop dots
//   - two pins with local Horizonte labels
// The bottom ~28px is intentionally kept clear because the passenger
// bottom-sheet overlaps it.

import { View, Text } from 'react-native';

const C = {
  mapBlue: '#EAF2FF',
  border: '#E5E7EB',
  navy: '#0B2F6B',
  green: '#16A34A',
  text: '#0F172A',
  white: '#FFFFFF',
};

const block = {
  position: 'absolute',
  backgroundColor: C.white,
  opacity: 0.5,
  borderRadius: 12,
};

const street = {
  position: 'absolute',
  backgroundColor: C.white,
  opacity: 0.55,
  borderRadius: 999,
  transform: [{ rotate: '-8deg' }],
};

const dot = {
  position: 'absolute',
  width: 7,
  height: 7,
  borderRadius: 999,
  backgroundColor: C.navy,
  opacity: 0.55,
};

const labelPill = {
  position: 'absolute',
  backgroundColor: C.white,
  paddingVertical: 4,
  paddingHorizontal: 9,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: C.border,
};

export default function MockMapCard() {
  return (
    <View
      style={{
        height: 244,
        borderRadius: 24,
        backgroundColor: C.mapBlue,
        borderWidth: 1,
        borderColor: C.border,
        overflow: 'hidden',
      }}
    >
      {/* faint neighborhood blocks */}
      <View style={[block, { top: 26, left: 24, width: 72, height: 46 }]} />
      <View style={[block, { top: 30, right: 28, width: 84, height: 40 }]} />
      <View style={[block, { top: 118, left: 28, width: 66, height: 44 }]} />
      <View style={[block, { top: 120, right: 40, width: 80, height: 40, opacity: 0.4 }]} />

      {/* streets */}
      <View style={[street, { top: 66, left: -30, width: '130%', height: 12 }]} />
      <View style={[street, { top: 156, left: -30, width: '130%', height: 12, opacity: 0.45 }]} />
      <View style={[street, { top: -20, left: 158, width: 12, height: '150%', opacity: 0.45 }]} />

      {/* soft pickup radius around origin */}
      <View style={{ position: 'absolute', top: 100, left: 6, width: 132, height: 132, borderRadius: 999, backgroundColor: C.navy, opacity: 0.08 }} />

      {/* angled route + stop dots */}
      <View style={{ position: 'absolute', top: 120, left: 62, width: 198, height: 5, backgroundColor: C.navy, borderRadius: 999, transform: [{ rotate: '-26deg' }] }} />
      <View style={[dot, { top: 132, left: 118 }]} />
      <View style={[dot, { top: 112, left: 162 }]} />
      <View style={[dot, { top: 92, left: 206 }]} />

      {/* origin pin (Centro) */}
      <View style={{ position: 'absolute', top: 150, left: 64, width: 16, height: 16, borderRadius: 999, backgroundColor: C.navy, borderWidth: 3, borderColor: C.white }} />
      <View style={[labelPill, { top: 172, left: 46 }]}>
        <Text style={{ fontSize: 11, fontWeight: '700', color: C.text }}>Centro</Text>
      </View>

      {/* destination pin (Planalto Horizonte) — label anchored to the right edge */}
      <View style={{ position: 'absolute', top: 58, left: 250, width: 16, height: 16, borderRadius: 999, backgroundColor: C.green, borderWidth: 3, borderColor: C.white }} />
      <View style={[labelPill, { top: 30, right: 14 }]}>
        <Text style={{ fontSize: 11, fontWeight: '700', color: C.text }}>Planalto Horizonte</Text>
      </View>
    </View>
  );
}
