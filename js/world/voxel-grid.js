import { materialCode, materialId } from '../materials/registry.js';
import { cellIndex } from './cell-index.js';

export class VoxelGrid {
  /**
   * @param {{ x: number, y: number, z: number }} size
   */
  constructor(size) {
    this.size = { ...size };
    this.volume = size.x * size.y * size.z;
    /** Dense material codes; 0 = air. */
    this.codes = new Uint8Array(this.volume);
    this._nonAirCount = 0;
    this.onChange = null;
    this.blockChanges = 0;
  }

  inBounds(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0
      && x < this.size.x && y < this.size.y && z < this.size.z;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  index(x, y, z) {
    return cellIndex(x, y, z, this.size);
  }

  get(x, y, z) {
    if (!this.inBounds(x, y, z)) return 'air';
    return materialId(this.codes[this.index(x, y, z)]);
  }

  /**
   * Fast path: material code without string id (0 = air / OOB).
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  getCode(x, y, z) {
    if (!this.inBounds(x, y, z)) return 0;
    return this.codes[this.index(x, y, z)];
  }

  set(x, y, z, materialIdStr) {
    if (!this.inBounds(x, y, z)) return false;

    const idx = this.index(x, y, z);
    const prevCode = this.codes[idx];
    const nextCode = materialIdStr === 'air' ? 0 : materialCode(materialIdStr);

    if (prevCode === nextCode) return false;

    this.codes[idx] = nextCode;
    if (prevCode === 0) this._nonAirCount++;
    else if (nextCode === 0) this._nonAirCount--;

    this.blockChanges++;
    const prev = materialId(prevCode);
    const next = materialId(nextCode);
    this.onChange?.(x, y, z, prev, next);
    return true;
  }

  clear() {
    this.codes.fill(0);
    this._nonAirCount = 0;
  }

  consumeBlockChanges() {
    const n = this.blockChanges;
    this.blockChanges = 0;
    return n;
  }

  fillLayer(y, materialIdStr) {
    for (let x = 0; x < this.size.x; x++) {
      for (let z = 0; z < this.size.z; z++) {
        this.set(x, y, z, materialIdStr);
      }
    }
  }

  *entries() {
    const { codes, size } = this;
    const sx = size.x;
    const sz = size.z;
    const plane = sx * sz;
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 0) continue;
      const y = (i / plane) | 0;
      const rem = i - y * plane;
      const z = (rem / sx) | 0;
      const x = rem - z * sx;
      yield { x, y, z, id: materialId(code) };
    }
  }

  count() {
    return this._nonAirCount;
  }

  /**
   * Count solid non-air cells (for profiler / stats).
   * @param {(id: string) => boolean} isSolidFn
   */
  countWhere(isSolidFn) {
    let n = 0;
    for (const { id } of this.entries()) {
      if (isSolidFn(id)) n++;
    }
    return n;
  }
}
