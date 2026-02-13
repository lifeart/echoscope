import { bus } from '../../src/core/event-bus.js';
import { store } from '../../src/core/store.js';
import { initMicSpectrogram } from '../../src/viz/mic-spectrogram.js';

describe('mic spectrogram mode indicator', () => {
  const rafOriginal = globalThis.requestAnimationFrame;
  const documentOriginal = (globalThis as any).document;

  const mockCtx = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    createImageData: vi.fn((w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    })),
    putImageData: vi.fn(),
  };

  const mockMode = { textContent: '' };
  const mockDetails = { style: { display: '' } };
  const mockCanvas = {
    width: 1000,
    height: 220,
    getContext: vi.fn(() => mockCtx),
  };

  const mockDocument = {
    getElementById: vi.fn((id: string) => {
      if (id === 'micSpectrogramMode') return mockMode;
      if (id === 'micSpectrogramDetails') return mockDetails;
      if (id === 'micSpectrogram') return mockCanvas;
      return null;
    }),
  };

  beforeAll(() => {
    globalThis.requestAnimationFrame = vi.fn(() => 0) as any;
    (globalThis as any).document = mockDocument;
  });

  afterAll(() => {
    globalThis.requestAnimationFrame = rafOriginal;
    (globalThis as any).document = documentOriginal;
  });

  beforeEach(() => {
    bus.clear();
    store.reset();
    mockMode.textContent = 'Mode: RAW';
    mockDetails.style.display = '';
    mockDocument.getElementById.mockClear();
    mockCanvas.getContext.mockClear();
    mockCtx.clearRect.mockClear();
    mockCtx.drawImage.mockClear();
    mockCtx.createImageData.mockClear();
    mockCtx.putImageData.mockClear();
  });

  it('switches OFF -> RAW -> FILTERED according to config/calibration state', () => {
    initMicSpectrogram();

    expect(mockMode.textContent).toBe('Mode: RAW');

    store.set('config.spectrogram.enabled', false);
    bus.emit('audio:samples', new Float32Array(32));
    expect(mockMode.textContent).toBe('Mode: OFF');

    store.set('config.spectrogram.enabled', true);
    store.set('calibration', null);
    bus.emit('audio:samples', new Float32Array(32));
    expect(mockMode.textContent).toBe('Mode: RAW');

    store.set('config.noiseKalman.enabled', true);
    store.set('calibration', { valid: true } as any);
    bus.emit('audio:samples', new Float32Array(640));
    expect(mockMode.textContent).toBe('Mode: FILTERED');
  });
});
