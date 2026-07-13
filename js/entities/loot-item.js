import * as THREE from 'three';
import { LOOT } from '../constants.js';
import { isSolid } from '../materials/registry.js';
import { getStackDef } from '../items/stack.js';
import { getBlockTexture } from '../materials/textures.js';

function createLootMaterial(def) {
  const texture = def.texture ? getBlockTexture(def.texture) : null;
  const params = {
    color: texture ? 0xffffff : (def.color ?? 0xffffff),
    transparent: def.opacity != null && def.opacity < 1,
    opacity: def.opacity ?? 1,
    roughness: 0.85,
    metalness: 0.05,
  };
  if (texture) params.map = texture;
  if (def.emissive != null) {
    params.emissive = def.emissive;
    params.emissiveIntensity = 0.55;
  }
  return new THREE.MeshStandardMaterial(params);
}

function cellSolid(grid, x, y, z) {
  if (!grid.inBounds(x, y, z)) return true;
  return isSolid(grid.get(x, y, z));
}

/**
 * World-space item entity — craft loot, not a voxel block.
 * Bounces on solids, bobbles on the ground, never places into the grid.
 */
export class LootItem {
  constructor(itemId, position, velocity) {
    this.itemId = itemId;
    /** @deprecated use itemId — kept for older call sites */
    this.materialId = itemId;
    this.position = position.clone();
    this.velocity = velocity.clone();
    this.age = 0;
    this.pickupDelay = LOOT.pickupDelay;
    this.onGround = false;
    this.alive = true;
    this.bobPhase = Math.random() * Math.PI * 2;

    const def = getStackDef(itemId);
    const geometry = new THREE.BoxGeometry(LOOT.size, LOOT.size, LOOT.size);
    this.mesh = new THREE.Mesh(geometry, createLootMaterial(def));
    this.syncMesh(0);
  }

  syncMesh(dt = 0) {
    this.bobPhase += dt * LOOT.bobSpeed;
    const bob = this.onGround ? (Math.sin(this.bobPhase) * 0.5 + 0.5) * LOOT.bobAmplitude : 0;
    this.mesh.position.set(this.position.x, this.position.y + bob, this.position.z);
    this.mesh.rotation.y += dt * LOOT.spinSpeed;
    if (!this.onGround) {
      this.mesh.rotation.x += dt * LOOT.spinSpeed * 0.55;
    } else {
      this.mesh.rotation.x *= 0.9;
    }
  }

  update(grid, dt) {
    if (!this.alive) return;

    this.age += dt;
    if (this.pickupDelay > 0) this.pickupDelay -= dt;

    if (this.age >= LOOT.lifetime) {
      this.alive = false;
      return;
    }

    const subDt = dt / LOOT.subSteps;
    this.onGround = false;

    for (let step = 0; step < LOOT.subSteps; step++) {
      this.velocity.y -= LOOT.gravity * subDt;
      this.velocity.y = Math.max(this.velocity.y, -LOOT.maxFallSpeed);

      const drag = Math.max(0, 1 - LOOT.airDrag * subDt);
      this.velocity.x *= drag;
      this.velocity.z *= drag;

      this.moveAxis(grid, 'x', this.velocity.x * subDt);
      this.moveAxis(grid, 'y', this.velocity.y * subDt);
      this.moveAxis(grid, 'z', this.velocity.z * subDt);
    }

    if (this.onGround) {
      const friction = Math.max(0, 1 - LOOT.groundFriction * dt);
      this.velocity.x *= friction;
      this.velocity.z *= friction;
      if (Math.abs(this.velocity.x) < 0.02) this.velocity.x = 0;
      if (Math.abs(this.velocity.z) < 0.02) this.velocity.z = 0;
    }

    this.syncMesh(dt);
  }

  moveAxis(grid, axis, delta) {
    if (delta === 0) return;

    const half = LOOT.size * 0.5;
    this.position[axis] += delta;

    // Probe the leading face of the loot AABB (center + half-extent).
    const probe = {
      x: this.position.x + (axis === 'x' ? Math.sign(delta) * half : 0),
      y: this.position.y + (axis === 'y' ? Math.sign(delta) * half : 0),
      z: this.position.z + (axis === 'z' ? Math.sign(delta) * half : 0),
    };
    const bx = Math.floor(probe.x);
    const by = Math.floor(probe.y);
    const bz = Math.floor(probe.z);

    if (!cellSolid(grid, bx, by, bz)) return;

    // Rest the loot face flush on the solid face (not center-on-surface).
    if (delta > 0) {
      const face = axis === 'x' ? bx : axis === 'y' ? by : bz;
      this.position[axis] = face - half - 1e-4;
    } else {
      const face = (axis === 'x' ? bx : axis === 'y' ? by : bz) + 1;
      this.position[axis] = face + half + 1e-4;
    }

    if (axis === 'y' && delta < 0) {
      this.velocity.y *= -LOOT.bounce;
      if (Math.abs(this.velocity.y) < 1.1) this.velocity.y = 0;
      this.onGround = true;
    } else {
      this.velocity[axis] *= -LOOT.bounce;
    }
  }

  canPickup() {
    return this.alive && this.pickupDelay <= 0;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
