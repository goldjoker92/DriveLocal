// One-shot Firebase startup restoration. This deliberately does not subscribe
// to later login/logout changes: the existing screens already own those flows.

export async function restoreInitialSession({ authInstance, resolveSession }) {
  if (typeof authInstance?.authStateReady === 'function') {
    await authInstance.authStateReady();
  }

  const user = authInstance?.currentUser || null;
  if (!user?.uid) return { status: 'anonymous', session: null };

  const session = await resolveSession(user);

  // Account changes during the Firestore lookup must never redirect using the
  // previous user's role/profile.
  if (authInstance?.currentUser?.uid !== user.uid) {
    return { status: 'stale', session: null };
  }

  return { status: 'authenticated', session };
}
