jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('firebase/firestore', () => ({ collection: jest.fn(() => 'collection'), doc: jest.fn(() => ({ id: 'randomFirestoreId' })), onSnapshot: jest.fn(), query: jest.fn(), limit: jest.fn(), orderBy: jest.fn() }));
jest.mock('../../config/firebase', () => ({ functions: {}, db: {}, auth: { currentUser: { uid: 'u1' } } }));
jest.mock('../ridesService', () => ({ listenToRideQuickMessages: jest.fn() }));
import { httpsCallable } from 'firebase/functions';
import { auth } from '../../config/firebase';
import { mergeConversationMessages, sendConversationMessage, traceMessage } from '../ride-messages-service';
import { messageAttempt } from '../../utils/ride-messages';
import { buildNotificationRouteTarget } from '../../utils/notificationNavigation';

let log;
beforeEach(() => { jest.clearAllMocks(); auth.currentUser = { uid: 'u1' }; log = jest.spyOn(console, 'info').mockImplementation(() => {}); });
afterEach(() => log.mockRestore());

it('deduplicates legacy slots against permanent history without hiding older pages', () => {
  const current = [{ messageId: 'new3', sequence: 3, kind: 'text' }, { messageId: 'new2', sequence: 2 }, { messageId: 'new1', sequence: 1 }];
  const legacy = [{ messageId: 'slot2', sequence: 2 }, { messageId: 'slot4', sequence: 4 }];
  expect(mergeConversationMessages(current, legacy).map((item) => item.messageId)).toEqual(['slot4', 'new3', 'new2', 'new1']);
});
it.each([['/active-ride', '/driver-ride-messages'], ['/driver-accepted', '/passenger-ride-messages']])('opens the correct conversation from %s', (route, expected) => {
  for (const eventType of ['ride_message', 'ride_quick_message']) {
    expect(buildNotificationRouteTarget({ route, eventType, rideId: 'r1' })).toEqual({ pathname: expected, params: { rideId: 'r1', eventType } });
  }
  expect(buildNotificationRouteTarget({ route, eventType: 'ride_message' })).toBeNull();
  expect(buildNotificationRouteTarget({ route, eventType: 'ride_started', rideId: 'r1' }).pathname).toBe(route);
});
it('preserves the attempt key for retries but makes a new key for an edited message', () => {
  const makeKey = jest.fn().mockReturnValueOnce('key1').mockReturnValueOnce('key2');
  const first = messageAttempt(null, { text: 'Hello' }, makeKey);
  expect(messageAttempt(first, { text: 'Hello' }, makeKey)).toBe(first);
  expect(messageAttempt(first, { text: 'Edited' }, makeKey).idempotencyKey).toBe('key2');
});
it('calls the text endpoint with a stable key, never logging private text', async () => {
  const endpoint = jest.fn().mockResolvedValue({ data: { messageId: 'id1', sequence: 1, traceId: 'trace1' } });
  httpsCallable.mockReturnValue(endpoint);
  const attempt = { text: 'SECRET ADDRESS', idempotencyKey: 'same-key' };
  await sendConversationMessage('r1', attempt, 'u1');
  expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'sendRideMessageSecure', { timeout: 15000 });
  expect(endpoint).toHaveBeenCalledWith({ rideId: 'r1', ...attempt });
  traceMessage('accidental.input', { text: attempt.text, error: new Error(attempt.text), rideId: 'r1' });
  expect(JSON.stringify(log.mock.calls)).not.toContain(attempt.text);
});
it('keeps sending through the legacy endpoint for a predefined reply', async () => {
  const endpoint = jest.fn().mockResolvedValue({ data: { sequence: 1 } });
  httpsCallable.mockReturnValue(endpoint);
  await sendConversationMessage('r1', { messageCode: 'driver_arriving', idempotencyKey: 'same-key' }, 'u1');
  expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'sendRideQuickMessageSecure', { timeout: 15000 });
});
it('rejects an account switch before any network call', async () => {
  auth.currentUser = { uid: 'u2' };
  await expect(sendConversationMessage('r1', { text: 'Hi' }, 'u1')).rejects.toMatchObject({ code: 'unauthenticated' });
  expect(httpsCallable).not.toHaveBeenCalled();
});
