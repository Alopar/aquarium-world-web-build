import * as THREE from 'three';
import { BOMB, PLAYER, VOXEL_SIZE } from '../constants.js';
import { hasDrops, isBreakable, isResourceBlock } from '../materials/registry.js';
import { ThrownBomb } from '../entities/thrown-bomb.js';

/**
 * Throwable bombs: loot-style throw → fuse → spherical voxel blast.
 */
export class BombSystem {
  constructor(scene, world, playerController, playerHealth, particleSystem, sound, lootSystem) {
    this.scene = scene;
    this.world = world;
    this.playerController = playerController;
    this.playerHealth = playerHealth;
    this.particleSystem = particleSystem;
    this.sound = sound;
    this.lootSystem = lootSystem;
    this.bombs = [];
    this.group = new THREE.Group();
    this.group.name = 'bombs';
    scene.add(this.group);

    this._spawnDir = new THREE.Vector3();
    this._spawnPos = new THREE.Vector3();
    this._spawnVel = new THREE.Vector3();
  }

  get count() {
    return this.bombs.length;
  }

  throw(origin, direction) {
    this._spawnDir.copy(direction).normalize();
    this._spawnPos.copy(origin).addScaledVector(this._spawnDir, BOMB.spawnOffset);
    this._spawnVel.copy(this._spawnDir).multiplyScalar(BOMB.throwSpeed);
    this._spawnVel.y += 1.4;

    const bomb = new ThrownBomb(this._spawnPos, this._spawnVel);
    this.bombs.push(bomb);
    this.group.add(bomb.mesh);
    return true;
  }

  update(dt) {
    const grid = this.world.grid;

    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const bomb = this.bombs[i];
      bomb.update(grid, dt);

      if (bomb.detonated) {
        this.explode(bomb.position.x, bomb.position.y, bomb.position.z);
        this.removeAt(i);
        continue;
      }

      if (!bomb.alive) {
        this.removeAt(i);
      }
    }
  }

  /**
   * Destroy breakable voxels in a sphere of BOMB.radius cells; damage nearby player.
   */
  explode(worldX, worldY, worldZ) {
    const cx = Math.floor(worldX / VOXEL_SIZE);
    const cy = Math.floor(worldY / VOXEL_SIZE);
    const cz = Math.floor(worldZ / VOXEL_SIZE);
    const r = BOMB.radius;
    const r2 = r * r;

    this.sound?.playExplosion?.();
    this.particleSystem?.spawnExplosion?.(
      (cx + 0.5) * VOXEL_SIZE,
      (cy + 0.5) * VOXEL_SIZE,
      (cz + 0.5) * VOXEL_SIZE,
    );

    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          if (dx * dx + dy * dy + dz * dz > r2) continue;

          const x = cx + dx;
          const y = cy + dy;
          const z = cz + dz;
          if (!this.world.grid.inBounds(x, y, z)) continue;

          const materialId = this.world.getBlock(x, y, z);
          if (!isBreakable(materialId)) continue;

          if (this.world.setBlock(x, y, z, 'air')) {
            this.particleSystem?.spawnBlockBreak(x, y, z, materialId);
            if (isResourceBlock(materialId) || hasDrops(materialId)) {
              this.lootSystem?.spawnBurst(materialId, x, y, z);
            }
          }
        }
      }
    }

    this.damagePlayer(worldX, worldY, worldZ);
  }

  damagePlayer(worldX, worldY, worldZ) {
    if (!this.playerController || !this.playerHealth) return;

    const player = this.playerController.position;
    const px = player.x;
    const py = player.y + PLAYER.height * 0.5;
    const pz = player.z;
    const dx = px - worldX;
    const dy = py - worldY;
    const dz = pz - worldZ;
    const dist = Math.hypot(dx, dy, dz);
    const maxDist = (BOMB.radius + 0.75) * VOXEL_SIZE;
    if (dist > maxDist) return;

    const falloff = 1 - dist / maxDist;
    const damage = BOMB.playerDamage * falloff * falloff;
    this.playerHealth.applyDamageWithSound(damage);
  }

  removeAt(index) {
    const bomb = this.bombs[index];
    this.group.remove(bomb.mesh);
    bomb.dispose();
    this.bombs.splice(index, 1);
  }

  dispose() {
    for (const bomb of this.bombs) {
      this.group.remove(bomb.mesh);
      bomb.dispose();
    }
    this.bombs = [];
    this.scene.remove(this.group);
  }
}
