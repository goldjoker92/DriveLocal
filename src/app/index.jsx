// DriveLocal landing page (route "/").
// Premium, mobile-first local ride-hailing landing — map-first with a
// bottom-sheet style passenger action that overlaps the map.
// Mock-only: buttons navigate to existing mock routes; no backend, no auth,
// no real map.

import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import MobileShell from '../components/MobileShell';
import MockMapCard from '../components/MockMapCard';
import TrustChip from '../components/TrustChip';

// Landing palette (kept local so the rest of the app stays unchanged).
const C = {
  surface: '#FFFFFF',
  bg: '#F7F8FA',
  text: '#0F172A',
  muted: '#64748B',
  border: '#E5E7EB',
  brandNavy: '#071A33',
  cta: '#0B2F6B',
  ctaPressed: '#061A3A',
  amber: '#F59E0B',
  mapBlue: '#EAF2FF',
  softAmber: '#FFF7E6',
};

// Shared premium card style (soft shadow, large radius).
const card = {
  backgroundColor: C.surface,
  borderRadius: 24,
  borderWidth: 1,
  borderColor: C.border,
  padding: 20,
  shadowColor: '#0F172A',
  shadowOpacity: 0.06,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 8 },
  elevation: 3,
};

// CTA button. kind: 'primary' (tactile dark navy) | 'secondary' (light outline).
function CtaButton({ label, onPress, kind = 'primary' }) {
  const isPrimary = kind === 'primary';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 56,
          borderRadius: 16,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 16,
          backgroundColor: isPrimary
            ? pressed
              ? C.ctaPressed
              : C.cta
            : pressed
              ? '#EEF2F7'
              : C.surface,
          borderWidth: isPrimary ? 0 : 1,
          borderColor: C.border,
          transform: [{ scale: pressed ? 0.99 : 1 }],
        },
        isPrimary && {
          shadowColor: C.cta,
          shadowOpacity: 0.28,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 8 },
          elevation: 4,
        },
      ]}
    >
      <Text style={{ fontSize: 16.5, fontWeight: '800', color: isPrimary ? '#FFFFFF' : C.cta }}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function Landing() {
  const router = useRouter();

  return (
    <MobileShell>
      {/* Top bar: wordmark + service area pill */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 20, fontWeight: '800', color: C.brandNavy }}>DriveLocal</Text>
        <View style={{ backgroundColor: C.mapBlue, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 }}>
          <Text style={{ fontSize: 12.5, fontWeight: '700', color: C.cta }}>Horizonte · CE</Text>
        </View>
      </View>

      {/* Hero */}
      <View style={{ gap: 6 }}>
        <Text style={{ fontSize: 26, fontWeight: '800', color: C.brandNavy, lineHeight: 32 }}>
          Corridas locais, com motoristas da sua cidade.
        </Text>
        <Text style={{ fontSize: 14, fontWeight: '600', color: C.muted }}>
          Rápido. Local. Pago por Pix.
        </Text>
      </View>

      {/* Map + passenger bottom-sheet (sheet overlaps the map) */}
      <View>
        <MockMapCard />

        <View style={[card, { marginTop: -28, gap: 14, zIndex: 2 }]}>
          {/* bottom-sheet grabber */}
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 999, backgroundColor: '#E2E8F0', marginBottom: 2 }} />

          <Text style={{ fontSize: 18, fontWeight: '800', color: C.text }}>Para onde você vai?</Text>

          {/* Input-like field (mock) */}
          <Pressable
            onPress={() => router.push('/select-route')}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              backgroundColor: C.bg,
              borderWidth: 1,
              borderColor: C.border,
              borderRadius: 14,
              paddingVertical: 15,
              paddingHorizontal: 14,
            }}
          >
            <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: C.cta }} />
            <Text style={{ fontSize: 15, color: C.muted, fontWeight: '500' }}>Buscar destino</Text>
          </Pressable>

          <Text style={{ fontSize: 13, color: C.muted }}>
            Pagamento direto por Pix ao motorista.
          </Text>

          <CtaButton label="Pedir uma corrida" onPress={() => router.push('/select-route')} kind="primary" />

          {/* Trust chips */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 2 }}>
            <TrustChip label="Motoristas locais" />
            <TrustChip label="Pix direto" />
            <TrustChip label="Sem dinheiro" />
          </View>
        </View>
      </View>

      {/* Driver opportunity (secondary to passenger) */}
      <View style={[card, { gap: 12 }]}>
        <Text style={{ fontSize: 18, fontWeight: '800', color: C.text }}>Você é motorista?</Text>
        <Text style={{ fontSize: 14, color: C.muted, lineHeight: 20 }}>
          Ganhe corridas locais com menos comissão e mais controle.
        </Text>

        {/* Founder offer — visible but calm */}
        <View
          style={{
            backgroundColor: C.softAmber,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: '#F6E0B5',
            padding: 14,
            gap: 8,
          }}
        >
          <View style={{ alignSelf: 'flex-start', backgroundColor: C.amber, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10 }}>
            <Text style={{ fontSize: 11.5, fontWeight: '800', color: C.brandNavy }}>Motorista fundador</Text>
          </View>
          <Text style={{ fontSize: 14, fontWeight: '600', color: C.text, lineHeight: 20 }}>
            0% comissão por 60 dias para os 100 primeiros aprovados.
          </Text>
        </View>

        <CtaButton label="Dirigir com DriveLocal" onPress={() => router.push('/email-register')} kind="secondary" />
      </View>

      {/* Discreet internal access (link, not a button) */}
      <Pressable onPress={() => router.push('/admin-login')} style={{ alignSelf: 'center', paddingVertical: 6 }}>
        <Text style={{ fontSize: 12.5, color: C.muted, fontWeight: '500' }}>Acesso interno</Text>
      </Pressable>
    </MobileShell>
  );
}
