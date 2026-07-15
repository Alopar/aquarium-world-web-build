import { LIGHTING, VOXEL_SIZE } from '../constants.js';
import { getLightLevel } from '../materials/registry.js';
import { setGeometryFullBright } from '../shaders/voxel-brightness-material.js';

function emptyLight() {
  return {
    sky: 1,
    block: 0,
    blockR: 0,
    blockG: 0,
    blockB: 0,
  };
}

function withBlendPassthrough(target) {
  return {
    ...target,
    prevSky: target.sky,
    prevBlockR: target.blockR,
    prevBlockG: target.blockG,
    prevBlockB: target.blockB,
    blendStart: -1e6,
  };
}

function maxRgb(a, b) {
  return {
    r: Math.max(a.r, b.r),
    g: Math.max(a.g, b.g),
    b: Math.max(a.b, b.b),
  };
}

/**
 * @param {THREE.Mesh} mesh
 * @param {import('./voxel-lighting.js').VoxelLightingSystem | null} lighting
 * @param {number} worldX
 * @param {number} worldY
 * @param {number} worldZ
 */
export function applyMeshVoxelBrightness(mesh, lighting, worldX, worldY, worldZ) {
  if (!mesh?.geometry) return;

  const bx = Math.floor(worldX / VOXEL_SIZE);
  const by = Math.floor(worldY / VOXEL_SIZE);
  const bz = Math.floor(worldZ / VOXEL_SIZE);
  const sample = sampleVoxelBrightness(lighting, bx, by, bz);

  let colorAttr = mesh.geometry.getAttribute('color');
  if (!colorAttr) {
    setGeometryFullBright(mesh.geometry);
    colorAttr = mesh.geometry.getAttribute('color');
  }

  // Uniform entity materials still use color.rg = sky / scalar block.
  const arr = colorAttr.array;
  for (let i = 0; i < arr.length; i += 3) {
    arr[i] = sample.sky;
    arr[i + 1] = sample.block;
    arr[i + 2] = 0;
  }
  colorAttr.needsUpdate = true;
}

/**
 * Sample skylight + blocklight RGB at a voxel (neighbor max for block).
 * @param {import('./voxel-lighting.js').VoxelLightingSystem | null} lighting
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
export function sampleVoxelBrightness(lighting, x, y, z) {
  if (!lighting) return emptyLight();

  const max = LIGHTING.maxLevel;
  const sky = lighting.getSkylight(x, y, z) / max;
  let rgb = lighting.getBlockLightRgb(x, y, z);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        rgb = maxRgb(rgb, lighting.getBlockLightRgb(x + dx, y + dy, z + dz));
      }
    }
  }
  return {
    sky,
    block: Math.max(rgb.r, rgb.g, rgb.b) / max,
    blockR: rgb.r / max,
    blockG: rgb.g / max,
    blockB: rgb.b / max,
  };
}

/**
 * Face brightness: sky + block RGB from the outward cell (MC-style).
 * Self block light is used only for emitters.
 */
export function sampleFaceBrightness(lighting, x, y, z, dir) {
  if (!lighting) return emptyLight();

  const max = LIGHTING.maxLevel;
  const ox = x + dir[0];
  const oy = y + dir[1];
  const oz = z + dir[2];
  const outwardSky = lighting.getSkylight(ox, oy, oz) / max;
  let rgb = lighting.getBlockLightRgb(ox, oy, oz);

  const selfId = lighting.grid?.get?.(x, y, z);
  if (selfId && getLightLevel(selfId) > 0) {
    rgb = maxRgb(rgb, lighting.getBlockLightRgb(x, y, z));
  }

  return {
    sky: outwardSky,
    block: Math.max(rgb.r, rgb.g, rgb.b) / max,
    blockR: rgb.r / max,
    blockG: rgb.g / max,
    blockB: rgb.b / max,
  };
}

/**
 * Face brightness with prev→target for shader lerp.
 */
export function sampleFaceBrightnessBlend(lighting, blend, x, y, z, dir) {
  const target = sampleFaceBrightness(lighting, x, y, z, dir);
  if (!blend || !lighting) return withBlendPassthrough(target);
  const prev = sampleFaceBrightness(blend.prevLightingView(), x, y, z, dir);
  return {
    sky: target.sky,
    block: target.block,
    blockR: target.blockR,
    blockG: target.blockG,
    blockB: target.blockB,
    prevSky: prev.sky,
    prevBlockR: prev.blockR,
    prevBlockG: prev.blockG,
    prevBlockB: prev.blockB,
    blendStart: blend.faceBlendStart(x, y, z, dir),
  };
}

/**
 * Voxel brightness with prev→target (fluid top helpers).
 */
export function sampleVoxelBrightnessBlend(lighting, blend, x, y, z) {
  const target = sampleVoxelBrightness(lighting, x, y, z);
  if (!blend || !lighting) return withBlendPassthrough(target);
  const prev = sampleVoxelBrightness(blend.prevLightingView(), x, y, z);
  let blendStart = -1e6;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const s = blend.cellBlendStart(x + dx, y + dy, z + dz);
        if (s > -1e5) {
          blendStart = blendStart < -1e5 ? s : Math.min(blendStart, s);
        }
      }
    }
  }
  return {
    sky: target.sky,
    block: target.block,
    blockR: target.blockR,
    blockG: target.blockG,
    blockB: target.blockB,
    prevSky: prev.sky,
    prevBlockR: prev.blockR,
    prevBlockG: prev.blockG,
    prevBlockB: prev.blockB,
    blendStart,
  };
}
