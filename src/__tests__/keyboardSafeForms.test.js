const fs = require('fs');
const path = require('path');

const appRoot = path.join(__dirname, '..', 'app');

function collectSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(absolutePath);
    if (!/\.(js|jsx|ts|tsx)$/.test(entry.name)) return [];
    return [absolutePath];
  });
}

function relativeToProject(filePath) {
  return path.relative(path.join(__dirname, '..', '..'), filePath).replace(/\\/g, '/');
}

describe('keyboard-safe form contract', () => {
  const screenFiles = collectSourceFiles(appRoot);

  test('every screen containing a text input uses KeyboardSafeScreen', () => {
    const formScreens = screenFiles.filter((filePath) => {
      const source = fs.readFileSync(filePath, 'utf8');
      return /<AppInput\b|<TextInput\b/.test(source);
    });

    expect(formScreens.length).toBeGreaterThan(0);

    const missingWrapper = formScreens
      .filter((filePath) => !fs.readFileSync(filePath, 'utf8').includes('<KeyboardSafeScreen'))
      .map(relativeToProject);

    expect(missingWrapper).toEqual([]);
  });

  test('Pedir corrida exposes passenger profile and safe navigation', () => {
    const requestRide = fs.readFileSync(
      path.join(appRoot, '(passenger)', 'request-ride.jsx'),
      'utf8'
    );
    const passengerProfile = fs.readFileSync(
      path.join(appRoot, '(passenger)', 'passenger-profile.jsx'),
      'utf8'
    );

    expect(requestRide).toContain("router.push('/passenger-profile')");
    expect(requestRide).toContain("goBackOrReplace(router, '/passenger-home')");
    expect(requestRide).toContain('👤 Perfil');
    expect(passengerProfile).toContain("goBackOrReplace(router, '/passenger-home')");
  });

  test('Android resizes the application above the software keyboard', () => {
    const appConfig = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', 'app.json'), 'utf8')
    );

    expect(appConfig.expo.android.softwareKeyboardLayoutMode).toBe('resize');
  });
});
