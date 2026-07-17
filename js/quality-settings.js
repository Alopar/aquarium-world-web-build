import { FLUID, GAS, LIGHTING } from './constants.js';
import { FOG_VIEW, clampFogViewDistance } from './systems/fog-controller.js';
import { PIXEL_SCALE, clampPixelScale } from './systems/pixel-scale.js';

const STORAGE_KEY = 'aquarium-graphics-v1';

const SKY_SHADE = LIGHTING.skyFaceShade;

/** Slider range for directional sky-face multipliers. */
export const SKY_FACE_SHADE_SLIDER = {
  min: 0.8,
  max: 1,
  step: 0.01,
};

const SKY_FACE_SHADE_DEFAULTS = {
  skyFaceShadeEnabled: LIGHTING.skyFaceShadeEnabled !== false,
  skyFaceShadeTop: SKY_SHADE.top,
  skyFaceShadeEast: SKY_SHADE.east,
  skyFaceShadeSouth: SKY_SHADE.south,
  skyFaceShadeWest: SKY_SHADE.west,
  skyFaceShadeNorth: SKY_SHADE.north,
  skyFaceShadeBottom: SKY_SHADE.bottom,
};

export const DESKTOP_QUALITY = {
  lowQuality: false,
  aquariumDecorEnabled: true,
  rainEnabled: true,
  fluidTicksPerFrame: FLUID.maxTicksPerFrame,
  gasTicksPerFrame: GAS.maxTicksPerFrame,
  lambertTerrain: false,
  foliageEnabled: true,
  fluidMeshEnabled: true,
  fogEnabled: false,
  fogViewDistance: FOG_VIEW.default,
  pixelScale: 1,
  ...SKY_FACE_SHADE_DEFAULTS,
};

export const MOBILE_QUALITY = {
  lowQuality: true,
  aquariumDecorEnabled: true,
  rainEnabled: false,
  fluidTicksPerFrame: 0,
  gasTicksPerFrame: 0,
  lambertTerrain: true,
  foliageEnabled: false,
  fluidMeshEnabled: false,
  fogEnabled: false,
  fogViewDistance: 45,
  pixelScale: 1,
  ...SKY_FACE_SHADE_DEFAULTS,
};

/** UI metadata for the graphics panel. */
export const GRAPHICS_OPTIONS = [
  {
    key: 'aquariumDecorEnabled',
    label: 'Стекло и skybox',
    hint: 'Выкл — только мир (воксели + фон суток)',
  },
  {
    key: 'rainEnabled',
    label: 'Дождь',
    hint: 'Капли, лужи, атмосфера',
  },
  {
    key: 'fluidTicksPerFrame',
    label: 'Симуляция жидкостей',
    hint: 'CPU: тики воды',
    tickKey: true,
    maxTicks: FLUID.maxTicksPerFrame,
  },
  {
    key: 'gasTicksPerFrame',
    label: 'Симуляция дыма',
    hint: 'CPU: тики газа',
    tickKey: true,
    maxTicks: GAS.maxTicksPerFrame,
  },
  {
    key: 'lambertTerrain',
    label: 'Lambert-материалы мира',
    hint: 'Проще Standard PBR (только текстуры)',
  },
  {
    key: 'foliageEnabled',
    label: 'Трава и цветы',
    hint: 'Instancing + шейдер',
  },
  {
    key: 'fluidMeshEnabled',
    label: 'Отрисовка воды',
    hint: 'Fluid shader на GPU',
  },
  {
    key: 'fogEnabled',
    label: 'Плотный туман',
    hint: 'Линейный туман + отсечение дальних чанков',
  },
  {
    key: 'skyFaceShadeEnabled',
    label: 'Направленный небесный свет',
    hint: 'Тоновые грани при чистом skylight (~11:00)',
  },
];

function skyShadeSlider(key, label, hint) {
  return {
    key,
    label,
    hint,
    min: SKY_FACE_SHADE_SLIDER.min,
    max: SKY_FACE_SHADE_SLIDER.max,
    step: SKY_FACE_SHADE_SLIDER.step,
    unit: '%',
    format: 'percent',
    requires: 'skyFaceShadeEnabled',
  };
}

export const GRAPHICS_SLIDERS = [
  {
    key: 'fogViewDistance',
    label: 'Дальность тумана',
    hint: '4 м — вплотную, дальше не видно',
    min: FOG_VIEW.min,
    max: FOG_VIEW.max,
    step: 1,
    unit: 'м',
    requires: 'fogEnabled',
  },
  {
    key: 'pixelScale',
    label: 'Pixel scale (A/B)',
    hint: '0.25× — меньше пикселей; до 2× — выше чёткость, ниже FPS',
    min: PIXEL_SCALE.min,
    max: PIXEL_SCALE.max,
    step: PIXEL_SCALE.step,
    unit: '×',
  },
  skyShadeSlider('skyFaceShadeTop', 'Небо: верх', '+Y — обычно 100%'),
  skyShadeSlider('skyFaceShadeEast', 'Небо: восток', '+X — к утреннему солнцу'),
  skyShadeSlider('skyFaceShadeSouth', 'Небо: юг', '+Z — к утреннему солнцу'),
  skyShadeSlider('skyFaceShadeWest', 'Небо: запад', '−X — тень'),
  skyShadeSlider('skyFaceShadeNorth', 'Небо: север', '−Z — тень'),
  skyShadeSlider('skyFaceShadeBottom', 'Небо: низ', '−Y — самая тёмная грань'),
];

const SKY_FACE_SHADE_KEYS = new Set([
  'skyFaceShadeEnabled',
  'skyFaceShadeTop',
  'skyFaceShadeEast',
  'skyFaceShadeSouth',
  'skyFaceShadeWest',
  'skyFaceShadeNorth',
  'skyFaceShadeBottom',
]);

export function isSkyFaceShadeKey(key) {
  return SKY_FACE_SHADE_KEYS.has(key);
}

export function isTickOptionEnabled(value) {
  return (value ?? 0) > 0;
}

export function tickOptionValue(enabled, maxTicks) {
  return enabled ? maxTicks : 0;
}

export function clampSkyFaceShade(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return SKY_FACE_SHADE_SLIDER.max;
  return Math.min(SKY_FACE_SHADE_SLIDER.max, Math.max(SKY_FACE_SHADE_SLIDER.min, n));
}

/**
 * Push quality sky-face shade into mutable LIGHTING (read by bake).
 * @param {typeof DESKTOP_QUALITY} quality
 */
export function syncSkyFaceShadeToLighting(quality) {
  if (!quality) return;
  LIGHTING.skyFaceShadeEnabled = quality.skyFaceShadeEnabled !== false;
  LIGHTING.skyFaceShade.top = clampSkyFaceShade(quality.skyFaceShadeTop);
  LIGHTING.skyFaceShade.east = clampSkyFaceShade(quality.skyFaceShadeEast);
  LIGHTING.skyFaceShade.south = clampSkyFaceShade(quality.skyFaceShadeSouth);
  LIGHTING.skyFaceShade.west = clampSkyFaceShade(quality.skyFaceShadeWest);
  LIGHTING.skyFaceShade.north = clampSkyFaceShade(quality.skyFaceShadeNorth);
  LIGHTING.skyFaceShade.bottom = clampSkyFaceShade(quality.skyFaceShadeBottom);
}

export function formatGraphicsSliderValue(slider, value) {
  if (slider.format === 'percent') {
    return `${Math.round(value * 100)}`;
  }
  if (slider.key === 'pixelScale') {
    return Number(value).toFixed(2);
  }
  return String(Math.round(Number(value)));
}

export function clampGraphicsSliderValue(slider, raw) {
  if (slider.key === 'pixelScale') return clampPixelScale(raw);
  if (slider.key === 'fogViewDistance') return clampFogViewDistance(raw);
  if (slider.format === 'percent') return clampSkyFaceShade(raw);
  const n = Number(raw);
  if (!Number.isFinite(n)) return slider.min;
  return Math.min(slider.max, Math.max(slider.min, n));
}

export function loadGraphicsOverrides() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveGraphicsOverrides(settings) {
  const payload = {};
  for (const opt of GRAPHICS_OPTIONS) {
    payload[opt.key] = settings[opt.key];
  }
  for (const slider of GRAPHICS_SLIDERS) {
    payload[slider.key] = settings[slider.key];
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function clearGraphicsOverrides() {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Initial quality preset (mobile/desktop + saved overrides).
 * @param {boolean} isMobile
 */
export function createQualitySettings(isMobile) {
  const base = isMobile ? { ...MOBILE_QUALITY } : { ...DESKTOP_QUALITY };
  const overrides = loadGraphicsOverrides();
  const settings = overrides
    ? { ...base, ...overrides, lowQuality: base.lowQuality }
    : base;
  syncSkyFaceShadeToLighting(settings);
  return settings;
}
