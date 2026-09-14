const {
  classifyPixRecord,
  summarizePixRecords,
} = require('../pix-smoke');

describe('read-only Pix production audit', () => {
  it('recognizes a normalized public/private pair as ready', () => {
    expect(classifyPixRecord(
      'driver-ready',
      { pixKeyType: 'Telefone', pixKey: '(85) 99999-1234' },
      { pixKeyType: 'Telefone', pixKey: '+5585999991234' }
    )).toMatchObject({
      status: 'ready',
      privateKeyValid: true,
    });
  });

  it('marks a valid profile with stale private data for automatic synchronization', () => {
    expect(classifyPixRecord(
      'driver-sync',
      { pixKeyType: 'E-mail', pixKey: 'new@example.com' },
      { pixKeyType: 'E-mail', pixKey: 'old@example.com' }
    )).toMatchObject({
      status: 'sync_on_finish',
      privateKeyValid: true,
    });
  });

  it('requires a profile update when the public key is malformed', () => {
    expect(classifyPixRecord(
      'driver-invalid',
      { pixKeyType: 'Chave aleatória', pixKey: 'invalid' },
      { pixKeyType: 'E-mail', pixKey: 'legacy@example.com' }
    )).toMatchObject({
      status: 'needs_driver_update',
      reasonCode: 'PIX_KEY_RANDOM_INVALID',
      privateKeyValid: true,
    });
  });

  it('summarizes records without retaining key material', () => {
    const summary = summarizePixRecords([
      { status: 'ready' },
      { status: 'sync_on_finish' },
      { status: 'needs_driver_update', reasonCode: 'PIX_KEY_EMPTY' },
      { status: 'needs_driver_update', reasonCode: 'PIX_KEY_EMPTY' },
    ]);

    expect(summary).toEqual({
      total: 4,
      ready: 1,
      sync_on_finish: 1,
      needs_driver_update: 2,
      reasons: { PIX_KEY_EMPTY: 2 },
    });
    expect(JSON.stringify(summary)).not.toContain('pixKey');
  });
});
