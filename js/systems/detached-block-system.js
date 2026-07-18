import * as THREE from 'three';
import { CHUNK_SIZE, DETACHED_BLOCKS } from '../constants.js';

function cellKey(x, y, z) {
  return `${x},${y},${z}`;
}

function disposeOverlayMesh(mesh) {
  if (!mesh) return;
  mesh.geometry?.dispose();
  // Chunk materials are shared — never dispose them here.
  if (!mesh.userData?.sharedMaterial) {
    mesh.material?.dispose();
  }
}

/**
 * Overlay voxel meshes for cascade-pending and freshly placed blocks,
 * so chunk remeshes can be deferred / batched.
 *
 * Disturbed places wake a sleeping collector; after collectInterval it folds
 * every disturbed cell that accumulated, then sleeps until the next place.
 * Overlays stay visible until their chunk actually rebuilds (flush is throttled).
 */
export class DetachedBlockSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../world/world.js').AquariumWorld} world
   */
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    /** @type {Map<string, { x: number, y: number, z: number, materialId: string, mesh: import('three').Mesh, mode: 'pending' | 'disturbed' | 'integrating' }>} */
    this.entries = new Map();
    this.group = new THREE.Group();
    this.group.name = 'detached-blocks';
    scene.add(this.group);
    /** Idle until a disturbed place wakes it. */
    this._collectorSleeping = true;
    this._collectTimer = 0;

    this.world.meshBuilder.onChunkRebuilt = (cx, cy, cz) => {
      this.onChunkRebuilt(cx, cy, cz);
    };
  }

  get count() {
    return this.entries.size;
  }

  has(x, y, z) {
    return this.entries.has(cellKey(x, y, z));
  }

  _createOverlay(x, y, z, materialId) {
    return this.world.meshBuilder.createCellOverlayMesh(x, y, z, materialId);
  }

  _wakeCollector() {
    if (!this._collectorSleeping) return;
    this._collectorSleeping = false;
    this._collectTimer = 0;
  }

  /**
   * Pull a doomed cascade cell out of chunk meshes into its own voxel overlay.
   * @param {{ remesh?: boolean }} [options] remesh=true removes the voxel from chunk geom.
   */
  detachPending(x, y, z, materialId, { remesh = true } = {}) {
    const key = cellKey(x, y, z);
    const existing = this.entries.get(key);
    if (existing) {
      existing.mode = 'pending';
      existing.materialId = materialId;
      return existing.mesh;
    }

    this.world.meshBuilder.addMeshSkip(x, y, z);
    const mesh = this._createOverlay(x, y, z, materialId);
    if (!mesh) {
      this.world.meshBuilder.removeMeshSkip(x, y, z);
      return null;
    }

    this.group.add(mesh);
    this.entries.set(key, {
      x,
      y,
      z,
      materialId,
      mesh,
      mode: 'pending',
    });
    if (remesh) {
      this.world.meshBuilder.markDirtyAt(x, y, z);
    }
    return mesh;
  }

  /** @param {{ x: number, y: number, z: number, materialId: string }[]} blocks */
  detachPendingMany(blocks, { remesh = true } = {}) {
    for (const block of blocks) {
      this.detachPending(block.x, block.y, block.z, block.materialId, { remesh });
    }
  }

  /**
   * Freshly placed solid: full voxel overlay, skip chunk geom.
   * Wakes the collector (no per-block timer) — all disturbed share one collect pass.
   */
  placeDisturbed(x, y, z, materialId) {
    const key = cellKey(x, y, z);
    const existing = this.entries.get(key);
    if (existing) {
      existing.mode = 'disturbed';
      existing.materialId = materialId;
      this._wakeCollector();
      return existing.mesh;
    }

    this.world.meshBuilder.addMeshSkip(x, y, z);
    const mesh = this._createOverlay(x, y, z, materialId);
    if (!mesh) {
      this.world.meshBuilder.removeMeshSkip(x, y, z);
      return null;
    }

    this.group.add(mesh);
    this.entries.set(key, {
      x,
      y,
      z,
      materialId,
      mesh,
      mode: 'disturbed',
    });
    this._wakeCollector();
    return mesh;
  }

  /**
   * Remove overlay. Clears mesh-skip.
   * @returns {null}
   */
  takeMesh(x, y, z, { dispose = true } = {}) {
    const key = cellKey(x, y, z);
    const entry = this.entries.get(key);
    if (!entry) {
      this.world.meshBuilder.removeMeshSkip(x, y, z);
      return null;
    }

    this.entries.delete(key);
    this.world.meshBuilder.removeMeshSkip(x, y, z);
    this.group.remove(entry.mesh);

    if (dispose) {
      disposeOverlayMesh(entry.mesh);
    }

    return null;
  }

  /** Drop pending/disturbed overlay when the cell was edited externally (dig, bomb). */
  cancelAt(x, y, z) {
    this.takeMesh(x, y, z, { dispose: true });
  }

  /**
   * Chunk geometry now includes integrating cells — drop their overlays.
   * Safe across throttled multi-frame flush (2 chunks/frame).
   */
  onChunkRebuilt(cx, cy, cz) {
    const s = this.world.meshBuilder.chunkSize || CHUNK_SIZE;
    const toDrop = [];
    for (const [key, entry] of this.entries) {
      if (entry.mode !== 'integrating') continue;
      if (Math.floor(entry.x / s) !== cx) continue;
      if (Math.floor(entry.y / s) !== cy) continue;
      if (Math.floor(entry.z / s) !== cz) continue;
      toDrop.push(key);
    }
    for (const key of toDrop) {
      const entry = this.entries.get(key);
      if (!entry) continue;
      this.entries.delete(key);
      this.group.remove(entry.mesh);
      disposeOverlayMesh(entry.mesh);
    }
  }

  _collectAllDisturbed() {
    const ready = [];
    for (const [key, entry] of this.entries) {
      if (entry.mode !== 'disturbed') continue;
      ready.push(entry);
    }
    if (ready.length === 0) return;

    for (const entry of ready) {
      const { x, y, z, materialId } = entry;
      if (this.world.getBlock(x, y, z) !== materialId) {
        this.takeMesh(x, y, z, { dispose: true });
        continue;
      }

      // Keep overlay until this cell's chunk flush finishes — remesh is throttled.
      // Light already updated on place; only geometry is deferred.
      entry.mode = 'integrating';
      this.world.meshBuilder.removeMeshSkip(x, y, z);
      this.world.meshBuilder.markDirtyAt(x, y, z);
    }
  }

  /**
   * Call after systems that can place solids this frame.
   * While awake: count down once, then fold every disturbed cell and sleep.
   */
  update(dt) {
    if (this._collectorSleeping) return;

    this._collectTimer += dt;
    if (this._collectTimer < DETACHED_BLOCKS.collectInterval) return;

    this._collectAllDisturbed();
    this._collectorSleeping = true;
    this._collectTimer = 0;
  }

  dispose() {
    if (this.world.meshBuilder.onChunkRebuilt) {
      this.world.meshBuilder.onChunkRebuilt = null;
    }
    for (const entry of this.entries.values()) {
      this.world.meshBuilder.removeMeshSkip(entry.x, entry.y, entry.z);
      this.group.remove(entry.mesh);
      disposeOverlayMesh(entry.mesh);
    }
    this.entries.clear();
    this.scene.remove(this.group);
  }
}
