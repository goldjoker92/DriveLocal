const React = require('react');
const { act, create } = require('react-test-renderer');
const { ScrollView, Text, ActivityIndicator, StyleSheet } = require('react-native');
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true, default: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 16 }) }));
const useWindowDimensions = require('react-native').useWindowDimensions;
const Banner = require('../DriverDispatchVisibilityBanner').default;
const Viewport = require('../OperationalAlertsViewport').default;
const { DriverAvailabilityContext } = require('../../contexts/DriverAvailabilityContext');
const { driverAvailabilityPresentation } = require('../../utils/driverAvailabilityPresentation');
const { colors } = require('../../constants/colors');

global.IS_REACT_ACT_ENVIRONMENT = true;
let tree;
const buttons = () => tree.root.findAllByProps({ accessibilityRole: 'button' });
async function render(state, reason, extra = {}, props = {}) {
  const visibility = { state, reason };
  const value = { visibility, presentation: driverAvailabilityPresentation(visibility), recover: jest.fn(), ...extra };
  await act(async () => {
    tree = create(<DriverAvailabilityContext.Provider value={value}>
      <Viewport><Banner {...props} /></Viewport>
    </DriverAvailabilityContext.Provider>);
  });
  return value;
}
beforeEach(() => { useWindowDimensions.mockReturnValue({ width: 360, height: 640, fontScale: 1, scale: 1 }); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

it.each([
  [320, 568, 1], [320, 568, 2], [568, 320, 2], [768, 1024, 1.5],
])('keeps the alert scrollable with full text at %s×%s and font scale %s', async (width, height, fontScale) => {
  useWindowDimensions.mockReturnValue({ width, height, fontScale, scale: 1 });
  await render('invisible', 'location_stale');
  const scroll = tree.root.findByType(ScrollView);
  expect(StyleSheet.flatten(scroll.props.style).maxHeight).toBeLessThan(height / 3);
  expect(scroll.props.nestedScrollEnabled).toBe(true);
  const texts = tree.root.findAllByType(Text);
  expect(texts.some((node) => String(node.props.children).includes('não está recebendo'))).toBe(true);
  texts.forEach((node) => {
    expect(node.props.numberOfLines).toBeUndefined();
    expect(node.props.allowFontScaling).not.toBe(false);
  });
  const button = buttons()[0];
  expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(48);
});

it('exposes the correct action and disables it while recovery is pending', async () => {
  const value = await render('invisible', 'services_disabled');
  let button = buttons()[0];
  expect(button.props.accessibilityLabel).toBe('ABRIR CONFIGURAÇÕES');
  await act(async () => button.props.onPress());
  expect(value.recover).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount()); tree = null;
  await render('invisible', 'location_stale', { recovering: true });
  button = buttons()[0];
  expect(button.props.disabled).toBe(true);
  expect(button.props.accessibilityState).toEqual({ disabled: true, busy: true });
  expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(1);
});

it.each(['healthy', 'offline', 'on_ride'])('does not cover the home or accepted ride with a %s banner', async (state) => {
  await render(state, state === 'healthy' ? 'ready' : state, {}, { hideWhenStable: true });
  expect(tree.root.findAllByType(Text)).toHaveLength(0);
  expect(buttons()).toHaveLength(0);
});

it('uses readable status and action text contrast', () => {
  const luminance = (hex) => {
    const channels = hex.slice(1).match(/../g).map((v) => parseInt(v, 16) / 255)
      .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  [[colors.successText, colors.successBg], [colors.successText, colors.background],
    [colors.warning, colors.warningBg], [colors.dangerText, colors.dangerBg],
    [colors.white, colors.warning], [colors.white, colors.danger]].forEach(([fg, bg]) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
