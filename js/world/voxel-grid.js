function indexKey(x, y, z) {
  return `${x},${y},${z}`;
}

export class VoxelGrid {
  constructor(size) {
    this.size = { ...size };
    this.cells = new Map();
    this.onChange = null;
    this.blockChanges = 0;
  }

  inBounds(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0
      && x < this.size.x && y < this.size.y && z < this.size.z;
  }

  get(x, y, z) {
    if (!this.inBounds(x, y, z)) return 'air';
    return this.cells.get(indexKey(x, y, z)) ?? 'air';
  }

  set(x, y, z, materialId) {
    if (!this.inBounds(x, y, z)) return false;

    const key = indexKey(x, y, z);
    const prev = this.cells.get(key) ?? 'air';

    if (materialId === 'air') {
      if (prev === 'air') return false;
      this.cells.delete(key);
    } else {
      if (prev === materialId) return false;
      this.cells.set(key, materialId);
    }

    this.blockChanges++;
    this.onChange?.(x, y, z, prev, materialId === 'air' ? 'air' : materialId);
    return true;
  }

  consumeBlockChanges() {
    const n = this.blockChanges;
    this.blockChanges = 0;
    return n;
  }

  fillLayer(y, materialId) {
    for (let x = 0; x < this.size.x; x++) {
      for (let z = 0; z < this.size.z; z++) {
        this.set(x, y, z, materialId);
      }
    }
  }

  *entries() {
    for (const [key, id] of this.cells) {
      const [x, y, z] = key.split(',').map(Number);
      yield { x, y, z, id };
    }
  }

  count() {
    return this.cells.size;
  }
}
