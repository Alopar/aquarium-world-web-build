export const AQUARIUM_SIZE = { x: 64, y: 40, z: 64 };

export const DEFAULT_WORLD_SEED = 42;

export const VOXEL_SIZE = 1;

export const THREE_VERSION = '0.160.0';

export const CAMERA = {
  fov: 75,
  near: 0.1,
  far: 300,
  startPosition: { x: 32, y: 15, z: 32 },
};

export const PLAYER = {
  width: 0.6,
  height: 1.8,
  eyeHeight: 1.62,
  walkSpeed: 4.3,
  flySpeed: 9,
  sprintMultiplier: 1.5,
  jumpSpeed: 8,
  gravity: 28,
  groundFriction: 12,
  /** Horizontal speed while swimming. */
  swimSpeed: 2.9,
  swimSprintMultiplier: 1.2,
  /** Vertical thrust while holding Space / Ctrl in liquid. */
  swimUpSpeed: 4.4,
  swimDownSpeed: 3.6,
  /** Weak downward pull in liquid (sink). */
  swimGravity: 5.5,
  swimMaxSinkSpeed: 3.4,
  swimMaxRiseSpeed: 5.8,
  /** Exponential drag coefficient while swimming. */
  swimDrag: 5.5,
  /** Multiply downward velocity when first entering deep liquid. */
  swimEnterDamp: 0.28,
  swimEnterDampThreshold: -7,
};

export const PLAYER_HEALTH = {
  max: 100,
  /** Fallback DPS if material has no damagePerSecond */
  lavaDamagePerSecond: 20,
  /** Seconds between hurt sounds while taking continuous damage */
  hurtSoundInterval: 0.35,
  /** Min downward speed (m/s) before fall damage applies (~1.5× safe fall height) */
  fallDamageMinSpeed: 10,
  /** HP lost per 1 m/s above fallDamageMinSpeed */
  fallDamagePerSpeed: 2.5,
};

export const PHYSICS = {
  maxSubSteps: 4,
  subStepThreshold: 0.45,
  maxFallSpeed: 40,
};

export const PROJECTILE = {
  throwSpeed: 12,
  gravity: 28,
  maxFallSpeed: 40,
  maxLifetime: 8,
  spawnOffset: 1.2,
  subSteps: 6,
  /** Impulse away from attachments when a block collapses into a projectile. */
  collapseImpulse: 4,
};

/** Метательная бомба: бросок + фитиль + сфера разрушения. */
export const BOMB = {
  size: 0.36,
  gravity: 22,
  maxFallSpeed: 18,
  bounce: 0.22,
  groundFriction: 14,
  airDrag: 1.1,
  subSteps: 4,
  throwSpeed: 11,
  spawnOffset: 1.15,
  spinSpeed: 4.5,
  /** Seconds from throw until detonation */
  fuseTime: 1.6,
  /** Voxel sphere radius (inclusive distance in cells) */
  radius: 2,
  /** Impulse for rim blocks kicked outward when the outward face is free */
  edgeImpulse: 9,
  /** Slight upward bias on blast-edge ejects */
  edgeImpulseUp: 2.5,
  /** Max HP damage at epicenter; falls off with distance */
  playerDamage: 45,
  /** Blink emissive while fuse burns */
  blinkSpeed: 8,
};

/** Подбираемые дропы (не блоки) — как item entities в Minecraft. */
export const LOOT = {
  size: 0.28,
  gravity: 22,
  maxFallSpeed: 18,
  bounce: 0.38,
  groundFriction: 10,
  airDrag: 1.2,
  subSteps: 4,
  pickupDelay: 0.45,
  pickupRadius: 1.5,
  lifetime: 180,
  burstSpeed: 4.2,
  burstUp: 3.4,
  throwSpeed: 9,
  spawnOffset: 1.1,
  spinSpeed: 2.8,
  bobAmplitude: 0.07,
  bobSpeed: 3.2,
};

export const COLORS = {
  sky: 0x6ec6ff,
  fog: 0x4a90c4,
  glass: 0x88ccff,
};

/** Полные сутки за cycleSeconds; phase 0 = рассвет. */
export const DAY_NIGHT = {
  cycleSeconds: 300,
  worldCenter: { x: 32, y: 0, z: 32 },
  sunOrbitRadius: 90,
  sunOrbitHeight: 72,
  day: {
    sky: 0x6ec6ff,
    fog: 0x4a90c4,
    fogNear: 60,
    fogFar: 180,
    ambientColor: 0xb8d8ff,
    ambientIntensity: 0.55,
    sunColor: 0xfff4d6,
    sunIntensity: 1.1,
    fillColor: 0x4aa8ff,
    fillIntensity: 0.35,
    hemiSkyColor: 0x88bbff,
    hemiGroundColor: 0x3a5a28,
    hemiIntensity: 0.25,
  },
  night: {
    sky: 0x01040a,
    fog: 0x03060e,
    fogNear: 10,
    fogFar: 48,
    ambientColor: 0x121c30,
    ambientIntensity: 0.045,
    sunColor: 0x7a8cb0,
    sunIntensity: 0.06,
    fillColor: 0x1a2840,
    fillIntensity: 0.03,
    hemiSkyColor: 0x1a2840,
    hemiGroundColor: 0x0a1018,
    hemiIntensity: 0.03,
  },
  twilight: {
    sky: 0xc45a3a,
    fog: 0x6a3a4a,
    ambientColor: 0xffb090,
    sunColor: 0xffc08a,
  },
  underwater: {
    lightMul: 0.35,
    sky: 0x062a48,
    fog: 0x0d4a72,
    fogNear: 0,
    fogFar: 10,
    /** CSS veil opacity at full submersion (0…1). */
    veilOpacity: 0.62,
  },
};

export const SPACE_SKY = {
  radius: 180,
  fadeStart: 22,
  fadeEnd: 4,
  directionPower: 1.4,
  texture: 'assets/menu-bg.png',
};

export const HOTBAR_SLOTS = 9;

/** Backpack rows × columns (below hotbar in inventory panel). */
export const INVENTORY_STORAGE_ROWS = 3;
export const INVENTORY_STORAGE_COLS = 9;
export const INVENTORY_STORAGE_SLOTS = INVENTORY_STORAGE_ROWS * INVENTORY_STORAGE_COLS;

/** Equipment slot keys (order = UI top → bottom). */
export const EQUIPMENT_SLOTS = ['mainhand', 'chest', 'legs'];

export const EQUIPMENT_SLOT_LABELS = {
  mainhand: 'Рука',
  chest: 'Грудь',
  legs: 'Ноги',
};

export const RAYCAST_MAX_DISTANCE = 8;

export const CHUNK_SIZE = 16;

/** Voxel skylight + block-light fields (0…maxLevel). */
export const LIGHTING = {
  maxLevel: 15,
  /** Floor brightness at light level 0 (caves / night). */
  minBrightness: 0.01,
  /** Peak brightness at light level 15 (full day / full blocklight). */
  maxBrightness: 0.98,
  blockLightFalloff: 1,
  /** Linear display lerp when voxel brightness decreases (seconds). Increases snap instantly. */
  brightnessLerpSeconds: 0.25,
  /** Max simultaneous transient emitters (torch, projectile, flash). */
  maxDynamicLights: 8,
  /** How many light-only chunks to patch per frame (static edits only). */
  maxLightChunksPerFrame: 8,
  heldLightForward: 0.35,
  /** Seconds between −1 steps on marked dynamic cells. */
  dynamicDecayInterval: 0.045,
  /** Soft directional tone on pure-skylight faces (runtime; graphics panel). */
  skyFaceShadeEnabled: true,
  skyFaceShade: {
    top: 1.0, // +Y
    east: 0.92, // +X — toward morning sun
    south: 0.92, // +Z — toward morning sun
    west: 0.88, // −X — shade
    north: 0.88, // −Z — shade
    bottom: 0.8, // −Y
  },
};

/** Bomb explosion flash (transient voxel light). */
export const BOMB_FLASH = {
  level: 14,
  color: { r: 1, g: 0.45, b: 0.12 },
  duration: 0.28,
};

/** Световая бомба — вспышка без разрушения. */
export const LIGHT_BOMB_FLASH = {
  level: 15,
  color: { r: 1, g: 1, b: 1 },
  duration: 0.45,
};

/** Сигнальная ракета: прямая траектория + красный свет, горе́ние на месте после попадания. */
export const SIGNAL_ROCKET = {
  size: 0.22,
  length: 0.55,
  throwSpeed: 22,
  spawnOffset: 1.25,
  maxLifetime: 12,
  subSteps: 8,
  lightLevel: 15,
  lightColor: { r: 1, g: 0.08, b: 0.02 },
  burnTime: 10,
  spinSpeed: 0,
  color: 0xc02010,
  emissive: 0xff2200,
};

/** Сколько грязных чанков пересобирать за один кадр */
export const MAX_CHUNKS_REBUILD_PER_FRAME = 2;

export const PARTICLES = {
  blockBreak: {
    count: 16,
    lifetime: 0.55,
    speed: 2.8,
    gravity: 12,
    size: 0.12,
  },
  rainSplash: {
    count: 6,
    lifetime: 0.28,
    speed: 1.6,
    gravity: 14,
    size: 0.07,
  },
  explosion: {
    count: 48,
    lifetime: 0.7,
    speed: 7.5,
    gravity: 8,
    size: 0.18,
  },
};

/**
 * Дождь: 1 мин осадков, затем 2 мин сухо (цикл 3 мин).
 * Лужи — редкий addFluid на открытой поверхности; вода стекает в низины.
 */
export const WEATHER = {
  rainDuration: 60,
  dryDuration: 120,
  /** Плавный вход/выход интенсивности */
  fadeSeconds: 2.5,
  /** Капли вокруг камеры */
  dropCount: 900,
  areaHalfXZ: 18,
  areaHeight: 22,
  fallSpeedMin: 14,
  fallSpeedMax: 22,
  streakLength: 0.55,
  /** Брызги при ударе о землю (доля кадров с попыткой) */
  splashChance: 0.35,
  maxSplashesPerFrame: 12,
  /** Лужи */
  puddleInterval: 0.9,
  puddleAttempts: 2,
  puddleAmountMin: 28,
  puddleAmountMax: 48,
  /** Не доливать клетку выше этого объёма дождём */
  puddleMaxVolume: 220,
  puddleRadius: 22,
  /** Доля попыток, смещённых в локальные низины */
  puddleBasinBias: 0.7,
  fogNearMul: 0.5,
  fogFarMul: 0.62,
  lightMul: 0.88,
};

export const BLOCK_SUPPORT = {
  breakDelay: 0.1,
  /** Max wall-clock ms for support BFS per frame */
  bfsBudgetMs: 2,
  /** Check deadline every N BFS visits */
  bfsDeadlineCheckEvery: 64,
};

/**
 * Cascade / projectile / place blocks rendered as overlays outside chunk geometry.
 * Disturbed placements wake a sleeping collector that folds them all after collectInterval.
 */
export const DETACHED_BLOCKS = {
  /** Seconds after wake before the collector folds all disturbed cells */
  collectInterval: 1,
};

export const TREE_GROWTH = {
  /** Seconds between each new tree block */
  interval: 3,
};

/** Instanced grass blades on exposed grass tops (sparse, not every block). */
export const GRASS_FOLIAGE = {
  /** Fraction of eligible grass tops that get a blade cluster (0…1) */
  coverage: 0.42,
  /** Each instance is a full tuft sprite */
  bladesMin: 1,
  bladesMax: 2,
  windStrength: 0.045,
  /** First good proportions: modest height, not too wide */
  width: 0.42,
  height: 0.32,
  /** Mild length variation */
  heightScaleMin: 0.85,
  heightScaleMax: 1.2,
  widthScaleMin: 0.9,
  widthScaleMax: 1.1,
};

/** Sparse decorative flowers on exposed grass tops. */
export const FLOWER_FOLIAGE = {
  /** Chance a grass top gets a flower (independent of grass blades) */
  coverage: 0.09,
  windStrength: 0.035,
  width: 0.36,
  height: 0.4,
  heightScaleMin: 0.85,
  heightScaleMax: 1.15,
  widthScaleMin: 0.9,
  widthScaleMax: 1.1,
  /** Texture ids in materials/textures.js */
  types: [
    'flower_poppy',
    'flower_dandelion',
    'flower_cornflower',
    'flower_daisy',
    'flower_allium',
  ],
};

export const FLUID = {
  /** Max simulation ticks processed per frame */
  maxTicksPerFrame: 3,
  /** Soft cap on active cells processed per tick */
  maxCellsPerTick: 2048,
  /**
   * How often to rescan all fluid cells for leftover slopes / unsettled volume.
   * Active queue alone can go quiet while a gentle hill remains.
   */
  rescanInterval: 0.5,
  /** Max fluid cells to inspect per rescan pass */
  maxRescanPerPass: 4096,
  /** Max thin-film cells to evaporate per evaporation tick */
  maxEvaporatePerPass: 4096,
};

export const GAS = {
  maxTicksPerFrame: 3,
  maxCellsPerTick: 2048,
  rescanInterval: 0.5,
  maxRescanPerPass: 4096,
  /** Max calm gas cells to dissolve per dissolve tick */
  maxDissolvePerPass: 4096,
};
