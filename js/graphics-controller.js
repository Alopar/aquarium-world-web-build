import { FLUID, GAS } from './constants.js';
import { applyUserFog, clampFogViewDistance } from './systems/fog-controller.js';
import { applyAquariumDecorEnabled } from './systems/aquarium-decor.js';
import { applyPixelScale, clampPixelScale } from './systems/pixel-scale.js';
import {
  DESKTOP_QUALITY,
  MOBILE_QUALITY,
  clampSkyFaceShade,
  saveGraphicsOverrides,
  syncSkyFaceShadeToLighting,
  tickOptionValue,
} from './quality-settings.js';
import { syncSkyFaceShadeUniforms } from './shaders/voxel-brightness-material.js';

function skyFaceShadeChanged(prev, next) {
  return next.skyFaceShadeEnabled !== prev.skyFaceShadeEnabled
    || next.skyFaceShadeTop !== prev.skyFaceShadeTop
    || next.skyFaceShadeEast !== prev.skyFaceShadeEast
    || next.skyFaceShadeSouth !== prev.skyFaceShadeSouth
    || next.skyFaceShadeWest !== prev.skyFaceShadeWest
    || next.skyFaceShadeNorth !== prev.skyFaceShadeNorth
    || next.skyFaceShadeBottom !== prev.skyFaceShadeBottom;
}

/**
 * Apply runtime graphics toggles (after game started).
 * @param {import('./app.js').App} app
 * @param {Partial<import('./quality-settings.js').DESKTOP_QUALITY>} patch
 */
export function applyGraphicsSettings(app, patch) {
  if (!app?.quality) return;

  const prev = app.quality;
  const patchNorm = { ...patch };
  if (patchNorm.fogViewDistance != null) {
    patchNorm.fogViewDistance = clampFogViewDistance(patchNorm.fogViewDistance);
  }
  if (patchNorm.pixelScale != null) {
    patchNorm.pixelScale = clampPixelScale(patchNorm.pixelScale);
  }
  for (const key of Object.keys(patchNorm)) {
    if (key.startsWith('skyFaceShade') && key !== 'skyFaceShadeEnabled') {
      patchNorm[key] = clampSkyFaceShade(patchNorm[key]);
    }
  }
  const next = { ...prev, ...patchNorm };
  const world = app.world;

  if (next.aquariumDecorEnabled !== prev.aquariumDecorEnabled) {
    applyAquariumDecorEnabled(app, next.aquariumDecorEnabled);
  }

  if (next.rainEnabled !== prev.rainEnabled && app.weather) {
    app.weather.rainEnabled = next.rainEnabled;
    if (!next.rainEnabled) {
      app.weather.group.visible = false;
      app.weather.intensity = 0;
      app.weather.targetIntensity = 0;
      app.sound?.setRainLevel?.(0);
    }
  }

  if (next.fluidTicksPerFrame !== prev.fluidTicksPerFrame && app.fluidSystem) {
    app.fluidSystem.maxTicksPerFrame = next.fluidTicksPerFrame;
  }

  if (next.gasTicksPerFrame !== prev.gasTicksPerFrame && app.gasSystem) {
    app.gasSystem.maxTicksPerFrame = next.gasTicksPerFrame;
  }

  if (next.lambertTerrain !== prev.lambertTerrain && world?.meshBuilder) {
    world.meshBuilder.setLambertTerrain(next.lambertTerrain);
  }

  if (next.pixelScale !== prev.pixelScale && app.renderer) {
    applyPixelScale(app.renderer, next.pixelScale, next.lowQuality);
  }

  if (next.foliageEnabled !== prev.foliageEnabled && world?.grassFoliageBuilder) {
    world.grassFoliageBuilder.setEnabled(next.foliageEnabled, world.scene);
  }

  if (next.fluidMeshEnabled !== prev.fluidMeshEnabled && world?.fluidMeshBuilder) {
    world.fluidMeshBuilder.setEnabled(next.fluidMeshEnabled, world.scene);
  }

  if (
    (next.fogEnabled !== prev.fogEnabled
      || next.fogViewDistance !== prev.fogViewDistance)
    && app.chunkVisibility
    && app.camera
    && app.world
  ) {
    app.chunkVisibility.update(app.camera, app.world, next, { force: true });
  }

  if (
    (next.fogEnabled !== prev.fogEnabled || next.fogViewDistance !== prev.fogViewDistance)
    && app.scene
  ) {
    applyUserFog(app.scene, next);
  }

  if (skyFaceShadeChanged(prev, next)) {
    syncSkyFaceShadeToLighting(next);
    // Sky face shade is applied in the fragment shader — no remesh.
    syncSkyFaceShadeUniforms();
  }

  app.quality = next;
  saveGraphicsOverrides(next);
}

/** @param {import('./app.js').App} app */
export function applyGraphicsPreset(app, preset) {
  applyGraphicsSettings(app, { ...preset });
}

/** @param {import('./app.js').App} app */
export function setGraphicsOption(app, key, enabled, maxTicks = FLUID.maxTicksPerFrame) {
  let value = enabled;
  if (key === 'fluidTicksPerFrame') {
    value = tickOptionValue(enabled, FLUID.maxTicksPerFrame);
  } else if (key === 'gasTicksPerFrame') {
    value = tickOptionValue(enabled, GAS.maxTicksPerFrame);
  }
  applyGraphicsSettings(app, { [key]: value });
}

/** @param {import('./app.js').App} app */
export function setGraphicsSlider(app, key, value) {
  applyGraphicsSettings(app, { [key]: value });
}

export { DESKTOP_QUALITY, MOBILE_QUALITY };
