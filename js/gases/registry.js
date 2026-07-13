/**
 * Реестр газов — параметры симуляции (дым, туман, пыль…).
 * Объём клетки: 0…maxVolume (полный куб = maxVolume).
 * volume > activeThreshold — активное распространение во все стороны;
 * volume ≤ activeThreshold — спокойный, растворяется до 0.
 */
export const GASES = {
  smoke: {
    id: 'smoke',
    materialId: 'smoke',
    maxVolume: 1000,
    /** Above this: omni flow; at/below: calm + dissolve. */
    activeThreshold: 500,
    tickInterval: 0.1,
    /** Max units transferred to all 6 neighbors per tick (shared budget). */
    flowOmni: 400,
    /** Relative flow preference: side/down strong, up weaker (cloud-like settle). */
    flowWeightSide: 1,
    flowWeightDown: 1.15,
    flowWeightUp: 0.3,
    /** Pairwise rest band: smaller diffs do not transfer. */
    restThreshold: 10,
    dissolveAmount: 8,
    dissolveInterval: 1,
  },
};

export function getGas(id) {
  return GASES[id] ?? null;
}

export function isGasMaterial(id) {
  return getGas(id) != null;
}

/** True while the cell should actively equalize into neighbors. */
export function isActiveGasVolume(volume, gas) {
  if (!gas || volume <= 0) return false;
  return volume > gas.activeThreshold;
}
