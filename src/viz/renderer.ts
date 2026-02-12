export function canvasPixelScale(canvas: HTMLCanvasElement): number {
  const rect = canvas.getBoundingClientRect();
  if (!(rect.width > 0)) return 1;
  return Math.max(1, canvas.width / rect.width);
}

export function resizeCanvasForDPR(canvas: HTMLCanvasElement): boolean {
  const rect = canvas.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) return false;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const targetW = Math.max(1, Math.round(rect.width * dpr));
  const targetH = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width === targetW && canvas.height === targetH) return false;
  canvas.width = targetW;
  canvas.height = targetH;
  return true;
}

export function clearCanvas(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = '#070707';
  ctx.fillRect(0, 0, w, h);
}

export function getCanvasCtx(id: string): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; w: number; h: number; s: number } | null {
  const canvas = document.getElementById(id) as HTMLCanvasElement | null;
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const w = canvas.width;
  const h = canvas.height;
  const s = canvasPixelScale(canvas);
  return { canvas, ctx, w, h, s };
}
