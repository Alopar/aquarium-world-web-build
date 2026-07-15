import * as THREE from 'three';
import { CHUNK_SIZE, LIGHTING, MAX_CHUNKS_REBUILD_PER_FRAME, VOXEL_SIZE } from '../constants.js';
import { getMaterial, isOpaque, listSolidMaterials } from '../materials/registry.js';
import { createVoxelBrightnessMaterial } from '../shaders/voxel-brightness-material.js';
import { sampleFaceBrightnessBlend } from '../lighting/brightness-sampling.js';

const FACE_DEFS = [
  { dir: [1, 0, 0], normal: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], uv: (x, y, z, c) => [y + c[1], z + c[2]] },
  { dir: [-1, 0, 0], normal: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], uv: (x, y, z, c) => [z + c[2], y + c[1]] },
  { dir: [0, 1, 0], normal: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], uv: (x, y, z, c) => [x + c[0], z + c[2]] },
  { dir: [0, -1, 0], normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uv: (x, y, z, c) => [x + c[0], z + c[2]] },
  { dir: [0, 0, 1], normal: [0, 0, 1], corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], uv: (x, y, z, c) => [x + c[0], y + c[1]] },
  { dir: [0, 0, -1], normal: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], uv: (x, y, z, c) => [x + c[0], y + c[1]] },
];

function chunkKey(cx, cy, cz) {
  return `${cx},${cy},${cz}`;
}

function shouldRenderFace(grid, x, y, z, nx, ny, nz) {
  if (!grid.inBounds(nx, ny, nz)) return true;
  const neighborId = grid.get(nx, ny, nz);
  if (neighborId === 'air') return true;
  return !isOpaque(neighborId);
}

function createMeshMaterial(materialDef) {
  return createVoxelBrightnessMaterial(materialDef);
}

function getFaceLight(lighting, blend, x, y, z, face) {
  return sampleFaceBrightnessBlend(lighting, blend, x, y, z, face.dir);
}

function getOrCreateBuffer(buffers, key) {
  if (!buffers.has(key)) {
    buffers.set(key, {
      positions: [],
      normals: [],
      uvs: [],
      colors: [],
      skies: [],
      prevBlocks: [],
      prevSkies: [],
      blendStarts: [],
      indices: [],
    });
  }
  return buffers.get(key);
}

function buildChunkBuffers(grid, lighting, blend, cx, cy, cz, chunkSize) {
  const buffers = new Map();
  const x0 = cx * chunkSize;
  const y0 = cy * chunkSize;
  const z0 = cz * chunkSize;
  const x1 = Math.min(x0 + chunkSize, grid.size.x);
  const y1 = Math.min(y0 + chunkSize, grid.size.y);
  const z1 = Math.min(z0 + chunkSize, grid.size.z);

  for (let x = x0; x < x1; x++) {
    for (let y = y0; y < y1; y++) {
      for (let z = z0; z < z1; z++) {
        const id = grid.get(x, y, z);
        const matDef = getMaterial(id);
        if (!matDef.solid) continue;

        const buf = getOrCreateBuffer(buffers, id);

        for (const face of FACE_DEFS) {
          const nx = x + face.dir[0];
          const ny = y + face.dir[1];
          const nz = z + face.dir[2];
          if (!shouldRenderFace(grid, x, y, z, nx, ny, nz)) continue;

          const faceLight = getFaceLight(lighting, blend, x, y, z, face);
          const base = buf.positions.length / 3;
          for (const corner of face.corners) {
            buf.positions.push(
              (x + corner[0]) * VOXEL_SIZE,
              (y + corner[1]) * VOXEL_SIZE,
              (z + corner[2]) * VOXEL_SIZE,
            );
            buf.normals.push(...face.normal);

            const [du, dv] = face.uv(x, y, z, corner);
            buf.uvs.push(du, dv);
            buf.colors.push(faceLight.blockR, faceLight.blockG, faceLight.blockB);
            buf.skies.push(faceLight.sky);
            buf.prevBlocks.push(faceLight.prevBlockR, faceLight.prevBlockG, faceLight.prevBlockB);
            buf.prevSkies.push(faceLight.prevSky);
            buf.blendStarts.push(faceLight.blendStart);
          }

          buf.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
  }

  return buffers;
}

function createMeshFromBuffer(buf, key, threeMaterials, name) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buf.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buf.normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(buf.colors, 3));
  geometry.setAttribute('aSky', new THREE.Float32BufferAttribute(buf.skies, 1));
  geometry.setAttribute('aPrevBlock', new THREE.Float32BufferAttribute(buf.prevBlocks, 3));
  geometry.setAttribute('aPrevSky', new THREE.Float32BufferAttribute(buf.prevSkies, 1));
  geometry.setAttribute('aBlendStart', new THREE.Float32BufferAttribute(buf.blendStarts, 1));
  geometry.setIndex(buf.indices);
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, threeMaterials.get(key));
  mesh.name = name;
  return mesh;
}

function applyBuffersToChunk(chunk, buffers, threeMaterials, cx, cy, cz, chunkSize) {
  for (const mesh of chunk.meshes.values()) {
    mesh.geometry.dispose();
    chunk.group.remove(mesh);
  }
  chunk.meshes.clear();

  for (const [key, buf] of buffers) {
    if (buf.positions.length === 0) continue;

    const mesh = createMeshFromBuffer(buf, key, threeMaterials, `chunk-${cx},${cy},${cz}-${key}`);
    chunk.meshes.set(key, mesh);
    chunk.group.add(mesh);
  }

  const s = chunkSize * VOXEL_SIZE;
  chunk.cx = cx;
  chunk.cy = cy;
  chunk.cz = cz;
  chunk.boxMin = [cx * s, cy * s, cz * s];
  chunk.boxMax = [(cx + 1) * s, (cy + 1) * s, (cz + 1) * s];
  chunk.hasGeometry = chunk.meshes.size > 0;
  chunk.group.frustumCulled = false;
  chunk.group.visible = chunk.hasGeometry;
}

export class MeshBuilder {
  constructor(grid, {
    chunkSize = CHUNK_SIZE,
    maxChunksPerFrame = MAX_CHUNKS_REBUILD_PER_FRAME,
    lambertTerrain = false,
    lighting = null,
    brightnessBlend = null,
  } = {}) {
    this.grid = grid;
    this.lighting = lighting;
    this.brightnessBlend = brightnessBlend;
    this.chunkSize = chunkSize;
    this.maxChunksPerFrame = maxChunksPerFrame;
    this.lambertTerrain = lambertTerrain;
    this.group = new THREE.Group();
    this.group.name = 'voxel-meshes';
    this.chunks = new Map();
    this.threeMaterials = new Map();
    this.dirtyChunks = new Set();
    this.flushScheduled = false;
    this.flushFrameId = null;
    this.chunksRebuiltLastFrame = 0;
    this._statsCache = null;
    this._statsCacheFrame = 0;
    this._statsFrameCounter = 0;

    const { x: sx, y: sy, z: sz } = grid.size;
    this.chunksX = Math.ceil(sx / chunkSize);
    this.chunksY = Math.ceil(sy / chunkSize);
    this.chunksZ = Math.ceil(sz / chunkSize);

    this._initMaterials();
  }

  _initMaterials() {
    for (const mat of this.threeMaterials.values()) {
      mat.dispose();
    }
    this.threeMaterials.clear();

    for (const mat of listSolidMaterials()) {
      this.threeMaterials.set(mat.id, createMeshMaterial(mat));
    }
  }

  setLambertTerrain(_useLambert) {
    // MC brightness path ignores PBR/Lambert — no-op for compatibility.
  }

  _clearChunkMeshes() {
    for (const chunk of this.chunks.values()) {
      for (const mesh of chunk.meshes.values()) {
        mesh.geometry.dispose();
        chunk.group.remove(mesh);
      }
      chunk.meshes.clear();
      chunk.hasGeometry = false;
      chunk.group.visible = false;
    }
  }

  markDirtyAt(x, y, z) {
    const s = this.chunkSize;
    const cx = Math.floor(x / s);
    const cy = Math.floor(y / s);
    const cz = Math.floor(z / s);

    this.markChunkDirty(cx, cy, cz);

    const lx = x - cx * s;
    const ly = y - cy * s;
    const lz = z - cz * s;

    if (lx === 0) this.markChunkDirty(cx - 1, cy, cz);
    if (lx === s - 1) this.markChunkDirty(cx + 1, cy, cz);
    if (ly === 0) this.markChunkDirty(cx, cy - 1, cz);
    if (ly === s - 1) this.markChunkDirty(cx, cy + 1, cz);
    if (lz === 0) this.markChunkDirty(cx, cy, cz - 1);
    if (lz === s - 1) this.markChunkDirty(cx, cy, cz + 1);

    this.scheduleFlush();
  }

  /** Mark all chunks intersecting a voxel-radius around (x,y,z). */
  markDirtyInRadius(x, y, z, radius = LIGHTING.maxLevel) {
    const s = this.chunkSize;
    const cx0 = Math.floor((x - radius) / s);
    const cx1 = Math.floor((x + radius) / s);
    const cy0 = Math.floor((y - radius) / s);
    const cy1 = Math.floor((y + radius) / s);
    const cz0 = Math.floor((z - radius) / s);
    const cz1 = Math.floor((z + radius) / s);

    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cz = cz0; cz <= cz1; cz++) {
          this.markChunkDirty(cx, cy, cz);
        }
      }
    }

    this.scheduleFlush();
  }

  /** Mark all Y slices in a 3×3 column neighborhood (after skylight column rebuild). */
  markDirtyColumnsAt(x, z) {
    const s = this.chunkSize;
    const cx0 = Math.floor((x - 1) / s);
    const cx1 = Math.floor((x + 1) / s);
    const cz0 = Math.floor((z - 1) / s);
    const cz1 = Math.floor((z + 1) / s);

    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        for (let cy = 0; cy < this.chunksY; cy++) {
          this.markChunkDirty(cx, cy, cz);
        }
      }
    }

    this.scheduleFlush();
  }

  markChunkDirty(cx, cy, cz) {
    if (cx < 0 || cy < 0 || cz < 0) return;
    if (cx >= this.chunksX || cy >= this.chunksY || cz >= this.chunksZ) return;
    this.dirtyChunks.add(chunkKey(cx, cy, cz));
  }

  scheduleFlush() {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    this.flushFrameId = requestAnimationFrame(() => this.flush());
  }

  cancelScheduledFlush() {
    if (this.flushFrameId != null) {
      cancelAnimationFrame(this.flushFrameId);
      this.flushFrameId = null;
    }
    this.flushScheduled = false;
  }

  flush(maxPerFrame = this.maxChunksPerFrame) {
    this.flushScheduled = false;
    this.flushFrameId = null;
    this.chunksRebuiltLastFrame = 0;

    let processed = 0;
    for (const key of this.dirtyChunks) {
      if (processed >= maxPerFrame) break;
      this.dirtyChunks.delete(key);
      const [cx, cy, cz] = key.split(',').map(Number);
      this.rebuildChunk(cx, cy, cz);
      processed++;
      this.chunksRebuiltLastFrame++;
    }

    if (processed > 0) {
      this._statsCache = null;
    }

    if (this.dirtyChunks.size > 0) {
      this.scheduleFlush();
    }
  }

  getOrCreateChunk(cx, cy, cz) {
    const key = chunkKey(cx, cy, cz);
    if (!this.chunks.has(key)) {
      const group = new THREE.Group();
      group.name = `chunk-${key}`;
      this.group.add(group);
      this.chunks.set(key, {
        group,
        meshes: new Map(),
        cx,
        cy,
        cz,
        hasGeometry: false,
        boxMin: [0, 0, 0],
        boxMax: [0, 0, 0],
      });
    }
    return this.chunks.get(key);
  }

  rebuildChunk(cx, cy, cz) {
    const chunk = this.getOrCreateChunk(cx, cy, cz);
    const buffers = buildChunkBuffers(
      this.grid,
      this.lighting,
      this.brightnessBlend,
      cx,
      cy,
      cz,
      this.chunkSize,
    );
    applyBuffersToChunk(chunk, buffers, this.threeMaterials, cx, cy, cz, this.chunkSize);
  }

  rebuildAll() {
    this.cancelScheduledFlush();
    this.dirtyChunks.clear();
    this._statsCache = null;

    for (let cx = 0; cx < this.chunksX; cx++) {
      for (let cy = 0; cy < this.chunksY; cy++) {
        for (let cz = 0; cz < this.chunksZ; cz++) {
          this.rebuildChunk(cx, cy, cz);
        }
      }
    }
  }

  _computeMeshStats() {
    let meshCount = 0;
    let vertices = 0;
    let triangles = 0;

    for (const chunk of this.chunks.values()) {
      for (const mesh of chunk.meshes.values()) {
        if (!mesh.visible) continue;
        meshCount++;
        const geo = mesh.geometry;
        const posCount = geo.attributes.position?.count ?? 0;
        vertices += posCount;
        if (geo.index) {
          triangles += geo.index.count / 3;
        } else {
          triangles += posCount / 3;
        }
      }
    }

    return {
      meshCount,
      vertices,
      triangles,
      chunkCount: this.chunks.size,
      dirtyChunks: this.dirtyChunks.size,
      chunksRebuiltLastFrame: this.chunksRebuiltLastFrame,
      materialCount: this.threeMaterials.size,
    };
  }

  getStats(force = false) {
    this._statsFrameCounter++;
    const stale = this._statsFrameCounter - this._statsCacheFrame >= 30;
    const needsRefresh = force || !this._statsCache || stale || this.dirtyChunks.size > 0;

    if (needsRefresh) {
      this._statsCache = this._computeMeshStats();
      this._statsCacheFrame = this._statsFrameCounter;
    }

    return {
      ...this._statsCache,
      dirtyChunks: this.dirtyChunks.size,
      chunksRebuiltLastFrame: this.chunksRebuiltLastFrame,
    };
  }

  dispose() {
    this.cancelScheduledFlush();
    this.dirtyChunks.clear();

    for (const chunk of this.chunks.values()) {
      for (const mesh of chunk.meshes.values()) {
        mesh.geometry.dispose();
        chunk.group.remove(mesh);
      }
      this.group.remove(chunk.group);
    }
    this.chunks.clear();

    for (const mat of this.threeMaterials.values()) {
      mat.dispose();
    }
    this.threeMaterials.clear();
  }
}
