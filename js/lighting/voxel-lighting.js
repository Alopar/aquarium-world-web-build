import * as THREE from 'three';
import { LIGHTING, VOXEL_SIZE } from '../constants.js';
import { getLightLevel, getLightColor, getMaterial } from '../materials/registry.js';

const FACE_DIRS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

function blocksSkylight(id) {
  const mat = getMaterial(id);
  return mat.solid === true && mat.opaque === true;
}

function blocksBlockLight(id) {
  const mat = getMaterial(id);
  return mat.solid === true && mat.opaque === true;
}

function clampColor(color) {
  return {
    r: Math.max(0, Math.min(1, color?.r ?? 1)),
    g: Math.max(0, Math.min(1, color?.g ?? 1)),
    b: Math.max(0, Math.min(1, color?.b ?? 1)),
  };
}

/**
 * Drop light intensity by `falloff` while keeping R:G:B ratios.
 * Independent per-channel −1 turns yellow into pure red at the fringe.
 * Peak channel(s) step by `falloff`; others scale down (floor) and stay
 * non-zero until the light dies — hue softens, but doesn't strip to one channel.
 * @returns {[number, number, number]}
 */
function attenuateRgb(r, g, b, falloff) {
  const level = r > g ? (r > b ? r : b) : (g > b ? g : b);
  if (level <= falloff) return [0, 0, 0];
  const next = level - falloff;
  let nr = r === level ? next : Math.floor((r * next) / level);
  let ng = g === level ? next : Math.floor((g * next) / level);
  let nb = b === level ? next : Math.floor((b * next) / level);
  if (r > 0) nr = Math.max(1, nr);
  if (g > 0) ng = Math.max(1, ng);
  if (b > 0) nb = Math.max(1, nb);
  return [
    Math.min(nr, next),
    Math.min(ng, next),
    Math.min(nb, next),
  ];
}

/**
 * Voxel lighting — three channels:
 *   skylight (scalar) | blockLight RGB (static emitters) | dynamicLight RGB (transient)
 * Display / gameplay sample = max(block, dynamic).
 * Both static (sky+block) and dynamic are sampled from 2D atlas textures in shaders —
 * mesh remesh is only needed for geometry, never for light radius.
 */
export class VoxelLightingSystem {
  /**
   * @param {import('../world/voxel-grid.js').VoxelGrid} grid
   */
  constructor(grid) {
    this.grid = grid;
    const { x, y, z } = grid.size;
    this.sizeX = x;
    this.sizeY = y;
    this.sizeZ = z;
    this.volume = x * y * z;

    this.skylight = new Uint8Array(this.volume);

    /** Static block emitters (CPU field + atlas; not baked into meshes). */
    this.blockLight = new Uint8Array(this.volume);
    this.blockLightR = new Uint8Array(this.volume);
    this.blockLightG = new Uint8Array(this.volume);
    this.blockLightB = new Uint8Array(this.volume);

    /** Transient flood (handheld / projectile / flash). */
    this.dynamicLight = new Uint8Array(this.volume);
    this.dynamicLightR = new Uint8Array(this.volume);
    this.dynamicLightG = new Uint8Array(this.volume);
    this.dynamicLightB = new Uint8Array(this.volume);

    /** Indices with dynamicLight > 0 — for cheap per-tick decay. */
    this._dynLit = [];
    this._dynLitFlag = new Uint8Array(this.volume);

    this._skyQueue = [];
    this._skyDecreaseQueue = [];
    this._blockQueue = [];
    this._dynQueue = [];

    /** @type {number[]} packed x,y,z,flags */
    this._pending = [];
    this._batchDepth = 0;
    /** Tight dirty bounds from the last sky/block update (for atlas blend). */
    this._dirtyMinX = 0;
    this._dirtyMinY = 0;
    this._dirtyMinZ = 0;
    this._dirtyMaxX = 0;
    this._dirtyMaxY = 0;
    this._dirtyMaxZ = 0;
    this._hasDirtyBounds = false;

    /** @type {Map<string, object>} */
    this._dynamicSources = new Map();
    this._dynamicSeq = 0;
    this._dynSourcesDirty = false;
    this._decayAcc = 0;
    this._texDirty = false;
    this._staticTexDirty = true;

    // RGBA atlas: width = sizeX * sizeZ, height = sizeY (row = y, col = x + z*sizeX)
    this._texW = x * z;
    this._texH = y;
    this._texData = new Uint8Array(this._texW * this._texH * 4);
    this.dynamicTexture = new THREE.DataTexture(
      this._texData,
      this._texW,
      this._texH,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    this.dynamicTexture.minFilter = THREE.NearestFilter;
    this.dynamicTexture.magFilter = THREE.NearestFilter;
    this.dynamicTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.dynamicTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.dynamicTexture.flipY = false;
    this.dynamicTexture.generateMipmaps = false;
    this.dynamicTexture.needsUpdate = true;

    /** Static atlas: RGB = block light, A = skylight (0…255 ↔ 0…maxLevel). */
    this._staticTexData = new Uint8Array(this._texW * this._texH * 4);
    this.staticTexture = new THREE.DataTexture(
      this._staticTexData,
      this._texW,
      this._texH,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    this.staticTexture.minFilter = THREE.NearestFilter;
    this.staticTexture.magFilter = THREE.NearestFilter;
    this.staticTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.staticTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.staticTexture.flipY = false;
    this.staticTexture.generateMipmaps = false;
    this.staticTexture.needsUpdate = true;

    /** @type {null | ((box: object) => void)} */
    this.onAfterFlush = null;
  }

  /** @param {number} x @param {number} y @param {number} z */
  _index(x, y, z) {
    return y * this.sizeX * this.sizeZ + z * this.sizeX + x;
  }

  _syncMax(maxArr, rArr, gArr, bArr, idx) {
    maxArr[idx] = Math.max(rArr[idx], gArr[idx], bArr[idx]);
  }

  _clearRgb(rArr, gArr, bArr, maxArr, idx) {
    rArr[idx] = 0;
    gArr[idx] = 0;
    bArr[idx] = 0;
    maxArr[idx] = 0;
  }

  _seedRgb(rArr, gArr, bArr, maxArr, idx, emit, color) {
    const r = Math.round(emit * color.r);
    const g = Math.round(emit * color.g);
    const b = Math.round(emit * color.b);
    rArr[idx] = r;
    gArr[idx] = g;
    bArr[idx] = b;
    this._syncMax(maxArr, rArr, gArr, bArr, idx);
    return maxArr[idx];
  }

  _raiseRgb(rArr, gArr, bArr, maxArr, idx, r, g, b) {
    let grew = false;
    if (r > rArr[idx]) {
      rArr[idx] = r;
      grew = true;
    }
    if (g > gArr[idx]) {
      gArr[idx] = g;
      grew = true;
    }
    if (b > bArr[idx]) {
      bArr[idx] = b;
      grew = true;
    }
    if (grew) this._syncMax(maxArr, rArr, gArr, bArr, idx);
    return grew;
  }

  getSkylight(x, y, z) {
    if (!this.grid.inBounds(x, y, z)) return LIGHTING.maxLevel;
    return this.skylight[this._index(x, y, z)];
  }

  /** Static block light only (mesh bake). */
  getStaticBlockLight(x, y, z) {
    if (!this.grid.inBounds(x, y, z)) return 0;
    return this.blockLight[this._index(x, y, z)];
  }

  getStaticBlockLightRgb(x, y, z) {
    if (!this.grid.inBounds(x, y, z)) return { r: 0, g: 0, b: 0 };
    const i = this._index(x, y, z);
    return { r: this.blockLightR[i], g: this.blockLightG[i], b: this.blockLightB[i] };
  }

  getDynamicLight(x, y, z) {
    if (!this.grid.inBounds(x, y, z)) return 0;
    return this.dynamicLight[this._index(x, y, z)];
  }

  getDynamicLightRgb(x, y, z) {
    if (!this.grid.inBounds(x, y, z)) return { r: 0, g: 0, b: 0 };
    const i = this._index(x, y, z);
    return { r: this.dynamicLightR[i], g: this.dynamicLightG[i], b: this.dynamicLightB[i] };
  }

  /** Combined max(static, dynamic) — debug / entities. */
  getBlockLight(x, y, z) {
    if (!this.grid.inBounds(x, y, z)) return 0;
    const i = this._index(x, y, z);
    return Math.max(this.blockLight[i], this.dynamicLight[i]);
  }

  getBlockLightRgb(x, y, z) {
    if (!this.grid.inBounds(x, y, z)) return { r: 0, g: 0, b: 0 };
    const i = this._index(x, y, z);
    return {
      r: Math.max(this.blockLightR[i], this.dynamicLightR[i]),
      g: Math.max(this.blockLightG[i], this.dynamicLightG[i]),
      b: Math.max(this.blockLightB[i], this.dynamicLightB[i]),
    };
  }

  hasBlockLightNear(x, y, z, radius = 1) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const nx = x + dx;
          const ny = y + dy;
          const nz = z + dz;
          if (!this.grid.inBounds(nx, ny, nz)) continue;
          const i = this._index(nx, ny, nz);
          if (this.blockLight[i] > 0 || this.dynamicLight[i] > 0) return true;
        }
      }
    }
    for (const src of this._dynamicSources.values()) {
      if (Math.abs(src.x - x) <= radius + src.level
        && Math.abs(src.y - y) <= radius + src.level
        && Math.abs(src.z - z) <= radius + src.level) {
        return true;
      }
    }
    return false;
  }

  sampleSkylightFactor(worldX, eyeY, worldZ) {
    const x = Math.floor(worldX);
    const z = Math.floor(worldZ);
    if (!this.grid.inBounds(x, 0, z)) return 1;
    const y0 = Math.max(0, Math.min(this.sizeY - 1, Math.floor(eyeY)));
    let maxLevel = 0;
    for (let y = y0; y < Math.min(this.sizeY, y0 + 2); y++) {
      maxLevel = Math.max(maxLevel, this.getSkylight(x, y, z));
    }
    return maxLevel / LIGHTING.maxLevel;
  }

  getVertexLight(x, y, z) {
    const max = LIGHTING.maxLevel;
    const rgb = this.getBlockLightRgb(x, y, z);
    return {
      sky: this.getSkylight(x, y, z) / max,
      block: this.getBlockLight(x, y, z) / max,
      blockR: rgb.r / max,
      blockG: rgb.g / max,
      blockB: rgb.b / max,
    };
  }

  /**
   * True when placing an opaque block at (x,y,z) cannot darken any neighbor.
   * Reads the CURRENT skylight field (still pre-update values when called from onChange).
   */
  canSkipSkylightDecrease(x, y, z) {
    if (!this.grid.inBounds(x, y, z)) return true;
    const oldSky = this.skylight[this._index(x, y, z)];
    if (oldSky <= 0) return true;

    for (const [dx, dy, dz] of FACE_DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (!this.grid.inBounds(nx, ny, nz)) continue;
      if (blocksSkylight(this.grid.get(nx, ny, nz))) continue;
      if (this.skylight[this._index(nx, ny, nz)] < oldSky) return false;
    }
    return true;
  }

  /** Zero skylight in an opaque cell without a flood (after canSkipSkylightDecrease). */
  occludeSkylightCell(x, y, z) {
    if (!this.grid.inBounds(x, y, z)) return;
    const idx = this._index(x, y, z);
    if (this.skylight[idx] === 0) return;
    this.skylight[idx] = 0;
    this._staticTexDirty = true;
    this.onAfterFlush?.({
      minX: x,
      minY: y,
      minZ: z,
      maxX: x,
      maxY: y,
      maxZ: z,
    });
  }

  beginBatch() {
    this._batchDepth++;
  }

  endBatch() {
    this._batchDepth = Math.max(0, this._batchDepth - 1);
    if (this._batchDepth === 0) this.flushPending();
  }

  /**
   * @param {{ skyDecrease?: boolean, skyUpdate?: boolean, blockLight?: boolean }} [opts]
   * skyUpdate=false skips skylight entirely (blockLight may still run).
   */
  markDirtyAt(x, y, z, { skyDecrease = false, skyUpdate = true, blockLight = true } = {}) {
    if (!skyUpdate && !skyDecrease && !blockLight) return;
    let flags = 0;
    if (skyDecrease) flags |= 1;
    if (blockLight) flags |= 2;
    if (skyUpdate || skyDecrease) flags |= 4;
    this._pending.push(x, y, z, flags);
    if (this._batchDepth === 0) this.flushPending();
  }

  _resetDirtyBounds() {
    this._hasDirtyBounds = false;
  }

  _expandDirty(x, y, z) {
    if (!this._hasDirtyBounds) {
      this._dirtyMinX = x;
      this._dirtyMinY = y;
      this._dirtyMinZ = z;
      this._dirtyMaxX = x;
      this._dirtyMaxY = y;
      this._dirtyMaxZ = z;
      this._hasDirtyBounds = true;
      return;
    }
    if (x < this._dirtyMinX) this._dirtyMinX = x;
    if (y < this._dirtyMinY) this._dirtyMinY = y;
    if (z < this._dirtyMinZ) this._dirtyMinZ = z;
    if (x > this._dirtyMaxX) this._dirtyMaxX = x;
    if (y > this._dirtyMaxY) this._dirtyMaxY = y;
    if (z > this._dirtyMaxZ) this._dirtyMaxZ = z;
  }

  _dirtyBox(pad = 0) {
    if (!this._hasDirtyBounds) {
      return {
        minX: 0,
        minY: 0,
        minZ: 0,
        maxX: this.sizeX - 1,
        maxY: this.sizeY - 1,
        maxZ: this.sizeZ - 1,
      };
    }
    return {
      minX: Math.max(0, this._dirtyMinX - pad),
      minY: Math.max(0, this._dirtyMinY - pad),
      minZ: Math.max(0, this._dirtyMinZ - pad),
      maxX: Math.min(this.sizeX - 1, this._dirtyMaxX + pad),
      maxY: Math.min(this.sizeY - 1, this._dirtyMaxY + pad),
      maxZ: Math.min(this.sizeZ - 1, this._dirtyMaxZ + pad),
    };
  }

  flushPending() {
    const p = this._pending;
    if (p.length === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let anySkyDecrease = false;
    let anySkyUpdate = false;
    let anyBlock = false;
    /** @type {number[]} */
    const decreaseEdits = [];

    for (let i = 0; i < p.length; i += 4) {
      const x = p[i];
      const y = p[i + 1];
      const z = p[i + 2];
      const flags = p[i + 3];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
      if (flags & 1) {
        anySkyDecrease = true;
        decreaseEdits.push(x, y, z);
      }
      if (flags & 2) anyBlock = true;
      if (flags & 4) anySkyUpdate = true;
    }
    p.length = 0;

    this._resetDirtyBounds();
    this._expandDirty(minX, minY, minZ);
    this._expandDirty(maxX, maxY, maxZ);

    if (anySkyDecrease) {
      this._skylightDecreaseFromEdits(decreaseEdits);
    } else if (anySkyUpdate) {
      this._skylightIncreaseFromEdits(minX, minY, minZ, maxX, maxY, maxZ);
    }

    if (anyBlock) {
      const r = LIGHTING.maxLevel;
      this._rebuildBlockLightBox(minX - r, minY - r, minZ - r, maxX + r, maxY + r, maxZ + r);
      this._expandDirty(minX - r, minY - r, minZ - r);
      this._expandDirty(maxX + r, maxY + r, maxZ + r);
    }

    this._staticTexDirty = true;
    this.onAfterFlush?.(this._dirtyBox(0));
  }

  rebuildAll() {
    this.skylight.fill(0);
    this.blockLight.fill(0);
    this.blockLightR.fill(0);
    this.blockLightG.fill(0);
    this.blockLightB.fill(0);
    this._clearAllDynamic();
    this._pending.length = 0;

    for (let x = 0; x < this.sizeX; x++) {
      for (let z = 0; z < this.sizeZ; z++) {
        this._seedColumnSkylight(x, z);
      }
    }
    this._propagateSkylightFromAllLit();
    this._rebuildBlockLightBox(0, 0, 0, this.sizeX - 1, this.sizeY - 1, this.sizeZ - 1);
    this._staticTexDirty = true;
  }

  markStaticTextureDirty() {
    this._staticTexDirty = true;
  }

  /**
   * Upload static sky+block atlas. When blend is active, write display-lerped
   * values so dimming still fades without remeshing.
   * @param {import('./brightness-blend.js').BrightnessBlendSystem | null} [blend]
   */
  uploadStaticTexture(blend = null) {
    this._staticTexDirty = false;
    const sx = this.sizeX;
    const sy = this.sizeY;
    const sz = this.sizeZ;
    const texW = this._texW;
    const data = this._staticTexData;
    const sky = this.skylight;
    const br = this.blockLightR;
    const bg = this.blockLightG;
    const bb = this.blockLightB;
    const scale = 255 / LIGHTING.maxLevel;
    const plane = sx * sz;

    for (let y = 0; y < sy; y++) {
      const yOff = y * plane;
      const rowOff = y * texW;
      for (let z = 0; z < sz; z++) {
        const zOff = yOff + z * sx;
        const colBase = rowOff + z * sx;
        for (let x = 0; x < sx; x++) {
          const idx = zOff + x;
          const dst = (colBase + x) * 4;
          data[dst] = Math.round(br[idx] * scale);
          data[dst + 1] = Math.round(bg[idx] * scale);
          data[dst + 2] = Math.round(bb[idx] * scale);
          data[dst + 3] = Math.round(sky[idx] * scale);
        }
      }
    }

    if (blend?.active?.length) {
      const now = blend.time;
      const duration = Math.max(1e-4, blend.duration);
      const list = blend.active;
      for (let i = 0; i < list.length; i++) {
        const idx = list[i];
        const t = Math.min(1, Math.max(0, (now - blend.startTime[idx]) / duration));
        const dispSky = Math.round(blend.fromSky[idx] + (blend.committedSky[idx] - blend.fromSky[idx]) * t);
        const dispR = Math.round(blend.fromBlockR[idx] + (blend.committedBlockR[idx] - blend.fromBlockR[idx]) * t);
        const dispG = Math.round(blend.fromBlockG[idx] + (blend.committedBlockG[idx] - blend.fromBlockG[idx]) * t);
        const dispB = Math.round(blend.fromBlockB[idx] + (blend.committedBlockB[idx] - blend.fromBlockB[idx]) * t);
        const y = Math.floor(idx / plane);
        const rem = idx - y * plane;
        const z = Math.floor(rem / sx);
        const x = rem - z * sx;
        const dst = (x + z * sx + y * texW) * 4;
        data[dst] = Math.round(dispR * scale);
        data[dst + 1] = Math.round(dispG * scale);
        data[dst + 2] = Math.round(dispB * scale);
        data[dst + 3] = Math.round(dispSky * scale);
      }
    }

    this.staticTexture.needsUpdate = true;
  }

  /**
   * Upload static atlas if dirty or a brightness blend is in progress.
   * @param {import('./brightness-blend.js').BrightnessBlendSystem | null} [blend]
   */
  flushStaticTexture(blend = null) {
    const blending = !!(blend?.active?.length);
    if (!this._staticTexDirty && !blending) return;
    this.uploadStaticTexture(blend);
  }

  // --- Dynamic lights -----------------------------------------------------

  upsertDynamicLight(id, worldX, worldY, worldZ, level, color) {
    let wx;
    let wy;
    let wz;
    let lv;
    let col;
    if (typeof worldX === 'object' && worldX != null) {
      wx = worldX.x;
      wy = worldX.y;
      wz = worldX.z;
      lv = worldY;
      col = worldZ;
    } else {
      wx = worldX;
      wy = worldY;
      wz = worldZ;
      lv = level;
      col = color;
    }

    const x = Math.floor(wx / VOXEL_SIZE);
    const y = Math.floor(wy / VOXEL_SIZE);
    const z = Math.floor(wz / VOXEL_SIZE);
    const emit = Math.max(0, Math.min(LIGHTING.maxLevel, Math.round(lv ?? 0)));
    const rgb = clampColor(col);
    if (emit <= 0) {
      this.removeDynamicLight(id);
      return;
    }

    const prev = this._dynamicSources.get(id);
    if (prev
      && prev.x === x && prev.y === y && prev.z === z
      && prev.level === emit
      && prev.color.r === rgb.r && prev.color.g === rgb.g && prev.color.b === rgb.b
      && prev.life == null) {
      return;
    }

    if (!prev && this._dynamicSources.size >= LIGHTING.maxDynamicLights) {
      this._evictWeakestDynamic(id);
    }

    this._dynamicSources.set(id, {
      id,
      x,
      y,
      z,
      level: emit,
      color: rgb,
      life: null,
      maxLife: null,
      seq: ++this._dynamicSeq,
    });
    this._dynSourcesDirty = true;
  }

  pulseDynamicLight(id, worldX, worldY, worldZ, level, color, _duration) {
    const x = Math.floor(worldX / VOXEL_SIZE);
    const y = Math.floor(worldY / VOXEL_SIZE);
    const z = Math.floor(worldZ / VOXEL_SIZE);
    const emit = Math.max(0, Math.min(LIGHTING.maxLevel, Math.round(level)));
    const rgb = clampColor(color);
    if (emit <= 0) return;

    // One-shot flood into dynamic field; fade via marked-cell decay (no remesh).
    const tempId = id;
    this._dynamicSources.set(tempId, {
      id: tempId,
      x,
      y,
      z,
      level: emit,
      color: rgb,
      life: null,
      maxLife: null,
      seq: ++this._dynamicSeq,
      oneShot: true,
    });
    this._floodAllDynamicSources();
    this._dynamicSources.delete(tempId);
    this._dynSourcesDirty = false;
    if (this._texDirty) this._uploadDynamicTexture();
  }

  removeDynamicLight(id) {
    if (!this._dynamicSources.has(id)) return;
    this._dynamicSources.delete(id);
    this._dynSourcesDirty = true;
  }

  /**
   * Decay all marked cells, then re-flood from active sources.
   * @param {number} dt
   */
  tickDynamicLights(dt) {
    const interval = LIGHTING.dynamicDecayInterval ?? 0.05;
    this._decayAcc += dt;

    let didDecay = false;
    while (this._decayAcc >= interval) {
      this._decayAcc -= interval;
      if (this._decayAllDynamicByOne()) didDecay = true;
    }

    if (this._dynamicSources.size > 0 && (this._dynSourcesDirty || didDecay)) {
      this._floodAllDynamicSources();
      this._dynSourcesDirty = false;
    } else if (this._dynSourcesDirty) {
      this._floodAllDynamicSources();
      this._dynSourcesDirty = false;
    }

    if (this._texDirty) {
      this._uploadDynamicTexture();
    }
  }

  _evictWeakestDynamic(keepId) {
    let worstId = null;
    let worstScore = Infinity;
    let worstSeq = Infinity;
    for (const [id, src] of this._dynamicSources) {
      if (id === keepId) continue;
      const score = src.level + (src.life != null ? 0 : 100);
      if (score < worstScore || (score === worstScore && src.seq < worstSeq)) {
        worstScore = score;
        worstSeq = src.seq;
        worstId = id;
      }
    }
    if (worstId != null) this.removeDynamicLight(worstId);
  }

  _markDynLit(idx) {
    if (this._dynLitFlag[idx]) return;
    this._dynLitFlag[idx] = 1;
    this._dynLit.push(idx);
  }

  _clearAllDynamic() {
    this.dynamicLight.fill(0);
    this.dynamicLightR.fill(0);
    this.dynamicLightG.fill(0);
    this.dynamicLightB.fill(0);
    this._dynLit.length = 0;
    this._dynLitFlag.fill(0);
    this._texDirty = true;
  }

  /** @returns {boolean} whether any cell changed */
  _decayAllDynamicByOne() {
    const lit = this._dynLit;
    if (lit.length === 0) return false;

    const dr = this.dynamicLightR;
    const dg = this.dynamicLightG;
    const db = this.dynamicLightB;
    const dm = this.dynamicLight;
    const flags = this._dynLitFlag;
    let w = 0;
    let changed = false;

    for (let i = 0; i < lit.length; i++) {
      const idx = lit[i];
      const [r, g, b] = attenuateRgb(dr[idx], dg[idx], db[idx], 1);
      if (r !== dr[idx] || g !== dg[idx] || b !== db[idx]) changed = true;
      dr[idx] = r;
      dg[idx] = g;
      db[idx] = b;
      const m = Math.max(r, g, b);
      dm[idx] = m;
      if (m > 0) {
        lit[w++] = idx;
      } else {
        flags[idx] = 0;
      }
    }
    lit.length = w;
    if (changed) this._texDirty = true;
    return changed;
  }

  _floodAllDynamicSources() {
    const dr = this.dynamicLightR;
    const dg = this.dynamicLightG;
    const db = this.dynamicLightB;
    const dm = this.dynamicLight;
    const falloff = LIGHTING.blockLightFalloff;
    const q = this._dynQueue;
    q.length = 0;

    for (const src of this._dynamicSources.values()) {
      if (!this.grid.inBounds(src.x, src.y, src.z)) continue;
      const idx = this._index(src.x, src.y, src.z);
      const r = Math.round(src.level * src.color.r);
      const g = Math.round(src.level * src.color.g);
      const b = Math.round(src.level * src.color.b);
      if (this._raiseRgb(dr, dg, db, dm, idx, r, g, b)) {
        this._markDynLit(idx);
        this._texDirty = true;
        q.push(src.x, src.y, src.z);
      } else if (dm[idx] > 0) {
        this._markDynLit(idx);
        q.push(src.x, src.y, src.z);
      }
    }

    for (let i = 0; i < q.length; i += 3) {
      const x = q[i];
      const y = q[i + 1];
      const z = q[i + 2];
      const idx = this._index(x, y, z);
      if (dm[idx] <= falloff) continue;

      const [nextR, nextG, nextB] = attenuateRgb(dr[idx], dg[idx], db[idx], falloff);
      if (nextR <= 0 && nextG <= 0 && nextB <= 0) continue;

      for (const [dx, dy, dz] of FACE_DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (!this.grid.inBounds(nx, ny, nz)) continue;
        const nidx = this._index(nx, ny, nz);
        if (!this._raiseRgb(dr, dg, db, dm, nidx, nextR, nextG, nextB)) continue;
        this._markDynLit(nidx);
        this._texDirty = true;
        if (!blocksBlockLight(this.grid.get(nx, ny, nz))) {
          q.push(nx, ny, nz);
        }
      }
    }
  }

  _uploadDynamicTexture() {
    this._texDirty = false;
    const sx = this.sizeX;
    const sz = this.sizeZ;
    const data = this._texData;
    const dr = this.dynamicLightR;
    const dg = this.dynamicLightG;
    const db = this.dynamicLightB;
    const scale = 255 / LIGHTING.maxLevel;
    const texW = this._texW;

    data.fill(0);
    const lit = this._dynLit;
    for (let i = 0; i < lit.length; i++) {
      const idx = lit[i];
      const y = Math.floor(idx / (sx * sz));
      const rem = idx - y * sx * sz;
      const z = Math.floor(rem / sx);
      const x = rem - z * sx;
      const dst = (x + z * sx + y * texW) * 4;
      data[dst] = Math.round(dr[idx] * scale);
      data[dst + 1] = Math.round(dg[idx] * scale);
      data[dst + 2] = Math.round(db[idx] * scale);
      data[dst + 3] = 255;
    }
    this.dynamicTexture.needsUpdate = true;
  }

  // --- Skylight / static blocklight (unchanged flood) ---------------------

  _seedColumnSkylight(x, z) {
    let level = LIGHTING.maxLevel;
    for (let y = this.sizeY - 1; y >= 0; y--) {
      const idx = this._index(x, y, z);
      if (blocksSkylight(this.grid.get(x, y, z))) {
        this.skylight[idx] = 0;
        level = 0;
      } else {
        this.skylight[idx] = level;
      }
    }
  }

  _skylightIncreaseFromEdits(minX, minY, minZ, maxX, maxY, maxZ) {
    const x0 = Math.max(0, minX);
    const x1 = Math.min(this.sizeX - 1, maxX);
    const z0 = Math.max(0, minZ);
    const z1 = Math.min(this.sizeZ - 1, maxZ);
    const y0 = Math.max(0, minY - LIGHTING.maxLevel);
    const y1 = Math.min(this.sizeY - 1, maxY + LIGHTING.maxLevel);
    const falloff = LIGHTING.blockLightFalloff;

    this._skyQueue.length = 0;

    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        this._seedColumnSkylight(x, z);
      }
    }

    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        for (let y = y0; y <= y1; y++) {
          if (blocksSkylight(this.grid.get(x, y, z))) continue;

          const idx = this._index(x, y, z);
          let level = this.skylight[idx];

          for (const [dx, dy, dz] of FACE_DIRS) {
            const nx = x + dx;
            const ny = y + dy;
            const nz = z + dz;
            let imported;
            if (!this.grid.inBounds(nx, ny, nz)) {
              imported = LIGHTING.maxLevel - falloff;
            } else {
              imported = this.skylight[this._index(nx, ny, nz)] - falloff;
            }
            if (imported > level) level = imported;
          }

          if (level > this.skylight[idx]) this.skylight[idx] = level;
          if (level > 0) this._skyQueue.push(x, y, z, level);
        }
      }
    }

    this._propagateSkyIncrease();
    this._expandDirty(x0, y0, z0);
    this._expandDirty(x1, y1, z1);
  }

  /**
   * Place/opaque occlusion: column reseed + light-decrease BFS + local increase.
   * Touches only cells that actually lost light (plus a refill pass), not a ±maxLevel wipe.
   * @param {number[]} edits packed x,y,z triples (grid already has new opaque blocks)
   */
  _skylightDecreaseFromEdits(edits) {
    const falloff = LIGHTING.blockLightFalloff;
    const dec = this._skyDecreaseQueue;
    dec.length = 0;
    this._skyQueue.length = 0;

    /** @type {Set<string>} */
    const columns = new Set();
    const oldCol = new Uint8Array(this.sizeY);

    for (let i = 0; i < edits.length; i += 3) {
      const ex = edits[i];
      const ez = edits[i + 2];
      const colKey = `${ex},${ez}`;
      if (columns.has(colKey)) continue;
      columns.add(colKey);

      for (let y = 0; y < this.sizeY; y++) {
        oldCol[y] = this.skylight[this._index(ex, y, ez)];
      }

      this._seedColumnSkylight(ex, ez);

      for (let y = 0; y < this.sizeY; y++) {
        const idx = this._index(ex, y, ez);
        const neu = this.skylight[idx];
        const old = oldCol[y];
        if (neu < old) {
          // Keep seed value; decrease BFS uses old to strip dependents.
          dec.push(ex, y, ez, old);
          this._expandDirty(ex, y, ez);
        } else if (neu > old) {
          this._skyQueue.push(ex, y, ez, neu);
          this._expandDirty(ex, y, ez);
        }
      }
    }

    // Decrease BFS: zero cells that could only have been lit via a brighter ancestor.
    for (let i = 0; i < dec.length; i += 4) {
      const x = dec[i];
      const y = dec[i + 1];
      const z = dec[i + 2];
      const oldLight = dec[i + 3];

      for (const [dx, dy, dz] of FACE_DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (!this.grid.inBounds(nx, ny, nz)) continue;
        if (blocksSkylight(this.grid.get(nx, ny, nz))) continue;

        const nidx = this._index(nx, ny, nz);
        const nLight = this.skylight[nidx];
        if (nLight <= 0) continue;

        if (nLight < oldLight) {
          this.skylight[nidx] = 0;
          dec.push(nx, ny, nz, nLight);
          this._expandDirty(nx, ny, nz);
        } else {
          // Brighter/equal neighbor can refill the hole.
          this._skyQueue.push(nx, ny, nz, nLight);
        }
      }
    }

    // Reseed touched columns again so vertical sky isn't left at 0 after side-strip.
    for (const key of columns) {
      const [cx, cz] = key.split(',').map(Number);
      this._seedColumnSkylight(cx, cz);
      for (let y = 0; y < this.sizeY; y++) {
        const level = this.skylight[this._index(cx, y, cz)];
        if (level > 0) this._skyQueue.push(cx, y, cz, level);
      }
    }

    // Import light from the border of the dirty region, then increase-flood.
    if (this._hasDirtyBounds) {
      const pad = LIGHTING.maxLevel;
      const x0 = Math.max(0, this._dirtyMinX - 1);
      const x1 = Math.min(this.sizeX - 1, this._dirtyMaxX + 1);
      const y0 = Math.max(0, this._dirtyMinY - 1);
      const y1 = Math.min(this.sizeY - 1, this._dirtyMaxY + 1);
      const z0 = Math.max(0, this._dirtyMinZ - 1);
      const z1 = Math.min(this.sizeZ - 1, this._dirtyMaxZ + 1);

      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          for (let z = z0; z <= z1; z++) {
            if (blocksSkylight(this.grid.get(x, y, z))) continue;
            const idx = this._index(x, y, z);
            let level = this.skylight[idx];
            for (const [dx, dy, dz] of FACE_DIRS) {
              const nx = x + dx;
              const ny = y + dy;
              const nz = z + dz;
              let imported;
              if (!this.grid.inBounds(nx, ny, nz)) {
                imported = LIGHTING.maxLevel - falloff;
              } else {
                imported = this.skylight[this._index(nx, ny, nz)] - falloff;
              }
              if (imported > level) level = imported;
            }
            if (level > this.skylight[idx]) {
              this.skylight[idx] = level;
              this._expandDirty(x, y, z);
            }
            if (level > 0) this._skyQueue.push(x, y, z, level);
          }
        }
      }

      // Track potential spread for atlas blend (increase may walk further).
      this._expandDirty(
        Math.max(0, this._dirtyMinX - pad),
        Math.max(0, this._dirtyMinY - pad),
        Math.max(0, this._dirtyMinZ - pad),
      );
      this._expandDirty(
        Math.min(this.sizeX - 1, this._dirtyMaxX + pad),
        Math.min(this.sizeY - 1, this._dirtyMaxY + pad),
        Math.min(this.sizeZ - 1, this._dirtyMaxZ + pad),
      );
    }

    this._propagateSkyIncrease();
  }

  _propagateSkylightFromAllLit() {
    this._skyQueue.length = 0;
    for (let x = 0; x < this.sizeX; x++) {
      for (let y = 0; y < this.sizeY; y++) {
        for (let z = 0; z < this.sizeZ; z++) {
          const level = this.skylight[this._index(x, y, z)];
          if (level > 0) this._skyQueue.push(x, y, z, level);
        }
      }
    }
    this._propagateSkyIncrease();
  }

  _propagateSkyIncrease() {
    const falloff = LIGHTING.blockLightFalloff;
    const q = this._skyQueue;

    for (let i = 0; i < q.length; i += 4) {
      const x = q[i];
      const y = q[i + 1];
      const z = q[i + 2];
      const level = q[i + 3];
      if (level <= falloff) continue;

      const nextLevel = level - falloff;
      for (const [dx, dy, dz] of FACE_DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (!this.grid.inBounds(nx, ny, nz)) continue;
        if (blocksSkylight(this.grid.get(nx, ny, nz))) continue;

        const nidx = this._index(nx, ny, nz);
        if (nextLevel > this.skylight[nidx]) {
          this.skylight[nidx] = nextLevel;
          q.push(nx, ny, nz, nextLevel);
        }
      }
    }
  }

  _rebuildBlockLightBox(rawX0, rawY0, rawZ0, rawX1, rawY1, rawZ1) {
    const x0 = Math.max(0, rawX0);
    const x1 = Math.min(this.sizeX - 1, rawX1);
    const y0 = Math.max(0, rawY0);
    const y1 = Math.min(this.sizeY - 1, rawY1);
    const z0 = Math.max(0, rawZ0);
    const z1 = Math.min(this.sizeZ - 1, rawZ1);
    if (x0 > x1 || y0 > y1 || z0 > z1) return;

    this._propX0 = x0;
    this._propX1 = x1;
    this._propY0 = y0;
    this._propY1 = y1;
    this._propZ0 = z0;
    this._propZ1 = z1;

    const br = this.blockLightR;
    const bg = this.blockLightG;
    const bb = this.blockLightB;
    const bm = this.blockLight;

    // Full wipe of the prop region — no annulus re-import of stale RGB.
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          this._clearRgb(br, bg, bb, bm, this._index(x, y, z));
        }
      }
    }

    this._blockQueue.length = 0;

    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          const id = this.grid.get(x, y, z);
          const emit = getLightLevel(id);
          if (emit <= 0) continue;
          const idx = this._index(x, y, z);
          const level = this._seedRgb(br, bg, bb, bm, idx, emit, getLightColor(id));
          this._blockQueue.push(x, y, z, level);
        }
      }
    }

    if (this._blockQueue.length === 0) return;
    this._propagateStaticBlockIncrease();
  }

  _propagateStaticBlockIncrease() {
    const falloff = LIGHTING.blockLightFalloff;
    const q = this._blockQueue;
    const br = this.blockLightR;
    const bg = this.blockLightG;
    const bb = this.blockLightB;
    const bm = this.blockLight;
    const x0 = this._propX0 ?? 0;
    const x1 = this._propX1 ?? this.sizeX - 1;
    const y0 = this._propY0 ?? 0;
    const y1 = this._propY1 ?? this.sizeY - 1;
    const z0 = this._propZ0 ?? 0;
    const z1 = this._propZ1 ?? this.sizeZ - 1;

    for (let i = 0; i < q.length; i += 4) {
      const x = q[i];
      const y = q[i + 1];
      const z = q[i + 2];
      const idx = this._index(x, y, z);
      const level = bm[idx];
      if (level <= falloff) continue;

      const [nextR, nextG, nextB] = attenuateRgb(br[idx], bg[idx], bb[idx], falloff);
      if (nextR <= 0 && nextG <= 0 && nextB <= 0) continue;

      for (const [dx, dy, dz] of FACE_DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (nx < x0 || nx > x1 || ny < y0 || ny > y1 || nz < z0 || nz > z1) continue;

        const nidx = this._index(nx, ny, nz);
        if (this._raiseRgb(br, bg, bb, bm, nidx, nextR, nextG, nextB)) {
          if (!blocksBlockLight(this.grid.get(nx, ny, nz))) {
            q.push(nx, ny, nz, bm[nidx]);
          }
        }
      }
    }
  }
}
