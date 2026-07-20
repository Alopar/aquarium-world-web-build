import * as THREE from 'three';
import { PROJECTILE, VOXEL_SIZE } from '../constants.js';
import {
  getLightColor,
  getLightLevel,
  getMaterial,
  isPlaceable,
  isResourceBlock,
  isSolid,
} from '../materials/registry.js';
import { getFluid, isFluidMaterial } from '../fluids/registry.js';
import { getGas, isGasMaterial } from '../gases/registry.js';
import { blockIntersectsPlayerAabb } from '../physics/voxel-collision.js';
import { Projectile } from '../physics/projectile.js';

const NEIGHBORS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export function isThrowableMaterial(materialId) {
  if (!materialId) return false;
  if (isResourceBlock(materialId)) return false;
  if (isFluidMaterial(materialId) || isGasMaterial(materialId)) return true;
  const mat = getMaterial(materialId);
  return mat.solid && mat.breakable !== false && mat.placeable !== false;
}

/** Impulse away from solid face-neighbors (including organic attachments). */
export function collapseAwayVelocity(grid, x, y, z) {
  let dx = 0;
  let dy = 0;
  let dz = 0;

  for (const [ox, oy, oz] of NEIGHBORS) {
    const nx = x + ox;
    const ny = y + oy;
    const nz = z + oz;
    if (!grid.inBounds(nx, ny, nz)) continue;
    if (!isSolid(grid.get(nx, ny, nz))) continue;
    dx -= ox;
    dy -= oy;
    dz -= oz;
  }

  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) {
    return new THREE.Vector3(0, 0, 0);
  }

  const speed = PROJECTILE.collapseImpulse;
  return new THREE.Vector3((dx / len) * speed, (dy / len) * speed, (dz / len) * speed);
}

export class ProjectileSystem {
  constructor(scene, world, playerController, blockInteraction, sound = null, detachedBlocks = null) {
    this.scene = scene;
    this.world = world;
    this.playerController = playerController;
    this.blockInteraction = blockInteraction;
    this.sound = sound;
    this.detachedBlocks = detachedBlocks;
    this.projectiles = [];
    this.group = new THREE.Group();
    this.group.name = 'projectiles';
    scene.add(this.group);

    this._spawnDir = new THREE.Vector3();
    this._spawnPos = new THREE.Vector3();
    this._spawnVel = new THREE.Vector3();
  }

  get count() {
    return this.projectiles.length;
  }

  /**
   * Spawn a physical block at a world position with the given velocity.
   * @returns {boolean}
   */
  spawn(materialId, position, velocity, { mesh = null } = {}) {
    if (!isThrowableMaterial(materialId)) return false;

    const projectile = new Projectile(materialId, position, velocity, { mesh });
    const { x: bx, y: by, z: bz } = {
      x: Math.floor(projectile.position.x / VOXEL_SIZE),
      y: Math.floor(projectile.position.y / VOXEL_SIZE),
      z: Math.floor(projectile.position.z / VOXEL_SIZE),
    };
    if (this.world.grid.inBounds(bx, by, bz)) {
      const id = this.world.getBlock(bx, by, bz);
      if (id === 'air' || getFluid(id) || getGas(id)) {
        projectile.lastAirCell = { x: bx, y: by, z: bz };
      }
    }

    this.projectiles.push(projectile);
    this.group.add(projectile.mesh);
    this._syncProjectileLight(projectile);
    return true;
  }

  throw(materialId, origin, direction) {
    this._spawnDir.copy(direction).normalize();
    this._spawnPos.copy(origin).addScaledVector(this._spawnDir, PROJECTILE.spawnOffset);
    this._spawnVel.copy(this._spawnDir).multiplyScalar(PROJECTILE.throwSpeed);
    return this.spawn(materialId, this._spawnPos, this._spawnVel);
  }

  /**
   * Turn a collapsed voxel into a falling block with impulse away from attachments.
   * Neighbors are read after the voxel is cleared to air.
   * Resource / drop blocks are handled by LootSystem before this is called.
   */
  spawnFromCollapse(materialId, x, y, z, { mesh = null } = {}) {
    this._spawnPos.set(
      (x + 0.5) * VOXEL_SIZE,
      (y + 0.5) * VOXEL_SIZE,
      (z + 0.5) * VOXEL_SIZE,
    );
    this._spawnVel.copy(collapseAwayVelocity(this.world.grid, x, y, z));
    return this.spawn(materialId, this._spawnPos, this._spawnVel, { mesh });
  }

  /**
   * Spawn with an explicit world-space velocity (blast edge kick, etc.).
   */
  spawnFromImpulse(materialId, x, y, z, vx, vy, vz, { mesh = null } = {}) {
    this._spawnPos.set(
      (x + 0.5) * VOXEL_SIZE,
      (y + 0.5) * VOXEL_SIZE,
      (z + 0.5) * VOXEL_SIZE,
    );
    this._spawnVel.set(vx, vy, vz);
    return this.spawn(materialId, this._spawnPos, this._spawnVel, { mesh });
  }

  canPlaceAt(x, y, z) {
    if (!this.world.grid.inBounds(x, y, z)) return false;
    const id = this.world.getBlock(x, y, z);
    // Solids block placement; air / liquid / gas are fine (displaced as needed).
    if (id !== 'air' && !getFluid(id) && !getGas(id)) return false;
    if (this.playerController) {
      const playerAabb = this.playerController.getAabb();
      if (blockIntersectsPlayerAabb(playerAabb, x, y, z, VOXEL_SIZE)) return false;
    }
    return true;
  }

  placeProjectile(materialId, cell, { mesh = null } = {}) {
    if (!cell) {
      if (mesh) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      return false;
    }
    if (!isPlaceable(materialId)) {
      if (mesh) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      return false;
    }
    const { x, y, z } = cell;
    if (!this.canPlaceAt(x, y, z)) {
      if (mesh) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      return false;
    }

    const fluid = getFluid(materialId);
    const gas = getGas(materialId);
    let placed = false;

    if (fluid) {
      const existing = getFluid(this.world.getBlock(x, y, z));
      if (existing && existing.id === fluid.id) {
        this.world.addFluid(x, y, z, materialId, fluid.maxVolume);
        placed = true;
      } else if (existing) {
        this.world.displaceFluid(x, y, z);
        placed = this.world.setFluid(x, y, z, materialId, fluid.maxVolume);
      } else {
        placed = this.world.setFluid(x, y, z, materialId, fluid.maxVolume);
      }
      if (mesh) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    } else if (gas) {
      const existing = getGas(this.world.getBlock(x, y, z));
      if (existing && existing.id === gas.id) {
        this.world.addGas(x, y, z, materialId, gas.maxVolume);
        placed = true;
      } else if (existing) {
        this.world.displaceGas(x, y, z);
        placed = this.world.setGas(x, y, z, materialId, gas.maxVolume);
      } else {
        placed = this.world.setGas(x, y, z, materialId, gas.maxVolume);
      }
      if (mesh) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    } else {
      // Skip chunk remesh — light updates immediately; mesh settles via disturbed collect.
      placed = this.world.setBlock(x, y, z, materialId, { skipMesh: true });
      if (placed) {
        const key = `${x},${y},${z}`;
        const pending = this.world.blockSupport?.pendingByKey?.has(key);
        if (!pending) {
          this.detachedBlocks?.placeDisturbed(x, y, z, materialId);
        }
      }
      if (mesh) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    }

    if (placed) {
      this.sound?.playBlockPlace(materialId);
      return true;
    }
    return false;
  }

  update(dt) {
    const lighting = this.world.lighting;

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];
      const result = projectile.update(this.world.grid, dt, lighting);
      if (!result) {
        this._syncProjectileLight(projectile);
        continue;
      }

      lighting.removeDynamicLight(projectile.lightId);

      const mesh = projectile.releaseMesh();
      if (mesh) this.group.remove(mesh);

      const placed = this.placeProjectile(projectile.materialId, result.cell, { mesh });
      if (!placed) {
        this.blockInteraction?.addToInventory(projectile.materialId, 1, { allowFluid: true });
      }

      projectile.dispose();
      this.projectiles.splice(i, 1);
    }
  }

  _syncProjectileLight(projectile) {
    const level = getLightLevel(projectile.materialId);
    if (level <= 0) return;
    this.world.lighting.upsertDynamicLight(
      projectile.lightId,
      projectile.position.x,
      projectile.position.y,
      projectile.position.z,
      level,
      getLightColor(projectile.materialId),
    );
  }

  dispose() {
    for (const projectile of this.projectiles) {
      this.world.lighting.removeDynamicLight(projectile.lightId);
      if (projectile.mesh) this.group.remove(projectile.mesh);
      projectile._ownsMesh = true;
      projectile.dispose();
    }
    this.projectiles = [];
    this.scene.remove(this.group);
  }
}
