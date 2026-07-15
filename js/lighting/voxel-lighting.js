import { LIGHTING } from '../constants.js';
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

/**
 * Voxel lighting — Minecraft-style.
 * Skylight is a white scalar; blocklight is RGB channels (0…maxLevel each).
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
    /** Max of RGB — for probes / debug. */
    this.blockLight = new Uint8Array(this.volume);
    this.blockLightR = new Uint8Array(this.volume);
    this.blockLightG = new Uint8Array(this.volume);
    this.blockLightB = new Uint8Array(this.volume);
    this._skyQueue = [];
    this._blockQueue = [];

    /** @type {number[]} packed x,y,z,flags */
    this._pending = [];
    this._batchDepth = 0;

    /** @type {null | ((box: { minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number }) => void)} */
    this.onAfterFlush = null;
  }

  /** @param {number} x @param {number} y @param {number} z */
  _index(x, y, z) {
    return y * this.sizeX * this.sizeZ + z * this.sizeX + x;
  }

  _syncBlockMax(idx) {
    this.blockLight[idx] = Math.max(
      this.blockLightR[idx],
      this.blockLightG[idx],
      this.blockLightB[idx],
    );
  }

  _clearBlockAt(idx) {
    this.blockLightR[idx] = 0;
    this.blockLightG[idx] = 0;
    this.blockLightB[idx] = 0;
    this.blockLight[idx] = 0;
  }

  /**
   * Seed emitter RGB into a cell; returns max channel for queue.
   * @param {number} idx
   * @param {number} emit
   * @param {{ r: number, g: number, b: number }} color
   */
  _seedBlockRgb(idx, emit, color) {
    const r = Math.round(emit * color.r);
    const g = Math.round(emit * color.g);
    const b = Math.round(emit * color.b);
    this.blockLightR[idx] = r;
    this.blockLightG[idx] = g;
    this.blockLightB[idx] = b;
    this._syncBlockMax(idx);
    return this.blockLight[idx];
  }

  /**
   * Raise cell RGB from imported channel values; returns whether anything grew.
   * @param {number} idx
   * @param {number} r
   * @param {number} g
   * @param {number} b
   */
  _raiseBlockRgb(idx, r, g, b) {
    let grew = false;
    if (r > this.blockLightR[idx]) {
      this.blockLightR[idx] = r;
      grew = true;
    }
    if (g > this.blockLightG[idx]) {
      this.blockLightG[idx] = g;
      grew = true;
    }
    if (b > this.blockLightB[idx]) {
      this.blockLightB[idx] = b;
      grew = true;
    }
    if (grew) this._syncBlockMax(idx);
    return grew;
  }

  getSkylight(x, y, z) {
    if (!this.grid.inBounds(x, y, z)) return LIGHTING.maxLevel;
    return this.skylight[this._index(x, y, z)];
  }

  getBlockLight(x, y, z) {
    if (!this.grid.inBounds(x, y, z)) return 0;
    return this.blockLight[this._index(x, y, z)];
  }

  /** @returns {{ r: number, g: number, b: number }} levels 0…maxLevel */
  getBlockLightRgb(x, y, z) {
    if (!this.grid.inBounds(x, y, z)) return { r: 0, g: 0, b: 0 };
    const i = this._index(x, y, z);
    return {
      r: this.blockLightR[i],
      g: this.blockLightG[i],
      b: this.blockLightB[i],
    };
  }

  /** Fast probe — is there any block light in a small neighborhood? */
  hasBlockLightNear(x, y, z, radius = 1) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const nx = x + dx;
          const ny = y + dy;
          const nz = z + dz;
          if (!this.grid.inBounds(nx, ny, nz)) continue;
          if (this.blockLight[this._index(nx, ny, nz)] > 0) return true;
        }
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

  /**
   * Queue a solid edit for lighting. Flushes immediately unless inside beginBatch/endBatch.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {{ skyDecrease?: boolean, blockLight?: boolean }} [opts]
   */
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
    this._pending.length = 0;

    for (let x = 0; x < this.sizeX; x++) {
      for (let z = 0; z < this.sizeZ; z++) {
        this._seedColumnSkylight(x, z);
      }
    }
    this._propagateSkylightFromAllLit();
    this._rebuildBlockLightBox(0, 0, 0, this.sizeX - 1, this.sizeY - 1, this.sizeZ - 1);
  }

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

  /**
   * Dig path: reseed ONLY edited columns (not ±1 — that wiped under-roof flood
   * light in neighbor columns), then pull sky from untouched neighbors and flood.
   */
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

          if (level > this.skylight[idx]) {
            this.skylight[idx] = level;
          }
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

    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          this._clearBlockAt(this._index(x, y, z));
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
          const level = this._seedBlockRgb(idx, emit, getLightColor(id));
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
            const ir = this.blockLightR[nidx] - falloff;
            const ig = this.blockLightG[nidx] - falloff;
            const ib = this.blockLightB[nidx] - falloff;
            if (ir <= 0 && ig <= 0 && ib <= 0) continue;
            const idx = this._index(x, y, z);
            if (this._raiseBlockRgb(idx, Math.max(0, ir), Math.max(0, ig), Math.max(0, ib))) {
              this._blockQueue.push(x, y, z, this.blockLight[idx]);
            }
          }
        }
      }
    }

    if (this._blockQueue.length === 0) return;
    this._propagateBlockIncrease();
  }

  _propagateBlockIncrease() {
    const falloff = LIGHTING.blockLightFalloff;
    const q = this._blockQueue;
    const br = this.blockLightR;
    const bg = this.blockLightG;
    const bb = this.blockLightB;

    for (let i = 0; i < q.length; i += 4) {
      const x = q[i];
      const y = q[i + 1];
      const z = q[i + 2];
      const idx = this._index(x, y, z);
      const level = this.blockLight[idx];
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
        if (this._raiseBlockRgb(nidx, nextR, nextG, nextB)) {
          if (!blocksBlockLight(this.grid.get(nx, ny, nz))) {
            q.push(nx, ny, nz, this.blockLight[nidx]);
          }
        }
      }
    }
  }
}
