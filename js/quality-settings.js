import { FLUID, GAS, WEATHER } from './constants.js';

/**
 * Runtime quality toggles (mobile / low preset).
 * @param {boolean} isMobile
 */
export function createQualitySettings(isMobile) {
  if (!isMobile) {
    return {
      lowQuality: false,
      rainEnabled: true,
      rainDropCount: WEATHER.dropCount,
      fluidTicksPerFrame: FLUID.maxTicksPerFrame,
      gasTicksPerFrame: GAS.maxTicksPerFrame,
      simpleGlass: false,
      lambertTerrain: false,
      foliageEnabled: true,
      fluidMeshEnabled: true,
    };
  }

  return {
    lowQuality: true,
    rainEnabled: false,
    rainDropCount: 0,
    fluidTicksPerFrame: 0,
    gasTicksPerFrame: 0,
    simpleGlass: true,
    lambertTerrain: true,
    foliageEnabled: false,
    fluidMeshEnabled: false,
  };
}
