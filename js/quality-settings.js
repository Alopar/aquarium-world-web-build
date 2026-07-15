import { FLUID, GAS, WEATHER } from './constants.js';
import { FOG_VIEW } from './systems/fog-controller.js';
import { PIXEL_SCALE } from './systems/pixel-scale.js';

const STORAGE_KEY = 'aquarium-graphics-v1';

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
];

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
];

export function isTickOptionEnabled(value) {
  return (value ?? 0) > 0;
}

export function tickOptionValue(enabled, maxTicks) {
  return enabled ? maxTicks : 0;
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
  if (!overrides) return base;
  return { ...base, ...overrides, lowQuality: base.lowQuality };
}
