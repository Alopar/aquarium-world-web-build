import * as THREE from 'three';
import { VOXEL_SIZE, WEATHER } from '../constants.js';
import { getMaterial, isSolid } from '../materials/registry.js';

const SIDE = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function blocksRain(id) {
  const mat = getMaterial(id);
  return mat.solid === true && mat.opaque === true && mat.organic !== true;
}

function isOpenToSky(grid, x, surfaceY, z) {
  for (let y = surfaceY + 1; y < grid.size.y; y++) {
    if (blocksRain(grid.get(x, y, z))) return false;
  }
  return true;
}

/** Top solid Y in column, or -1. */
function findSolidTop(grid, x, z) {
  if (!grid.inBounds(x, 0, z)) return -1;
  for (let y = grid.size.y - 1; y >= 0; y--) {
    if (isSolid(grid.get(x, y, z))) return y;
  }
  return -1;
}

/**
 * World Y of the first solid top at (wx, wz), scanning down from fromY.
 * Returns null if none.
 */
function findHitY(grid, wx, wz, fromY) {
  const x = Math.floor(wx);
  const z = Math.floor(wz);
  if (!grid.inBounds(x, 0, z)) return null;

  let y = Math.min(grid.size.y - 1, Math.floor(fromY));
  for (; y >= 0; y--) {
    const id = grid.get(x, y, z);
    if (id === 'air') continue;

    const mat = getMaterial(id);
    if (mat.organic) continue;
    if (mat.liquid) return (y + Math.min(1, 0.35)) * VOXEL_SIZE;
    if (mat.solid) return (y + 1) * VOXEL_SIZE;
  }
  return 0;
}

function isLocalBasin(grid, x, z) {
  const h = findSolidTop(grid, x, z);
  if (h < 0) return false;
  let taller = 0;
  for (const [dx, dz] of SIDE) {
    const nh = findSolidTop(grid, x + dx, z + dz);
    if (nh > h) taller++;
  }
  return taller >= 2;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export class WeatherSystem {
  /**
   * @param {import('../world/world.js').AquariumWorld} world
   * @param {THREE.Scene} scene
   * @param {import('./particle-system.js').ParticleSystem | null} particleSystem
   * @param {import('./sound.js').SoundSystem | null} sound
   */
  constructor(world, scene, particleSystem = null, sound = null, {
    rainEnabled = true,
  } = {}) {
    this.world = world;
    this.scene = scene;
    this.particleSystem = particleSystem;
    this.sound = sound;
    this.rainEnabled = rainEnabled;

    this.isRaining = false;
    this.cycleEnabled = true;
    /** null = автоцикл, true/false = принудительно */
    this.forcedRain = null;
    /** Первый дождь через ~25 с, дальше полный цикл dry/rain. */
    this.timer = Math.min(25, WEATHER.dryDuration);
    this.intensity = 0;
    this.targetIntensity = 0;
    this.puddleTimer = 0;
    this.exposedFactor = 1;

    this.group = new THREE.Group();
    this.group.name = 'rain';
    scene.add(this.group);

    this.dropCount = WEATHER.dropCount;
    this.positions = new Float32Array(this.dropCount * 6);
    this.speeds = new Float32Array(this.dropCount);
    this.alive = new Uint8Array(this.dropCount);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry = geometry;

    this.material = new THREE.LineBasicMaterial({
      color: 0xaacce8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });

    this.lines = new THREE.LineSegments(geometry, this.material);
    this.lines.frustumCulled = false;
    this.group.add(this.lines);
    this.group.visible = false;

    for (let i = 0; i < this.dropCount; i++) {
      this.speeds[i] = lerp(WEATHER.fallSpeedMin, WEATHER.fallSpeedMax, Math.random());
      this.alive[i] = 0;
    }
  }

  /**
   * @param {number} dt
   * @param {import('./player-controller.js').PlayerController | null} player
   * @param {import('./day-night.js').DayNightSystem | null} dayNight
   */
  update(dt, player = null, dayNight = null) {
    if (!this.rainEnabled) {
      this.group.visible = false;
      this.sound?.setRainLevel?.(0);
      return;
    }

    if (this.cycleEnabled && this.forcedRain === null) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.isRaining = !this.isRaining;
        this.timer = this.isRaining ? WEATHER.rainDuration : WEATHER.dryDuration;
        this.syncEvaporation();
      }
    }

    if (this.forcedRain !== null) {
      if (this.isRaining !== this.forcedRain) {
        this.isRaining = this.forcedRain;
        this.syncEvaporation();
      }
    }

    this.targetIntensity = this.isRaining ? 1 : 0;
    const fade = WEATHER.fadeSeconds > 0 ? dt / WEATHER.fadeSeconds : 1;
    if (this.intensity < this.targetIntensity) {
      this.intensity = Math.min(this.targetIntensity, this.intensity + fade);
    } else if (this.intensity > this.targetIntensity) {
      this.intensity = Math.max(this.targetIntensity, this.intensity - fade);
    }

    const cam = player?.camera;
    const lighting = this.world?.lighting;
    if (cam && lighting) {
      this.exposedFactor = lighting.sampleSkylightFactor(
        cam.position.x,
        cam.position.y,
        cam.position.z,
      );
    } else {
      this.exposedFactor = 1;
    }

    const visual = this.intensity * this.exposedFactor;
    this.material.opacity = visual * 0.42;
    this.group.visible = visual > 0.02;

    const grid = this.world?.grid;

    if (visual > 0.02 && cam && grid) {
      this.updateDrops(dt, cam, grid, visual);
    }

    if (this.isRaining && this.intensity > 0.4 && player?.position && grid) {
      this.updatePuddles(dt, player, grid);
    }

    this.applyAtmosphere(dayNight);
    this.sound?.setRainLevel?.(this.intensity * this.exposedFactor);
  }

  /** @param {boolean} enabled */
  setCycleEnabled(enabled) {
    this.cycleEnabled = enabled;
    if (enabled) this.forcedRain = null;
  }

  /** @param {boolean|null} raining null снимает принудительный режим */
  setForcedRain(raining) {
    this.forcedRain = raining;
    if (raining !== null) {
      this.isRaining = raining;
      this.syncEvaporation();
    }
  }

  syncEvaporation() {
    const fluids = this.world?.fluidSystem;
    if (!fluids) return;
    fluids.evaporationEnabled = !this.isRaining;
  }

  updateDrops(dt, camera, grid, visual) {
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    const half = WEATHER.areaHalfXZ;
    const height = WEATHER.areaHeight;
    const streak = WEATHER.streakLength;
    const activeCount = Math.floor(this.dropCount * Math.min(1, 0.25 + visual * 0.75));
    let splashes = 0;

    for (let i = 0; i < this.dropCount; i++) {
      const i6 = i * 6;

      if (i >= activeCount) {
        this.alive[i] = 0;
        this.positions[i6 + 1] = -999;
        this.positions[i6 + 4] = -999;
        continue;
      }

      if (!this.alive[i]) {
        this.respawnDrop(i, cx, cy, cz, half, height, true);
      }

      const speed = this.speeds[i];
      this.positions[i6 + 1] -= speed * dt;
      this.positions[i6 + 4] = this.positions[i6 + 1] - streak;

      const x = this.positions[i6];
      const y = this.positions[i6 + 1];
      const z = this.positions[i6 + 2];

      // Recycle if far from camera box
      if (
        Math.abs(x - cx) > half * 1.15
        || Math.abs(z - cz) > half * 1.15
        || y < cy - height * 0.85
      ) {
        this.respawnDrop(i, cx, cy, cz, half, height, false);
        continue;
      }

      const hitY = findHitY(grid, x, z, y + 0.2);
      if (hitY != null && y <= hitY) {
        const gx = Math.floor(x);
        const gz = Math.floor(z);
        const solidY = findSolidTop(grid, gx, gz);
        const open = solidY < 0 || isOpenToSky(grid, gx, solidY, gz);

        if (
          open
          && visual > 0.35
          && splashes < WEATHER.maxSplashesPerFrame
          && Math.random() < WEATHER.splashChance
        ) {
          this.particleSystem?.spawnSplash(x, hitY + 0.02, z);
          splashes++;
        }

        this.respawnDrop(i, cx, cy, cz, half, height, false);
      }
    }

    this.geometry.attributes.position.needsUpdate = true;
  }

  respawnDrop(i, cx, cy, cz, half, height, scatterY) {
    const x = cx + (Math.random() * 2 - 1) * half;
    const z = cz + (Math.random() * 2 - 1) * half;
    const y = scatterY
      ? cy + Math.random() * height
      : cy + height * (0.55 + Math.random() * 0.45);
    const streak = WEATHER.streakLength;
    const i6 = i * 6;
    this.positions[i6] = x;
    this.positions[i6 + 1] = y;
    this.positions[i6 + 2] = z;
    this.positions[i6 + 3] = x;
    this.positions[i6 + 4] = y - streak;
    this.positions[i6 + 5] = z;
    this.speeds[i] = lerp(WEATHER.fallSpeedMin, WEATHER.fallSpeedMax, Math.random());
    this.alive[i] = 1;
  }

  updatePuddles(dt, player, grid) {
    this.puddleTimer -= dt;
    if (this.puddleTimer > 0) return;
    this.puddleTimer = WEATHER.puddleInterval;

    const px = Math.floor(player.position.x);
    const pz = Math.floor(player.position.z);
    const radius = WEATHER.puddleRadius;

    for (let n = 0; n < WEATHER.puddleAttempts; n++) {
      let x = px + Math.floor((Math.random() * 2 - 1) * radius);
      let z = pz + Math.floor((Math.random() * 2 - 1) * radius);

      if (Math.random() < WEATHER.puddleBasinBias) {
        let best = null;
        let bestScore = -1;
        for (let t = 0; t < 6; t++) {
          const tx = px + Math.floor((Math.random() * 2 - 1) * radius);
          const tz = pz + Math.floor((Math.random() * 2 - 1) * radius);
          if (!grid.inBounds(tx, 0, tz)) continue;
          const h = findSolidTop(grid, tx, tz);
          if (h < 0) continue;
          if (!isOpenToSky(grid, tx, h, tz)) continue;
          const basin = isLocalBasin(grid, tx, tz) ? 2 : 0;
          const score = basin + (20 - h) + Math.random();
          if (score > bestScore) {
            bestScore = score;
            best = { x: tx, z: tz, h };
          }
        }
        if (best) {
          x = best.x;
          z = best.z;
        }
      }

      if (!grid.inBounds(x, 0, z)) continue;

      const solidY = findSolidTop(grid, x, z);
      if (solidY < 0) continue;
      if (!isOpenToSky(grid, x, solidY, z)) continue;

      const placeY = solidY + 1;
      if (!grid.inBounds(x, placeY, z)) continue;

      const cell = grid.get(x, placeY, z);
      if (cell !== 'air' && cell !== 'water') continue;
      if (isSolid(cell)) continue;

      if (cell === 'water') {
        const vol = this.world.getFluidVolume(x, placeY, z);
        if (vol >= WEATHER.puddleMaxVolume) continue;
      }

      const amount = Math.floor(
        lerp(WEATHER.puddleAmountMin, WEATHER.puddleAmountMax, Math.random()),
      );
      this.world.addFluid(x, placeY, z, 'water', amount);
    }
  }

  applyAtmosphere(dayNight) {
    const t = this.intensity * this.exposedFactor;
    if (t < 0.01 || !this.scene.fog) return;

    this.scene.fog.near *= lerp(1, WEATHER.fogNearMul, t);
    this.scene.fog.far *= lerp(1, WEATHER.fogFarMul, t);
  }

  dispose() {
    this.isRaining = false;
    this.syncEvaporation();
    this.sound?.setRainLevel?.(0);
    this.group.parent?.remove(this.group);
    this.geometry.dispose();
    this.material.dispose();
  }
}
