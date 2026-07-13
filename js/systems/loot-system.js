import * as THREE from 'three';
import { LOOT, VOXEL_SIZE, PLAYER } from '../constants.js';
import { rollResourceDrops } from '../materials/registry.js';
import { isItem } from '../items/registry.js';
import { LootItem } from '../entities/loot-item.js';

function randomBurstVelocity() {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const dir = new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta),
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi),
  );
  dir.y = Math.abs(dir.y) * 0.55 + 0.45;
  dir.normalize();
  const speed = LOOT.burstSpeed * (0.65 + Math.random() * 0.55);
  const vel = dir.multiplyScalar(speed);
  vel.y += LOOT.burstUp * (0.5 + Math.random() * 0.5);
  return vel;
}

/**
 * Minecraft-style item drops: small entities, not placeable block projectiles.
 */
export class LootSystem {
  constructor(scene, world, playerController, blockInteraction, sound = null) {
    this.scene = scene;
    this.world = world;
    this.playerController = playerController;
    this.blockInteraction = blockInteraction;
    this.sound = sound;
    this.items = [];
    this.group = new THREE.Group();
    this.group.name = 'loot';
    scene.add(this.group);

    this._spawnDir = new THREE.Vector3();
    this._spawnPos = new THREE.Vector3();
    this._spawnVel = new THREE.Vector3();
  }

  get count() {
    return this.items.length;
  }

  spawn(itemId, position, velocity) {
    if (!isItem(itemId)) return false;
    const item = new LootItem(itemId, position, velocity);
    this.items.push(item);
    this.group.add(item.mesh);
    return true;
  }

  /** Throw a held item as loot (never places a block). */
  throw(itemId, origin, direction) {
    if (!isItem(itemId)) return false;
    this._spawnDir.copy(direction).normalize();
    this._spawnPos.copy(origin).addScaledVector(this._spawnDir, LOOT.spawnOffset);
    this._spawnVel.copy(this._spawnDir).multiplyScalar(LOOT.throwSpeed);
    this._spawnVel.y += 1.2;
    return this.spawn(itemId, this._spawnPos, this._spawnVel);
  }

  /**
   * Destroyed wood / ore node → scatter item loot entities.
   * @returns {boolean}
   */
  spawnBurst(sourceMaterialId, x, y, z) {
    const drops = rollResourceDrops(sourceMaterialId);
    if (drops.length === 0) return false;

    let spawned = false;
    const centerX = (x + 0.5) * VOXEL_SIZE;
    const centerY = (y + 0.5) * VOXEL_SIZE;
    const centerZ = (z + 0.5) * VOXEL_SIZE;

    for (const drop of drops) {
      for (let i = 0; i < drop.count; i++) {
        this._spawnPos.set(
          centerX + (Math.random() - 0.5) * 0.35,
          centerY + (Math.random() - 0.5) * 0.35,
          centerZ + (Math.random() - 0.5) * 0.35,
        );
        this._spawnVel.copy(randomBurstVelocity());
        if (this.spawn(drop.itemId, this._spawnPos, this._spawnVel)) {
          spawned = true;
        }
      }
    }

    return spawned;
  }

  tryPickup(item) {
    if (!item.canPickup() || !this.playerController || !this.blockInteraction) return false;

    const player = this.playerController.position;
    const cx = player.x;
    const cy = player.y + PLAYER.height * 0.45;
    const cz = player.z;
    const dx = item.position.x - cx;
    const dy = item.position.y - cy;
    const dz = item.position.z - cz;
    const r = LOOT.pickupRadius;
    if (dx * dx + dy * dy + dz * dz > r * r) return false;

    return this.blockInteraction.addToInventory(item.itemId, 1) === true;
  }

  update(dt) {
    const grid = this.world.grid;

    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      item.update(grid, dt);

      if (!item.alive) {
        this.removeAt(i);
        continue;
      }

      if (this.tryPickup(item)) {
        this.sound?.playLootPickup();
        this.removeAt(i);
      }
    }
  }

  removeAt(index) {
    const item = this.items[index];
    this.group.remove(item.mesh);
    item.dispose();
    this.items.splice(index, 1);
  }

  dispose() {
    for (const item of this.items) {
      this.group.remove(item.mesh);
      item.dispose();
    }
    this.items = [];
    this.scene.remove(this.group);
  }
}
