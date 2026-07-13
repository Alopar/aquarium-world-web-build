import * as THREE from 'three';
import { CHUNK_SIZE, MAX_CHUNKS_REBUILD_PER_FRAME, VOXEL_SIZE } from '../constants.js';
import { getMaterial, isOpaque, listSolidMaterials } from '../materials/registry.js';
import {
  buildSolidAtlas,
  getBlockTexture,
  getSolidAtlasTexture,
  getSolidAtlasUv,
} from '../materials/textures.js';

const ATLAS_KEY = '__atlas__';
const FLAT_OPAQUE_KEY = '__flat_opaque__';

const FACE_DEFS = [
  { dir: [1, 0, 0], normal: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], uv: (x, y, z, c) => [y + c[1], z + c[2]] },
  { dir: [-1, 0, 0], normal: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], uv: (x, y, z, c) => [z + c[2], y + c[1]] },
  { dir: [0, 1, 0], normal: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], uv: (x, y, z, c) => [x + c[0], z + c[2]] },
  { dir: [0, -1, 0], normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uv: (x, y, z, c) => [x + c[0], z + c[2]] },
  { dir: [0, 0, 1], normal: [0, 0, 1], corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], uv: (x, y, z, c) => [x + c[0], y + c[1]] },
  { dir: [0, 0, -1], normal: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], uv: (x, y, z, c) => [x + c[0], y + c[1]] },
];

const GREEDY_SWEEPS = [
  { axis: 0, dir: 1, normal: [1, 0, 0], uAxis: 1, vAxis: 2 },
  { axis: 0, dir: -1, normal: [-1, 0, 0], uAxis: 1, vAxis: 2 },
  { axis: 1, dir: 1, normal: [0, 1, 0], uAxis: 0, vAxis: 2 },
  { axis: 1, dir: -1, normal: [0, -1, 0], uAxis: 0, vAxis: 2 },
  { axis: 2, dir: 1, normal: [0, 0, 1], uAxis: 0, vAxis: 1 },
  { axis: 2, dir: -1, normal: [0, 0, -1], uAxis: 0, vAxis: 1 },
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

function flatBucketKey(_matDef) {
  return FLAT_OPAQUE_KEY;
}

function vertexColorFromMaterial(matDef) {
  const hex = matDef.emissive ?? matDef.color ?? 0xffffff;
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

function createMeshMaterial(materialDef, useLambert = false) {
  const texture = materialDef.texture ? getBlockTexture(materialDef.texture) : null;
  const params = {
    color: texture ? 0xffffff : materialDef.color,
    transparent: materialDef.opacity != null && materialDef.opacity < 1,
    opacity: materialDef.opacity ?? 1,
  };
  if (texture) {
    params.map = texture;
  }
  if (materialDef.emissive != null) {
    params.emissive = materialDef.emissive;
    params.emissiveIntensity = materialDef.emissiveIntensity ?? 0.6;
  }
  if (useLambert) {
    return new THREE.MeshLambertMaterial(params);
  }
  params.roughness = 0.92;
  return new THREE.MeshStandardMaterial(params);
}

function getOrCreateBuffer(buffers, key, flat = false) {
  if (!buffers.has(key)) {
    buffers.set(key, {
      positions: [],
      normals: [],
      uvs: [],
      colors: [],
      indices: [],
      flat,
    });
  }
  return buffers.get(key);
}

function atlasUv(localU, localV, tile) {
  return [
    tile[0] + localU * tile[2],
    tile[1] + localV * tile[3],
  ];
}

function pushGreedyQuad(buf, normal, color, corners) {
  const base = buf.positions.length / 3;
  for (const c of corners) {
    buf.positions.push(c[0] * VOXEL_SIZE, c[1] * VOXEL_SIZE, c[2] * VOXEL_SIZE);
    buf.normals.push(normal[0], normal[1], normal[2]);
    buf.colors.push(color[0], color[1], color[2]);
  }
  buf.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function facePlaneOnAxis(axis, dir, cellCoord) {
  return dir > 0 ? cellCoord + 1 : cellCoord;
}

function greedyQuadCorners(axis, dir, cellCoord, u0, v0, w, h) {
  const plane = facePlaneOnAxis(axis, dir, cellCoord);
  if (axis === 0) {
    if (dir > 0) {
      return [
        [plane, u0, v0], [plane, u0 + w, v0], [plane, u0 + w, v0 + h], [plane, u0, v0 + h],
      ];
    }
    return [
      [plane, u0, v0 + h], [plane, u0 + w, v0 + h], [plane, u0 + w, v0], [plane, u0, v0],
    ];
  }
  if (axis === 1) {
    if (dir > 0) {
      return [
        [u0, plane, v0 + h], [u0 + w, plane, v0 + h], [u0 + w, plane, v0], [u0, plane, v0],
      ];
    }
    return [
      [u0, plane, v0], [u0 + w, plane, v0], [u0 + w, plane, v0 + h], [u0, plane, v0 + h],
    ];
  }
  if (dir > 0) {
    return [
      [u0 + w, v0, plane], [u0 + w, v0 + h, plane], [u0, v0 + h, plane], [u0, v0, plane],
    ];
  }
  // Match FACE_DEFS -Z winding: (x,y,z), (x,y+1,z), (x+1,y+1,z), (x+1,y,z)
  return [
    [u0, v0, plane], [u0, v0 + h, plane], [u0 + w, v0 + h, plane], [u0 + w, v0, plane],
  ];
}

function buildGreedyFlatChunkBuffers(grid, cx, cy, cz, chunkSize) {
  const buffers = new Map();
  const x0 = cx * chunkSize;
  const y0 = cy * chunkSize;
  const z0 = cz * chunkSize;
  const x1 = Math.min(x0 + chunkSize, grid.size.x);
  const y1 = Math.min(y0 + chunkSize, grid.size.y);
  const z1 = Math.min(z0 + chunkSize, grid.size.z);
  const dims = [x1 - x0, y1 - y0, z1 - z0];

  for (const sweep of GREEDY_SWEEPS) {
    const { axis, dir, normal, uAxis, vAxis } = sweep;
    const du = dims[uAxis];
    const dv = dims[vAxis];
    const sliceMin = 0;
    const sliceMax = dims[axis];

    for (let slice = sliceMin; slice < sliceMax; slice++) {
      const mask = new Array(du * dv).fill(null);

      for (let v = 0; v < dv; v++) {
        for (let u = 0; u < du; u++) {
          const bases = [x0, y0, z0];
          const coords = [0, 0, 0];
          coords[axis] = bases[axis] + slice;
          coords[uAxis] = bases[uAxis] + u;
          coords[vAxis] = bases[vAxis] + v;

          const x = coords[0];
          const y = coords[1];
          const z = coords[2];
          const nx = x + (axis === 0 ? dir : 0);
          const ny = y + (axis === 1 ? dir : 0);
          const nz = z + (axis === 2 ? dir : 0);

          if (!shouldRenderFace(grid, x, y, z, nx, ny, nz)) continue;
          const id = grid.get(x, y, z);
          const matDef = getMaterial(id);
          if (!matDef.solid) continue;
          const bucket = flatBucketKey(matDef);
          mask[u + v * du] = `${bucket}:${id}`;
        }
      }

      for (let v = 0; v < dv; v++) {
        for (let u = 0; u < du; u++) {
          const maskKey = mask[u + v * du];
          if (!maskKey) continue;

          let width = 1;
          while (u + width < du && mask[u + width + v * du] === maskKey) {
            width++;
          }

          let height = 1;
          outer: while (v + height < dv) {
            for (let k = 0; k < width; k++) {
              if (mask[u + k + (v + height) * du] !== maskKey) break outer;
            }
            height++;
          }

          for (let dv2 = 0; dv2 < height; dv2++) {
            for (let du2 = 0; du2 < width; du2++) {
              mask[u + du2 + (v + dv2) * du] = null;
            }
          }

          const colon = maskKey.indexOf(':');
          const bufKey = maskKey.slice(0, colon);
          const id = maskKey.slice(colon + 1);
          const matDef = getMaterial(id);
          const buf = getOrCreateBuffer(buffers, bufKey, true);
          const color = vertexColorFromMaterial(matDef);
          const bases = [x0, y0, z0];
          const uOrigin = bases[uAxis] + u;
          const vOrigin = bases[vAxis] + v;
          const cellCoord = bases[axis] + slice;
          const corners = greedyQuadCorners(
            axis,
            dir,
            cellCoord,
            uOrigin,
            vOrigin,
            width,
            height,
          );
          pushGreedyQuad(buf, normal, color, corners);
        }
      }
    }
  }

  return buffers;
}

function buildTexturedChunkBuffers(grid, cx, cy, cz, chunkSize, atlasEligible = null) {
  const buffers = new Map();
  const x0 = cx * chunkSize;
  const y0 = cy * chunkSize;
  const z0 = cz * chunkSize;
  const x1 = Math.min(x0 + chunkSize, grid.size.x);
  const y1 = Math.min(y0 + chunkSize, grid.size.y);
  const z1 = Math.min(z0 + chunkSize, grid.size.z);

  function getTile(blockId) {
    const uv = getSolidAtlasUv(blockId);
    if (!uv) return [0, 0, 1, 1];
    return [uv.ox, uv.oy, uv.sx, uv.sy];
  }

  for (let x = x0; x < x1; x++) {
    for (let y = y0; y < y1; y++) {
      for (let z = z0; z < z1; z++) {
        const id = grid.get(x, y, z);
        const matDef = getMaterial(id);
        if (!matDef.solid) continue;

        const useAtlas = atlasEligible ? atlasEligible(id) : false;
        const key = useAtlas ? ATLAS_KEY : id;
        const buf = getOrCreateBuffer(buffers, key);
        const tile = useAtlas ? getTile(id) : null;

        for (const face of FACE_DEFS) {
          const nx = x + face.dir[0];
          const ny = y + face.dir[1];
          const nz = z + face.dir[2];
          if (!shouldRenderFace(grid, x, y, z, nx, ny, nz)) continue;

          const base = buf.positions.length / 3;
          for (const corner of face.corners) {
            buf.positions.push(
              (x + corner[0]) * VOXEL_SIZE,
              (y + corner[1]) * VOXEL_SIZE,
              (z + corner[2]) * VOXEL_SIZE,
            );
            buf.normals.push(...face.normal);

            let u = 0;
            let v = 0;
            if (face.normal[0] !== 0) {
              u = corner[1];
              v = corner[2];
            } else if (face.normal[1] !== 0) {
              u = corner[0];
              v = corner[2];
            } else {
              u = corner[0];
              v = corner[1];
            }
            if (tile) {
              const [au, av] = atlasUv(u, v, tile);
              buf.uvs.push(au, av);
            } else {
              const [du, dv] = face.uv(x, y, z, corner);
              buf.uvs.push(du, dv);
            }
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
  if (buf.flat) {
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(buf.colors, 3));
  } else {
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uvs, 2));
  }
  geometry.setIndex(buf.indices);
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, threeMaterials.get(key));
  mesh.castShadow = !buf.flat;
  mesh.receiveShadow = !buf.flat;
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
    flatColors = false,
  } = {}) {
    this.grid = grid;
    this.chunkSize = chunkSize;
    this.maxChunksPerFrame = maxChunksPerFrame;
    this.lambertTerrain = lambertTerrain;
    this.flatColors = flatColors;
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
    /** @type {((cx: number, cy: number, cz: number) => void) | null} */
    this.onChunkDirty = null;
    /** @type {((cx: number, cy: number, cz: number) => void) | null} */
    this.onChunkRebuilt = null;

    const { x: sx, y: sy, z: sz } = grid.size;
    this.chunksX = Math.ceil(sx / chunkSize);
    this.chunksY = Math.ceil(sy / chunkSize);
    this.chunksZ = Math.ceil(sz / chunkSize);

    if (!this.flatColors) {
      const solids = listSolidMaterials();
      buildSolidAtlas(solids);
    }
    this._initMaterials();
  }

  _initMaterials() {
    for (const mat of this.threeMaterials.values()) {
      mat.dispose();
    }
    this.threeMaterials.clear();

    if (this.flatColors) {
      this.threeMaterials.set(FLAT_OPAQUE_KEY, new THREE.MeshLambertMaterial({
        vertexColors: true,
      }));
      this._atlasEligibleId = () => false;
      return;
    }

    const solids = listSolidMaterials();
    const atlasTex = getSolidAtlasTexture();
    if (atlasTex) {
      const atlasMat = this.lambertTerrain
        ? new THREE.MeshLambertMaterial({ map: atlasTex, color: 0xffffff })
        : new THREE.MeshStandardMaterial({
          map: atlasTex,
          color: 0xffffff,
          roughness: 0.92,
        });
      this.threeMaterials.set(ATLAS_KEY, atlasMat);
    }

    const isAtlasEligible = (m) =>
      atlasTex
      && m?.solid === true
      && m?.opaque === true
      && (m.opacity == null || m.opacity >= 1)
      && m?.emissive == null
      && getSolidAtlasUv(m.id) != null;

    for (const mat of solids) {
      if (isAtlasEligible(mat)) continue;
      this.threeMaterials.set(mat.id, createMeshMaterial(mat, this.lambertTerrain));
    }

    this._atlasEligibleId = (id) => {
      const m = getMaterial(id);
      return isAtlasEligible(m);
    };
  }

  setLambertTerrain(useLambert) {
    if (this.flatColors || this.lambertTerrain === useLambert) return;
    this.lambertTerrain = useLambert;
    this._initMaterials();
    this._clearChunkMeshes();
    this.rebuildAll();
  }

  setFlatColors(flat) {
    if (this.flatColors === flat) return;
    this.flatColors = flat;
    if (!this.flatColors) {
      buildSolidAtlas(listSolidMaterials());
    }
    this._initMaterials();
    this._clearChunkMeshes();
    this.rebuildAll();
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

  markChunkDirty(cx, cy, cz) {
    if (cx < 0 || cy < 0 || cz < 0) return;
    if (cx >= this.chunksX || cy >= this.chunksY || cz >= this.chunksZ) return;
    this.dirtyChunks.add(chunkKey(cx, cy, cz));
    this.onChunkDirty?.(cx, cy, cz);
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
        occludeStreak: 0,
      });
    }
    return this.chunks.get(key);
  }

  rebuildChunk(cx, cy, cz) {
    const chunk = this.getOrCreateChunk(cx, cy, cz);
    const buffers = this.flatColors
      ? buildGreedyFlatChunkBuffers(this.grid, cx, cy, cz, this.chunkSize)
      : buildTexturedChunkBuffers(this.grid, cx, cy, cz, this.chunkSize, this._atlasEligibleId);
    applyBuffersToChunk(chunk, buffers, this.threeMaterials, cx, cy, cz, this.chunkSize);
    this.onChunkRebuilt?.(cx, cy, cz);
  }

  getPrimaryMergeKey() {
    return this.flatColors ? FLAT_OPAQUE_KEY : ATLAS_KEY;
  }

  /**
   * Build primary (atlas / flat opaque) buffers for a super-region of span×span×span chunks.
   * @param {number} scx super-chunk index (corner chunk = scx * span)
   */
  buildPrimaryRegionBuffers(scx, scy, scz, span) {
    const cornerCx = scx * span;
    const cornerCy = scy * span;
    const cornerCz = scz * span;
    const regionSize = this.chunkSize * span;
    const buffers = this.flatColors
      ? buildGreedyFlatChunkBuffers(this.grid, cornerCx, cornerCy, cornerCz, regionSize)
      : buildTexturedChunkBuffers(
        this.grid,
        cornerCx,
        cornerCy,
        cornerCz,
        regionSize,
        this._atlasEligibleId,
      );
    const key = this.getPrimaryMergeKey();
    return { key, buffer: buffers.get(key) ?? null };
  }

  /** True when region has no materials that must stay on per-chunk meshes. */
  isRegionMergeable(scx, scy, scz, span) {
    const cornerCx = scx * span;
    const cornerCy = scy * span;
    const cornerCz = scz * span;
    if (cornerCx + span > this.chunksX
      || cornerCy + span > this.chunksY
      || cornerCz + span > this.chunksZ) {
      return false;
    }

    const x0 = cornerCx * this.chunkSize;
    const y0 = cornerCy * this.chunkSize;
    const z0 = cornerCz * this.chunkSize;
    const x1 = Math.min(x0 + this.chunkSize * span, this.grid.size.x);
    const y1 = Math.min(y0 + this.chunkSize * span, this.grid.size.y);
    const z1 = Math.min(z0 + this.chunkSize * span, this.grid.size.z);

    for (let x = x0; x < x1; x++) {
      for (let y = y0; y < y1; y++) {
        for (let z = z0; z < z1; z++) {
          const id = this.grid.get(x, y, z);
          const matDef = getMaterial(id);
          if (!matDef.solid) continue;
          if (!this.flatColors && !this._atlasEligibleId(id)) {
            return false;
          }
        }
      }
    }
    return true;
  }

  setChunkPrimaryMeshVisible(cx, cy, cz, visible) {
    const chunk = this.chunks.get(chunkKey(cx, cy, cz));
    if (!chunk) return;
    const mesh = chunk.meshes.get(this.getPrimaryMergeKey());
    if (mesh) mesh.visible = visible;
  }

  createPrimaryMeshFromBuffer(buf, scx, scy, scz, span) {
    const key = this.getPrimaryMergeKey();
    return createMeshFromBuffer(
      buf,
      key,
      this.threeMaterials,
      `super-${scx},${scy},${scz}-${key}`,
    );
  }

  getSuperRegionBox(scx, scy, scz, span) {
    const s = this.chunkSize * VOXEL_SIZE;
    const cx = scx * span;
    const cy = scy * span;
    const cz = scz * span;
    return {
      min: [cx * s, cy * s, cz * s],
      max: [(cx + span) * s, (cy + span) * s, (cz + span) * s],
    };
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
