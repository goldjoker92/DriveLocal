// DriveLocal landing page (route "/"). Iteration 1D.
// Passenger-first: keep the existing Uber-like map/card visual, but organize
// content as ride-intent first, then a clear motorista entry, then an existing-
// account login, and finally a discreet internal ("Área interna") link.
//
// The passenger ride flow is NOT implemented yet, so the ride CTA shows a clean
// "Em breve" message instead of navigating into mock ride data.
// No backend calls here; auth/role routing lives in the auth screens.

import { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import MobileShell from '../components/MobileShell';
import MockMapCard from '../components/MockMapCard';
import TrustChip from '../components/TrustChip';
import { auth } from '../config/firebase';

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
  green: '#10B981',
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

// A single ride-intent field (colored dot + editable input) matching the map card.
function RideField({ dotColor, placeholder, value, onChangeText }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: C.bg,
        borderWidth: 1,
        borderColor: C.border,
        borderRadius: 14,
        paddingVertical: 4,
        paddingHorizontal: 14,
      }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: dotColor }} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={C.muted}
        style={{ flex: 1, fontSize: 15, color: C.text, fontWeight: '500', paddingVertical: 11 }}
      />
    </View>
  );
}

export default function Landing() {
  const router = useRouter();
  const [origem, setOrigem] = useState('');
  const [destino, setDestino] = useState('');

  // Passenger ride flow (Iteration 3A). Signed-in passengers go straight to the
  // ride-request form; new passengers create an account first. The typed
  // origin/destination are forwarded so nothing the passenger wrote is lost.
  function onRequestRide() {
    const signedIn = !!(auth.currentUser && auth.currentUser.uid);
    console.log('[LANDING] ride CTA pressed signedIn=', signedIn);
    if (signedIn) {
      router.push({
        pathname: '/request-ride',
        params: { originText: origem.trim(), destinationText: destino.trim() },
      });
    } else {
      router.push({
        pathname: '/passenger-register',
        params: { origem: origem.trim(), destino: destino.trim() },
      });
    }
  }

  return (
    <MobileShell>
      {/* Header: wordmark + service area, then the local tagline */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 20, fontWeight: '800', color: C.brandNavy }}>DriveLocal</Text>
        <View style={{ backgroundColor: C.mapBlue, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 }}>
          <Text style={{ fontSize: 12.5, fontWeight: '700', color: C.cta }}>Horizonte · CE</Text>
        </View>
      </View>

      <View style={{ gap: 6 }}>
        <Text style={{ fontSize: 26, fontWeight: '800', color: C.brandNavy, lineHeight: 32 }}>
          Corridas mais acessíveis em Horizonte
        </Text>
        <Text style={{ fontSize: 14, fontWeight: '600', color: C.muted }}>
          Rápido. Local. Pago por Pix.
        </Text>
      </View>

      {/* Map + passenger ride-intent bottom-sheet (sheet overlaps the map) */}
      <View>
        <MockMapCard />

        <View style={[card, { marginTop: -28, gap: 12, zIndex: 2 }]}>
          {/* bottom-sheet grabber */}
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 999, backgroundColor: '#E2E8F0', marginBottom: 2 }} />

          <Text style={{ fontSize: 18, fontWeight: '800', color: C.text }}>Para onde você vai?</Text>

          {/* Origem / Destino (editable, no mock ride data behind them) */}
          <RideField dotColor={C.green} placeholder="Origem" value={origem} onChangeText={setOrigem} />
          <RideField dotColor={C.cta} placeholder="Destino" value={destino} onChangeText={setDestino} />

          <CtaButton label="Ver valor da corrida / cadastrar-se ou entrar / pedir corrida" onPress={onRequestRide} kind="primary" />

          <Text style={{ fontSize: 13, color: C.muted }}>Pagamento direto por Pix ao motorista.</Text>

          {/* Trust chips */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 2 }}>
            <TrustChip label="Mais acessível" />
            <TrustChip label="Exclusivo em Horizonte" />
            <TrustChip label="Pix direto ao motorista" />
          </View>
        </View>
      </View>

      {/* Motorista entry (professional, secondary to passenger) */}
      <View style={[card, { gap: 12 }]}>
        <Text style={{ fontSize: 18, fontWeight: '800', color: C.text }}>Sou motorista?</Text>
        <Text style={{ fontSize: 14, color: C.muted, lineHeight: 20 }}>
          Ganhe corridas locais com uma taxa da plataforma menor e receba direto no seu Pix.
        </Text>

        {/* Founder offer — same wording, friendlier visual rhythm */}
        <View
          style={{
            backgroundColor: C.softAmber,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: '#F6E0B5',
            paddingHorizontal: 14,
            paddingVertical: 13,
            gap: 10,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 16 }}>⭐</Text>
            <View style={{ backgroundColor: C.amber, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10 }}>
              <Text style={{ fontSize: 11.5, fontWeight: '800', color: C.brandNavy }}>Motorista fundador</Text>
            </View>
          </View>

          <View style={{ gap: 7 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
              <Text style={{ fontSize: 15, lineHeight: 19 }}>🏆</Text>
              <Text style={{ flex: 1, fontSize: 13.5, fontWeight: '600', color: C.text, lineHeight: 19 }}>
                100 primeiros aprovados: 0% de taxa da plataforma durante 60 dias e sem assinatura por 60 dias.
              </Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
              <Text style={{ fontSize: 15, lineHeight: 19 }}>🚗</Text>
              <Text style={{ flex: 1, fontSize: 13.5, fontWeight: '600', color: C.text, lineHeight: 19 }}>
                A partir do 101º: 0% de taxa da plataforma durante 60 dias e até 5 corridas sem assinatura.
              </Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
              <Text style={{ fontSize: 15, lineHeight: 19 }}>⏱️</Text>
              <Text style={{ flex: 1, fontSize: 13.5, fontWeight: '600', color: C.text, lineHeight: 19 }}>
                Durante os primeiros 60 dias após a aprovação, 100% do valor de cada corrida fica com você — 0% de taxa da plataforma.
              </Text>
            </View>
          </View>
        </View>

        <CtaButton
          label="Entrar ou cadastrar motorista"
          onPress={() => {
            console.log('[LANDING] motorista CTA -> /driver-auth');
            router.push('/driver-auth');
          }}
          kind="secondary"
        />
      </View>

      {/* Existing account (any role) — general email login, redirects by role */}
      <View style={[card, { gap: 10 }]}>
        <Text style={{ fontSize: 16, fontWeight: '800', color: C.text }}>Já tenho conta?</Text>
        <CtaButton
          label="Entrar com e-mail"
          onPress={() => {
            console.log('[LANDING] existing account -> /email-login');
            router.push('/email-login');
          }}
          kind="secondary"
        />
      </View>

      {/* Discreet internal access (strict admin only, handled after login) */}
      <Pressable
        onPress={() => {
          console.log('[LANDING] Área interna -> /email-login?intent=internal');
          router.push({ pathname: '/email-login', params: { intent: 'internal' } });
        }}
        style={{ alignSelf: 'center', paddingVertical: 6 }}
      >
        <Text style={{ fontSize: 12.5, color: C.muted, fontWeight: '500' }}>Área interna</Text>
      </Pressable>
    </MobileShell>
  );
}
