/**
 * QR code generation (via qrcode lib) and webcam scanning (BarcodeDetector / jsQR fallback).
 * Both libraries are lazy-loaded on first use to keep them out of the main bundle.
 */

// BarcodeDetector is not yet in all TS DOM libs
declare class BarcodeDetector {
  constructor(opts: { formats: string[] });
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string }>>;
}

export async function renderQrCode(canvas: HTMLCanvasElement, data: string): Promise<void> {
  const QRCode = (await import('qrcode')).default;
  await QRCode.toCanvas(canvas, data, {
    errorCorrectionLevel: 'L',
    margin: 2,
    width: canvas.width,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

export function startQrScanner(
  video: HTMLVideoElement,
  onDetected: (data: string) => void,
): { stop: () => void } {
  let stopped = false;
  let animId = 0;
  let stream: MediaStream | null = null;

  // Try native BarcodeDetector first, fallback to jsQR
  const hasBarcode = typeof BarcodeDetector !== 'undefined';

  async function init(): Promise<void> {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
    });
    video.srcObject = stream;
    await video.play();

    if (hasBarcode) {
      scanWithBarcodeDetector();
    } else {
      await scanWithJsQR();
    }
  }

  function scanWithBarcodeDetector(): void {
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    const tick = async (): Promise<void> => {
      if (stopped) return;
      try {
        const results = await detector.detect(video);
        if (results.length > 0 && results[0].rawValue) {
          onDetected(results[0].rawValue);
          return;
        }
      } catch (_) { /* ignore frame errors */ }
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
  }

  async function scanWithJsQR(): Promise<void> {
    const jsQR = (await import('jsqr')).default;
    const offscreen = document.createElement('canvas');
    const ctx = offscreen.getContext('2d')!;
    const tick = (): void => {
      if (stopped) return;
      if (video.readyState >= video.HAVE_ENOUGH_DATA) {
        offscreen.width = video.videoWidth;
        offscreen.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        const imageData = ctx.getImageData(0, 0, offscreen.width, offscreen.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code?.data) {
          onDetected(code.data);
          return;
        }
      }
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
  }

  function stop(): void {
    stopped = true;
    if (animId) cancelAnimationFrame(animId);
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    video.srcObject = null;
  }

  init().catch(() => { /* getUserMedia denied or unavailable */ });

  return { stop };
}
