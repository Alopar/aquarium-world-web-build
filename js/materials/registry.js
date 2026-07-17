export const MATERIALS = {
  air: {
    id: 'air',
    name: 'Воздух',
    solid: false,
    breakable: false,
    opaque: false,
    color: null,
  },
  stone: {
    id: 'stone',
    name: 'Камень',
    solid: true,
    breakable: true,
    opaque: true,
    color: 0x7a7a7a,
    texture: 'stone',
  },
  lava_rock: {
    id: 'lava_rock',
    name: 'Лавовый камень',
    solid: true,
    breakable: false,
    opaque: true,
    color: 0x3a1208,
    texture: 'lava_rock',
    emissive: 0xff4400,
    lightLevel: 5,
    lightColor: 0xff4400,
    damagePerSecond: 20,
  },
  dirt: {
    id: 'dirt',
    name: 'Земля',
    solid: true,
    breakable: true,
    opaque: true,
    color: 0x6b4f2a,
    texture: 'dirt',
  },
  grass: {
    id: 'grass',
    name: 'Трава',
    solid: true,
    breakable: true,
    opaque: true,
    color: 0x5a8f3c,
    texture: 'grass',
  },
  sand: {
    id: 'sand',
    name: 'Песок',
    solid: true,
    breakable: true,
    opaque: true,
    color: 0xc2a86a,
    texture: 'sand',
  },
  gravel: {
    id: 'gravel',
    name: 'Гравий',
    solid: true,
    breakable: true,
    opaque: true,
    color: 0x9a9a9a,
    texture: 'gravel',
  },
  cobblestone: {
    id: 'cobblestone',
    name: 'Булыжник',
    solid: true,
    breakable: true,
    opaque: true,
    color: 0x6e6e6e,
    texture: 'cobblestone',
  },
  wood: {
    id: 'wood',
    name: 'Дерево',
    solid: true,
    breakable: true,
    opaque: true,
    organic: true,
    collectible: false,
    color: 0x8b6914,
    texture: 'wood',
    /** Срубленный ствол уничтожается — выпадают вещи-брёвна (не блоки). */
    drops: [{ itemId: 'log', min: 1, max: 1 }],
  },
  organic: {
    id: 'organic',
    name: 'Органика',
    solid: true,
    breakable: true,
    opaque: true,
    organic: true,
    collectible: false,
    color: 0x3d8f2e,
    texture: 'organic',
  },
  glass: {
    id: 'glass',
    name: 'Стекло',
    solid: true,
    breakable: true,
    opaque: false,
    color: 0x88ccff,
    opacity: 0.35,
  },
  /** Ресурсные блоки: уничтожаются, в инвентарь не попадают — из них вываливается лут. */
  iron_ore: {
    id: 'iron_ore',
    name: 'Железная жила',
    solid: true,
    breakable: true,
    opaque: true,
    resourceBlock: true,
    placeable: false,
    color: 0xb89a78,
    texture: 'iron_ore',
    drops: [{ itemId: 'iron', min: 2, max: 4 }],
  },
  coal_ore: {
    id: 'coal_ore',
    name: 'Угольная жила',
    solid: true,
    breakable: true,
    opaque: true,
    resourceBlock: true,
    placeable: false,
    color: 0x2a2a2e,
    texture: 'coal_ore',
    drops: [{ itemId: 'coal', min: 2, max: 4 }],
  },
  copper_ore: {
    id: 'copper_ore',
    name: 'Медная жила',
    solid: true,
    breakable: true,
    opaque: true,
    resourceBlock: true,
    placeable: false,
    color: 0xc86a28,
    texture: 'copper_ore',
    drops: [{ itemId: 'copper', min: 2, max: 4 }],
  },
  crystal_ore: {
    id: 'crystal_ore',
    name: 'Кристаллическая жила',
    solid: true,
    breakable: true,
    opaque: true,
    resourceBlock: true,
    placeable: false,
    color: 0x6ec8ff,
    texture: 'crystal_ore',
    emissive: 0x44aaff,
    lightLevel: 8,
    lightColor: 0x44aaff,
    drops: [{ itemId: 'crystal', min: 1, max: 3 }],
  },
  /** Светящийся фонарь — emissive + жёлтый blocklight. */
  lumen: {
    id: 'lumen',
    name: 'Люмен',
    solid: true,
    breakable: true,
    opaque: false,
    color: 0xffe6a8,
    opacity: 0.9,
    emissive: 0xffc14d,
    emissiveIntensity: 1.6,
    lightLevel: 14,
    lightColor: 0xffc14d,
  },
  /** Слабый синий люмен — cool blocklight. */
  blue_lumen: {
    id: 'blue_lumen',
    name: 'Синий люмен',
    solid: true,
    breakable: true,
    opaque: false,
    color: 0xa8d4ff,
    opacity: 0.9,
    emissive: 0x4488ff,
    emissiveIntensity: 1.2,
    lightLevel: 15,
    lightColor: 0x4488ff,
  },
  water: {
    id: 'water',
    name: 'Вода',
    solid: false,
    liquid: true,
    breakable: false,
    opaque: false,
    color: 0x2aa8e0,
    opacity: 0.48,
  },
  lava: {
    id: 'lava',
    name: 'Лава',
    solid: false,
    liquid: true,
    breakable: false,
    opaque: false,
    color: 0xff6a1a,
    opacity: 0.85,
    emissive: 0xff4400,
    lightLevel: 5,
    lightColor: 0xff4400,
  },
  smoke: {
    id: 'smoke',
    name: 'Дым',
    solid: false,
    gas: true,
    breakable: false,
    opaque: false,
    color: 0xd4dae3,
    opacity: 0.9,
  },
};

import { isItem } from '../items/registry.js';

export function getMaterial(id) {
  return MATERIALS[id] ?? MATERIALS.air;
}

export function listSolidMaterials() {
  return Object.values(MATERIALS).filter((m) => m.solid);
}

export function listLiquidMaterials() {
  return Object.values(MATERIALS).filter((m) => m.liquid);
}

export function listGasMaterials() {
  return Object.values(MATERIALS).filter((m) => m.gas);
}

export function isSolid(id) {
  return getMaterial(id).solid;
}

export function isOrganic(id) {
  return getMaterial(id).organic === true;
}

/** Solid that participates in block support / adhesion. Organic does not provide support. */
export function isStructuralSolid(id) {
  const mat = getMaterial(id);
  return mat.solid === true && mat.organic !== true;
}

export function isBreakable(id) {
  return getMaterial(id).breakable;
}

/** Diggable world blocks that go straight into inventory (not items / ores / trees). */
export function isCollectible(id) {
  if (isItem(id)) return false;
  const mat = getMaterial(id);
  if (!mat.solid) return false;
  return mat.collectible !== false;
}

export function isResourceBlock(id) {
  return getMaterial(id).resourceBlock === true;
}

/** True if breaking this block should scatter item loot. */
export function hasDrops(id) {
  const mat = getMaterial(id);
  return Array.isArray(mat.drops) && mat.drops.length > 0;
}

export function isPlaceable(id) {
  if (isItem(id)) return false;
  const mat = getMaterial(id);
  if (!mat.solid && !mat.liquid && !mat.gas) return false;
  return mat.placeable !== false;
}

/** Roll item drops for a block. Returns [{ itemId, count }, ...]. */
export function rollResourceDrops(materialId) {
  const mat = getMaterial(materialId);
  if (!Array.isArray(mat.drops)) return [];

  const result = [];
  for (const drop of mat.drops) {
    const itemId = drop.itemId ?? drop.materialId;
    if (!itemId || !isItem(itemId)) continue;
    const min = drop.min ?? 1;
    const max = drop.max ?? min;
    const count = min + Math.floor(Math.random() * (max - min + 1));
    if (count > 0) result.push({ itemId, count });
  }
  return result;
}

export function getLightLevel(id) {
  return getMaterial(id).lightLevel ?? 0;
}

/**
 * Blocklight tint 0…1. Falls back to emissive, then white.
 * @returns {{ r: number, g: number, b: number }}
 */
export function getLightColor(id) {
  const mat = getMaterial(id);
  const hex = mat.lightColor ?? mat.emissive ?? 0xffffff;
  return {
    r: ((hex >> 16) & 255) / 255,
    g: ((hex >> 8) & 255) / 255,
    b: (hex & 255) / 255,
  };
}

export function isOpaque(id) {
  const mat = getMaterial(id);
  return mat.solid && mat.opaque !== false;
}
