import * as THREE from 'three';
import { getMaterial } from '../materials/registry.js';

function lightKey(x, y, z) {
  return `${x},${y},${z}`;
}

/**
 * Max simultaneous block lights. Pool is always in the scene so
 * Three.js MeshStandardMaterial shaders keep a stable numPointLights
 * and do not recompile on each place/break (which caused gameplay freezes).
 */
export const MAX_BLOCK_LIGHTS = 32;

/**
 * Manages PointLights for blocks with a `light` material definition (e.g. lumen).
 */
export class BlockLightSystem {
  constructor(scene, { poolSize = MAX_BLOCK_LIGHTS } = {}) {
    this.scene = scene;
    /** @type {Map<string, THREE.PointLight>} */
    this.active = new Map();
    /** @type {THREE.PointLight[]} */
    this.pool = [];
    /** @type {THREE.PointLight[]} */
    this.free = [];

    for (let i = 0; i < poolSize; i++) {
      const light = new THREE.PointLight(0xffd078, 0, 16, 2);
      light.castShadow = false;
      light.name = `block-light-pool-${i}`;
      // Park far below the world; intensity 0 but still counted by the renderer.
      light.position.set(0, -1000, 0);
      scene.add(light);
      this.pool.push(light);
      this.free.push(light);
    }
  }

  /**
   * Sync light at a cell after grid change.
   * @param {import('../world/voxel-grid.js').VoxelGrid} grid
   */
  syncAt(grid, x, y, z) {
    const key = lightKey(x, y, z);
    const mat = getMaterial(grid.get(x, y, z));
    const def = mat.light;

    if (!def) {
      this.release(key);
      return;
    }

    let light = this.active.get(key);
    if (!light) {
      light = this.free.pop();
      if (!light) {
        // Pool exhausted — skip rather than add a new light (would hitch).
        return;
      }
      this.active.set(key, light);
    }

    light.color.setHex(def.color ?? 0xffffff);
    light.intensity = def.intensity ?? 1.5;
    light.distance = def.distance ?? 12;
    light.decay = def.decay ?? 2;
    light.position.set(x + 0.5, y + 0.5, z + 0.5);
  }

  release(key) {
    const light = this.active.get(key);
    if (!light) return;
    light.intensity = 0;
    light.position.set(0, -1000, 0);
    this.active.delete(key);
    this.free.push(light);
  }

  clear() {
    for (const key of [...this.active.keys()]) {
      this.release(key);
    }
  }

  resyncFromGrid(grid) {
    this.clear();
    for (const { x, y, z } of grid.entries()) {
      this.syncAt(grid, x, y, z);
    }
  }

  dispose() {
    this.clear();
    for (const light of this.pool) {
      this.scene.remove(light);
      light.dispose();
    }
    this.pool.length = 0;
    this.free.length = 0;
  }
}
