function indexKey(x, y, z) {
  return `${x},${y},${z}`;
}

/**
 * Sparse volume map for fluid cells (1…maxVolume). Material id lives in VoxelGrid.
 */
export class FluidField {
  constructor() {
    /** @type {Map<string, number>} */
    this.volumes = new Map();
    this.onChange = null;
  }

  getVolume(x, y, z) {
    return this.volumes.get(indexKey(x, y, z)) ?? 0;
  }

  /**
   * @returns {boolean} true if volume changed
   */
  setVolume(x, y, z, volume) {
    const key = indexKey(x, y, z);
    const prev = this.volumes.get(key) ?? 0;
    const next = Math.max(0, Math.floor(volume));

    if (next <= 0) {
      if (prev === 0) return false;
      this.volumes.delete(key);
      this.onChange?.(x, y, z, prev, 0);
      return true;
    }

    if (prev === next) return false;
    this.volumes.set(key, next);
    this.onChange?.(x, y, z, prev, next);
    return true;
  }

  clear() {
    this.volumes.clear();
  }

  *entries() {
    for (const [key, volume] of this.volumes) {
      const [x, y, z] = key.split(',').map(Number);
      yield { x, y, z, volume };
    }
  }

  count() {
    return this.volumes.size;
  }
}
