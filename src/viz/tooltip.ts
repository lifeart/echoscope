export function drawTooltip(
  ctx: CanvasRenderingContext2D, lines: string[],
  px: number, py: number, s: number, w: number, h: number,
): void {
  const font = `${11 * s}px system-ui`;
  ctx.font = font;
  const pad = 6 * s;
  const lineH = 14 * s;
  const maxTW = Math.max(...lines.map(l => ctx.measureText(l).width));
  const boxW = maxTW + pad * 2;
  const boxH = lineH * lines.length + pad * 2;
  let bx = px + 12 * s;
  let by = py - boxH - 4 * s;
  if (bx + boxW > w) bx = px - boxW - 12 * s;
  if (by < 0) by = py + 12 * s;
  if (by + boxH > h) by = h - boxH - 2 * s;

  ctx.fillStyle = '#1a1a1aDD';
  const r = 4 * s;
  ctx.beginPath();
  ctx.moveTo(bx + r, by);
  ctx.lineTo(bx + boxW - r, by);
  ctx.quadraticCurveTo(bx + boxW, by, bx + boxW, by + r);
  ctx.lineTo(bx + boxW, by + boxH - r);
  ctx.quadraticCurveTo(bx + boxW, by + boxH, bx + boxW - r, by + boxH);
  ctx.lineTo(bx + r, by + boxH);
  ctx.quadraticCurveTo(bx, by + boxH, bx, by + boxH - r);
  ctx.lineTo(bx, by + r);
  ctx.quadraticCurveTo(bx, by, bx + r, by);
  ctx.fill();

  ctx.fillStyle = '#eaeaea';
  ctx.font = font;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], bx + pad, by + pad + lineH * (i + 0.8));
  }
}
