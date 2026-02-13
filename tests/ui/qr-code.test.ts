// @vitest-environment jsdom
import { renderQrCode, startQrScanner } from '../../src/ui/qr-code.js';
import QRCode from 'qrcode';

vi.mock('qrcode', () => ({
  default: {
    toCanvas: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('jsqr', () => ({
  default: vi.fn().mockReturnValue(null),
}));

describe('qr-code', () => {
  describe('renderQrCode', () => {
    it('calls qrcode.toCanvas with correct params', async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;

      await renderQrCode(canvas, 'https://example.com?offer=abc');

      expect(QRCode.toCanvas).toHaveBeenCalledWith(
        canvas,
        'https://example.com?offer=abc',
        expect.objectContaining({
          errorCorrectionLevel: 'L',
          margin: 2,
          width: 256,
        }),
      );
    });
  });

  describe('startQrScanner', () => {
    it('requests getUserMedia with environment camera', async () => {
      const video = document.createElement('video');
      // Stub play() to resolve
      video.play = vi.fn().mockResolvedValue(undefined);

      const mockStream = {
        getTracks: () => [{ stop: vi.fn() }],
      } as unknown as MediaStream;

      const mockGetUserMedia = vi.fn().mockResolvedValue(mockStream);
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: mockGetUserMedia },
        writable: true,
        configurable: true,
      });

      const scanner = startQrScanner(video, vi.fn());
      await new Promise((r) => setTimeout(r, 50));

      expect(mockGetUserMedia).toHaveBeenCalledWith({
        video: { facingMode: 'environment' },
      });
      scanner.stop();
    });

    it('stop function stops video tracks', async () => {
      const video = document.createElement('video');
      video.play = vi.fn().mockResolvedValue(undefined);

      const stopFn = vi.fn();
      const mockStream = {
        getTracks: () => [{ stop: stopFn }],
      } as unknown as MediaStream;

      const mockGetUserMedia = vi.fn().mockResolvedValue(mockStream);
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: mockGetUserMedia },
        writable: true,
        configurable: true,
      });

      const scanner = startQrScanner(video, vi.fn());
      await new Promise((r) => setTimeout(r, 50));
      scanner.stop();

      expect(stopFn).toHaveBeenCalled();
    });
  });
});
