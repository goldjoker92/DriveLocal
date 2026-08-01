const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..', '..');
const appRoot = path.join(projectRoot, 'src', 'app');

function collectSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(absolutePath);
    if (!/\.(js|jsx|ts|tsx)$/.test(entry.name)) return [];
    return [absolutePath];
  });
}

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function relativeToProject(filePath) {
  return path.relative(projectRoot, filePath).replace(/\\/g, '/');
}

describe('keyboard-safe form contract', () => {
  const screenFiles = collectSourceFiles(appRoot);

  test('the root viewport and Android native window both avoid the keyboard', () => {
    const rootLayout = read('src/app/_layout.jsx');
    const appConfig = JSON.parse(read('app.json'));

    expect(rootLayout).toContain('KeyboardAvoidingView');
    expect(rootLayout).toContain("Platform.OS === 'ios' ? 'padding' : 'height'");
    expect(appConfig.expo.android.softwareKeyboardLayoutMode).toBe('resize');
  });

  test('every screen containing a text input has a scrollable escape path', () => {
    const formScreens = screenFiles.filter((filePath) => {
      const source = fs.readFileSync(filePath, 'utf8');
      return /<AppInput\b|<TextInput\b/.test(source);
    });

    expect(formScreens.length).toBeGreaterThan(0);

    const nonScrollableForms = formScreens
      .filter((filePath) => {
        const source = fs.readFileSync(filePath, 'utf8');
        return !/<KeyboardSafeScreen\b|<ScrollView\b|<MobileShell\b/.test(source);
      })
      .map(relativeToProject);

    expect(nonScrollableForms).toEqual([]);
  });

  test('critical long forms use the strengthened KeyboardSafeScreen wrapper', () => {
    const criticalForms = [
      'src/app/(account)/privacy-center.jsx',
      'src/app/(admin)/admin-login.jsx',
      'src/app/(admin)/ride-disputes.jsx',
      'src/app/(admin)/wallet-adjust.jsx',
      'src/app/(auth)/email-login.jsx',
      'src/app/(auth)/email-register.jsx',
      'src/app/(auth)/passenger-register.jsx',
      'src/app/(auth)/verify-whatsapp.jsx',
      'src/app/(driver)/profile.jsx',
      'src/app/(driver)/vehicle.jsx',
      'src/app/(passenger)/request-ride.jsx',
      'src/app/(passenger)/select-route.jsx',
    ];

    const missingWrapper = criticalForms.filter(
      (relativePath) => !read(relativePath).includes('<KeyboardSafeScreen')
    );

    expect(missingWrapper).toEqual([]);
  });

  test('the landing shell preserves taps, scrolling and keyboard dismissal', () => {
    const mobileShell = read('src/components/MobileShell.jsx');

    expect(mobileShell).toContain('keyboardShouldPersistTaps="handled"');
    expect(mobileShell).toContain('keyboardDismissMode=');
    expect(mobileShell).toContain('automaticallyAdjustKeyboardInsets');
  });

  test('Pedir corrida exposes passenger profile and safe navigation', () => {
    const requestRide = read('src/app/(passenger)/request-ride.jsx');
    const passengerProfile = read('src/app/(passenger)/passenger-profile.jsx');

    expect(requestRide).toContain("router.push('/passenger-profile')");
    expect(requestRide).toContain("goBackOrReplace(router, '/passenger-home')");
    expect(requestRide).toContain('👤 Perfil');
    expect(passengerProfile).toContain("goBackOrReplace(router, '/passenger-home')");
  });
});
