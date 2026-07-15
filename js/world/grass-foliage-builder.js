import * as THREE from 'three';
import {
  CHUNK_SIZE,
  FLOWER_FOLIAGE,
  GRASS_FOLIAGE,
  LIGHTING,
  MAX_CHUNKS_REBUILD_PER_FRAME,
  VOXEL_SIZE,
} from '../constants.js';
import { getMaterial } from '../materials/registry.js';
import { createFoliageMaterial, updateGrassShaderTime } from '../shaders/grass-material.js';
import { sampleFaceBrightnessBlend } from '../lighting/brightness-sampling.js';

function chunkKey(cx, cy, cz) {
  return `${cx},${cy},${cz}`;
}

/** Deterministic 0…1 hash from integer cell coords. */
function hash01(x, y, z) {
  let n = (x * 374761393) ^ (y * 668265263) ^ (z * 2147483647);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/**
 * Crossed quads (X) with UVs for a foliage sprite.
 * Origin at the base center.
 */
function createCrossGeometry(width, height) {
  const w = width * 0.5;
  const h = height;
  const positions = new Float32Array([
    -w, 0, 0, w, 0, 0, w, h, 0, -w, h, 0,
    0, 0, -w, 0, 0, w, 0, h, w, 0, h, -w,
  ]);
  const uvs = new Float32Array([
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1,
  ]);
  const indices = [
    0, 1, 2, 0, 2, 3,
    4, 5, 6, 4, 6, 7,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Grass top open to air/gas — no solid or liquid above.
 */
function isExposedGrassTop(grid, x, y, z) {
  if (grid.get(x, y, z) !== 'grass') return false;

  const ny = y + 1;
  if (!grid.inBounds(x, ny, z)) return true;

  const above = grid.get(x, ny, z);
  if (above === 'air') return true;

  const mat = getMaterial(above);
  if (mat.solid || mat.liquid) return false;
  return true;
}

function shouldPlaceGrass(x, y, z) {
  return hash01(x, y, z) < GRASS_FOLIAGE.coverage;
}

function shouldPlaceFlower(x, y, z) {
  // Separate hash so flowers are not locked to the same cells as grass tufts.
  return hash01(x + 91, y + 7, z + 53) < FLOWER_FOLIAGE.coverage;
}

function bladesForCell(x, y, z) {
  const t = hash01(x + 17, y, z + 31);
  const min = GRASS_FOLIAGE.bladesMin;
  const max = GRASS_FOLIAGE.bladesMax;
  return min + Math.floor(t * (max - min + 1));
}

function flowerTypeForCell(x, y, z) {
  const types = FLOWER_FOLIAGE.types;
  const t = hash01(x + 203, y, z + 111);
  return types[Math.floor(t * types.length) % types.length];
}

function foliageTint(x, y, z, salt) {
  const t = hash01(x * 3 + salt, y + 5, z * 7);
  const white = new THREE.Color(0xffffff);
  const subtle = new THREE.Color(0xf0f4ec);
  return white.clone().lerp(subtle, t * 0.12);
}

function foliageLight(x, y, z, lighting, blend) {
  if (!lighting) {
    return {
      sky: 1,
      blockR: 0,
      blockG: 0,
      blockB: 0,
      prevSky: 1,
      prevBlockR: 0,
      prevBlockG: 0,
      prevBlockB: 0,
      blendStart: -1e6,
    };
  }
  // Same as top face of the grass block in mesh-builder.
  return sampleFaceBrightnessBlend(lighting, blend, x, y, z, [0, 1, 0]);
}

function pushScaledInstance(list, x, y, z, i, cfg, salt, lighting = null, blend = null) {
  const ox = (hash01(x, i + salt, z) - 0.5) * 0.45;
  const oz = (hash01(x + 9, i + salt, z + 3) - 0.5) * 0.45;
  const yaw = hash01(x + i * 13 + salt, y, z) * Math.PI * 2;
  const ht = hash01(x, y + i * 7 + salt, z + 19);
  const wt = hash01(x + 41, i + salt, z + 3);
  const scaleY = cfg.heightScaleMin + ht * (cfg.heightScaleMax - cfg.heightScaleMin);
  const scaleXZ = cfg.widthScaleMin + wt * (cfg.widthScaleMax - cfg.widthScaleMin);
  list.push({
    x: (x + 0.5 + ox) * VOXEL_SIZE,
    y: (y + 1) * VOXEL_SIZE,
    z: (z + 0.5 + oz) * VOXEL_SIZE,
    yaw,
    scaleX: scaleXZ,
    scaleY,
    scaleZ: scaleXZ,
    color: foliageTint(x, y, z, salt + i),
    ...foliageLight(x, y, z, lighting, blend),
  });
}

export class GrassFoliageBuilder {
  constructor(grid, {
    chunkSize = CHUNK_SIZE,
    maxChunksPerFrame = MAX_CHUNKS_REBUILD_PER_FRAME,
    enabled = true,
    lighting = null,
    brightnessBlend = null,
  } = {}) {
    this.grid = grid;
    this.lighting = lighting;
    this.brightnessBlend = brightnessBlend;
    this.chunkSize = chunkSize;
    this.maxChunksPerFrame = maxChunksPerFrame;
    this.enabled = enabled;
    this.group = new THREE.Group();
    this.group.name = 'grass-foliage';
    this.chunks = new Map();
    this.dirtyChunks = new Set();
    this.flushScheduled = false;
    this.flushFrameId = null;
    this.chunksRebuiltLastFrame = 0;

    const { x: sx, y: sy, z: sz } = grid.size;
    this.chunksX = Math.ceil(sx / chunkSize);
    this.chunksY = Math.ceil(sy / chunkSize);
    this.chunksZ = Math.ceil(sz / chunkSize);

    if (!this.enabled) {
      this.group.visible = false;
      return;
    }

    this._initResources();
  }

  _initResources() {
    if (this.grassGeometry) return;

    this.grassGeometry = createCrossGeometry(GRASS_FOLIAGE.width, GRASS_FOLIAGE.height);
    this.flowerGeometry = createCrossGeometry(FLOWER_FOLIAGE.width, FLOWER_FOLIAGE.height);

    this.grassMaterial = createFoliageMaterial(
      'grass_blade',
      GRASS_FOLIAGE.windStrength,
      GRASS_FOLIAGE.height,
    );
    this.flowerMaterials = new Map();
    for (const type of FLOWER_FOLIAGE.types) {
      this.flowerMaterials.set(
        type,
        createFoliageMaterial(type, FLOWER_FOLIAGE.windStrength, FLOWER_FOLIAGE.height),
      );
    }
    this._dummy = new THREE.Object3D();
  }

  _clearChunks() {
    this.cancelScheduledFlush();
    this.dirtyChunks.clear();
    for (const chunk of this.chunks.values()) {
      this.clearChunkMeshes(chunk);
    }
    this.chunks.clear();
  }

  setEnabled(enabled, scene = null) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;

    if (enabled) {
      this._initResources();
      this.group.visible = true;
      if (scene && !this.group.parent) scene.add(this.group);
      this.rebuildAll();
      return;
    }

    this._clearChunks();
    this.group.visible = false;
    if (scene?.remove) scene.remove(this.group);
  }

  markDirtyAt(x, y, z) {
    if (!this.enabled) return;
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

  markDirtyInRadius(x, y, z, radius = LIGHTING.maxLevel) {
    if (!this.enabled) return;
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

  markChunkDirty(cx, cy, cz) {
    if (cx < 0 || cy < 0 || cz < 0) return;
    if (cx >= this.chunksX || cy >= this.chunksY || cz >= this.chunksZ) return;
    this.dirtyChunks.add(chunkKey(cx, cy, cz));
  }

  scheduleFlush() {
    if (!this.enabled) return;
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
    if (!this.enabled) return;
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

    if (this.dirtyChunks.size > 0) {
      this.scheduleFlush();
    }
  }

  getOrCreateChunk(cx, cy, cz) {
    const key = chunkKey(cx, cy, cz);
    if (!this.chunks.has(key)) {
      this.chunks.set(key, { grassMesh: null, flowerMeshes: new Map() });
    }
    return this.chunks.get(key);
  }

  clearChunkMeshes(chunk) {
    if (chunk.grassMesh) {
      chunk.grassMesh.geometry.dispose();
      this.group.remove(chunk.grassMesh);
      chunk.grassMesh = null;
    }
    for (const mesh of chunk.flowerMeshes.values()) {
      mesh.geometry.dispose();
      this.group.remove(mesh);
    }
    chunk.flowerMeshes.clear();
  }

  _applyInstances(mesh, placements) {
    const dummy = this._dummy;
    const count = placements.length;
    const skyAttr = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    const blockAttr = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    const prevSkyAttr = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    const prevBlockAttr = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    const blendStartAttr = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);

    for (let i = 0; i < count; i++) {
      const p = placements[i];
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.yaw, 0);
      dummy.scale.set(p.scaleX, p.scaleY, p.scaleZ);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, p.color);
      skyAttr.setX(i, p.sky);
      blockAttr.setXYZ(i, p.blockR, p.blockG, p.blockB);
      prevSkyAttr.setX(i, p.prevSky);
      prevBlockAttr.setXYZ(i, p.prevBlockR, p.prevBlockG, p.prevBlockB);
      blendStartAttr.setX(i, p.blendStart);
    }

    mesh.geometry.setAttribute('aSkyLight', skyAttr);
    mesh.geometry.setAttribute('aBlockLight', blockAttr);
    mesh.geometry.setAttribute('aPrevSkyLight', prevSkyAttr);
    mesh.geometry.setAttribute('aPrevBlockLight', prevBlockAttr);
    mesh.geometry.setAttribute('aBlendStart', blendStartAttr);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    skyAttr.needsUpdate = true;
    blockAttr.needsUpdate = true;
    prevSkyAttr.needsUpdate = true;
    prevBlockAttr.needsUpdate = true;
    blendStartAttr.needsUpdate = true;
    mesh.computeBoundingSphere();
  }

  _makeInstanced(geometry, material, placements, name) {
    const geo = geometry.clone();
    const mesh = new THREE.InstancedMesh(geo, material, placements.length);
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = true;
    mesh.name = name;
    this._applyInstances(mesh, placements);
    this.group.add(mesh);
    return mesh;
  }

  rebuildChunk(cx, cy, cz) {
    const chunk = this.getOrCreateChunk(cx, cy, cz);
    this.clearChunkMeshes(chunk);

    const s = this.chunkSize;
    const x0 = cx * s;
    const y0 = cy * s;
    const z0 = cz * s;
    const x1 = Math.min(x0 + s, this.grid.size.x);
    const y1 = Math.min(y0 + s, this.grid.size.y);
    const z1 = Math.min(z0 + s, this.grid.size.z);

    const grassPlacements = [];
    /** @type {Map<string, object[]>} */
    const flowerPlacements = new Map();
    for (const type of FLOWER_FOLIAGE.types) {
      flowerPlacements.set(type, []);
    }

    for (let x = x0; x < x1; x++) {
      for (let y = y0; y < y1; y++) {
        for (let z = z0; z < z1; z++) {
          if (!isExposedGrassTop(this.grid, x, y, z)) continue;

          if (shouldPlaceGrass(x, y, z)) {
            const count = bladesForCell(x, y, z);
            for (let i = 0; i < count; i++) {
              pushScaledInstance(grassPlacements, x, y, z, i, GRASS_FOLIAGE, 0, this.lighting, this.brightnessBlend);
            }
          }

          if (shouldPlaceFlower(x, y, z)) {
            const type = flowerTypeForCell(x, y, z);
            pushScaledInstance(flowerPlacements.get(type), x, y, z, 0, FLOWER_FOLIAGE, 77, this.lighting, this.brightnessBlend);
          }
        }
      }
    }

    if (grassPlacements.length > 0) {
      chunk.grassMesh = this._makeInstanced(
        this.grassGeometry,
        this.grassMaterial,
        grassPlacements,
        `grass-${cx},${cy},${cz}`,
      );
    }

    for (const [type, placements] of flowerPlacements) {
      if (placements.length === 0) continue;
      const mesh = this._makeInstanced(
        this.flowerGeometry,
        this.flowerMaterials.get(type),
        placements,
        `flower-${type}-${cx},${cy},${cz}`,
      );
      chunk.flowerMeshes.set(type, mesh);
    }
  }

  rebuildAll() {
    if (!this.enabled) return;
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

  update(dt) {
    if (!this.enabled) return;
    updateGrassShaderTime(dt);
  }

  dispose() {
    this.cancelScheduledFlush();
    this.dirtyChunks.clear();

    for (const chunk of this.chunks.values()) {
      this.clearChunkMeshes(chunk);
    }
    this.chunks.clear();

    if (!this.enabled) return;

    this.grassGeometry.dispose();
    this.flowerGeometry.dispose();
    this.grassMaterial.dispose();
    for (const mat of this.flowerMaterials.values()) {
      mat.dispose();
    }
    this.flowerMaterials.clear();
  }
}
