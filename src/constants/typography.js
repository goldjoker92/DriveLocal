// Typography scale. Font family is Plus Jakarta Sans per design handoff,
// but we keep system fallback so Step 1 boots without loading custom fonts.
// TODO: load Plus Jakarta Sans via expo-font in a later step.

export const fontFamily = 'System';

export const typography = {
  h1: { fontSize: 28, fontWeight: '800' },
  h2: { fontSize: 22, fontWeight: '700' },
  h3: { fontSize: 18, fontWeight: '700' },
  body: { fontSize: 15, fontWeight: '500' },
  bodyBold: { fontSize: 15, fontWeight: '700' },
  small: { fontSize: 13, fontWeight: '500' },
  caption: { fontSize: 11, fontWeight: '700' },
};
