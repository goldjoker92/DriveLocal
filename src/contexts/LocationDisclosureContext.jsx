// Google Play prominent location disclosure.
//
// The custom in-app disclosure is shown before Android's native permission UI.
// It uses role-specific copy so passengers are never told that they are tracked in
// background, while drivers see every background feature and the stop conditions.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import AppButton from '../components/AppButton';
import { colors } from '../constants/colors';
import { radius, spacing } from '../constants/spacing';
import { fontFamily, typography } from '../constants/typography';
import {
  getLocationPermissionState,
  LOCATION_ROLE,
  requestLocationPermissions,
} from '../services/locationPermissionService';

const LocationDisclosureContext = createContext(null);

const COPY = Object.freeze({
  [LOCATION_ROLE.DRIVER]: Object.freeze({
    eyebrow: 'MOTORISTA · LOCALIZAÇÃO EM SEGUNDO PLANO',
    title: 'Sua localização mantém a corrida funcionando',
    prominent:
      'A DriveLocal coleta dados de localização para permitir o despacho de corridas, o envio de ofertas próximas e o acompanhamento do motorista pelo passageiro, mesmo quando o app estiver fechado ou não estiver em uso.',
    details:
      'O rastreamento começa somente quando você ativa “Disponível” ou durante uma corrida. Uma notificação permanente fica visível. O rastreamento para quando você fica indisponível ou encerra ou cancela a corrida. A localização não é usada para anúncios.',
    points: Object.freeze([
      'Ofertas próximas enquanto você está disponível',
      'Aproximação e trajeto visíveis ao passageiro da corrida',
      'Controle pelo modo Disponível e pela finalização da corrida',
    ]),
  }),
  [LOCATION_ROLE.PASSENGER]: Object.freeze({
    eyebrow: 'PASSAGEIRO · LOCALIZAÇÃO DURANTE O USO',
    title: 'Confirme seu ponto de embarque com mais facilidade',
    prominent:
      'A DriveLocal acessa sua localização enquanto o app está em uso para preencher o local de embarque, localizar endereços e calcular a corrida.',
    details:
      'A localização do passageiro não é acompanhada em segundo plano e não é usada para anúncios. Você também pode informar o endereço manualmente.',
    points: Object.freeze([
      'Preenchimento do local de embarque',
      'Localização e validação de endereços',
      'Alternativa manual disponível a qualquer momento',
    ]),
  }),
});

function normalizedRole(role) {
  return role === LOCATION_ROLE.DRIVER ? LOCATION_ROLE.DRIVER : LOCATION_ROLE.PASSENGER;
}

function safeSource(value) {
  return String(value || 'unknown').replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 64);
}

function traceDisclosure(event, request, details = {}, level = 'info') {
  const payload = {
    scope: 'location_disclosure',
    event,
    role: normalizedRole(request?.role),
    source: safeSource(request?.source),
    trigger: safeSource(request?.trigger || 'unspecified'),
    status: details.status || null,
    atMs: Date.now(),
  };
  const method = console[level] || console.log;
  method(`[LOCATION_DISCLOSURE] ${event}`, payload);
}

export function LocationDisclosureProvider({ children }) {
  const activeRef = useRef(null);
  const [request, setRequest] = useState(null);
  const [busy, setBusy] = useState(false);

  const finish = useCallback((result) => {
    const active = activeRef.current;
    activeRef.current = null;
    setBusy(false);
    setRequest(null);
    active?.resolve(result);
  }, []);

  useEffect(() => () => {
    const active = activeRef.current;
    activeRef.current = null;
    active?.resolve({ status: 'cancelled', role: normalizedRole(active?.request?.role) });
  }, []);

  const requestLocationDisclosure = useCallback(async ({
    role,
    source = 'unknown',
    trigger = 'feature',
  } = {}) => {
    const selectedRole = normalizedRole(role);
    const selectedRequest = {
      role: selectedRole,
      source: safeSource(source),
      trigger: safeSource(trigger),
    };

    const current = await getLocationPermissionState(selectedRole);
    if (current.status === 'granted') {
      traceDisclosure('skipped_already_granted', selectedRequest, { status: current.status });
      return current;
    }

    if (activeRef.current) {
      traceDisclosure('joined_existing', selectedRequest, { status: 'pending' });
      return activeRef.current.promise;
    }

    let resolveRequest;
    const promise = new Promise((resolve) => {
      resolveRequest = resolve;
    });

    activeRef.current = {
      request: selectedRequest,
      promise,
      resolve: resolveRequest,
    };
    setRequest(selectedRequest);
    traceDisclosure('presented', selectedRequest, { status: current.status });
    return promise;
  }, []);

  const defer = useCallback(() => {
    if (!request || busy) return;
    traceDisclosure('deferred', request, { status: 'deferred' });
    finish({ status: 'deferred', role: request.role });
  }, [busy, finish, request]);

  const continueToAndroid = useCallback(async () => {
    if (!request || busy) return;
    setBusy(true);
    traceDisclosure('accepted', request, { status: 'accepted' });

    const result = await requestLocationPermissions({
      role: request.role,
      source: request.source,
    });

    traceDisclosure(
      'permission_flow_completed',
      request,
      { status: result.status },
      result.status === 'granted' ? 'info' : 'warn',
    );
    finish(result);
  }, [busy, finish, request]);

  const value = useMemo(() => ({ requestLocationDisclosure }), [requestLocationDisclosure]);
  const copy = request ? COPY[request.role] : COPY[LOCATION_ROLE.PASSENGER];

  return (
    <LocationDisclosureContext.Provider value={value}>
      {children}

      <Modal
        animationType="fade"
        transparent
        visible={Boolean(request)}
        statusBarTranslucent
        onRequestClose={defer}
      >
        <View style={styles.backdrop}>
          <View
            accessibilityRole="alert"
            accessibilityLabel={copy.title}
            style={styles.card}
          >
            <View style={styles.headerRow}>
              <View style={styles.iconBubble}>
                <Text style={styles.icon}>{request?.role === LOCATION_ROLE.DRIVER ? '📍' : '◎'}</Text>
              </View>
              <View style={styles.headerCopy}>
                <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
                <Text style={styles.title}>{copy.title}</Text>
              </View>
            </View>

            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.body}
            >
              <View style={styles.prominentBox}>
                <Text style={styles.prominentText}>{copy.prominent}</Text>
              </View>

              <Text style={styles.details}>{copy.details}</Text>

              <View style={styles.points}>
                {copy.points.map((point) => (
                  <View key={point} style={styles.pointRow}>
                    <Text style={styles.check}>✓</Text>
                    <Text style={styles.pointText}>{point}</Text>
                  </View>
                ))}
              </View>

              <Text style={styles.nextStep}>
                Ao tocar em “Continuar”, a solicitação oficial do Android será exibida em seguida.
              </Text>
            </ScrollView>

            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Agora não"
                disabled={busy}
                onPress={defer}
                style={({ pressed }) => [
                  styles.deferButton,
                  pressed && !busy && styles.pressed,
                  busy && styles.disabled,
                ]}
              >
                <Text style={styles.deferText}>Agora não</Text>
              </Pressable>

              <AppButton
                title={busy ? 'ABRINDO O ANDROID…' : 'CONTINUAR'}
                disabled={busy}
                haptic="medium"
                onPress={continueToAndroid}
                style={styles.continueButton}
              />
            </View>

            {busy ? (
              <View accessibilityLiveRegion="polite" style={styles.busyRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.busyText}>Aguardando sua escolha no Android…</Text>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>
    </LocationDisclosureContext.Provider>
  );
}

export function useLocationDisclosure() {
  const value = useContext(LocationDisclosureContext);
  if (!value) {
    throw new Error('useLocationDisclosure must be used inside LocationDisclosureProvider');
  }
  return value;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: 'rgba(7, 26, 51, 0.68)',
  },
  card: {
    maxHeight: '90%',
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
    gap: spacing.md,
    shadowColor: colors.black,
    shadowOpacity: 0.22,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  iconBubble: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryTint,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  icon: {
    fontSize: 23,
  },
  headerCopy: {
    flex: 1,
    gap: 3,
  },
  eyebrow: {
    fontFamily,
    color: colors.primary,
    letterSpacing: 0.6,
    ...typography.caption,
  },
  title: {
    fontFamily,
    color: colors.text,
    ...typography.h3,
  },
  body: {
    gap: spacing.md,
  },
  prominentBox: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    backgroundColor: colors.primaryTint,
  },
  prominentText: {
    fontFamily,
    color: colors.text,
    lineHeight: 22,
    ...typography.bodyBold,
  },
  details: {
    fontFamily,
    color: colors.textMuted,
    lineHeight: 21,
    ...typography.small,
  },
  points: {
    gap: spacing.sm,
  },
  pointRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  check: {
    width: 22,
    fontFamily,
    color: colors.success,
    ...typography.bodyBold,
  },
  pointText: {
    flex: 1,
    fontFamily,
    color: colors.text,
    ...typography.small,
  },
  nextStep: {
    fontFamily,
    color: colors.textFaint,
    lineHeight: 18,
    ...typography.caption,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  deferButton: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  deferText: {
    fontFamily,
    color: colors.textMuted,
    ...typography.bodyBold,
  },
  continueButton: {
    flex: 1,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.5,
  },
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  busyText: {
    fontFamily,
    color: colors.textMuted,
    ...typography.caption,
  },
});
