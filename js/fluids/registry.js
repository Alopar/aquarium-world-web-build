/**
 * Реестр жидкостей — параметры симуляции потоков.
 * Объём клетки: 0…maxVolume (полный куб = maxVolume).
 */
export const FLUIDS = {
  water: {
    id: 'water',
    materialId: 'water',
    viscosity: 1,
    density: 1,
    maxVolume: 1000,
    tickInterval: 0.1,
    /** Units transferred downward per tick (Infinity = fill all free space below). */
    flowDown: Infinity,
    /** Max units transferred sideways per tick (shared across neighbors). */
    flowSide: 400,
    /**
     * Pairwise rest band: smaller diffs only flow down a slope.
     * At 0…1000 this is ~1% of a full cell — visually flat.
     */
    restThreshold: 10,
    /**
     * Volumes below this never "hover" in a cell if they can fall —
     * they drain downward in the same tick (kills flicker above thin films).
     */
    minStableVolume: 100,
    /**
     * Calm low band: volume in 0…calmVolumeLow does not auto-spread
     * unless wakeAround marks the cell disturbed.
     */
    calmVolumeLow: 10,
    /**
     * Calm high band: volume in calmVolumeHigh…maxVolume does not auto-spread
     * unless disturbed (near-full surface cells).
     */
    calmVolumeHigh: 900,
    /** Snap leftovers toward multiples of this via evaporation. */
    quantizeStep: 10,
    /** With air above, near-full cells evaporate down to this level. */
    surfaceEvaporateFloor: 900,
    evaporateAmount: 1,
    evaporateInterval: 1,
  },
  lava: {
    id: 'lava',
    materialId: 'lava',
    viscosity: 4,
    density: 2.5,
    maxVolume: 1000,
    tickInterval: 0.1,
    flowDown: Infinity,
    flowSide: 100,
    restThreshold: 10,
    minStableVolume: 100,
    calmVolumeLow: 10,
    calmVolumeHigh: 900,
    quantizeStep: 10,
    surfaceEvaporateFloor: 900,
    evaporateAmount: 1,
    evaporateInterval: 1,
  },
};

export function getFluid(id) {
  return FLUIDS[id] ?? null;
}

export function isFluidMaterial(id) {
  return getFluid(id) != null;
}

/** Thin film or near-full surface — calm unless externally disturbed. */
export function isCalmVolume(volume, fluid) {
  if (!fluid || volume <= 0) return false;
  return volume <= fluid.calmVolumeLow || volume >= fluid.calmVolumeHigh;
}
