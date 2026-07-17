import { LIGHTING, VOXEL_SIZE } from '../constants.js';
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
  let skyAttr = mesh.geometry.getAttribute('aSky');
  if (!colorAttr || !skyAttr) {
    setGeometryFullBright(mesh.geometry);
    colorAttr = mesh.geometry.getAttribute('color');
    skyAttr = mesh.geometry.getAttribute('aSky');
  }

  // Entity meshes: own albedo × scalar air brightness (no colored blocklight tint).
  const colors = colorAttr.array;
  const skies = skyAttr.array;
  const block = sample.block;
  for (let i = 0; i < skies.length; i++) {
    skies[i] = sample.sky;
    colors[i * 3] = block;
    colors[i * 3 + 1] = block;
    colors[i * 3 + 2] = block;
  }
  colorAttr.needsUpdate = true;
  skyAttr.needsUpdate = true;

  const prevBlock = mesh.geometry.getAttribute('aPrevBlock');
  const prevSky = mesh.geometry.getAttribute('aPrevSky');
  const blendStart = mesh.geometry.getAttribute('aBlendStart');
  if (prevBlock && prevSky && blendStart) {
    prevBlock.array.set(colors);
    prevSky.array.set(skies);
    blendStart.array.fill(-1e6);
    prevBlock.needsUpdate = true;
    prevSky.needsUpdate = true;
    blendStart.needsUpdate = true;
  }
}

/**
 * Sample skylight + combined blocklight (static∨dynamic) for entities.
 */
export function sampleVoxelBrightness(lighting, x, y, z) {
  if (!lighting) return emptyLight();

  const max = LIGHTING.maxLevel;
  const sky = lighting.getSkylight(x, y, z) / max;
  const getRgb = lighting.getBlockLightRgb.bind(lighting);
  let rgb = getRgb(x, y, z);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        rgb = maxRgb(rgb, getRgb(x + dx, y + dy, z + dz));
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
 * Static-only voxel sample for mesh attribute bake (dynamic comes from shader atlas).
 */
export function sampleVoxelStaticBrightness(lighting, x, y, z) {
  if (!lighting) return emptyLight();

  const max = LIGHTING.maxLevel;
  const getRgb = lighting.getStaticBlockLightRgb?.bind(lighting)
    ?? lighting.getBlockLightRgb.bind(lighting);
  const sky = lighting.getSkylight(x, y, z) / max;
  let rgb = getRgb(x, y, z);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        rgb = maxRgb(rgb, getRgb(x + dx, y + dy, z + dz));
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

/** Per-face sky multiplier for pure skylight (no block light). */
function skyFaceShadeMul(dir) {
  if (!LIGHTING.skyFaceShadeEnabled) return 1;
  const s = LIGHTING.skyFaceShade;
  if (dir[1] > 0) return s.top;
  if (dir[1] < 0) return s.bottom;
  if (dir[0] > 0) return s.east;
  if (dir[0] < 0) return s.west;
  if (dir[2] > 0) return s.south;
  return s.north;
}

/**
 * Face brightness: sky + **static** block RGB from the outward cell (MC-style).
 * Dynamic light is applied in the fragment shader via 3D texture.
 * Emitters do not bake their own cell light onto their faces — glow is emissive.
 * Pure-skylight faces get a tiny directional shade (~11:00 SE sun).
 */
export function sampleFaceBrightness(lighting, x, y, z, dir) {
  if (!lighting) return emptyLight();

  const max = LIGHTING.maxLevel;
  const ox = x + dir[0];
  const oy = y + dir[1];
  const oz = z + dir[2];
  const getRgb = lighting.getStaticBlockLightRgb?.bind(lighting)
    ?? lighting.getBlockLightRgb.bind(lighting);
  const getSky = lighting.getSkylight.bind(lighting);

  let outwardSky = getSky(ox, oy, oz) / max;
  const rgb = getRgb(ox, oy, oz);
  const block = Math.max(rgb.r, rgb.g, rgb.b) / max;

  // No static block light → fake soft sun direction on sky only.
  if (block <= 0 && outwardSky > 0) {
    outwardSky *= skyFaceShadeMul(dir);
  }

  return {
    sky: outwardSky,
    block,
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
 * Face brightness snapped (no blend) — for dynamic light mesh patches.
 */
export function sampleFaceBrightnessSnap(lighting, x, y, z, dir) {
  return withBlendPassthrough(sampleFaceBrightness(lighting, x, y, z, dir));
}

/**
 * Voxel brightness snapped (no blend) — for dynamic light mesh patches.
 */
export function sampleVoxelBrightnessSnap(lighting, x, y, z) {
  return withBlendPassthrough(sampleVoxelStaticBrightness(lighting, x, y, z));
}

/**
 * Voxel brightness with prev→target (fluid top helpers) — static bake only.
 */
export function sampleVoxelBrightnessBlend(lighting, blend, x, y, z) {
  const target = sampleVoxelStaticBrightness(lighting, x, y, z);
  if (!blend || !lighting) return withBlendPassthrough(target);
  const prev = sampleVoxelStaticBrightness(blend.prevLightingView(), x, y, z);
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
