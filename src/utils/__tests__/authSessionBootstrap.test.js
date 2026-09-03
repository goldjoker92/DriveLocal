import { restoreInitialSession } from '../authSessionBootstrap';

describe('initial auth session restoration', () => {
  it('waits for Firebase persistence before reading the current user', async () => {
    const order = [];
    let restoredUser = null;
    const authInstance = {
      authStateReady: async () => {
        order.push('auth_ready');
        restoredUser = { uid: 'driver-1' };
      },
      get currentUser() {
        order.push('current_user_read');
        return restoredUser;
      },
    };

    const result = await restoreInitialSession({
      authInstance,
      resolveSession: async () => {
        order.push('role_resolved');
        return { role: 'driver', driver: { verificationStatus: 'approved' } };
      },
    });

    expect(result.status).toBe('authenticated');
    expect(order[0]).toBe('auth_ready');
    expect(order).toContain('role_resolved');
  });

  it('does not read Firestore for an anonymous startup', async () => {
    const resolveSession = jest.fn();
    const result = await restoreInitialSession({
      authInstance: { authStateReady: jest.fn(), currentUser: null },
      resolveSession,
    });

    expect(result).toEqual({ status: 'anonymous', session: null });
    expect(resolveSession).not.toHaveBeenCalled();
  });

  it('ignores a stale role lookup when the authenticated account changes', async () => {
    const firstUser = { uid: 'driver-1' };
    const authInstance = { authStateReady: jest.fn(), currentUser: firstUser };

    const result = await restoreInitialSession({
      authInstance,
      resolveSession: async () => {
        authInstance.currentUser = { uid: 'passenger-2' };
        return { role: 'driver', driver: { verificationStatus: 'approved' } };
      },
    });

    expect(result).toEqual({ status: 'stale', session: null });
  });

  it('propagates role lookup failures without signing the user out', async () => {
    const authInstance = {
      authStateReady: jest.fn(),
      currentUser: { uid: 'driver-1' },
      signOut: jest.fn(),
    };

    await expect(restoreInitialSession({
      authInstance,
      resolveSession: async () => {
        throw Object.assign(new Error('offline'), { code: 'firestore/unavailable' });
      },
    })).rejects.toMatchObject({ code: 'firestore/unavailable' });
    expect(authInstance.signOut).not.toHaveBeenCalled();
  });
});
