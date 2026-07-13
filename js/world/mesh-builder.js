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

function getOrCreateBuffer(buffers, id) {
  if (!buffers.has(id)) {
    buffers.set(id, { positions: [], normals: [], uvs: [], indices: [] });
  }
  return buffers.get(id);
}

function pushQuad(buf, normal, v0, v1, v2, v3, uv0, uv1, uv2, uv3) {
  const base = buf.positions.length / 3;
  buf.positions.push(...v0, ...v1, ...v2, ...v3);
  buf.normals.push(...normal, ...normal, ...normal, ...normal);
  buf.uvs.push(...uv0, ...uv1, ...uv2, ...uv3);
  buf.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/**
 * Greedy meshing per-chunk, per-face direction.
 * Keeps UVs in "block space" so textures tile per-block like before.
 */
function buildChunkBuffers(grid, cx, cy, cz, chunkSize) {
  const buffers = new Map();
  const x0 = cx * chunkSize;
  const y0 = cy * chunkSize;
  const z0 = cz * chunkSize;
  const x1 = Math.min(x0 + chunkSize, grid.size.x);
  const y1 = Math.min(y0 + chunkSize, grid.size.y);
  const z1 = Math.min(z0 + chunkSize, grid.size.z);

  const sizeX = x1 - x0;
  const sizeY = y1 - y0;
  const sizeZ = z1 - z0;

  // Reusable masks to avoid allocations inside loops.
  /** @type {Array<string|null>} */
  const mask = [];

  function voxelId(x, y, z) {
    return grid.get(x0 + x, y0 + y, z0 + z);
  }

  // +X faces (sweep x, mask in (y,z))
  for (let x = 0; x < sizeX; x++) {
    mask.length = sizeY * sizeZ;
    let mi = 0;
    for (let y = 0; y < sizeY; y++) {
      for (let z = 0; z < sizeZ; z++) {
        const id = voxelId(x, y, z);
        const matDef = getMaterial(id);
        if (!matDef.solid) {
          mask[mi++] = null;
          continue;
        }
        const wx = x0 + x;
        const wy = y0 + y;
        const wz = z0 + z;
        const nx = wx + 1;
        const ny = wy;
        const nz = wz;
        mask[mi++] = shouldRenderFace(grid, wx, wy, wz, nx, ny, nz) ? id : null;
      }
    }

    for (let y = 0; y < sizeY; y++) {
      for (let z = 0; z < sizeZ;) {
        const id = mask[y * sizeZ + z];
        if (!id) {
          z++;
          continue;
        }
        // Compute width in z.
        let w = 1;
        while (z + w < sizeZ && mask[y * sizeZ + z + w] === id) w++;
        // Compute height in y.
        let h = 1;
        outer: for (; y + h < sizeY; h++) {
          for (let k = 0; k < w; k++) {
            if (mask[(y + h) * sizeZ + z + k] !== id) break outer;
          }
        }
        // Clear.
        for (let dy = 0; dy < h; dy++) {
          for (let dz = 0; dz < w; dz++) {
            mask[(y + dy) * sizeZ + z + dz] = null;
          }
        }

        const buf = getOrCreateBuffer(buffers, id);
        const wx = x0 + x;
        const wy = y0 + y;
        const wz = z0 + z;
        const xPlane = (wx + 1) * VOXEL_SIZE;
        const yA = wy * VOXEL_SIZE;
        const yB = (wy + h) * VOXEL_SIZE;
        const zA = wz * VOXEL_SIZE;
        const zB = (wz + w) * VOXEL_SIZE;

        // Matches FACE_DEFS[0] winding/UV mapping (+X): u=y, v=z
        pushQuad(
          buf,
          [1, 0, 0],
          [xPlane, yA, zA],
          [xPlane, yB, zA],
          [xPlane, yB, zB],
          [xPlane, yA, zB],
          [wy, wz],
          [wy + h, wz],
          [wy + h, wz + w],
          [wy, wz + w],
        );

        z += w;
      }
    }
  }

  // -X faces (sweep x, mask in (y,z))
  for (let x = 0; x < sizeX; x++) {
    mask.length = sizeY * sizeZ;
    let mi = 0;
    for (let y = 0; y < sizeY; y++) {
      for (let z = 0; z < sizeZ; z++) {
        const id = voxelId(x, y, z);
        const matDef = getMaterial(id);
        if (!matDef.solid) {
          mask[mi++] = null;
          continue;
        }
        const wx = x0 + x;
        const wy = y0 + y;
        const wz = z0 + z;
        const nx = wx - 1;
        const ny = wy;
        const nz = wz;
        mask[mi++] = shouldRenderFace(grid, wx, wy, wz, nx, ny, nz) ? id : null;
      }
    }

    for (let y = 0; y < sizeY; y++) {
      for (let z = 0; z < sizeZ;) {
        const id = mask[y * sizeZ + z];
        if (!id) {
          z++;
          continue;
        }
        let w = 1;
        while (z + w < sizeZ && mask[y * sizeZ + z + w] === id) w++;
        let h = 1;
        outer: for (; y + h < sizeY; h++) {
          for (let k = 0; k < w; k++) {
            if (mask[(y + h) * sizeZ + z + k] !== id) break outer;
          }
        }
        for (let dy = 0; dy < h; dy++) {
          for (let dz = 0; dz < w; dz++) {
            mask[(y + dy) * sizeZ + z + dz] = null;
          }
        }

        const buf = getOrCreateBuffer(buffers, id);
        const wx = x0 + x;
        const wy = y0 + y;
        const wz = z0 + z;
        const xPlane = wx * VOXEL_SIZE;
        const yA = wy * VOXEL_SIZE;
        const yB = (wy + h) * VOXEL_SIZE;
        const zA = wz * VOXEL_SIZE;
        const zB = (wz + w) * VOXEL_SIZE;

        // Matches FACE_DEFS[1] winding/UV mapping (-X): u=z, v=y
        pushQuad(
          buf,
          [-1, 0, 0],
          [xPlane, yA, zB],
          [xPlane, yB, zB],
          [xPlane, yB, zA],
          [xPlane, yA, zA],
          [wz + w, wy],
          [wz + w, wy + h],
          [wz, wy + h],
          [wz, wy],
        );

        z += w;
      }
    }
  }

  // +Y faces (sweep y, mask in (x,z))
  for (let y = 0; y < sizeY; y++) {
    mask.length = sizeX * sizeZ;
    let mi = 0;
    for (let x = 0; x < sizeX; x++) {
      for (let z = 0; z < sizeZ; z++) {
        const id = voxelId(x, y, z);
        const matDef = getMaterial(id);
        if (!matDef.solid) {
          mask[mi++] = null;
          continue;
        }
        const wx = x0 + x;
        const wy = y0 + y;
        const wz = z0 + z;
        const nx = wx;
        const ny = wy + 1;
        const nz = wz;
        mask[mi++] = shouldRenderFace(grid, wx, wy, wz, nx, ny, nz) ? id : null;
      }
    }

    for (let x = 0; x < sizeX; x++) {
      for (let z = 0; z < sizeZ;) {
        const id = mask[x * sizeZ + z];
        if (!id) {
          z++;
          continue;
        }
        let w = 1;
        while (z + w < sizeZ && mask[x * sizeZ + z + w] === id) w++;
        let h = 1;
        outer: for (; x + h < sizeX; h++) {
          for (let k = 0; k < w; k++) {
            if (mask[(x + h) * sizeZ + z + k] !== id) break outer;
          }
        }
        for (let dx = 0; dx < h; dx++) {
          for (let dz = 0; dz < w; dz++) {
            mask[(x + dx) * sizeZ + z + dz] = null;
          }
        }

        const buf = getOrCreateBuffer(buffers, id);
        const wx = x0 + x;
        const wy = y0 + y;
        const wz = z0 + z;
        const yPlane = (wy + 1) * VOXEL_SIZE;
        const xA = wx * VOXEL_SIZE;
        const xB = (wx + h) * VOXEL_SIZE;
        const zA = wz * VOXEL_SIZE;
        const zB = (wz + w) * VOXEL_SIZE;

        // Matches FACE_DEFS[2] winding/UV mapping (+Y): u=x, v=z (with z flipped in vertex order)
        pushQuad(
          buf,
          [0, 1, 0],
          [xA, yPlane, zB],
          [xB, yPlane, zB],
          [xB, yPlane, zA],
          [xA, yPlane, zA],
          [wx, wz + w],
          [wx + h, wz + w],
          [wx + h, wz],
          [wx, wz],
        );

        z += w;
      }
    }
  }

  // -Y faces (sweep y, mask in (x,z))
  for (let y = 0; y < sizeY; y++) {
    mask.length = sizeX * sizeZ;
    let mi = 0;
    for (let x = 0; x < sizeX; x++) {
      for (let z = 0; z < sizeZ; z++) {
        const id = voxelId(x, y, z);
        const matDef = getMaterial(id);
        if (!matDef.solid) {
          mask[mi++] = null;
          continue;
        }
        const wx = x0 + x;
        const wy = y0 + y;
        const wz = z0 + z;
        const nx = wx;
        const ny = wy - 1;
        const nz = wz;
        mask[mi++] = shouldRenderFace(grid, wx, wy, wz, nx, ny, nz) ? id : null;
      }
    }

    for (let x = 0; x < sizeX; x++) {
      for (let z = 0; z < sizeZ;) {
        const id = mask[x * sizeZ + z];
        if (!id) {
          z++;
          continue;
        }
        let w = 1;
        while (z + w < sizeZ && mask[x * sizeZ + z + w] === id) w++;
        let h = 1;
        outer: for (; x + h < sizeX; h++) {
          for (let k = 0; k < w; k++) {
            if (mask[(x + h) * sizeZ + z + k] !== id) break outer;
          }
        }
        for (let dx = 0; dx < h; dx++) {
          for (let dz = 0; dz < w; dz++) {
            mask[(x + dx) * sizeZ + z + dz] = null;
          }
        }

        const buf = getOrCreateBuffer(buffers, id);
        const wx = x0 + x;
        const wy = y0 + y;
        const wz = z0 + z;
        const yPlane = wy * VOXEL_SIZE;
        const xA = wx * VOXEL_SIZE;
        const xB = (wx + h) * VOXEL_SIZE;
        const zA = wz * VOXEL_SIZE;
        const zB = (wz + w) * VOXEL_SIZE;

        // Matches FACE_DEFS[3] winding/UV mapping (-Y): u=x, v=z
        pushQuad(
          buf,
          [0, -1, 0],
          [xA, yPlane, zA],
          [xB, yPlane, zA],
          [xB, yPlane, zB],
          [xA, yPlane, zB],
          [wx, wz],
          [wx + h, wz],
          [wx + h, wz + w],
          [wx, wz + w],
        );

        z += w;
      }
    }
  }

  // +Z faces (sweep z, mask in (x,y))
  for (let z = 0; z < sizeZ; z++) {
    mask.length = sizeX * sizeY;
    let mi = 0;
    for (let x = 0; x < sizeX; x++) {
      for (let y = 0; y < sizeY; y++) {
        const id = voxelId(x, y, z);
        const matDef = getMaterial(id);
        if (!matDef.solid) {
          mask[mi++] = null;
          continue;
        }
        const wx = x0 + x;
        const wy = y0 + y;
        const wz = z0 + z;
        const nx = wx;
        const ny = wy;
        const nz = wz + 1;
        mask[mi++] = shouldRenderFace(grid, wx, wy, wz, nx, ny, nz) ? id : null;
      }
    }

    for (let x = 0; x < sizeX; x++) {
      for (let y = 0; y < sizeY;) {
        const id = mask[x * sizeY + y];
        if (!id) {
          y++;
          continue;
        }
        let w = 1;
        while (y + w < sizeY && mask[x * sizeY + y + w] === id) w++;
        let h = 1;
        outer: for (; x + h < sizeX; h++) {
          for (let k = 0; k < w; k++) {
            if (mask[(x + h) * sizeY + y + k] !== id) break outer;
          }
        }
        for (let dx = 0; dx < h; dx++) {
          for (let dy = 0; dy < w; dy++) {
            mask[(x + dx) * sizeY + y + dy] = null;
          }
        }

        const buf = getOrCreateBuffer(buffers, id);
        const wx = x0 + x;
        const wy = y0 + y;
        const wz = z0 + z;
        const zPlane = (wz + 1) * VOXEL_SIZE;
        const xA = wx * VOXEL_SIZE;
        const xB = (wx + h) * VOXEL_SIZE;
        const yA = wy * VOXEL_SIZE;
        const yB = (wy + w) * VOXEL_SIZE;

        // Matches FACE_DEFS[4] winding/UV mapping (+Z): u=x, v=y
        pushQuad(
          buf,
          [0, 0, 1],
          [xB, yA, zPlane],
          [xB, yB, zPlane],
          [xA, yB, zPlane],
          [xA, yA, zPlane],
          [wx + h, wy],
          [wx + h, wy + w],
          [wx, wy + w],
          [wx, wy],
        );

        y += w;
      }
    }
  }

  // -Z faces (sweep z, mask in (x,y))
  for (let z = 0; z < sizeZ; z++) {
    mask.length = sizeX * sizeY;
    let mi = 0;
    for (let x = 0; x < sizeX; x++) {
      for (let y = 0; y < sizeY; y++) {
        const id = voxelId(x, y, z);
        const matDef = getMaterial(id);
        if (!matDef.solid) {
          mask[mi++] = null;
          continue;
        }
        const wx = x0 + x;
        const wy = y0 + y;
        const wz = z0 + z;
        const nx = wx;
        const ny = wy;
        const nz = wz - 1;
        mask[mi++] = shouldRenderFace(grid, wx, wy, wz, nx, ny, nz) ? id : null;
      }
    }

    for (let x = 0; x < sizeX; x++) {
      for (let y = 0; y < sizeY;) {
        const id = mask[x * sizeY + y];
        if (!id) {
          y++;
          continue;
        }
        let w = 1;
        while (y + w < sizeY && mask[x * sizeY + y + w] === id) w++;
        let h = 1;
        outer: for (; x + h < sizeX; h++) {
          for (let k = 0; k < w; k++) {
            if (mask[(x + h) * sizeY + y + k] !== id) break outer;
          }
        }
        for (let dx = 0; dx < h; dx++) {
          for (let dy = 0; dy < w; dy++) {
            mask[(x + dx) * sizeY + y + dy] = null;
          }
        }

        const buf = getOrCreateBuffer(buffers, id);
        const wx = x0 + x;
        const wy = y0 + y;
        const wz = z0 + z;
        const zPlane = wz * VOXEL_SIZE;
        const xA = wx * VOXEL_SIZE;
        const xB = (wx + h) * VOXEL_SIZE;
        const yA = wy * VOXEL_SIZE;
        const yB = (wy + w) * VOXEL_SIZE;

        // Matches FACE_DEFS[5] winding/UV mapping (-Z): u=x, v=y
        pushQuad(
          buf,
          [0, 0, -1],
          [xA, yA, zPlane],
          [xA, yB, zPlane],
          [xB, yB, zPlane],
          [xB, yA, zPlane],
          [wx, wy],
          [wx, wy + w],
          [wx + h, wy + w],
          [wx + h, wy],
        );

        y += w;
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
