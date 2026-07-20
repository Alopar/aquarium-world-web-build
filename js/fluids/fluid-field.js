import { AQUARIUM_SIZE } from '../constants.js';
import { cellIndex, unpackCell } from '../world/cell-index.js';

/**
 * Dense volume field for fluid cells (1…maxVolume). Material id lives in VoxelGrid.
 */
export class FluidField {
  /**
   * @param {{ x: number, y: number, z: number }} [size]
   */
  constructor(size = AQUARIUM_SIZE) {
    this.size = { ...size };
    this.volume = size.x * size.y * size.z;
    /** @type {Uint16Array} */
    this.volumes = new Uint16Array(this.volume);
    /** Occupied linear indices (non-zero volumes). */
    this.occupied = new Set();
    this.onChange = null;
  }

  getVolume(x, y, z) {
    if (
      x < 0 || y < 0 || z < 0
      || x >= this.size.x || y >= this.size.y || z >= this.size.z
    ) {
      return 0;
    }
    return this.volumes[cellIndex(x, y, z, this.size)];
  }

  /**
   * @returns {boolean} true if volume changed
   */
  setVolume(x, y, z, volume) {
    if (
      x < 0 || y < 0 || z < 0
      || x >= this.size.x || y >= this.size.y || z >= this.size.z
    ) {
      return false;
    }

    const idx = cellIndex(x, y, z, this.size);
    const prev = this.volumes[idx];
    const next = Math.max(0, Math.min(0xffff, Math.floor(volume)));

    if (next <= 0) {
      if (prev === 0) return false;
      this.volumes[idx] = 0;
      this.occupied.delete(idx);
      this.onChange?.(x, y, z, prev, 0);
      return true;
    }

    if (prev === next) return false;
    this.volumes[idx] = next;
    this.occupied.add(idx);
    this.onChange?.(x, y, z, prev, next);
    return true;
  }

  clear() {
    this.volumes.fill(0);
    this.occupied.clear();
  }

  *entries() {
    for (const idx of this.occupied) {
      const { x, y, z } = unpackCell(idx);
      yield { x, y, z, volume: this.volumes[idx] };
    }
  }

  count() {
    return this.occupied.size;
  }
}
