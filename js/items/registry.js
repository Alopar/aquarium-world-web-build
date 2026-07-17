/**
 * Inventory / craft / gear items — NOT world blocks.
 * Dropped as loot entities; can be thrown, never placed into the voxel grid.
 */
export const ITEMS = {
  log: {
    id: 'log',
    name: 'Бревно',
    color: 0x8b6914,
    texture: 'wood',
  },
  iron: {
    id: 'iron',
    name: 'Железо',
    color: 0xa8a8b0,
    texture: 'iron',
  },
  coal: {
    id: 'coal',
    name: 'Уголь',
    color: 0x1c1c1e,
    texture: 'coal',
  },
  copper: {
    id: 'copper',
    name: 'Медь',
    color: 0xd4894a,
    texture: 'copper',
  },
  crystal: {
    id: 'crystal',
    name: 'Кристалл',
    color: 0xa8e0ff,
    texture: 'crystal',
    opacity: 0.85,
    emissive: 0x66ccff,
  },
  club: {
    id: 'club',
    name: 'Дубина',
    color: 0x6b4423,
    equipSlot: 'mainhand',
    damage: 5,
  },
  pickaxe: {
    id: 'pickaxe',
    name: 'Кирка',
    color: 0xb87333,
    equipSlot: 'mainhand',
    damage: 4,
  },
  sword: {
    id: 'sword',
    name: 'Меч',
    color: 0xc0c4cc,
    equipSlot: 'mainhand',
    damage: 8,
  },
  shirt: {
    id: 'shirt',
    name: 'Рубашка',
    color: 0x4a7c59,
    equipSlot: 'chest',
    armor: 1,
  },
  pants: {
    id: 'pants',
    name: 'Штаны',
    color: 0x3d4a6b,
    equipSlot: 'legs',
    armor: 2,
  },
  iron_chest: {
    id: 'iron_chest',
    name: 'Железный нагрудник',
    color: 0x8a8e96,
    equipSlot: 'chest',
    armor: 4,
  },
  iron_legs: {
    id: 'iron_legs',
    name: 'Железные поножи',
    color: 0x6e727a,
    equipSlot: 'legs',
    armor: 3,
  },
  bomb: {
    id: 'bomb',
    name: 'Бомба',
    color: 0x2a1a12,
    emissive: 0xff4400,
    /** Thrown as a timed explosive — not ordinary loot pickup. */
    explosive: true,
  },
  light_bomb: {
    id: 'light_bomb',
    name: 'Световая бомба',
    color: 0xf0f4ff,
    emissive: 0xffffff,
    explosive: true,
    /** Fuse detonation = bright white flash only, no blast. */
    flashOnly: true,
  },
  signal_rocket: {
    id: 'signal_rocket',
    name: 'Сигнальная ракета',
    color: 0xc02010,
    emissive: 0xff2200,
    /** Straight-shot flare: red dynamic light, burns after impact. */
    signalRocket: true,
  },
};

export function getItem(id) {
  return ITEMS[id] ?? null;
}

export function isItem(id) {
  return Object.prototype.hasOwnProperty.call(ITEMS, id);
}

export function isExplosive(id) {
  return Boolean(getItem(id)?.explosive);
}

export function isFlashOnlyExplosive(id) {
  return Boolean(getItem(id)?.flashOnly);
}

export function isSignalRocket(id) {
  return Boolean(getItem(id)?.signalRocket);
}

export function isEquipable(id) {
  const item = getItem(id);
  return Boolean(item?.equipSlot);
}

export function getEquipSlot(id) {
  return getItem(id)?.equipSlot ?? null;
}
