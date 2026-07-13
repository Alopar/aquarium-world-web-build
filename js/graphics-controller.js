import { FLUID, GAS } from './constants.js';
import { setAquariumTankGlassMode } from './world/glass-tank.js';
import {
  DESKTOP_QUALITY,
  MOBILE_QUALITY,
  saveGraphicsOverrides,
  tickOptionValue,
} from './quality-settings.js';

/**
 * Apply runtime graphics toggles (after game started).
 * @param {import('./app.js').App} app
 * @param {Partial<import('./quality-settings.js').DESKTOP_QUALITY>} patch
 */
export function applyGraphicsSettings(app, patch) {
  if (!app?.quality) return;

  const prev = app.quality;
  const next = { ...prev, ...patch };
  const world = app.world;

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

  if (next.simpleGlass !== prev.simpleGlass && world?.tank) {
    setAquariumTankGlassMode(world.tank, next.simpleGlass);
  }

  if (next.lambertTerrain !== prev.lambertTerrain && world?.meshBuilder) {
    world.meshBuilder.setLambertTerrain(next.lambertTerrain);
  }

  if (next.flatColorsTerrain !== prev.flatColorsTerrain && world?.meshBuilder) {
    world.meshBuilder.setFlatColors(next.flatColorsTerrain);
  }

  if (next.foliageEnabled !== prev.foliageEnabled && world?.grassFoliageBuilder) {
    world.grassFoliageBuilder.setEnabled(next.foliageEnabled, world.scene);
  }

  if (next.fluidMeshEnabled !== prev.fluidMeshEnabled && world?.fluidMeshBuilder) {
    world.fluidMeshBuilder.setEnabled(next.fluidMeshEnabled, world.scene);
  }

  if (next.simpleSmokeRender !== prev.simpleSmokeRender && world?.gasMeshBuilder) {
    world.gasMeshBuilder.setSimpleRender(next.simpleSmokeRender);
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

export { DESKTOP_QUALITY, MOBILE_QUALITY };
