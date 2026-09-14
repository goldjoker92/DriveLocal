const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', relativePath), 'utf8');
}

describe('Pix payment reliability contract', () => {
  test('native clipboard result is checked before success feedback', () => {
    const clipboard = source('utils/clipboard.js');
    const passenger = source('app/(passenger)/pix-payment.jsx');
    const wallet = source('components/DriverPixPaymentSheet.jsx');
    expect(clipboard).toContain('Clipboard.setStringAsync');
    expect(passenger).toContain('const copiedSuccessfully = await copyToClipboard(payload)');
    expect(wallet).toContain('const copiedSuccessfully = await copyToClipboard(payment.qrCode)');
  });

  test('direct Pix QR is adaptive, high correction and has a quiet zone', () => {
    const summary = source('components/PixPaymentSummary.jsx');
    expect(summary).toContain('useWindowDimensions');
    expect(summary).toContain('ecl="H"');
    expect(summary).toContain('quietZone={quietZone}');
  });

  test('Pix screens maximize and restore activity brightness', () => {
    const hook = source('hooks/useTemporaryMaxBrightness.js');
    expect(hook).toContain('Brightness.setBrightnessAsync(1)');
    expect(hook).toContain('Brightness.restoreSystemBrightnessAsync()');
    expect(hook).toContain('Brightness.setBrightnessAsync(previousBrightness)');
  });

  test('cockpit blocks an invalid Pix key before work starts', () => {
    const cockpit = source('app/(driver)/driver-home.jsx');
    expect(cockpit).toContain("validateAndNormalizePixKey(driver?.pixKey, driver?.pixKeyType)");
    expect(cockpit).toContain("'Atualize sua chave Pix'");
  });
});
