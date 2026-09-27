import React from 'react';
import { act, create } from 'react-test-renderer';
jest.mock('../../config/firebase', () => ({ auth: { currentUser: { uid: 'u1' } } }));
jest.mock('../../services/ridesService', () => ({ listenToMyOffer: jest.fn(() => jest.fn()) }));
jest.mock('../../services/passengerRideLiveListeners', () => ({ listenToPassengerRide: jest.fn(() => jest.fn()) }));
jest.mock('../../services/ride-messages-service', () => ({
  openRideConversation: jest.fn(), traceMessage: jest.fn(),
  listenToConversation: jest.fn(() => jest.fn()), listenToConversationReadiness: jest.fn(() => jest.fn()),
}));
import useRideConversation from '../use-ride-conversation';
import { openRideConversation, listenToConversation, listenToConversationReadiness } from '../../services/ride-messages-service';
import { listenToMyOffer } from '../../services/ridesService';
import { listenToPassengerRide } from '../../services/passengerRideLiveListeners';
let tree;
let state;
function Probe({ role = 'passenger' }) { state = useRideConversation('r1', role); return null; }
beforeEach(() => { jest.clearAllMocks(); openRideConversation.mockResolvedValue({ role: 'passenger', status: 'assigned' }); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

it('tracks acceptance/start through the shared passenger listener', async () => {
  await act(async () => { tree = create(<Probe />); });
  await act(async () => {
    listenToConversation.mock.calls[0][2]({ messages: [{ messageId: '1' }], hasMore: false });
    listenToConversationReadiness.mock.calls[0][1](true);
    listenToPassengerRide.mock.calls[0][1]({ status: 'in_progress' });
  });
  expect(state.status).toBe('in_progress');
  expect(state.messages).toHaveLength(1);
  expect(state.loading).toBe(false);
  expect(state.ready).toBe(true);
});
it('never opens private ride listeners for a driver', async () => {
  openRideConversation.mockResolvedValue({ role: 'driver', status: 'assigned' });
  await act(async () => { tree = create(<Probe role="driver" />); });
  expect(listenToPassengerRide).not.toHaveBeenCalled();
  expect(listenToMyOffer).toHaveBeenCalledWith('u1', expect.any(Function), expect.any(Function), 'r1');
  await act(async () => listenToMyOffer.mock.calls[0][1]({ driverRideStatus: 'cancelled' }));
  expect(state.status).toBe('cancelled');
});
it('ignores a late context response after leaving the conversation', async () => {
  let resolve;
  openRideConversation.mockImplementation(() => new Promise((done) => { resolve = done; }));
  await act(async () => { tree = create(<Probe />); });
  await act(async () => tree.unmount()); tree = null;
  await act(async () => resolve({ role: 'passenger', status: 'assigned' }));
  expect(listenToConversation).not.toHaveBeenCalled();
  expect(listenToPassengerRide).not.toHaveBeenCalled();
});
it('fails closed when the route role does not match the authenticated participant', async () => {
  openRideConversation.mockResolvedValue({ role: 'driver', status: 'assigned' });
  await act(async () => { tree = create(<Probe role="passenger" />); });
  expect(state.error).toEqual({ code: 'permission-denied' });
  expect(state.ready).toBe(false);
  expect(listenToConversation).not.toHaveBeenCalled();
});
