import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { colors } from '../constants/colors';
import { reportClientError } from '../services/clientErrorReporter';

function createRecoveryTrace() {
  return `ui_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, recoveryTrace: null };
  }

  static getDerivedStateFromError(error) {
    return { error, recoveryTrace: createRecoveryTrace() };
  }

  componentDidCatch(error, info) {
    void reportClientError(error, {
      eventName: 'react.render_failed',
      source: 'react_boundary',
      severity: 'fatal',
      isFatal: true,
      route: this.props.route,
      role: this.props.role || 'unknown',
      traceId: this.state.recoveryTrace,
      componentStack: info?.componentStack || null,
    });
  }

  handleRetry = () => {
    console.info('[CLIENT_ERROR] recovery.retry_requested', {
      traceRef: this.state.recoveryTrace,
    });
    this.setState({ error: null, recoveryTrace: null });
  };

  handleHome = () => {
    console.info('[CLIENT_ERROR] recovery.home_requested', {
      traceRef: this.state.recoveryTrace,
    });
    this.setState({ error: null, recoveryTrace: null }, () => {
      router.replace('/');
    });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <View style={styles.screen} accessibilityRole="alert">
        <View style={styles.card}>
          <Text style={styles.eyebrow}>DRIVELOCAL</Text>
          <Text style={styles.title}>Algo deu errado</Text>
          <Text style={styles.body}>
            O erro foi registrado com segurança. Tente novamente ou volte para o início.
          </Text>
          {this.state.recoveryTrace ? (
            <Text style={styles.reference}>Referência: {this.state.recoveryTrace}</Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            onPress={this.handleRetry}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.primaryButtonText}>TENTAR NOVAMENTE</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={this.handleHome}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryButtonText}>VOLTAR AO INÍCIO</Text>
          </Pressable>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: colors.background,
  },
  card: {
    padding: 24,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  eyebrow: {
    marginBottom: 10,
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '800',
  },
  body: {
    marginTop: 10,
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 23,
  },
  reference: {
    marginTop: 12,
    color: colors.textFaint,
    fontSize: 12,
  },
  primaryButton: {
    marginTop: 24,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: colors.primary,
  },
  primaryButtonText: {
    color: colors.onPrimary,
    fontWeight: '800',
  },
  secondaryButton: {
    marginTop: 10,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  secondaryButtonText: {
    color: colors.primary,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.72,
  },
});
