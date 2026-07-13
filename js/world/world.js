import { AQUARIUM_SIZE, DEFAULT_WORLD_SEED } from '../constants.js';
import { getMaterial, isOrganic, isSolid, isStructuralSolid } from '../materials/registry.js';
import { getFluid } from '../fluids/registry.js';
import { getGas } from '../gases/registry.js';
import { FluidField } from '../fluids/fluid-field.js';
import { GasField } from '../gases/gas-field.js';
import { VoxelGrid } from './voxel-grid.js';
import { createAquariumTank } from './glass-tank.js';
import { generateTerrain } from './generator.js';
import { MeshBuilder } from './mesh-builder.js';
import { FluidMeshBuilder } from './fluid-mesh-builder.js';
import { GasMeshBuilder } from './gas-mesh-builder.js';
import { GrassFoliageBuilder } from './grass-foliage-builder.js';
import { BlockLightSystem } from '../systems/block-lights.js';

export class AquariumWorld {
  constructor(scene, { quality = {} } = {}) {
    this.scene = scene;
    this.quality = quality;
    this.grid = new VoxelGrid(AQUARIUM_SIZE);
    this.fluidField = new FluidField();
    this.gasField = new GasField();
    this.meshBuilder = new MeshBuilder(this.grid, {
      lambertTerrain: !!quality.lambertTerrain,
      flatColors: !!quality.flatColorsTerrain,
    });
    this.fluidMeshBuilder = new FluidMeshBuilder(this.grid, this.fluidField, {
      enabled: quality.fluidMeshEnabled !== false,
    });
    this.gasMeshBuilder = new GasMeshBuilder(this.grid, this.gasField, {
      simpleRender: !!quality.simpleSmokeRender,
    });
    this.grassFoliageBuilder = new GrassFoliageBuilder(this.grid, {
      enabled: quality.foliageEnabled !== false,
    });
    this.blockLights = new BlockLightSystem(scene);
    this.tank = null;
    this.blockSupport = null;
    this.treeGrowth = null;
    /** @type {import('../fluids/fluid-system.js').FluidSystem | null} */
    this.fluidSystem = null;
    /** @type {import('../gases/gas-system.js').GasSystem | null} */
    this.gasSystem = null;

    this.grid.onChange = (x, y, z) => {
      this.meshBuilder.markDirtyAt(x, y, z);
      if (this.fluidMeshBuilder.enabled) {
        this.fluidMeshBuilder.markDirtyAt(x, y, z);
      }
      this.gasMeshBuilder.markDirtyAt(x, y, z);
      if (this.grassFoliageBuilder.enabled) {
        this.grassFoliageBuilder.markDirtyAt(x, y, z);
      }
      this.blockLights.syncAt(this.grid, x, y, z);
    };

    this.fluidField.onChange = (x, y, z) => {
      if (this.fluidMeshBuilder.enabled) {
        this.fluidMeshBuilder.markDirtyAt(x, y, z);
      }
    };

    this.gasField.onChange = (x, y, z) => {
      this.gasMeshBuilder.markDirtyAt(x, y, z);
    };

    scene.add(this.meshBuilder.group);
    if (this.fluidMeshBuilder.enabled) {
      scene.add(this.fluidMeshBuilder.group);
    }
    scene.add(this.gasMeshBuilder.group);
    if (this.grassFoliageBuilder.enabled) {
      scene.add(this.grassFoliageBuilder.group);
    }
  }

  setFluidSystem(system) {
    this.fluidSystem = system;
  }

  setGasSystem(system) {
    this.gasSystem = system;
  }

  generate(seed = DEFAULT_WORLD_SEED) {
    this.blockLights.clear();
    this.grid.cells.clear();
    this.fluidField.clear();
    this.gasField.clear();
    const onChange = this.grid.onChange;
    this.grid.onChange = null;
    const treePlans = generateTerrain(this.grid, seed);
    this.grid.onChange = onChange;
    this.meshBuilder.rebuildAll();
    this.fluidMeshBuilder.rebuildAll();
    this.gasMeshBuilder.rebuildAll();
    this.grassFoliageBuilder.rebuildAll();
    return treePlans;
  }

  createTank() {
    this.tank = createAquariumTank(this.scene, this.grid.size, {
      simpleGlass: !!this.quality.simpleGlass,
    });
  }

  setBlockSupport(system) {
    this.blockSupport = system;
  }

  setTreeGrowth(system) {
    this.treeGrowth = system;
  }

  getFluidVolume(x, y, z) {
    return this.fluidField.getVolume(x, y, z);
  }

  getGasVolume(x, y, z) {
    return this.gasField.getVolume(x, y, z);
  }

  /**
   * Place or update a fluid cell. volume <= 0 clears the cell.
   * @returns {boolean}
   */
  setFluid(x, y, z, fluidId, volume, options = {}) {
    const fluid = getFluid(fluidId);
    if (!fluid) return false;
    if (!this.grid.inBounds(x, y, z)) return false;

    const clamped = Math.min(fluid.maxVolume, Math.max(0, Math.floor(volume)));
    const currentId = this.grid.get(x, y, z);

    if (clamped <= 0) {
      const hadFluid = getFluid(currentId) != null;
      const volChanged = this.fluidField.setVolume(x, y, z, 0);
      let gridChanged = false;
      if (hadFluid) {
        gridChanged = this.grid.set(x, y, z, 'air');
      }
      if (volChanged || gridChanged) {
        if (options.fromSim) {
          if (options.evaporate) {
            this.fluidSystem?.activate(x, y, z);
          } else {
            this.fluidSystem?.propagateDisturbance(x, y, z);
          }
        } else {
          this.fluidSystem?.wakeAround(x, y, z);
        }
        return true;
      }
      return false;
    }

    if (isSolid(currentId)) return false;
    if (getGas(currentId)) {
      this.displaceGas(x, y, z);
    }
    const afterDisplaceId = this.grid.get(x, y, z);
    if (afterDisplaceId !== 'air' && afterDisplaceId !== fluidId) return false;

    const prevVol = this.fluidField.getVolume(x, y, z);
    let changed = false;

    if (afterDisplaceId !== fluidId) {
      if (afterDisplaceId !== 'air') {
        this.grid.set(x, y, z, 'air');
      }
      changed = this.grid.set(x, y, z, fluidId) || changed;
    }

    if (prevVol !== clamped) {
      changed = this.fluidField.setVolume(x, y, z, clamped) || changed;
    }

    if (!changed && afterDisplaceId === fluidId && prevVol === clamped) {
      return false;
    }

    if (changed || afterDisplaceId === fluidId) {
      if (options.fromSim) {
        if (options.evaporate) {
          this.fluidSystem?.activate(x, y, z);
        } else {
          this.fluidSystem?.propagateDisturbance(x, y, z);
        }
      } else {
        this.fluidMeshBuilder.markDirtyAt(x, y, z);
        this.fluidSystem?.wakeAround(x, y, z);
      }
      return true;
    }

    return false;
  }

  /**
   * Place or update a gas cell. volume <= 0 clears the cell.
   * @returns {boolean}
   */
  setGas(x, y, z, gasId, volume, options = {}) {
    const gas = getGas(gasId);
    if (!gas) return false;
    if (!this.grid.inBounds(x, y, z)) return false;

    const clamped = Math.min(gas.maxVolume, Math.max(0, Math.floor(volume)));
    const currentId = this.grid.get(x, y, z);

    if (clamped <= 0) {
      const hadGas = getGas(currentId) != null;
      const volChanged = this.gasField.setVolume(x, y, z, 0);
      let gridChanged = false;
      if (hadGas) {
        gridChanged = this.grid.set(x, y, z, 'air');
      }
      if (volChanged || gridChanged) {
        if (options.fromSim) {
          if (options.dissolve) {
            this.gasSystem?.activate(x, y, z);
          } else {
            this.gasSystem?.propagateDisturbance(x, y, z);
          }
        } else {
          this.gasSystem?.wakeAround(x, y, z);
        }
        return true;
      }
      return false;
    }

    if (isSolid(currentId)) return false;
    if (getFluid(currentId)) {
      this.displaceFluid(x, y, z);
    }
    const afterDisplaceId = this.grid.get(x, y, z);
    if (afterDisplaceId !== 'air' && afterDisplaceId !== gasId) return false;

    const prevVol = this.gasField.getVolume(x, y, z);
    let changed = false;

    if (afterDisplaceId !== gasId) {
      if (afterDisplaceId !== 'air') {
        this.grid.set(x, y, z, 'air');
      }
      changed = this.grid.set(x, y, z, gasId) || changed;
    }

    if (prevVol !== clamped) {
      changed = this.gasField.setVolume(x, y, z, clamped) || changed;
    }

    if (!changed && afterDisplaceId === gasId && prevVol === clamped) {
      return false;
    }

    if (changed || afterDisplaceId === gasId) {
      if (options.fromSim) {
        if (options.dissolve) {
          this.gasSystem?.activate(x, y, z);
        } else {
          this.gasSystem?.propagateDisturbance(x, y, z);
        }
      } else {
        this.gasMeshBuilder.markDirtyAt(x, y, z);
        this.gasSystem?.wakeAround(x, y, z);
      }
      return true;
    }

    return false;
  }

  /**
   * Add volume into a cell (same fluid or air). Returns units actually added.
   */
  addFluid(x, y, z, fluidId, amount, options = {}) {
    const fluid = getFluid(fluidId);
    if (!fluid || amount <= 0) return 0;
    if (!this.grid.inBounds(x, y, z)) return 0;

    const currentId = this.grid.get(x, y, z);
    if (isSolid(currentId)) return 0;
    if (currentId !== 'air' && currentId !== fluidId) return 0;

    const current = currentId === fluidId ? this.fluidField.getVolume(x, y, z) : 0;
    const space = fluid.maxVolume - current;
    if (space <= 0) return 0;

    const added = Math.min(space, Math.floor(amount));
    this.setFluid(x, y, z, fluidId, current + added, options);
    return added;
  }

  /**
   * Add volume into a cell (same gas or air). Returns units actually added.
   */
  addGas(x, y, z, gasId, amount, options = {}) {
    const gas = getGas(gasId);
    if (!gas || amount <= 0) return 0;
    if (!this.grid.inBounds(x, y, z)) return 0;

    const currentId = this.grid.get(x, y, z);
    if (isSolid(currentId)) return 0;
    if (currentId !== 'air' && currentId !== gasId) return 0;

    const current = currentId === gasId ? this.gasField.getVolume(x, y, z) : 0;
    const space = gas.maxVolume - current;
    if (space <= 0) return 0;

    const added = Math.min(space, Math.floor(amount));
    this.setGas(x, y, z, gasId, current + added, options);
    return added;
  }

  /**
   * Push fluid out of a cell into face-neighbors. Leftover volume is destroyed.
   * Call before placing a solid into a liquid cell.
   */
  displaceFluid(x, y, z) {
    const id = this.grid.get(x, y, z);
    const fluid = getFluid(id);
    if (!fluid) return;

    let remaining = this.fluidField.getVolume(x, y, z);
    if (remaining <= 0) {
      this.setFluid(x, y, z, id, 0, { fromSim: true });
      return;
    }

    // Clear source first so neighbors can take the volume.
    this.setFluid(x, y, z, id, 0, { fromSim: true, evaporate: true });

    // Horizontal first, then up, then down.
    const order = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
      [0, 1, 0],
      [0, -1, 0],
    ];

    for (const [ox, oy, oz] of order) {
      if (remaining <= 0) break;
      const nx = x + ox;
      const ny = y + oy;
      const nz = z + oz;
      if (!this.grid.inBounds(nx, ny, nz)) continue;

      const nid = this.grid.get(nx, ny, nz);
      if (isSolid(nid)) continue;
      if (nid !== 'air' && nid !== id) continue;

      const added = this.addFluid(nx, ny, nz, id, remaining, { fromSim: true });
      remaining -= added;
    }

    // Anything that did not fit is destroyed (game convention).
    this.fluidSystem?.propagateDisturbance(x, y, z);
  }

  /**
   * Push gas out of a cell into face-neighbors. Leftover volume is destroyed.
   */
  displaceGas(x, y, z) {
    const id = this.grid.get(x, y, z);
    const gas = getGas(id);
    if (!gas) return;

    let remaining = this.gasField.getVolume(x, y, z);
    if (remaining <= 0) {
      this.setGas(x, y, z, id, 0, { fromSim: true });
      return;
    }

    this.setGas(x, y, z, id, 0, { fromSim: true, dissolve: true });

    // Prefer up first (volatile), then horizontal, then down.
    const order = [
      [0, 1, 0],
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
      [0, -1, 0],
    ];

    for (const [ox, oy, oz] of order) {
      if (remaining <= 0) break;
      const nx = x + ox;
      const ny = y + oy;
      const nz = z + oz;
      if (!this.grid.inBounds(nx, ny, nz)) continue;

      const nid = this.grid.get(nx, ny, nz);
      if (isSolid(nid)) continue;
      if (nid !== 'air' && nid !== id) continue;

      const added = this.addGas(nx, ny, nz, id, remaining, { fromSim: true });
      remaining -= added;
    }

    this.gasSystem?.propagateDisturbance(x, y, z);
  }

  setBlock(x, y, z, materialId, options = {}) {
    const prev = this.getBlock(x, y, z);

    if (getFluid(materialId)) {
      const fluid = getFluid(materialId);
      return this.setFluid(x, y, z, materialId, fluid.maxVolume, options);
    }

    if (getGas(materialId)) {
      const gas = getGas(materialId);
      return this.setGas(x, y, z, materialId, gas.maxVolume, options);
    }

    // Solid (or air) replacing liquid/gas: squeeze out, destroy the rest.
    if (getFluid(prev)) {
      this.displaceFluid(x, y, z);
    }
    if (getGas(prev)) {
      this.displaceGas(x, y, z);
    }

    const changed = this.grid.set(x, y, z, materialId);

    if (!changed) {
      return false;
    }

    if (isStructuralSolid(prev) && materialId === 'air') {
      this.blockSupport?.onBlockRemoved(x, y, z, options.source);
    } else if (isOrganic(prev) && materialId === 'air') {
      this.blockSupport?.onOrganicRemoved(x, y, z, options.source);
    } else if (isStructuralSolid(materialId) && options.source !== 'collapse') {
      this.blockSupport?.onBlockPlaced(x, y, z, materialId);
    }

    if ((isOrganic(prev) || prev === 'wood') && materialId === 'air' && options.source !== 'tree-growth') {
      this.treeGrowth?.onTreeDamaged(x, y, z);
    }

    this.fluidSystem?.wakeAround(x, y, z);
    this.gasSystem?.wakeAround(x, y, z);
    return true;
  }

  getBlock(x, y, z) {
    return this.grid.get(x, y, z);
  }

  getStats() {
    const solids = [...this.grid.cells.values()].filter((id) => getMaterial(id).solid).length;
    const liquids = this.fluidField.count();
    const gases = this.gasField.count();
    return { total: this.grid.count(), solids, liquids, gases };
  }

  dispose() {
    this.blockLights.dispose();
    this.meshBuilder.dispose();
    this.fluidMeshBuilder.dispose();
    this.gasMeshBuilder.dispose();
    this.grassFoliageBuilder.dispose();
    if (this.tank) {
      this.scene.remove(this.tank);
      this.tank = null;
    }
  }
}
