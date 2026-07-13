import * as THREE from 'three';
import { CHUNK_SIZE, MAX_CHUNKS_REBUILD_PER_FRAME, VOXEL_SIZE } from '../constants.js';
import { isOpaque, listLiquidMaterials } from '../materials/registry.js';
import { getFluid } from '../fluids/registry.js';
import {
  createFluidShaderMaterial,
  updateFluidShaderTime,
} from '../shaders/fluid-material.js';

function chunkKey(cx, cy, cz) {
  return `${cx},${cy},${cz}`;
}

function cornerKey(cx, y, cz) {
  return `${cx},${y},${cz}`;
}

/**
 * Liquid fill height 0…1 for a cell. Fluid with liquid above is treated as full.
 */
function fluidHeightAt(grid, fluidField, fluid, x, y, z) {
  if (!grid.inBounds(x, y, z)) return 0;
  if (grid.get(x, y, z) !== fluid.id) return 0;
  const vol = fluidField.getVolume(x, y, z);
  if (vol <= 0) return 0;

  if (
    grid.inBounds(x, y + 1, z)
    && grid.get(x, y + 1, z) === fluid.id
    && fluidField.getVolume(x, y + 1, z) > 0
  ) {
    return 1;
  }

  return vol / fluid.maxVolume;
}

/** Height at grid corner (cx, cz) on layer y. */
function cornerHeightAt(grid, fluidField, fluid, cx, y, cz) {
  let h = 0;
  for (const dx of [-1, 0]) {
    for (const dz of [-1, 0]) {
      h = Math.max(h, fluidHeightAt(grid, fluidField, fluid, cx + dx, y, cz + dz));
    }
  }
  return h;
}

function isTopSurfaceCell(grid, fluidField, fluid, x, y, z) {
  if (fluidHeightAt(grid, fluidField, fluid, x, y, z) <= 0) return false;

  const nx = x;
  const ny = y + 1;
  const nz = z;
  if (!grid.inBounds(nx, ny, nz)) return true;

  const neighborId = grid.get(nx, ny, nz);
  if (neighborId === fluid.id && fluidField.getVolume(nx, ny, nz) > 0) {
    return false;
  }

  return !isOpaque(neighborId);
}

/**
 * Skip faces hidden by opaque solids or by the same liquid.
 */
function shouldRenderFluidFace(grid, fluidField, fluid, x, y, z, dx, dy, dz) {
  const nx = x + dx;
  const ny = y + dy;
  const nz = z + dz;

  if (!grid.inBounds(nx, ny, nz)) return true;

  const neighborId = grid.get(nx, ny, nz);
  if (neighborId === fluid.id && fluidField.getVolume(nx, ny, nz) > 0) {
    return false;
  }

  return !isOpaque(neighborId);
}

function pushQuad(buf, verts, normal, surface) {
  const base = buf.positions.length / 3;
  for (const [px, py, pz] of verts) {
    buf.positions.push(px, py, pz);
    buf.normals.push(...normal);
    buf.surfaces.push(surface);
  }
  buf.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function getOrCreateCornerVertex(buf, cache, grid, fluidField, fluid, cx, y, cz) {
  const key = cornerKey(cx, y, cz);
  if (cache.has(key)) return cache.get(key);

  const h = cornerHeightAt(grid, fluidField, fluid, cx, y, cz);
  const idx = buf.positions.length / 3;
  buf.positions.push(cx * VOXEL_SIZE, y * VOXEL_SIZE + h * VOXEL_SIZE, cz * VOXEL_SIZE);
  buf.normals.push(0, 1, 0);
  buf.surfaces.push(1);
  cache.set(key, idx);
  return idx;
}

/**
 * One shared top triangle pair per surface cell — no overlapping per-cell quads.
 */
function appendFluidSurfaceCell(buf, cache, grid, fluidField, fluid, x, y, z) {
  if (!isTopSurfaceCell(grid, fluidField, fluid, x, y, z)) return;

  const a = getOrCreateCornerVertex(buf, cache, grid, fluidField, fluid, x, y, z);
  const b = getOrCreateCornerVertex(buf, cache, grid, fluidField, fluid, x + 1, y, z);
  const c = getOrCreateCornerVertex(buf, cache, grid, fluidField, fluid, x + 1, y, z + 1);
  const d = getOrCreateCornerVertex(buf, cache, grid, fluidField, fluid, x, y, z + 1);

  // Winding matches +Y faces (seen from above).
  buf.indices.push(d, c, b, d, b, a);
}

/**
 * Side/bottom walls only — top is built as a unified heightfield per chunk.
 */
function appendFluidBody(buf, grid, fluidField, fluid, x, y, z) {
  const x0 = x * VOXEL_SIZE;
  const y0 = y * VOXEL_SIZE;
  const z0 = z * VOXEL_SIZE;
  const x1 = x0 + VOXEL_SIZE;
  const z1 = z0 + VOXEL_SIZE;

  const h00 = cornerHeightAt(grid, fluidField, fluid, x, y, z);
  const h10 = cornerHeightAt(grid, fluidField, fluid, x + 1, y, z);
  const h11 = cornerHeightAt(grid, fluidField, fluid, x + 1, y, z + 1);
  const h01 = cornerHeightAt(grid, fluidField, fluid, x, y, z + 1);

  const y00 = y0 + h00 * VOXEL_SIZE;
  const y10 = y0 + h10 * VOXEL_SIZE;
  const y11 = y0 + h11 * VOXEL_SIZE;
  const y01 = y0 + h01 * VOXEL_SIZE;

  if (shouldRenderFluidFace(grid, fluidField, fluid, x, y, z, 0, -1, 0)) {
    pushQuad(
      buf,
      [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
      [0, -1, 0],
      0,
    );
  }

  if (shouldRenderFluidFace(grid, fluidField, fluid, x, y, z, 1, 0, 0)) {
    pushQuad(
      buf,
      [[x1, y0, z0], [x1, y10, z0], [x1, y11, z1], [x1, y0, z1]],
      [1, 0, 0],
      0,
    );
  }

  if (shouldRenderFluidFace(grid, fluidField, fluid, x, y, z, -1, 0, 0)) {
    pushQuad(
      buf,
      [[x0, y0, z1], [x0, y01, z1], [x0, y00, z0], [x0, y0, z0]],
      [-1, 0, 0],
      0,
    );
  }

  if (shouldRenderFluidFace(grid, fluidField, fluid, x, y, z, 0, 0, 1)) {
    pushQuad(
      buf,
      [[x1, y0, z1], [x1, y11, z1], [x0, y01, z1], [x0, y0, z1]],
      [0, 0, 1],
      0,
    );
  }

  if (shouldRenderFluidFace(grid, fluidField, fluid, x, y, z, 0, 0, -1)) {
    pushQuad(
      buf,
      [[x0, y0, z0], [x0, y00, z0], [x1, y10, z0], [x1, y0, z0]],
      [0, 0, -1],
      0,
    );
  }
}

function buildFluidChunkBuffers(grid, fluidField, cx, cy, cz, chunkSize) {
  const buffers = new Map();
  const cornerCaches = new Map();
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
        const fluid = getFluid(id);
        if (!fluid) continue;

        const volume = fluidField.getVolume(x, y, z);
        if (volume <= 0) continue;

        if (!buffers.has(id)) {
          buffers.set(id, { positions: [], normals: [], surfaces: [], indices: [] });
          cornerCaches.set(id, new Map());
        }

        const buf = buffers.get(id);
        appendFluidBody(buf, grid, fluidField, fluid, x, y, z);
        appendFluidSurfaceCell(buf, cornerCaches.get(id), grid, fluidField, fluid, x, y, z);
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
    geometry.setAttribute('aSurface', new THREE.Float32BufferAttribute(buf.surfaces, 1));
    geometry.setIndex(buf.indices);
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, threeMaterials.get(id));
    mesh.renderOrder = 1;
    mesh.name = `fluid-chunk-${cx},${cy},${cz}-${id}`;
    chunk.meshes.set(id, mesh);
    chunk.group.add(mesh);
  }
}

export class FluidMeshBuilder {
  constructor(grid, fluidField, {
    chunkSize = CHUNK_SIZE,
    maxChunksPerFrame = MAX_CHUNKS_REBUILD_PER_FRAME,
  } = {}) {
    this.grid = grid;
    this.fluidField = fluidField;
    this.chunkSize = chunkSize;
    this.maxChunksPerFrame = maxChunksPerFrame;
    this.group = new THREE.Group();
    this.group.name = 'fluid-meshes';
    this.chunks = new Map();
    this.threeMaterials = new Map();
    this.dirtyChunks = new Set();
    this.flushScheduled = false;
    this.flushFrameId = null;
    this.elapsed = 0;

    const { x: sx, y: sy, z: sz } = grid.size;
    this.chunksX = Math.ceil(sx / chunkSize);
    this.chunksY = Math.ceil(sy / chunkSize);
    this.chunksZ = Math.ceil(sz / chunkSize);

    for (const mat of listLiquidMaterials()) {
      this.threeMaterials.set(mat.id, createFluidShaderMaterial(mat));
    }
  }

  update(dt) {
    this.elapsed += dt;
    updateFluidShaderTime(this.elapsed);
  }

  markDirtyAt(x, y, z) {
    const s = this.chunkSize;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const mx = x + dx;
          const my = y + dy;
          const mz = z + dz;
          this.markChunkDirty(Math.floor(mx / s), Math.floor(my / s), Math.floor(mz / s));
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
      const group = new THREE.Group();
      group.name = `fluid-chunk-${key}`;
      this.group.add(group);
      this.chunks.set(key, { group, meshes: new Map() });
    }
    return this.chunks.get(key);
  }

  rebuildChunk(cx, cy, cz) {
    const chunk = this.getOrCreateChunk(cx, cy, cz);
    const buffers = buildFluidChunkBuffers(
      this.grid,
      this.fluidField,
      cx,
      cy,
      cz,
      this.chunkSize,
    );
    applyBuffersToChunk(chunk, buffers, this.threeMaterials, cx, cy, cz);
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
