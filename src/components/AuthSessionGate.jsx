// Restores an existing Firebase session once at cold start and leaves all fresh
// login, registration, logout and active-ride navigation flows unchanged.

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { auth } from '../config/firebase';
import { colors } from '../constants/colors';
import { getAuthenticatedAccountSession } from '../services/authService';
import { restoreInitialSession } from '../utils/authSessionBootstrap';
import { isAuthEntryRoute, restoredSessionRoute } from '../utils/authSessionRouting';

function trace(event, details = {}, level = 'log') {
  const method = console[level] || console.log;
  method(`[AUTH_SESSION] ${event}`, {
    scope: 'auth_session',
    event,
    atMs: Date.now(),
    ...details,
  });
}

export default function AuthSessionGate({ route }) {
  const router = useRouter();
  const routeRef = useRef(route);
  const [phase, setPhase] = useState('checking');
  routeRef.current = route;

  useEffect(() => {
    let disposed = false;
    const startedAtMs = Date.now();

    async function restore() {
      trace('restore_started', { entryRoute: isAuthEntryRoute(routeRef.current) });

      try {
        const result = await restoreInitialSession({
          authInstance: auth,
          resolveSession: getAuthenticatedAccountSession,
        });
        if (disposed) return;

        if (result.status === 'anonymous') {
          trace('restore_anonymous', { durationMs: Date.now() - startedAtMs });
          setPhase('ready');
          return;
        }

        if (result.status === 'stale') {
          trace('restore_stale_ignored', { durationMs: Date.now() - startedAtMs }, 'warn');
          setPhase('ready');
          return;
        }

        const destination = restoredSessionRoute(result.session);
        trace('role_resolved', {
          role: result.session?.role || 'unknown',
          hasDestination: Boolean(destination),
          durationMs: Date.now() - startedAtMs,
        });

        // Deep links, active rides and already-authenticated screens win over the
        // startup redirect. Only public entry/login routes are replaced.
        if (!destination || !isAuthEntryRoute(routeRef.current)) {
          trace('route_preserved', {
            role: result.session?.role || 'unknown',
            reason: destination ? 'non_entry_route' : 'unknown_role',
          });
          setPhase('ready');
          return;
        }

        trace('redirect_requested', {
          role: result.session?.role || 'unknown',
          destination,
        });
        setPhase('redirecting');
        router.replace(destination);
      } catch (error) {
        if (disposed) return;
        // A temporary Firestore/network failure must not sign the user out. The
        // existing session remains available for the next foreground/restart.
        trace('restore_failed', {
          reason: error?.code || error?.name || 'unknown',
          durationMs: Date.now() - startedAtMs,
        }, 'warn');
        setPhase('ready');
      }
    }

    restore();
    return () => {
      disposed = true;
    };
  }, [router]);

  useEffect(() => {
    if (phase === 'redirecting' && !isAuthEntryRoute(route)) {
      setPhase('ready');
    }
  }, [phase, route]);

  // Prevent the login/landing page from flashing while Firebase restores a
  // persisted user. Operational/deep-linked routes are never covered.
  if (phase === 'ready' || !isAuthEntryRoute(route)) return null;

  return (
    <View style={styles.overlay} accessibilityLabel="Restaurando sessão">
      <ActivityIndicator size="small" color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    zIndex: 1000,
    elevation: 1000,
  },
});
