/** Canvas pixel ratio multiplier for A/B (on top of device + lowQuality cap). */
export const PIXEL_SCALE = {
  min: 0.25,
  max: 2,
  default: 1,
  step: 0.05,
};

export function clampPixelScale(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return PIXEL_SCALE.default;
  return Math.max(PIXEL_SCALE.min, Math.min(PIXEL_SCALE.max, n));
}

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {number} pixelScale
 * @param {boolean} lowQuality
 */
export function applyPixelScale(renderer, pixelScale, lowQuality = false) {
  if (!renderer) return;
  const maxCap = lowQuality ? 1 : 2;
  const device = window.devicePixelRatio || 1;
  const scale = clampPixelScale(pixelScale);
  renderer.setPixelRatio(Math.min(device, maxCap) * scale);
  renderer.setSize(window.innerWidth, window.innerHeight);
}
