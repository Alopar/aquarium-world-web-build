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
  return mat.solid === true && mat.opaque === true && mat.organic !== true;
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
 * Voxel lighting — three channels:
 *   skylight (scalar) | blockLight RGB (static emitters) | dynamicLight RGB (transient)
 * Display / gameplay sample = max(block, dynamic).
 * Meshes bake only static block + sky; dynamic is sampled from a 3D texture in shaders.
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

    /** Static block emitters (baked into mesh attributes). */
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
    this._blockQueue = [];
    this._dynQueue = [];

    /** @type {number[]} packed x,y,z,flags */
    this._pending = [];
    this._batchDepth = 0;

    /** @type {Map<string, object>} */
    this._dynamicSources = new Map();
    this._dynamicSeq = 0;
    this._dynSourcesDirty = false;
    this._decayAcc = 0;
    this._texDirty = false;

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

  beginBatch() {
    this._batchDepth++;
  }

  endBatch() {
    this._batchDepth = Math.max(0, this._batchDepth - 1);
    if (this._batchDepth === 0) this.flushPending();
  }

  markDirtyAt(x, y, z, { skyDecrease = false, blockLight = true } = {}) {
    let flags = 0;
    if (skyDecrease) flags |= 1;
    if (blockLight) flags |= 2;
    this._pending.push(x, y, z, flags);
    if (this._batchDepth === 0) this.flushPending();
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
    let anyBlock = false;

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
      if (flags & 1) anySkyDecrease = true;
      if (flags & 2) anyBlock = true;
    }
    p.length = 0;

    const r = LIGHTING.maxLevel;

    if (anySkyDecrease) {
      this._rebuildSkylightBox(minX - r, minY - r, minZ - r, maxX + r, maxY + r, maxZ + r);
    } else {
      this._skylightIncreaseFromEdits(minX, minY, minZ, maxX, maxY, maxZ);
    }

    if (anyBlock) {
      this._rebuildBlockLightBox(minX - r, minY - r, minZ - r, maxX + r, maxY + r, maxZ + r);
    }

    this.onAfterFlush?.({
      minX: minX - r,
      minY: minY - r,
      minZ: minZ - r,
      maxX: maxX + r,
      maxY: maxY + r,
      maxZ: maxZ + r,
    });
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
   * Decay marked dynamic cells, then raise from sustained sources.
   * No mesh remesh — GPU reads dynamicTexture.
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
      let r = dr[idx];
      let g = dg[idx];
      let b = db[idx];
      if (r > 0) r--;
      if (g > 0) g--;
      if (b > 0) b--;
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
      }
    }

    for (let i = 0; i < q.length; i += 3) {
      const x = q[i];
      const y = q[i + 1];
      const z = q[i + 2];
      const idx = this._index(x, y, z);
      if (dm[idx] <= falloff) continue;

      const nextR = dr[idx] > falloff ? dr[idx] - falloff : 0;
      const nextG = dg[idx] > falloff ? dg[idx] - falloff : 0;
      const nextB = db[idx] > falloff ? db[idx] - falloff : 0;
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
  }

  _rebuildSkylightBox(rawX0, rawY0, rawZ0, rawX1, rawY1, rawZ1) {
    const x0 = Math.max(0, rawX0);
    const x1 = Math.min(this.sizeX - 1, rawX1);
    const y0 = Math.max(0, rawY0);
    const y1 = Math.min(this.sizeY - 1, rawY1);
    const z0 = Math.max(0, rawZ0);
    const z1 = Math.min(this.sizeZ - 1, rawZ1);
    if (x0 > x1 || y0 > y1 || z0 > z1) return;

    const falloff = LIGHTING.blockLightFalloff;

    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          this.skylight[this._index(x, y, z)] = 0;
        }
      }
    }

    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        this._seedColumnSkylight(x, z);
      }
    }

    this._skyQueue.length = 0;

    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          const level = this.skylight[this._index(x, y, z)];
          if (level > 0) this._skyQueue.push(x, y, z, level);
        }
      }
    }

    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          if (blocksSkylight(this.grid.get(x, y, z))) continue;
          for (const [dx, dy, dz] of FACE_DIRS) {
            const nx = x + dx;
            const ny = y + dy;
            const nz = z + dz;
            if (nx >= x0 && nx <= x1 && ny >= y0 && ny <= y1 && nz >= z0 && nz <= z1) continue;

            let imported;
            if (!this.grid.inBounds(nx, ny, nz)) {
              imported = LIGHTING.maxLevel - falloff;
            } else {
              imported = this.skylight[this._index(nx, ny, nz)] - falloff;
            }
            if (imported <= 0) continue;
            const idx = this._index(x, y, z);
            if (imported > this.skylight[idx]) {
              this.skylight[idx] = imported;
              this._skyQueue.push(x, y, z, imported);
            }
          }
        }
      }
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

    const falloff = LIGHTING.blockLightFalloff;
    const br = this.blockLightR;
    const bg = this.blockLightG;
    const bb = this.blockLightB;
    const bm = this.blockLight;

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

    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          for (const [dx, dy, dz] of FACE_DIRS) {
            const nx = x + dx;
            const ny = y + dy;
            const nz = z + dz;
            if (nx >= x0 && nx <= x1 && ny >= y0 && ny <= y1 && nz >= z0 && nz <= z1) continue;
            if (!this.grid.inBounds(nx, ny, nz)) continue;
            const nidx = this._index(nx, ny, nz);
            const ir = br[nidx] - falloff;
            const ig = bg[nidx] - falloff;
            const ib = bb[nidx] - falloff;
            if (ir <= 0 && ig <= 0 && ib <= 0) continue;
            const idx = this._index(x, y, z);
            if (this._raiseRgb(br, bg, bb, bm, idx, Math.max(0, ir), Math.max(0, ig), Math.max(0, ib))) {
              this._blockQueue.push(x, y, z, bm[idx]);
            }
          }
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

    for (let i = 0; i < q.length; i += 4) {
      const x = q[i];
      const y = q[i + 1];
      const z = q[i + 2];
      const idx = this._index(x, y, z);
      const level = bm[idx];
      if (level <= falloff) continue;

      const nextR = br[idx] > falloff ? br[idx] - falloff : 0;
      const nextG = bg[idx] > falloff ? bg[idx] - falloff : 0;
      const nextB = bb[idx] > falloff ? bb[idx] - falloff : 0;
      if (nextR <= 0 && nextG <= 0 && nextB <= 0) continue;

      for (const [dx, dy, dz] of FACE_DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (!this.grid.inBounds(nx, ny, nz)) continue;

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
