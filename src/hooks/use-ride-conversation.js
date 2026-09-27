import { useCallback, useEffect, useState } from 'react';
import { auth } from '../config/firebase';
import { listenToMyOffer } from '../services/ridesService';
import { listenToPassengerRide } from '../services/passengerRideLiveListeners';
import { listenToConversation, listenToConversationReadiness, openRideConversation, traceMessage } from '../services/ride-messages-service';

export default function useRideConversation(rideId, role, pageSize = 50) {
  const uid = auth.currentUser?.uid;
  const [context, setContext] = useState(null);
  const [status, setStatus] = useState(null);
  const [ready, setReady] = useState(false);
  const [history, setHistory] = useState({ messages: [], hasMore: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((n) => n + 1), []);

  useEffect(() => {
    let disposed = false;
    const stops = [];
    setContext(null); setStatus(null); setReady(false); setError(null); setLoading(true);
    setHistory({ messages: [], hasMore: false });
    if (!rideId || !role || !uid) { setLoading(false); return undefined; }
    const fail = (failure) => {
      if (disposed) return;
      setError(failure); setLoading(false); setStatus(null); setReady(false);
      traceMessage('conversation.failed', { rideId, role, reason: failure?.code || 'unknown' });
    };
    openRideConversation(rideId).then((result) => {
      if (disposed || auth.currentUser?.uid !== uid) return;
      if (result.role !== role) { fail({ code: 'permission-denied' }); return; }
      setContext(result); setStatus(result.status);
      const statusChanged = (value) => { if (!disposed) setStatus(value); };
      stops.push(role === 'driver'
        ? listenToMyOffer(uid, (offer) => statusChanged(offer?.driverRideStatus || null), fail, rideId)
        : listenToPassengerRide(rideId, (ride) => statusChanged(ride?.status || null), fail));
      stops.push(listenToConversationReadiness(rideId, (value) => { if (!disposed) setReady(value); }, fail));
    }).catch(fail);
    return () => { disposed = true; stops.forEach((stop) => stop()); };
  }, [rideId, role, uid, revision]);

  useEffect(() => {
    if (!context) return undefined;
    let disposed = false;
    setLoading(true);
    const stop = listenToConversation(rideId, pageSize, (value) => {
      if (!disposed) { setHistory(value); setLoading(false); }
    }, (failure) => {
      if (!disposed) { setError(failure); setLoading(false); setReady(false); }
    });
    return () => { disposed = true; stop(); };
  }, [context, rideId, pageSize]);

  return { ...history, status, ready, loading, error, retry };
}
