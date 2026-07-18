import * as THREE from 'three';

function cellKey(x, y, z) {
  return `${x},${y},${z}`;
}

function disposeMesh(mesh) {
  if (!mesh) return;
  mesh.geometry?.dispose();
  if (!mesh.userData?.sharedMaterial) {
    mesh.material?.dispose();
  }
}

function disposeGroup(group) {
  if (!group) return;
  for (const child of [...group.children]) {
    group.remove(child);
    disposeMesh(child);
  }
}

/**
 * Trees live outside chunk geometry: one assembled mesh when whole,
 * per-block overlays while damaged / growing / cascading.
 */
export class TreeMeshSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../world/world.js').AquariumWorld} world
   */
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'tree-meshes';
    scene.add(this.group);
    /** @type {Map<string, object>} */
    this.trees = new Map();
    /** Plan cell → root key (includes future growth cells). */
    this.cellToTree = new Map();
  }

  /** @param {Array} plans from generateTrees / tryPlantTree */
  loadPlans(plans) {
    for (const plan of plans) {
      this.registerPlan(plan);
    }
  }

  registerPlan(plan) {
    if (!plan?.blocks?.length) return;

    const root = plan.blocks[0];
    const key = cellKey(root.x, root.y, root.z);
    this._unregister(key);

    const entry = {
      key,
      blocks: plan.blocks,
      mode: null,
      assembled: null,
      /** @type {Map<string, import('three').Mesh>} */
      cells: new Map(),
    };

    this.trees.set(key, entry);
    for (const b of plan.blocks) {
      this.cellToTree.set(cellKey(b.x, b.y, b.z), key);
    }
    this._syncVisual(entry);
  }

  _unregister(key) {
    const entry = this.trees.get(key);
    if (!entry) return;
    this._setMeshSkip(entry.blocks, false);
    this._clearVisual(entry);
    for (const b of entry.blocks) {
      const ck = cellKey(b.x, b.y, b.z);
      if (this.cellToTree.get(ck) === key) {
        this.cellToTree.delete(ck);
      }
    }
    this.trees.delete(key);
  }

  findEntry(x, y, z) {
    const key = this.cellToTree.get(cellKey(x, y, z));
    return key ? this.trees.get(key) ?? null : null;
  }

  /** True when this cell has a tree overlay / is part of an assembled tree mesh. */
  owns(x, y, z) {
    const entry = this.findEntry(x, y, z);
    if (!entry) return false;
    if (entry.mode === 'cells') return entry.cells.has(cellKey(x, y, z));
    if (entry.mode === 'assembled') {
      return this.world.getBlock(x, y, z) !== 'air';
    }
    return false;
  }

  _existingBlocks(entry) {
    const { grid } = this.world;
    const out = [];
    for (const b of entry.blocks) {
      if (grid.get(b.x, b.y, b.z) === b.materialId) out.push(b);
    }
    return out;
  }

  _setMeshSkip(blocks, enabled) {
    const mb = this.world.meshBuilder;
    for (const b of blocks) {
      if (enabled) mb.addMeshSkip(b.x, b.y, b.z);
      else mb.removeMeshSkip(b.x, b.y, b.z);
    }
  }

  _clearVisual(entry) {
    if (entry.assembled) {
      this.group.remove(entry.assembled);
      disposeGroup(entry.assembled);
      entry.assembled = null;
    }
    for (const mesh of entry.cells.values()) {
      this.group.remove(mesh);
      disposeMesh(mesh);
    }
    entry.cells.clear();
    entry.mode = null;
  }

  _syncVisual(entry) {
    const existing = this._existingBlocks(entry);
    this._setMeshSkip(entry.blocks, false);
    if (existing.length === 0) {
      this._clearVisual(entry);
      return;
    }
    this._setMeshSkip(existing, true);
    if (existing.length === entry.blocks.length) {
      this._assemble(entry, existing);
    } else {
      this._split(entry, existing);
    }
  }

  _assemble(entry, existing) {
    this._clearVisual(entry);
    const assembled = this.world.meshBuilder.createBlocksMeshGroup(
      existing,
      `tree-${entry.key}`,
    );
    if (!assembled) return;
    this.group.add(assembled);
    entry.assembled = assembled;
    entry.mode = 'assembled';
  }

  _split(entry, existing) {
    this._clearVisual(entry);
    for (const b of existing) {
      const mesh = this.world.meshBuilder.createCellOverlayMesh(
        b.x,
        b.y,
        b.z,
        b.materialId,
      );
      if (!mesh) continue;
      this.group.add(mesh);
      entry.cells.set(cellKey(b.x, b.y, b.z), mesh);
    }
    entry.mode = 'cells';
  }

  /** Expand assembled tree into per-block overlays (cascade / damage). */
  split(entry) {
    if (!entry) return;
    const existing = this._existingBlocks(entry);
    this._setMeshSkip(entry.blocks, false);
    this._setMeshSkip(existing, true);
    this._split(entry, existing);
  }

  /** Fold per-block overlays into one tree mesh when fully grown. */
  assemble(entry) {
    if (!entry) return;
    const existing = this._existingBlocks(entry);
    if (existing.length !== entry.blocks.length) return;
    this._setMeshSkip(existing, true);
    this._assemble(entry, existing);
  }

  /**
   * Organic cell cleared from the grid.
   * Dig / bomb: split remaining into cell meshes so cascade can drop without remesh.
   * Collapse: drop that cell overlay only.
   */
  onOrganicRemoved(x, y, z, source) {
    if (source === 'collapse') {
      this.removeCell(x, y, z);
      return;
    }

    const entry = this.findEntry(x, y, z);
    if (!entry) return;

    this.world.meshBuilder.removeMeshSkip(x, y, z);
    this.split(entry);

    if (this._existingBlocks(entry).length === 0) {
      this._unregister(entry.key);
    }
  }

  removeCell(x, y, z) {
    const key = cellKey(x, y, z);
    const entry = this.findEntry(x, y, z);
    this.world.meshBuilder.removeMeshSkip(x, y, z);
    if (!entry) return;

    if (entry.mode === 'assembled') {
      this.split(entry);
    }

    const mesh = entry.cells.get(key);
    if (mesh) {
      entry.cells.delete(key);
      this.group.remove(mesh);
      disposeMesh(mesh);
    }

    if (entry.cells.size === 0 && this._existingBlocks(entry).length === 0) {
      this._unregister(entry.key);
    }
  }

  /** Growth step: show a temporary cell mesh; assemble when the plan is complete. */
  onGrowthPlaced(x, y, z, materialId) {
    const entry = this.findEntry(x, y, z);
    if (!entry) return;

    this.world.meshBuilder.addMeshSkip(x, y, z);

    if (entry.mode === 'assembled') {
      this.split(entry);
    }

    if (entry.mode !== 'cells') {
      this._split(entry, this._existingBlocks(entry));
    } else {
      const key = cellKey(x, y, z);
      if (!entry.cells.has(key)) {
        const mesh = this.world.meshBuilder.createCellOverlayMesh(x, y, z, materialId);
        if (mesh) {
          this.group.add(mesh);
          entry.cells.set(key, mesh);
        }
      }
    }

    if (this._existingBlocks(entry).length === entry.blocks.length) {
      this.assemble(entry);
    }
  }

  dispose() {
    for (const key of [...this.trees.keys()]) {
      this._unregister(key);
    }
    this.cellToTree.clear();
    this.scene.remove(this.group);
  }
}
