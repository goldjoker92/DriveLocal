import React from 'react';
import { act, create } from 'react-test-renderer';
import { ScrollView, StyleSheet, Text, TextInput, useWindowDimensions } from 'react-native';
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: jest.fn() }));

let mockConversation = {};
let mockAuthCallback;
jest.mock('../../config/firebase', () => ({ auth: { currentUser: { uid: 'u1' }, onAuthStateChanged: (fn) => { mockAuthCallback = fn; return jest.fn(); } } }));
jest.mock('../../hooks/use-ride-conversation', () => ({ __esModule: true, default: () => mockConversation }));
jest.mock('../../services/ride-messages-service', () => ({ newMessageKey: jest.fn(() => 'stable_key_123456'), sendConversationMessage: jest.fn() }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useLocalSearchParams: () => ({ rideId: 'ride1' }), useRouter: () => ({ canGoBack: () => true, back: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));

import RideConversationScreen, { Conversation } from '../ride-conversation-screen';
import { auth } from '../../config/firebase';
import { sendConversationMessage } from '../../services/ride-messages-service';

let tree;
const text = () => JSON.stringify(tree.toJSON());
const button = (label) => tree.root.findAll((node) => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
const sendButton = () => tree.root.findAll((node) => node.props.testID === 'send-message' && node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function')[0];
const type = async (value) => act(async () => tree.root.findByType(TextInput).props.onChangeText(value));
async function render(role = 'passenger') { await act(async () => { tree = create(<Conversation rideId="ride1" role={role} uid="u1" />); }); }

beforeEach(() => {
  jest.clearAllMocks();
  useWindowDimensions.mockReturnValue({ width: 360, height: 640, fontScale: 1, scale: 1 });
  auth.currentUser = { uid: 'u1' };
  mockConversation = { messages: [], hasMore: false, status: 'assigned', ready: true, loading: false, error: null, retry: jest.fn() };
  sendConversationMessage.mockResolvedValue({ sequence: 1 });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

it.each(['driver', 'passenger'])('sends a short message and clears only the acknowledged draft for %s', async (role) => {
  await render(role); await type('Estou perto do mercado');
  await act(async () => sendButton().props.onPress());
  expect(sendConversationMessage).toHaveBeenCalledWith('ride1', { text: 'Estou perto do mercado', idempotencyKey: 'stable_key_123456' }, 'u1');
  expect(tree.root.findByType(TextInput).props.value).toBe('');
});

it('locks synchronously against a double tap and disables the composer while pending', async () => {
  let finish;
  sendConversationMessage.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await render(); await type('Estou aqui');
  const press = sendButton().props.onPress;
  await act(async () => { press(); press(); });
  expect(sendConversationMessage).toHaveBeenCalledTimes(1);
  expect(tree.root.findByType(TextInput).props.editable).toBe(false);
  expect(text()).toContain('Enviando');
  await act(async () => finish({ sequence: 1 }));
});

it('keeps the text and the same idempotency key after a network timeout', async () => {
  sendConversationMessage.mockRejectedValueOnce({ code: 'functions/deadline-exceeded' });
  await render(); await type('Portão azul');
  await act(async () => sendButton().props.onPress());
  expect(tree.root.findByType(TextInput).props.value).toBe('Portão azul');
  expect(text()).toContain('Seu texto foi mantido');
  await act(async () => sendButton().props.onPress());
  expect(sendConversationMessage.mock.calls[0][1]).toEqual(sendConversationMessage.mock.calls[1][1]);
});

it.each(['in_progress', 'completed', 'cancelled', 'awaiting_payment'])('keeps history but removes all sending controls in %s', async (status) => {
  mockConversation.status = status;
  mockConversation.messages = [{ messageId: 'm1', kind: 'text', text: 'Estou aqui', senderRole: 'passenger', createdAtMs: 1000 }];
  await render();
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
  expect(text()).toContain('Estou aqui');
  expect(text()).toContain('Somente consulta');
  expect(text()).not.toContain('Lida');
});

it('offers legacy presets and explains why free text is not ready yet', async () => {
  mockConversation.ready = false;
  await render('driver');
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
  expect(text()).toContain('versão atualizada');
  await act(async () => button('Respostas rápidas').props.onPress());
  expect(text()).toContain('Estou chegando ao local.');
  expect(text()).not.toContain('Onde você está esperando?');
  await act(async () => button('Estou chegando ao local.').props.onPress());
  expect(sendConversationMessage).toHaveBeenCalledWith('ride1', expect.objectContaining({ messageCode: 'driver_arriving' }), 'u1');
});

it('disables empty/oversized sends while retaining the editable draft', async () => {
  await render();
  expect(sendButton().props.accessibilityState.disabled).toBe(true);
  await type('a'.repeat(281));
  expect(sendButton().props.accessibilityState.disabled).toBe(true);
  await type('🙂'.repeat(280));
  expect(sendButton().props.accessibilityState.disabled).toBe(false);
});

it('shows a retry on listener failure and does not offer sending', async () => {
  mockConversation.error = { code: 'unavailable' };
  await render();
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
  await act(async () => button('Tentar novamente').props.onPress());
  expect(mockConversation.retry).toHaveBeenCalledTimes(1);
});

it('clears the private draft on account change', async () => {
  await act(async () => { tree = create(<RideConversationScreen role="passenger" />); });
  await type('Private draft');
  await act(async () => { auth.currentUser = { uid: 'u2' }; mockAuthCallback(auth.currentUser); });
  expect(tree.root.findByType(TextInput).props.value).toBe('');
});


it.each([[320, 568, 1], [320, 568, 2], [568, 320, 2], [768, 1024, 1.5]])('keeps composer scrollable and full labels at %sx%s / font %s', async (width, height, fontScale) => {
  useWindowDimensions.mockReturnValue({ width, height, fontScale, scale: 1 });
  await render('driver');
  const composer = tree.root.findByType(ScrollView);
  expect(StyleSheet.flatten(composer.props.style).maxHeight).toBe('60%');
  expect(composer.props.keyboardShouldPersistTaps).toBe('handled');
  const input = tree.root.findByType(TextInput);
  expect(input.props.multiline).toBe(true);
  expect(StyleSheet.flatten(input.props.style).maxHeight).toBeLessThan(height / 5);
  tree.root.findAllByType(Text).forEach((node) => {
    expect(node.props.allowFontScaling).not.toBe(false);
    expect(node.props.numberOfLines).toBeUndefined();
  });
  const send = sendButton();
  const style = typeof send.props.style === 'function' ? send.props.style({ pressed: false }) : send.props.style;
  expect(StyleSheet.flatten(style).minHeight).toBeGreaterThanOrEqual(48);
});
