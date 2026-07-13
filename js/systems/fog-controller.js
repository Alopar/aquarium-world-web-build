import * as THREE from 'three';

export const FOG_VIEW = {
  min: 4,
  max: 220,
  default: 80,
};

export function clampFogViewDistance(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return FOG_VIEW.default;
  return Math.max(FOG_VIEW.min, Math.min(FOG_VIEW.max, n));
}

/** Aggressive near plane for dense linear fog ramp. */
export function fogNearForDistance(far) {
  const f = Math.max(FOG_VIEW.min, far);
  return Math.max(3, Math.min(f - 0.5, f * 0.06));
}

/**
 * User fog distance override — call after day-night and weather each frame.
 * @param {THREE.Scene | null | undefined} scene
 * @param {{ fogEnabled?: boolean, fogViewDistance?: number } | null | undefined} quality
 */
export function applyUserFog(scene, quality) {
  if (!scene?.fog || !quality?.fogEnabled) return;

  const far = clampFogViewDistance(quality.fogViewDistance);
  const near = fogNearForDistance(far);

  if (scene.fog instanceof THREE.Fog) {
    scene.fog.near = near;
    scene.fog.far = far;
  }
}
