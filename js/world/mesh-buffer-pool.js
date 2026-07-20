import * as THREE from 'three';

/**
 * Grow-only typed scratch for voxel meshing (positions / normals / uvs / colors / surfaces / indices).
 */
export class VertexScratch {
  constructor({
    hasUvs = false,
    hasColors = false,
    hasSurfaces = false,
  } = {}) {
    this.hasUvs = hasUvs;
    this.hasColors = hasColors;
    this.hasSurfaces = hasSurfaces;
    this.positions = new Float32Array(192);
    this.normals = new Float32Array(192);
    this.uvs = hasUvs ? new Float32Array(128) : null;
    this.colors = hasColors ? new Float32Array(192) : null;
    this.surfaces = hasSurfaces ? new Float32Array(64) : null;
    this.indices = new Uint32Array(128);
    this.posCount = 0;
    this.uvCount = 0;
    this.colorCount = 0;
    this.surfaceCount = 0;
    this.idxCount = 0;
  }

  reset() {
    this.posCount = 0;
    this.uvCount = 0;
    this.colorCount = 0;
    this.surfaceCount = 0;
    this.idxCount = 0;
  }

  get vertexCount() {
    return this.posCount / 3;
  }

  _growFloat(arr, needed) {
    if (needed <= arr.length) return arr;
    let cap = arr.length || 64;
    while (cap < needed) cap *= 2;
    const next = new Float32Array(cap);
    next.set(arr);
    return next;
  }

  _growIndex(needed) {
    if (needed <= this.indices.length) return;
    let cap = this.indices.length || 64;
    while (cap < needed) cap *= 2;
    const next = new Uint32Array(cap);
    next.set(this.indices);
    this.indices = next;
  }

  ensureVerts(extra) {
    const need = this.posCount + extra * 3;
    this.positions = this._growFloat(this.positions, need);
    this.normals = this._growFloat(this.normals, need);
    if (this.hasUvs) {
      this.uvs = this._growFloat(this.uvs, this.uvCount + extra * 2);
    }
    if (this.hasColors) {
      this.colors = this._growFloat(this.colors, this.colorCount + extra * 3);
    }
    if (this.hasSurfaces) {
      this.surfaces = this._growFloat(this.surfaces, this.surfaceCount + extra);
    }
  }

  ensureIndices(extra) {
    this._growIndex(this.idxCount + extra);
  }

  pushVertex(px, py, pz, nx, ny, nz, u = 0, v = 0, r = 0, g = 0, b = 0, surface = 0) {
    this.ensureVerts(1);
    const pi = this.posCount;
    this.positions[pi] = px;
    this.positions[pi + 1] = py;
    this.positions[pi + 2] = pz;
    this.normals[pi] = nx;
    this.normals[pi + 1] = ny;
    this.normals[pi + 2] = nz;
    this.posCount += 3;

    if (this.hasUvs) {
      this.uvs[this.uvCount] = u;
      this.uvs[this.uvCount + 1] = v;
      this.uvCount += 2;
    }
    if (this.hasColors) {
      this.colors[this.colorCount] = r;
      this.colors[this.colorCount + 1] = g;
      this.colors[this.colorCount + 2] = b;
      this.colorCount += 3;
    }
    if (this.hasSurfaces) {
      this.surfaces[this.surfaceCount++] = surface;
    }
  }

  pushIndexQuad(base) {
    this.ensureIndices(6);
    const i = this.idxCount;
    this.indices[i] = base;
    this.indices[i + 1] = base + 1;
    this.indices[i + 2] = base + 2;
    this.indices[i + 3] = base;
    this.indices[i + 4] = base + 2;
    this.indices[i + 5] = base + 3;
    this.idxCount += 6;
  }

  pushIndexTri(a, b, c) {
    this.ensureIndices(3);
    const i = this.idxCount;
    this.indices[i] = a;
    this.indices[i + 1] = b;
    this.indices[i + 2] = c;
    this.idxCount += 3;
  }
}

/**
 * Ensure BufferAttribute capacity and copy scratch floats.
 * @param {THREE.BufferGeometry} geometry
 * @param {string} name
 * @param {Float32Array} src
 * @param {number} count floats to copy
 * @param {number} itemSize
 */
function setFloatAttr(geometry, name, src, count, itemSize) {
  let attr = geometry.getAttribute(name);
  if (!attr || attr.array.length < count) {
    let cap = Math.max(count, 64);
    if (attr) {
      while (cap < count) cap *= 2;
    }
    attr = new THREE.BufferAttribute(new Float32Array(cap), itemSize);
    geometry.setAttribute(name, attr);
  }
  attr.array.set(src.subarray(0, count));
  attr.needsUpdate = true;
  attr.updateRange.offset = 0;
  attr.updateRange.count = count;
}

/**
 * Apply scratch buffers onto an existing BufferGeometry (reuse attributes).
 * Draw count is controlled via setDrawRange (indexed).
 * @param {THREE.BufferGeometry} geometry
 * @param {VertexScratch} scratch
 */
export function applyScratchToGeometry(geometry, scratch) {
  if (scratch.posCount === 0) {
    geometry.setDrawRange(0, 0);
    if (!geometry.boundingSphere) geometry.boundingSphere = new THREE.Sphere();
    geometry.boundingSphere.radius = 0;
    return;
  }

  setFloatAttr(geometry, 'position', scratch.positions, scratch.posCount, 3);
  setFloatAttr(geometry, 'normal', scratch.normals, scratch.posCount, 3);

  if (scratch.hasUvs) {
    setFloatAttr(geometry, 'uv', scratch.uvs, scratch.uvCount, 2);
  }
  if (scratch.hasColors) {
    setFloatAttr(geometry, 'color', scratch.colors, scratch.colorCount, 3);
  }
  if (scratch.hasSurfaces) {
    setFloatAttr(geometry, 'aSurface', scratch.surfaces, scratch.surfaceCount, 1);
  }

  let index = geometry.getIndex();
  if (!index || index.array.length < scratch.idxCount) {
    let cap = Math.max(scratch.idxCount, 64);
    if (index) {
      while (cap < scratch.idxCount) cap *= 2;
    }
    index = new THREE.BufferAttribute(new Uint32Array(cap), 1);
    geometry.setIndex(index);
  }
  index.array.set(scratch.indices.subarray(0, scratch.idxCount));
  index.needsUpdate = true;
  index.updateRange.offset = 0;
  index.updateRange.count = scratch.idxCount;

  geometry.setDrawRange(0, scratch.idxCount);

  // Bound only used vertices (attribute capacity may be larger / zero-padded).
  const pos = scratch.positions;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < scratch.posCount; i += 3) {
    const x = pos[i];
    const y = pos[i + 1];
    const z = pos[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (!geometry.boundingSphere) geometry.boundingSphere = new THREE.Sphere();
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  let radiusSq = 0;
  for (let i = 0; i < scratch.posCount; i += 3) {
    const dx = pos[i] - cx;
    const dy = pos[i + 1] - cy;
    const dz = pos[i + 2] - cz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > radiusSq) radiusSq = d;
  }
  geometry.boundingSphere.center.set(cx, cy, cz);
  geometry.boundingSphere.radius = Math.sqrt(radiusSq);
}

/**
 * Pool of VertexScratch buffers keyed by material id (or other string key).
 */
export class ScratchPool {
  /**
   * @param {{ hasUvs?: boolean, hasColors?: boolean, hasSurfaces?: boolean }} opts
   */
  constructor(opts = {}) {
    this.opts = opts;
    /** @type {Map<string, VertexScratch>} */
    this._map = new Map();
  }

  beginFrame() {
    for (const scratch of this._map.values()) {
      scratch.reset();
    }
  }

  /**
   * @param {string} key
   * @returns {VertexScratch}
   */
  get(key) {
    let scratch = this._map.get(key);
    if (!scratch) {
      scratch = new VertexScratch(this.opts);
      this._map.set(key, scratch);
    }
    return scratch;
  }

  /** Keys that received geometry this build. */
  *entries() {
    for (const [key, scratch] of this._map) {
      if (scratch.posCount > 0 || scratch.idxCount > 0) {
        yield [key, scratch];
      }
    }
  }
}
