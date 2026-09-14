function createCardCanvas(width: number, height: number, title: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d unavailable');

  const g = ctx.createLinearGradient(0, 0, width * 0.7, height);
  g.addColorStop(0, '#232844');
  g.addColorStop(0.5, '#1b1e2e');
  g.addColorStop(1, '#0f1117');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(108,140,255,0.25)';
  ctx.lineWidth = Math.max(1, Math.round(width / 640));
  for (let i = 1; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, (width * i) / 12, 0, Math.PI * 2);
    ctx.stroke();
  }

  const maxFont = Math.round(height * 0.085);
  const minFont = Math.round(height * 0.05);
  let font = maxFont;
  const measure = (f: number) => {
    ctx.font = `${f}px ${FONT_STACK}`;
    return ctx.measureText(title).width;
  };
  while (font > minFont && measure(font) > width * 0.86) font -= 4;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(232,234,242,0.96)';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = Math.round(height / 24);
  ctx.font = `${font}px ${FONT_STACK}`;
  ctx.fillText(title, width / 2, height / 2 - height * 0.02);

  ctx.font = `${Math.round(height * 0.028)}px ${FONT_STACK}`;
  ctx.fillStyle = 'rgba(232,234,242,0.55)';
  ctx.fillText('DJ Mixer', width / 2, height * 0.93);

  return canvas;
}

const FONT_STACK =
  "'Sinhala MN', 'Noto Sans Sinhala', 'Iskoola Pota', 'Malithi Web', 'Nirmala UI', system-ui, sans-serif";

/**
 * Render the gradient + Sinhala title card used as the video track for
 * audio-only sources. Returns a PNG Blob.
 */
export async function makeTitleCardBlob(
  width: number,
  height: number,
  title: string,
): Promise<Blob> {
  const canvas = createCardCanvas(width, height, title || 'DJ Mixer');
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (blob) return blob;
  const dataUrl = canvas.toDataURL('image/png');
  const res = await fetch(dataUrl);
  if (!res.ok) throw new Error('png encode failed');
  return res.blob();
}