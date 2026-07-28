const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('driver active ride compact card contract', () => {
  test('uses a compact presentation only on the active ride route', () => {
    const component = source('src/components/DriverActiveRideCard.jsx');

    expect(component).toContain("import { usePathname } from 'expo-router'");
    expect(component).toContain("includes('active-ride')");
    expect(component).toContain('if (compact)');
    expect(component).toContain("presentation: compact ? 'compact' : 'full'");
  });

  test('keeps the compact card readable without pushing the ride controls below the fold', () => {
    const component = source('src/components/DriverActiveRideCard.jsx');

    expect(component).toContain('styles.compactCard');
    expect(component).toContain('styles.compactMainRow');
    expect(component).toContain('styles.compactPickupRow');
    expect(component).toContain('numberOfLines={1}');
    expect(component).toContain('ellipsizeMode="tail"');
    expect(component).toContain('width: 42');
    expect(component).toContain('height: 42');
  });

  test('preserves the complete recovery card on the other driver screens', () => {
    const component = source('src/components/DriverActiveRideCard.jsx');

    expect(component).toContain('CORRIDA ATIVA');
    expect(component).toContain('Valor da corrida');
    expect(component).toContain('<RouteRow marker="●" label="Embarque"');
    expect(component).toContain('label="Destino"');
  });
});
