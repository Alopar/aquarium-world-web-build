import * as THREE from 'three';
import { CHUNK_SIZE, MAX_CHUNKS_REBUILD_PER_FRAME, VOXEL_SIZE } from '../constants.js';
import { getMaterial } from '../materials/registry.js';
import { getGas } from '../gases/registry.js';
import { VertexScratch, applyScratchToGeometry } from './mesh-buffer-pool.js';

const FACE_NEIGHBORS = [
  { dir: [1, 0, 0], normal: [1, 0, 0] },
  { dir: [-1, 0, 0], normal: [-1, 0, 0] },
  { dir: [0, 1, 0], normal: [0, 1, 0] },
  { dir: [0, -1, 0], normal: [0, -1, 0] },
  { dir: [0, 0, 1], normal: [0, 0, 1] },
  { dir: [0, 0, -1], normal: [0, 0, -1] },
];

function chunkKey(cx, cy, cz) {
  return `${cx},${cy},${cz}`;
}

function shouldRenderGasFace(grid, nx, ny, nz) {
  if (!grid.inBounds(nx, ny, nz)) return true;
  const neighbor = grid.get(nx, ny, nz);
  if (neighbor === 'air') return true;
  const mat = getMaterial(neighbor);
  return !mat.opaque;
}

function faceCorners(x0, y0, z0, x1, y1, z1, dir) {
  if (dir[0] === 1) {
    return [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]];
  }
  if (dir[0] === -1) {
    return [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]];
  }
  if (dir[1] === 1) {
    return [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]];
  }
  if (dir[1] === -1) {
    return [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]];
  }
  if (dir[2] === 1) {
    return [[x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1]];
  }
  return [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]];
}

function buildGasChunkScratch(scratch, grid, gasField, cx, cy, cz, chunkSize) {
  scratch.reset();
  const gas = getGas('smoke');
  const maxV = gas?.maxVolume ?? 1000;
  const smokeMat = getMaterial('smoke');
  const baseOpacity = smokeMat.opacity ?? 0.55;
  const color = new THREE.Color(smokeMat.color ?? 0xd4dae3);

  const x0 = cx * chunkSize;
  const y0 = cy * chunkSize;
  const z0 = cz * chunkSize;
  const x1 = Math.min(x0 + chunkSize, grid.size.x);
  const y1 = Math.min(y0 + chunkSize, grid.size.y);
  const z1 = Math.min(z0 + chunkSize, grid.size.z);

  for (let x = x0; x < x1; x++) {
    for (let y = y0; y < y1; y++) {
      for (let z = z0; z < z1; z++) {
        if (grid.get(x, y, z) !== 'smoke') continue;
        const volume = gasField.getVolume(x, y, z);
        if (volume <= 0) continue;

        const fill = Math.min(1, volume / maxV);
        const alpha = baseOpacity * (0.35 + fill * 0.65);
        const r = color.r * alpha;
        const g = color.g * alpha;
        const b = color.b * alpha;

        const vx0 = x * VOXEL_SIZE;
        const vy0 = y * VOXEL_SIZE;
        const vz0 = z * VOXEL_SIZE;
        const vx1 = vx0 + VOXEL_SIZE;
        const vy1 = vy0 + VOXEL_SIZE;
        const vz1 = vz0 + VOXEL_SIZE;

        for (const { dir, normal } of FACE_NEIGHBORS) {
          const nx = x + dir[0];
          const ny = y + dir[1];
          const nz = z + dir[2];
          if (!shouldRenderGasFace(grid, nx, ny, nz)) continue;

          const base = scratch.vertexCount;
          const corners = faceCorners(vx0, vy0, vz0, vx1, vy1, vz1, dir);
          const [nnx, nny, nnz] = normal;
          for (const c of corners) {
            scratch.pushVertex(c[0], c[1], c[2], nnx, nny, nnz, 0, 0, r, g, b);
          }
          scratch.pushIndexQuad(base);
        }
      }
    }
  }
}

/** Semi-transparent voxel faces for smoke cells (chunked + budgeted remesh). */
export class GasMeshBuilder {
  constructor(grid, gasField, {
    chunkSize = CHUNK_SIZE,
    maxChunksPerFrame = MAX_CHUNKS_REBUILD_PER_FRAME,
  } = {}) {
    this.grid = grid;
    this.gasField = gasField;
    this.chunkSize = chunkSize;
    this.maxChunksPerFrame = maxChunksPerFrame;
    this.group = new THREE.Group();
    this.group.name = 'gas-meshes';

    this.material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.chunks = new Map();
    this.dirtyChunks = new Set();
    this.flushScheduled = false;
    this.flushFrameId = null;
    this._scratch = new VertexScratch({ hasColors: true });

    const { x: sx, y: sy, z: sz } = grid.size;
    this.chunksX = Math.ceil(sx / chunkSize);
    this.chunksY = Math.ceil(sy / chunkSize);
    this.chunksZ = Math.ceil(sz / chunkSize);
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

    let processed = 0;
    for (const key of this.dirtyChunks) {
      if (processed >= maxPerFrame) break;
      this.dirtyChunks.delete(key);
      const [cx, cy, cz] = key.split(',').map(Number);
      this.rebuildChunk(cx, cy, cz);
      processed++;
    }

    if (this.dirtyChunks.size > 0) {
      this.scheduleFlush();
    }
  }

  getOrCreateChunk(cx, cy, cz) {
    const key = chunkKey(cx, cy, cz);
    if (!this.chunks.has(key)) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
      mesh.name = `gas-chunk-${key}`;
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.group.add(mesh);
      this.chunks.set(key, { mesh, cx, cy, cz });
    }
    return this.chunks.get(key);
  }

  rebuildChunk(cx, cy, cz) {
    const chunk = this.getOrCreateChunk(cx, cy, cz);
    buildGasChunkScratch(
      this._scratch,
      this.grid,
      this.gasField,
      cx,
      cy,
      cz,
      this.chunkSize,
    );

    if (this._scratch.posCount === 0) {
      chunk.mesh.geometry.setDrawRange(0, 0);
      chunk.mesh.visible = false;
      return;
    }

    applyScratchToGeometry(chunk.mesh.geometry, this._scratch);
    chunk.mesh.visible = true;
  }

  rebuildAll() {
    this.cancelScheduledFlush();
    this.dirtyChunks.clear();

    for (let cx = 0; cx < this.chunksX; cx++) {
      for (let cy = 0; cy < this.chunksY; cy++) {
        for (let cz = 0; cz < this.chunksZ; cz++) {
          this.rebuildChunk(cx, cy, cz);
        }
      }
    }
  }

  dispose() {
    this.cancelScheduledFlush();
    this.dirtyChunks.clear();
    for (const chunk of this.chunks.values()) {
      chunk.mesh.geometry.dispose();
      this.group.remove(chunk.mesh);
    }
    this.chunks.clear();
    this.material.dispose();
  }
}
