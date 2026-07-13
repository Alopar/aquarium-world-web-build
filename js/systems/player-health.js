import { PLAYER_HEALTH, VOXEL_SIZE } from '../constants.js';
import { getMaterial } from '../materials/registry.js';

function sampleHazardUnderFeet(grid, position, halfWidth) {
  // position.y — уровень ног; блок под ногами на один индекс ниже.
  const gy = Math.floor((position.y - 1e-5) / VOXEL_SIZE) - 1;
  if (gy < 0) return 0;

  const blockTop = (gy + 1) * VOXEL_SIZE;
  if (position.y - blockTop > 0.12) return 0;

  const reach = halfWidth * 0.9;
  const samples = [
    [0, 0],
    [reach, reach],
    [reach, -reach],
    [-reach, reach],
    [-reach, -reach],
  ];

  let bestDps = 0;
  for (const [ox, oz] of samples) {
    const gx = Math.floor((position.x + ox) / VOXEL_SIZE);
    const gz = Math.floor((position.z + oz) / VOXEL_SIZE);
    if (!grid.inBounds(gx, gy, gz)) continue;

    const mat = getMaterial(grid.get(gx, gy, gz));
    const dps = mat.damagePerSecond ?? 0;
    if (dps > bestDps) bestDps = dps;
  }

  return bestDps;
}

export class PlayerHealth {
  constructor(playerController, sound = null, inventory = null) {
    this.player = playerController;
    this.sound = sound;
    this.inventory = inventory;
    this.maxHealth = PLAYER_HEALTH.max;
    this.health = this.maxHealth;
    this.hurtSoundCooldown = 0;
    this.listeners = new Set();
  }

  setInventory(inventory) {
    this.inventory = inventory;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    for (const fn of this.listeners) fn(this);
  }

  get ratio() {
    return this.health / this.maxHealth;
  }

  get isDead() {
    return this.health <= 0;
  }

  takeDamage(amount) {
    if (amount <= 0 || this.isDead) return false;

    const armor = this.inventory?.getTotalArmor?.() ?? 0;
    const reduced = Math.max(0, amount - armor * 0.5);

    const prev = this.health;
    this.health = Math.max(0, this.health - reduced);
    if (this.health !== prev) this.notify();
    return this.health < prev;
  }

  healFull() {
    if (this.health === this.maxHealth) return;
    this.health = this.maxHealth;
    this.notify();
  }

  respawn() {
    this.healFull();
    this.player.resetToSpawn();
    this.player.landingImpactSpeed = 0;
    this.hurtSoundCooldown = 0;
  }

  applyDamageWithSound(amount) {
    const damaged = this.takeDamage(amount);
    if (damaged && this.hurtSoundCooldown <= 0) {
      this.sound?.resume();
      this.sound?.playHurt?.();
      this.hurtSoundCooldown = PLAYER_HEALTH.hurtSoundInterval;
    }
    return damaged;
  }

  applyFallDamage() {
    const { player } = this;
    if (player.inFluid) return;

    const impact = player.landingImpactSpeed;
    if (player.mode !== 'walk' || impact < PLAYER_HEALTH.fallDamageMinSpeed) return;

    const excess = impact - PLAYER_HEALTH.fallDamageMinSpeed;
    const damage = excess * PLAYER_HEALTH.fallDamagePerSpeed;
    this.applyDamageWithSound(damage);
  }

  update(dt) {
    if (this.hurtSoundCooldown > 0) {
      this.hurtSoundCooldown = Math.max(0, this.hurtSoundCooldown - dt);
    }

    const { player } = this;
    if (player.mode !== 'walk') return;

    this.applyFallDamage();

    if (!player.onGround) return;

    const dps = sampleHazardUnderFeet(player.grid, player.position, player.halfWidth);
    if (dps > 0) {
      this.applyDamageWithSound(dps * dt);
    }

    if (this.isDead) {
      this.respawn();
    }
  }
}
