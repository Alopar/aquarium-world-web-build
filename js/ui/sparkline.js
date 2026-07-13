const DEFAULT_COLOR = 'rgba(120, 200, 255, 0.95)';
const GRID_MAJOR = 'rgba(120, 180, 255, 0.22)';
const GRID_MINOR = 'rgba(120, 180, 255, 0.1)';
const BORDER_COLOR = 'rgba(120, 180, 255, 0.18)';

function parseColor(color) {
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return { r: 120, g: 200, b: 255 };
  return { r: +match[1], g: +match[2], b: +match[3] };
}

function buildPoints(values, vMin, range, padding, innerW, innerH) {
  return values.map((v, i) => ({
    x: padding + (i / (values.length - 1)) * innerW,
    y: padding + innerH - ((v - vMin) / range) * innerH,
  }));
}

function drawGrid(ctx, w, h, padding) {
  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

  const innerTop = padding;
  const innerBottom = h - padding;
  const innerH = innerBottom - innerTop;

  for (let i = 0; i <= 4; i++) {
    const y = innerTop + (innerH / 4) * i;
    ctx.strokeStyle = i === 2 ? GRID_MAJOR : GRID_MINOR;
    ctx.lineWidth = i === 2 ? 1 : 1;
    ctx.beginPath();
    ctx.moveTo(padding, y + 0.5);
    ctx.lineTo(w - padding, y + 0.5);
    ctx.stroke();
  }

  const innerW = w - padding * 2;
  for (let i = 1; i < 4; i++) {
    const x = padding + (innerW / 4) * i;
    ctx.strokeStyle = GRID_MINOR;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, innerTop);
    ctx.lineTo(x + 0.5, innerBottom);
    ctx.stroke();
  }
}

export function drawSparkline(canvas, values, {
  color = DEFAULT_COLOR,
  min = null,
  max = null,
  padding = 3,
} = {}) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(4, 12, 24, 0.75)';
  ctx.fillRect(0, 0, w, h);

  drawGrid(ctx, w, h, padding);

  if (!values || values.length < 2) return;

  let vMin = min;
  let vMax = max;
  if (vMin == null || vMax == null) {
    vMin = Infinity;
    vMax = -Infinity;
    for (const v of values) {
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
  }

  const range = vMax - vMin || 1;
  const innerW = w - padding * 2;
  const innerH = h - padding * 2;
  const points = buildPoints(values, vMin, range, padding, innerW, innerH);
  const { r, g, b } = parseColor(color);

  const gradient = ctx.createLinearGradient(0, padding, 0, h - padding);
  gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.28)`);
  gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.02)`);

  ctx.beginPath();
  ctx.moveTo(points[0].x, h - padding);
  for (const p of points) ctx.lineTo(p.x, p.y);
  ctx.lineTo(points[points.length - 1].x, h - padding);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.35)`;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    if (i === 0) ctx.moveTo(points[i].x, points[i].y);
    else ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.75;
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    if (i === 0) ctx.moveTo(points[i].x, points[i].y);
    else ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();

  const last = points[points.length - 1];
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.45)`;
  ctx.beginPath();
  ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e8f4ff';
  ctx.beginPath();
  ctx.arc(last.x, last.y, 2, 0, Math.PI * 2);
  ctx.fill();
}
