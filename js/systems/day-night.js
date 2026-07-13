import * as THREE from 'three';
import { DAY_NIGHT, PLAYER } from '../constants.js';
import { getMaterial } from '../materials/registry.js';
import { isPointInFluid } from '../physics/fluid-query.js';
import { setFluidLightUniforms } from '../shaders/fluid-material.js';

const _sky = new THREE.Color();
const _fog = new THREE.Color();
const _ambient = new THREE.Color();
const _sun = new THREE.Color();
const _fill = new THREE.Color();
const _twilightSky = new THREE.Color();
const _twilightFog = new THREE.Color();
const _twilightAmbient = new THREE.Color();
const _twilightSun = new THREE.Color();
const _daySky = new THREE.Color();
const _dayFog = new THREE.Color();
const _dayAmbient = new THREE.Color();
const _daySun = new THREE.Color();
const _dayFill = new THREE.Color();
const _nightSky = new THREE.Color();
const _nightFog = new THREE.Color();
const _nightAmbient = new THREE.Color();
const _nightSun = new THREE.Color();
const _nightFill = new THREE.Color();
const _underFog = new THREE.Color();
const _underSky = new THREE.Color();
const _waterFog = new THREE.Color();
const _waterSky = new THREE.Color();
const _sunDir = new THREE.Vector3();

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function blocksSkylight(id) {
  const mat = getMaterial(id);
  return mat.solid === true && mat.opaque === true && mat.organic !== true;
}

/**
 * 0 = open sky, 1 = deep underground.
 * Organic (trees) does not count as ceiling.
 */
export function sampleUndergroundFactor(grid, worldX, eyeY, worldZ) {
  if (!grid) return 0;

  const x = Math.floor(worldX);
  const z = Math.floor(worldZ);
  if (!grid.inBounds(x, 0, z)) return 0;

  const startY = Math.floor(eyeY) + 1;
  let ceilingY = -1;
  for (let y = startY; y < grid.size.y; y++) {
    if (blocksSkylight(grid.get(x, y, z))) {
      ceilingY = y;
      break;
    }
  }
  if (ceilingY < 0) return 0;

  let cover = 0;
  const coverEnd = Math.min(grid.size.y, ceilingY + 20);
  for (let y = ceilingY; y < coverEnd; y++) {
    if (blocksSkylight(grid.get(x, y, z))) cover++;
  }

  const depth = ceilingY - eyeY;
  const depthFactor = smoothstep(0.5, 8, depth);
  const coverFactor = smoothstep(1, 10, cover);
  return Math.min(1, 0.72 + depthFactor * 0.18 + coverFactor * 0.1);
}

/**
 * 0 = above water, 1 = eyes submerged in liquid.
 */
export function sampleUnderwaterFactor(grid, fluidField, worldX, eyeY, worldZ) {
  return isPointInFluid(grid, fluidField, worldX, eyeY, worldZ) ? 1 : 0;
}

function bakePresetColors() {
  const { day, night, twilight, underground, underwater } = DAY_NIGHT;
  _daySky.setHex(day.sky);
  _dayFog.setHex(day.fog);
  _dayAmbient.setHex(day.ambientColor);
  _daySun.setHex(day.sunColor);
  _dayFill.setHex(day.fillColor);
  _nightSky.setHex(night.sky);
  _nightFog.setHex(night.fog);
  _nightAmbient.setHex(night.ambientColor);
  _nightSun.setHex(night.sunColor);
  _nightFill.setHex(night.fillColor);
  _twilightSky.setHex(twilight.sky);
  _twilightFog.setHex(twilight.fog);
  _twilightAmbient.setHex(twilight.ambientColor);
  _twilightSun.setHex(twilight.sunColor);
  _underFog.setHex(underground.fog);
  _underSky.setHex(underground.sky);
  _waterFog.setHex(underwater.fog);
  _waterSky.setHex(underwater.sky);
}

bakePresetColors();

export class DayNightSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {{ ambient: THREE.AmbientLight, sun: THREE.DirectionalLight, fill: THREE.PointLight, shadowsEnabled?: boolean }} lights
   */
  constructor(scene, lights) {
    this.scene = scene;
    this.lights = lights;
    this.shadowsEnabled = lights.shadowsEnabled !== false;
    // Start in the morning so the first minutes are bright
    this.elapsed = DAY_NIGHT.cycleSeconds * 0.12;
    this.undergroundFactor = 0;
    this.underwaterFactor = 0;
    this.phase = 0;
    this.dayAmount = 1;
  }

  /**
   * @param {number} dt
   * @param {{ grid?: import('../world/voxel-grid.js').VoxelGrid, position?: THREE.Vector3 } | null} player
   * @param {{ mesh?: THREE.Mesh } | null} spaceSky
   * @param {import('../fluids/fluid-field.js').FluidField | null} fluidField
   */
  update(dt, player = null, spaceSky = null, fluidField = null) {
    this.elapsed += dt;
    const cycle = DAY_NIGHT.cycleSeconds;
    this.phase = (this.elapsed % cycle) / cycle;

    // phase 0 = dawn, 0.25 = noon, 0.5 = dusk, 0.75 = midnight
    const sunAltitude = Math.sin(this.phase * Math.PI * 2);
    this.dayAmount = smoothstep(-0.12, 0.28, sunAltitude);
    const twilight = (1 - Math.abs(sunAltitude)) * smoothstep(0.45, 0.05, Math.abs(sunAltitude));

    const day = DAY_NIGHT.day;
    const night = DAY_NIGHT.night;
    const under = DAY_NIGHT.underground;
    const t = this.dayAmount;

    _sky.copy(_nightSky).lerp(_daySky, t);
    _fog.copy(_nightFog).lerp(_dayFog, t);
    _ambient.copy(_nightAmbient).lerp(_dayAmbient, t);
    _sun.copy(_nightSun).lerp(_daySun, t);
    _fill.copy(_nightFill).lerp(_dayFill, t);

    if (twilight > 0.01) {
      _sky.lerp(_twilightSky, twilight * 0.55);
      _fog.lerp(_twilightFog, twilight * 0.4);
      _ambient.lerp(_twilightAmbient, twilight * 0.35);
      _sun.lerp(_twilightSun, twilight * 0.5);
    }

    let ambientIntensity = lerp(night.ambientIntensity, day.ambientIntensity, t);
    let sunIntensity = lerp(night.sunIntensity, day.sunIntensity, t);
    let fillIntensity = lerp(night.fillIntensity, day.fillIntensity, t);
    let fogNear = lerp(night.fogNear, day.fogNear, t);
    let fogFar = lerp(night.fogFar, day.fogFar, t);

    // Stronger fog at night
    const nightFogBoost = 1 - t;
    fogNear = lerp(fogNear, fogNear * 0.7, nightFogBoost * 0.5);
    fogFar = lerp(fogFar, fogFar * 0.75, nightFogBoost * 0.5);

    const center = DAY_NIGHT.worldCenter;
    const angle = this.phase * Math.PI * 2;
    const sunX = center.x + Math.cos(angle) * DAY_NIGHT.sunOrbitRadius;
    const sunY = Math.max(-8, sunAltitude * DAY_NIGHT.sunOrbitHeight);
    const sunZ = center.z + Math.sin(angle) * DAY_NIGHT.sunOrbitRadius * 0.35;
    this.lights.sun.position.set(sunX, sunY, sunZ);

    let targetUnder = 0;
    let targetWater = 0;
    if (player?.position && player?.grid) {
      const eyeX = player.camera?.position?.x ?? player.position.x;
      const eyeY = player.camera?.position?.y ?? (player.position.y + PLAYER.eyeHeight);
      const eyeZ = player.camera?.position?.z ?? player.position.z;
      targetUnder = sampleUndergroundFactor(player.grid, eyeX, eyeY, eyeZ);
      targetWater = sampleUnderwaterFactor(player.grid, fluidField, eyeX, eyeY, eyeZ);
    }
    // Smooth to avoid flicker at cave mouths / water edge
    this.undergroundFactor += (targetUnder - this.undergroundFactor) * Math.min(1, dt * 4);
    // Snap into water faster so the veil appears as soon as eyes submerge
    const waterLerp = targetWater > this.underwaterFactor ? dt * 28 : dt * 8;
    this.underwaterFactor += (targetWater - this.underwaterFactor) * Math.min(1, waterLerp);
    const u = this.undergroundFactor;
    const w = this.underwaterFactor;
    const underWater = DAY_NIGHT.underwater;

    if (u > 0.001) {
      ambientIntensity *= lerp(1, under.lightMul, u);
      sunIntensity *= lerp(1, under.lightMul * 0.3, u);
      fillIntensity *= lerp(1, under.lightMul * 0.5, u);
      fogNear = lerp(fogNear, under.fogNear, u);
      fogFar = lerp(fogFar, under.fogFar, u);
      _sky.lerp(_underSky, u);
      _fog.lerp(_underFog, u);
      _ambient.multiplyScalar(lerp(1, 0.25, u));
      _sun.multiplyScalar(lerp(1, 0.15, u));
    }

    if (w > 0.001) {
      ambientIntensity = lerp(ambientIntensity, ambientIntensity * underWater.lightMul, w);
      sunIntensity = lerp(sunIntensity, sunIntensity * underWater.lightMul * 0.5, w);
      fillIntensity = lerp(fillIntensity, fillIntensity * underWater.lightMul * 0.65, w);
      fogNear = lerp(fogNear, underWater.fogNear, w);
      fogFar = lerp(fogFar, underWater.fogFar, w);
      _sky.lerp(_waterSky, w);
      _fog.lerp(_waterFog, w);
      _ambient.lerp(_waterFog, w * 0.55);
      _sun.lerp(_waterFog, w * 0.35);
    }

    this.scene.background.copy(_sky);
    if (this.scene.fog) {
      this.scene.fog.color.copy(_fog);
      this.scene.fog.near = fogNear;
      this.scene.fog.far = fogFar;
    }

    this.lights.ambient.color.copy(_ambient);
    this.lights.ambient.intensity = ambientIntensity;
    this.lights.sun.color.copy(_sun);
    this.lights.sun.intensity = Math.max(0, sunIntensity);
    this.lights.sun.castShadow = this.shadowsEnabled
      && sunAltitude > 0.05
      && u < 0.85
      && w < 0.5;
    this.lights.fill.color.copy(_fill);
    this.lights.fill.intensity = fillIntensity;

    _sunDir.set(sunX - center.x, sunY - center.y, sunZ - center.z).normalize();
    if (sunAltitude < 0) {
      _sunDir.y = Math.abs(_sunDir.y) * 0.15;
    }
    setFluidLightUniforms(_sunDir, _sun, sunIntensity, _ambient, ambientIntensity);

    // Cosmic backdrop only near glass walls on the surface
    if (spaceSky?.decorEnabled && spaceSky.mesh && (u > 0.45 || w > 0.35)) {
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

  /** Human-readable period label (RU). */
  getPeriodLabel() {
    switch (this.getPeriod()) {
      case 'dawn': return 'Рассвет';
      case 'day': return 'День';
      case 'dusk': return 'Закат';
      default: return 'Ночь';
    }
  }
}
