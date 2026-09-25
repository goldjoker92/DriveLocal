import * as Clipboard from 'expo-clipboard';
import { copyToClipboard } from '../clipboard';

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(),
}), { virtual: true });

describe('copyToClipboard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('copies the complete Pix payload on native platforms', async () => {
    Clipboard.setStringAsync.mockResolvedValue(true);

    await expect(copyToClipboard('000201pix-payload')).resolves.toBe(true);
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('000201pix-payload');
  });

  it('does not report success when the native clipboard fails', async () => {
    Clipboard.setStringAsync.mockRejectedValue(new Error('clipboard unavailable'));

    await expect(copyToClipboard('000201pix-payload')).resolves.toBe(false);
  });
});
