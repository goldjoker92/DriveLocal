const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('auth session restoration integration contract', () => {
  it('keeps Firebase Auth persisted with React Native AsyncStorage', () => {
    const firebase = source('src/config/firebase.js');
    expect(firebase).toContain('getReactNativePersistence(appStorage)');
    expect(firebase).toContain("@react-native-async-storage/async-storage");
    expect(firebase).toContain("event: 'persistence_initialized'");
    expect(firebase).toContain("event: 'persistence_instance_reused'");
  });

  it('mounts one cold-start gate after the root navigator', () => {
    const layout = source('src/app/_layout.jsx');
    expect(layout).toContain("import AuthSessionGate from '../components/AuthSessionGate'");
    expect(layout).toContain('<AuthSessionGate route={pathname} />');
    expect(layout.indexOf('<Stack')).toBeLessThan(layout.indexOf('<AuthSessionGate'));
  });

  it('waits for Auth readiness and never signs out during restoration', () => {
    const gate = source('src/components/AuthSessionGate.jsx');
    const bootstrap = source('src/utils/authSessionBootstrap.js');
    expect(bootstrap).toContain('await authInstance.authStateReady()');
    expect(gate).toContain('getAuthenticatedAccountSession');
    expect(gate).toContain("trace('restore_failed'");
    expect(gate).not.toContain('logoutUser');
    expect(gate).not.toContain('signOut');
    expect(gate).not.toContain('startedRef');
    expect(bootstrap).not.toContain('signOut');
  });

  it('limits automatic redirects to public entry routes', () => {
    const gate = source('src/components/AuthSessionGate.jsx');
    const routing = source('src/utils/authSessionRouting.js');
    expect(gate).toContain('!isAuthEntryRoute(routeRef.current)');
    expect(gate).toContain("reason: destination ? 'non_entry_route' : 'unknown_role'");
    expect(routing).toContain("'/(admin)/admin-home'");
    expect(routing).toContain("'/(passenger)/passenger-home'");
    expect(routing).toContain("'/(driver)/driver-home'");
  });
});
