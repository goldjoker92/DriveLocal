const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('dynamic app config JSON stdout contract', () => {
  test('keeps diagnostics opt-in while retaining strict production failures', () => {
    const appConfig = source('app.config.js');

    expect(appConfig).toContain('const configDiagnosticsEnabled');
    expect(appConfig).toContain("process.env.APP_CONFIG_DEBUG");
    expect(appConfig).toContain('function writeConfigDiagnostic(message)');
    expect(appConfig).toContain('if (!configDiagnosticsEnabled) return;');
    expect(appConfig).toContain('process.stderr.write');
    expect(appConfig).not.toContain('console.info(');
    expect(appConfig).not.toContain('console.log(');
    expect(appConfig).not.toContain('console.warn(');
    expect(appConfig).toContain('if (easBuildActive) throw new Error(message)');
    expect(appConfig).toContain('writeConfigDiagnostic(message)');
    expect(appConfig).toContain('androidFirebaseMatchesExpected');
    expect(appConfig).toContain('localEasConfigFallbackActive');
  });
});
