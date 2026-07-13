import * as THREE from 'three';
import { CHUNK_SIZE, MAX_CHUNKS_REBUILD_PER_FRAME, VOXEL_SIZE } from '../constants.js';
import { getMaterial, isOpaque, listSolidMaterials } from '../materials/registry.js';
import { getBlockTexture } from '../materials/textures.js';

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
  const texture = materialDef.texture ? getBlockTexture(materialDef.texture) : null;
  const params = {
    color: texture ? 0xffffff : materialDef.color,
    transparent: materialDef.opacity != null && materialDef.opacity < 1,
    opacity: materialDef.opacity ?? 1,
    roughness: 0.92,
  };
  if (texture) {
    params.map = texture;
  }
  if (materialDef.emissive != null) {
    params.emissive = materialDef.emissive;
    params.emissiveIntensity = materialDef.emissiveIntensity ?? 0.6;
  }
  return new THREE.MeshStandardMaterial(params);
}

function buildChunkBuffers(grid, cx, cy, cz, chunkSize) {
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

        for (const face of FACE_DEFS) {
          const [nx, ny, nz] = [x + face.dir[0], y + face.dir[1], z + face.dir[2]];
          if (!shouldRenderFace(grid, x, y, z, nx, ny, nz)) continue;

          if (!buffers.has(id)) {
            buffers.set(id, { positions: [], normals: [], uvs: [], indices: [] });
          }
          const buf = buffers.get(id);
          const base = buf.positions.length / 3;

          for (const corner of face.corners) {
            buf.positions.push(
              (x + corner[0]) * VOXEL_SIZE,
              (y + corner[1]) * VOXEL_SIZE,
              (z + corner[2]) * VOXEL_SIZE,
            );
            buf.normals.push(...face.normal);
            const [u, v] = face.uv(x, y, z, corner);
            buf.uvs.push(u, v);
          }

          buf.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
  }

  return buffers;
}

function applyBuffersToChunk(chunk, buffers, threeMaterials, cx, cy, cz) {
  for (const mesh of chunk.meshes.values()) {
    mesh.geometry.dispose();
    chunk.group.remove(mesh);
  }
  chunk.meshes.clear();

  for (const [id, buf] of buffers) {
    if (buf.positions.length === 0) continue;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(buf.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buf.normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uvs, 2));
    geometry.setIndex(buf.indices);
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, threeMaterials.get(id));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `chunk-${cx},${cy},${cz}-${id}`;
    chunk.meshes.set(id, mesh);
    chunk.group.add(mesh);
  }
}

export class MeshBuilder {
  constructor(grid, {
    chunkSize = CHUNK_SIZE,
    maxChunksPerFrame = MAX_CHUNKS_REBUILD_PER_FRAME,
  } = {}) {
    this.grid = grid;
    this.chunkSize = chunkSize;
    this.maxChunksPerFrame = maxChunksPerFrame;
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

    for (const mat of listSolidMaterials()) {
      this.threeMaterials.set(mat.id, createMeshMaterial(mat));
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
      this.chunks.set(key, { group, meshes: new Map() });
    }
    return this.chunks.get(key);
  }

  rebuildChunk(cx, cy, cz) {
    const chunk = this.getOrCreateChunk(cx, cy, cz);
    const buffers = buildChunkBuffers(this.grid, cx, cy, cz, this.chunkSize);
    applyBuffersToChunk(chunk, buffers, this.threeMaterials, cx, cy, cz);
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
