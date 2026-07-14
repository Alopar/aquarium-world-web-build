import * as THREE from 'three';
import { VOXEL_SIZE } from '../constants.js';
import { clampFogViewDistance } from './fog-controller.js';

const _frustum = new THREE.Frustum();
const _projScreenMatrix = new THREE.Matrix4();
const _box = new THREE.Box3();
const _boxMin = new THREE.Vector3();
const _boxMax = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _chunkCenter = new THREE.Vector3();
const _boxSize = new THREE.Vector3();

/**
 * CPU chunk visibility: frustum AABB + optional fog distance cull.
 */
export class ChunkVisibilitySystem {
  constructor() {
    this.stats = {
      empty: 0,
      visible: 0,
      frustumHidden: 0,
      fogHidden: 0,
    };
  }

  /**
   * @param {THREE.Camera} camera
   * @param {import('../world/world.js').AquariumWorld | null} world
   * @param {object} quality
   * @param {{ force?: boolean }} [opts]
   */
  update(camera, world, quality, _opts = {}) {
    const meshBuilder = world?.meshBuilder;
    const grid = world?.grid;
    if (!meshBuilder || !grid || !camera) return;

    const fogOn = quality?.fogEnabled === true;
    const fogLimit = fogOn ? clampFogViewDistance(quality.fogViewDistance) : null;

    _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projScreenMatrix);
    camera.getWorldPosition(_origin);

    let empty = 0;
    let visible = 0;
    let frustumHidden = 0;
    let fogHidden = 0;

    for (const chunk of meshBuilder.chunks.values()) {
      if (!chunk.hasGeometry) {
        chunk.group.visible = false;
        empty += 1;
        continue;
      }

      _boxMin.fromArray(chunk.boxMin);
      _boxMax.fromArray(chunk.boxMax);
      _box.set(_boxMin, _boxMax);

      if (fogLimit != null && isBeyondFogDistance(_box, _origin, fogLimit)) {
        chunk.group.visible = false;
        fogHidden += 1;
        continue;
      }

      if (!_frustum.intersectsBox(_box)) {
        chunk.group.visible = false;
        frustumHidden += 1;
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

    this.stats = { empty, visible, frustumHidden, fogHidden };
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
