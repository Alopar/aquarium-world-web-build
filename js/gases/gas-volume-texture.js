import * as THREE from 'three';
import { getGas } from './registry.js';

/**
 * World-space smoke density as a 3D texture (linear filtered → soft cloud).
 */
export class GasVolumeTexture {
  /**
   * @param {{ x: number, y: number, z: number }} size grid size in cells
   */
  constructor(size) {
    this.size = { x: size.x, y: size.y, z: size.z };
    this.width = size.x;
    this.height = size.y;
    this.depth = size.z;
    this.data = new Uint8Array(this.width * this.height * this.depth);
    this.texture = new THREE.Data3DTexture(this.data, this.width, this.height, this.depth);
    this.texture.format = THREE.RedFormat;
    this.texture.type = THREE.UnsignedByteType;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.wrapR = THREE.ClampToEdgeWrapping;
    this.texture.unpackAlignment = 1;
    this.texture.needsUpdate = true;

    /** @type {{ minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number } | null} */
    this.bounds = null;
    this.dirty = true;
  }

  index(x, y, z) {
    return x + this.width * (y + this.height * z);
  }

  clear() {
    this.data.fill(0);
    this.bounds = null;
    this.texture.needsUpdate = true;
    this.dirty = false;
  }

  /**
   * Rebuild density from sparse gas field + grid material ids.
   * @param {import('../world/voxel-grid.js').VoxelGrid} grid
   * @param {import('./gas-field.js').GasField} gasField
   */
  sync(grid, gasField) {
    this.data.fill(0);

    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let count = 0;

    for (const { x, y, z, volume } of gasField.entries()) {
      const id = grid.get(x, y, z);
      const gas = getGas(id);
      if (!gas || volume <= 0) continue;

      const dens = Math.min(255, Math.max(1, Math.round((volume / gas.maxVolume) * 255)));
      this.data[this.index(x, y, z)] = dens;
      count++;

      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }

    if (count === 0) {
      this.bounds = null;
    } else {
      // Small pad only — linear filter softens ~0.5 cell; large pad caused distant bleed
      const pad = 0.35;
      this.bounds = {
        minX: minX - pad,
        minY: minY - pad,
        minZ: minZ - pad,
        maxX: maxX + 1 + pad,
        maxY: maxY + 1 + pad,
        maxZ: maxZ + 1 + pad,
      };
    }

    this.texture.needsUpdate = true;
    this.dirty = false;
  }

  markDirty() {
    this.dirty = true;
  }

  dispose() {
    this.texture.dispose();
  }
}
