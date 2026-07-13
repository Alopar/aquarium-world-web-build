import * as THREE from 'three';
import { VOXEL_SIZE } from '../constants.js';
import { isOpaque } from '../materials/registry.js';
import { clampFogViewDistance } from './fog-controller.js';

const OCCLUDE_STREAK_TO_HIDE = 2;
const NEAR_CHUNK_SKIP_OCCLUSION = 20;

const _frustum = new THREE.Frustum();
const _projScreenMatrix = new THREE.Matrix4();
const _box = new THREE.Box3();
const _boxMin = new THREE.Vector3();
const _boxMax = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _chunkCenter = new THREE.Vector3();
const _boxSize = new THREE.Vector3();
const _sampleTargets = [
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
];

/**
 * CPU chunk visibility: frustum AABB + optional voxel DDA occlusion.
 */
export class ChunkVisibilitySystem {
  constructor() {
    this.frameCounter = 0;
    this.stats = {
      empty: 0,
      visible: 0,
      frustumHidden: 0,
      occlusionHidden: 0,
      fogHidden: 0,
    };
  }

  /**
   * @param {THREE.Camera} camera
   * @param {import('../world/world.js').AquariumWorld | null} world
   * @param {object} quality
   * @param {{ force?: boolean }} [opts]
   */
  update(camera, world, quality, { force = false } = {}) {
    const meshBuilder = world?.meshBuilder;
    const grid = world?.grid;
    if (!meshBuilder || !grid || !camera) return;

    const frustumOn = quality?.chunkFrustumCull !== false;
    const occlusionOn = quality?.chunkOcclusionCull === true;
    const fogOn = quality?.fogEnabled === true;
    const fogLimit = fogOn ? clampFogViewDistance(quality.fogViewDistance) : null;

    if (!frustumOn && !occlusionOn && !fogOn) {
      for (const chunk of meshBuilder.chunks.values()) {
        chunk.group.visible = !!chunk.hasGeometry;
        chunk.occludeStreak = 0;
      }
      this.restoreFogCullables(world);
      return;
    }

    if (!force && !fogOn && this.frameCounter % 2 !== 0) {
      this.frameCounter += 1;
      return;
    }
    this.frameCounter += 1;

    _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projScreenMatrix);
    camera.getWorldPosition(_origin);

    let empty = 0;
    let visible = 0;
    let frustumHidden = 0;
    let occlusionHidden = 0;
    let fogHidden = 0;

    for (const chunk of meshBuilder.chunks.values()) {
      if (!chunk.hasGeometry) {
        chunk.group.visible = false;
        chunk.occludeStreak = 0;
        empty += 1;
        continue;
      }

      _boxMin.fromArray(chunk.boxMin);
      _boxMax.fromArray(chunk.boxMax);
      _box.set(_boxMin, _boxMax);

      if (fogLimit != null && isBeyondFogDistance(_box, _origin, fogLimit)) {
        chunk.group.visible = false;
        chunk.occludeStreak = 0;
        fogHidden += 1;
        continue;
      }

      if (frustumOn && !_frustum.intersectsBox(_box)) {
        chunk.group.visible = false;
        chunk.occludeStreak = 0;
        frustumHidden += 1;
        continue;
      }

      let occluded = false;
      if (occlusionOn) {
        _box.getCenter(_chunkCenter);
        const near = _origin.distanceTo(_chunkCenter) < NEAR_CHUNK_SKIP_OCCLUSION;
        if (!near && isChunkOccluded(grid, _origin, _box)) {
          chunk.occludeStreak = (chunk.occludeStreak ?? 0) + 1;
        } else {
          chunk.occludeStreak = 0;
        }
        occluded = chunk.occludeStreak >= OCCLUDE_STREAK_TO_HIDE;
      } else {
        chunk.occludeStreak = 0;
      }

      if (occluded) {
        chunk.group.visible = false;
        occlusionHidden += 1;
        continue;
      }

      chunk.group.visible = true;
      visible += 1;
    }

    if (fogLimit != null) {
      this.applyFogCullToFoliage(world?.grassFoliageBuilder, _origin, fogLimit);
      this.applyFogCullToFluid(world?.fluidMeshBuilder, _origin, fogLimit);
    } else {
      this.restoreFogCullables(world);
    }

    this.stats = { empty, visible, frustumHidden, occlusionHidden, fogHidden };
  }

  restoreFogCullables(world) {
    const grass = world?.grassFoliageBuilder;
    if (grass?.enabled) {
      for (const chunk of grass.chunks.values()) {
        if (chunk.grassMesh) chunk.grassMesh.visible = true;
        for (const mesh of chunk.flowerMeshes.values()) {
          mesh.visible = true;
        }
      }
    }

    const fluid = world?.fluidMeshBuilder;
    if (fluid?.enabled) {
      for (const chunk of fluid.chunks.values()) {
        chunk.group.visible = true;
      }
    }
  }

  applyFogCullToFoliage(builder, origin, fogLimit) {
    if (!builder?.enabled) return;
    const s = builder.chunkSize * VOXEL_SIZE;
    for (const [key, chunk] of builder.chunks) {
      const [cx, cy, cz] = key.split(',').map(Number);
      _boxMin.set(cx * s, cy * s, cz * s);
      _boxMax.set((cx + 1) * s, (cy + 1) * s, (cz + 1) * s);
      _box.set(_boxMin, _boxMax);
      const visible = !isBeyondFogDistance(_box, origin, fogLimit);
      if (chunk.grassMesh) chunk.grassMesh.visible = visible;
      for (const mesh of chunk.flowerMeshes.values()) {
        mesh.visible = visible;
      }
    }
  }

  applyFogCullToFluid(builder, origin, fogLimit) {
    if (!builder?.enabled) return;
    const s = builder.chunkSize * VOXEL_SIZE;
    for (const [key, chunk] of builder.chunks) {
      const [cx, cy, cz] = key.split(',').map(Number);
      _boxMin.set(cx * s, cy * s, cz * s);
      _boxMax.set((cx + 1) * s, (cy + 1) * s, (cz + 1) * s);
      _box.set(_boxMin, _boxMax);
      chunk.group.visible = !isBeyondFogDistance(_box, origin, fogLimit);
    }
  }
}

function isBeyondFogDistance(box, origin, fogLimit) {
  box.getCenter(_chunkCenter);
  box.getSize(_boxSize);
  const radius = _boxSize.length() * 0.5;
  return origin.distanceTo(_chunkCenter) > fogLimit + radius;
}

/** Sample top face of AABB — avoids rays through hills to chunk bottom/center. */
function fillSampleTargets(box) {
  const { min, max } = box;
  const y = max.y;
  const cx = (min.x + max.x) * 0.5;
  const cz = (min.z + max.z) * 0.5;
  _sampleTargets[0].set(cx, y, cz);
  _sampleTargets[1].set(min.x, y, min.z);
  _sampleTargets[2].set(max.x, y, min.z);
  _sampleTargets[3].set(min.x, y, max.z);
  _sampleTargets[4].set(max.x, y, max.z);
  return _sampleTargets;
}

/** Chunk occluded only if every top-face sample ray is blocked before AABB entry. */
function isChunkOccluded(grid, origin, box) {
  const targets = fillSampleTargets(box);
  for (const target of targets) {
    if (!rayHitsOpaqueBeforeBox(grid, origin, target, box)) {
      return false;
    }
  }
  return true;
}

function rayBoxEntryT(origin, dir, box) {
  let tMin = 0;
  let tMax = Infinity;

  const axes = ['x', 'y', 'z'];
  for (const axis of axes) {
    const o = origin[axis];
    const d = dir[axis];
    const bMin = box.min[axis];
    const bMax = box.max[axis];

    if (Math.abs(d) < 1e-8) {
      if (o < bMin || o > bMax) return null;
      continue;
    }

    let t1 = (bMin - o) / d;
    let t2 = (bMax - o) / d;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }

  return tMin;
}

function isOpaqueCell(grid, vx, vy, vz) {
  if (!grid.inBounds(vx, vy, vz)) return false;
  return isOpaque(grid.get(vx, vy, vz));
}

/**
 * True if an opaque voxel blocks the ray before the chunk AABB entry.
 * Ignores hits strictly below the chunk bottom (hill in front, treetops still visible).
 */
function rayHitsOpaqueBeforeBox(grid, origin, target, box) {
  _dir.subVectors(target, origin);
  const dist = _dir.length();
  if (dist < 1e-4) return false;
  _dir.multiplyScalar(1 / dist);

  const tEntry = rayBoxEntryT(origin, _dir, box);
  if (tEntry == null) return false;
  const limit = Math.max(0, tEntry - 1e-4);

  const vs = VOXEL_SIZE;
  const originVx = Math.floor(origin.x / vs);
  const originVy = Math.floor(origin.y / vs);
  const originVz = Math.floor(origin.z / vs);

  let vx = originVx;
  let vy = originVy;
  let vz = originVz;

  const stepX = _dir.x >= 0 ? 1 : -1;
  const stepY = _dir.y >= 0 ? 1 : -1;
  const stepZ = _dir.z >= 0 ? 1 : -1;

  const tDeltaX = Math.abs(_dir.x) < 1e-8 ? Infinity : Math.abs(vs / _dir.x);
  const tDeltaY = Math.abs(_dir.y) < 1e-8 ? Infinity : Math.abs(vs / _dir.y);
  const tDeltaZ = Math.abs(_dir.z) < 1e-8 ? Infinity : Math.abs(vs / _dir.z);

  const boundaryX = stepX > 0 ? (vx + 1) * vs : vx * vs;
  const boundaryY = stepY > 0 ? (vy + 1) * vs : vy * vs;
  const boundaryZ = stepZ > 0 ? (vz + 1) * vs : vz * vs;

  let tMaxX = Math.abs(_dir.x) < 1e-8 ? Infinity : (boundaryX - origin.x) / _dir.x;
  let tMaxY = Math.abs(_dir.y) < 1e-8 ? Infinity : (boundaryY - origin.y) / _dir.y;
  let tMaxZ = Math.abs(_dir.z) < 1e-8 ? Infinity : (boundaryZ - origin.z) / _dir.z;

  if (tMaxX < 0) tMaxX += tDeltaX * Math.ceil(-tMaxX / tDeltaX);
  if (tMaxY < 0) tMaxY += tDeltaY * Math.ceil(-tMaxY / tDeltaY);
  if (tMaxZ < 0) tMaxZ += tDeltaZ * Math.ceil(-tMaxZ / tDeltaZ);

  let traveled = 0;
  const maxSteps = 512;
  const chunkFloorY = box.min.y + 1e-3;

  for (let i = 0; i < maxSteps && traveled < limit; i++) {
    const isOriginCell = vx === originVx && vy === originVy && vz === originVz;
    if (!isOriginCell && isOpaqueCell(grid, vx, vy, vz)) {
      const cellTopY = (vy + 1) * vs;
      if (cellTopY > chunkFloorY) {
        return true;
      }
    }

    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        vx += stepX;
        traveled = tMaxX;
        tMaxX += tDeltaX;
      } else {
        vz += stepZ;
        traveled = tMaxZ;
        tMaxZ += tDeltaZ;
      }
    } else if (tMaxY < tMaxZ) {
      vy += stepY;
      traveled = tMaxY;
      tMaxY += tDeltaY;
    } else {
      vz += stepZ;
      traveled = tMaxZ;
      tMaxZ += tDeltaZ;
    }
  }

  return false;
}
