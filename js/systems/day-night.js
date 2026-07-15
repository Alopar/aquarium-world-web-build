import * as THREE from 'three';
import { DAY_NIGHT, PLAYER } from '../constants.js';
import { isPointInFluid } from '../physics/fluid-query.js';
import { setBrightnessUniforms } from '../shaders/voxel-brightness-material.js';

const _sky = new THREE.Color();
const _fog = new THREE.Color();
const _twilightSky = new THREE.Color();
const _twilightFog = new THREE.Color();
const _daySky = new THREE.Color();
const _dayFog = new THREE.Color();
const _nightSky = new THREE.Color();
const _nightFog = new THREE.Color();
const _waterFog = new THREE.Color();
const _waterSky = new THREE.Color();

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Skylight render multiplier (0…1).
 * Separate from dayAmount used for sky/fog colors — reaches 1.0 quickly when sun is up,
 * so skylight 15 gives full texture brightness during daytime (MC-style).
 */
function computeSkyLightFactor(sunAltitude) {
  if (sunAltitude <= 0) return 0;
  if (sunAltitude >= 0.08) return 1;
  return sunAltitude / 0.08;
}

/**
 * 0 = above water, 1 = eyes submerged in liquid.
 */
export function sampleUnderwaterFactor(grid, fluidField, worldX, eyeY, worldZ) {
  return isPointInFluid(grid, fluidField, worldX, eyeY, worldZ) ? 1 : 0;
}

function bakePresetColors() {
  const { day, night, twilight, underwater } = DAY_NIGHT;
  _daySky.setHex(day.sky);
  _dayFog.setHex(day.fog);
  _nightSky.setHex(night.sky);
  _nightFog.setHex(night.fog);
  _twilightSky.setHex(twilight.sky);
  _twilightFog.setHex(twilight.fog);
  _waterFog.setHex(underwater.fog);
  _waterSky.setHex(underwater.sky);
}

bakePresetColors();

export class DayNightSystem {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    this.elapsed = DAY_NIGHT.cycleSeconds * 0.12;
    this.cycleEnabled = true;
    this.underwaterFactor = 0;
    this.phase = 0;
    this.dayAmount = 1;
    this.skyLightFactor = 1;
  }

  /** @param {boolean} enabled */
  setCycleEnabled(enabled) {
    this.cycleEnabled = enabled;
  }

  /**
   * @param {'dawn'|'day'|'dusk'|'night'} period
   */
  setPeriod(period) {
    const phases = { dawn: 0, day: 0.25, dusk: 0.5, night: 0.75 };
    const phase = phases[period] ?? 0.25;
    this.elapsed = phase * DAY_NIGHT.cycleSeconds;
  }

  /**
   * @param {number} dt
   * @param {{ grid?: import('../world/voxel-grid.js').VoxelGrid, position?: THREE.Vector3, camera?: THREE.Camera } | null} player
   * @param {{ mesh?: THREE.Mesh } | null} spaceSky
   * @param {import('../fluids/fluid-field.js').FluidField | null} fluidField
   * @param {import('../world/world.js').AquariumWorld | null} world
   */
  update(dt, player = null, spaceSky = null, fluidField = null, world = null) {
    if (this.cycleEnabled) this.elapsed += dt;
    const cycle = DAY_NIGHT.cycleSeconds;
    this.phase = (this.elapsed % cycle) / cycle;

    const sunAltitude = Math.sin(this.phase * Math.PI * 2);
    this.dayAmount = smoothstep(-0.12, 0.28, sunAltitude);
    this.skyLightFactor = computeSkyLightFactor(sunAltitude);
    const twilight = (1 - Math.abs(sunAltitude)) * smoothstep(0.45, 0.05, Math.abs(sunAltitude));

    const day = DAY_NIGHT.day;
    const night = DAY_NIGHT.night;
    const t = this.dayAmount;

    _sky.copy(_nightSky).lerp(_daySky, t);
    _fog.copy(_nightFog).lerp(_dayFog, t);

    if (twilight > 0.01) {
      _sky.lerp(_twilightSky, twilight * 0.55);
      _fog.lerp(_twilightFog, twilight * 0.4);
    }

    let fogNear = lerp(night.fogNear, day.fogNear, t);
    let fogFar = lerp(night.fogFar, day.fogFar, t);

    const nightFogBoost = 1 - t;
    fogNear = lerp(fogNear, fogNear * 0.7, nightFogBoost * 0.5);
    fogFar = lerp(fogFar, fogFar * 0.75, nightFogBoost * 0.5);

    let targetWater = 0;
    if (player?.position && player?.grid) {
      const eyeX = player.camera?.position?.x ?? player.position.x;
      const eyeY = player.camera?.position?.y ?? (player.position.y + PLAYER.eyeHeight);
      const eyeZ = player.camera?.position?.z ?? player.position.z;
      targetWater = sampleUnderwaterFactor(player.grid, fluidField, eyeX, eyeY, eyeZ);
    }
    const waterLerp = targetWater > this.underwaterFactor ? dt * 28 : dt * 8;
    this.underwaterFactor += (targetWater - this.underwaterFactor) * Math.min(1, waterLerp);
    const w = this.underwaterFactor;
    const underWater = DAY_NIGHT.underwater;

    if (w > 0.001) {
      fogNear = lerp(fogNear, underWater.fogNear, w);
      fogFar = lerp(fogFar, underWater.fogFar, w);
      _sky.lerp(_waterSky, w);
      _fog.lerp(_waterFog, w);
    }

    this.scene.background.copy(_sky);
    if (this.scene.fog) {
      this.scene.fog.color.copy(_fog);
      this.scene.fog.near = fogNear;
      this.scene.fog.far = fogFar;
    }

    setBrightnessUniforms(this.skyLightFactor);

    const lumenMat = world?.meshBuilder?.threeMaterials?.get('lumen');
    if (lumenMat?.uniforms?.uEmissiveMul) {
      lumenMat.uniforms.uEmissiveMul.value = lerp(2.4, 1.6, t);
    }

    if (spaceSky?.decorEnabled && spaceSky.mesh && w > 0.35) {
      spaceSky.mesh.visible = false;
    }
  }

  /**
   * @returns {'dawn'|'day'|'dusk'|'night'}
   */
  getPeriod() {
    const sunAltitude = Math.sin(this.phase * Math.PI * 2);
    const rising = Math.cos(this.phase * Math.PI * 2) > 0;
    const nearHorizon = Math.abs(sunAltitude) < 0.35;

    if (nearHorizon && rising) return 'dawn';
    if (nearHorizon && !rising) return 'dusk';
    if (this.dayAmount > 0.45) return 'day';
    return 'night';
  }

  getPeriodLabel() {
    switch (this.getPeriod()) {
      case 'dawn': return 'Рассвет';
      case 'day': return 'День';
      case 'dusk': return 'Закат';
      default: return 'Ночь';
    }
  }
}
