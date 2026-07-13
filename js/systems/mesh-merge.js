import * as THREE from 'three';
import { MESH_MERGE } from '../constants.js';

function superKey(scx, scy, scz) {
  return `${scx},${scy},${scz}`;
}

/**
 * Progressively merges span³ terrain chunks into one greedy super-mesh.
 */
export class MeshMergeSystem {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'merged-chunks';
    this.supers = new Map();
    this.enabled = true;
    this.span = MESH_MERGE.span;
    this.stableFramesRequired = MESH_MERGE.stableFrames;
    this.maxPerFrame = MESH_MERGE.maxPerFrame;
    this.stats = {
      merged: 0,
      pending: 0,
      triangles: 0,
      meshes: 0,
    };
  }

  attach(meshBuilder) {
    if (!meshBuilder?.group) return;
    if (this.group.parent !== meshBuilder.group) {
      meshBuilder.group.add(this.group);
    }
    meshBuilder.onChunkDirty = (cx, cy, cz) => this.onChunkDirty(meshBuilder, cx, cy, cz);
    meshBuilder.onChunkRebuilt = (cx, cy, cz) => this.onChunkRebuilt(meshBuilder, cx, cy, cz);
  }

  detach(meshBuilder) {
    if (meshBuilder) {
      if (meshBuilder.onChunkDirty) meshBuilder.onChunkDirty = null;
      if (meshBuilder.onChunkRebuilt) meshBuilder.onChunkRebuilt = null;
    }
    this.splitAll(meshBuilder);
    this.group.parent?.remove(this.group);
  }

  setEnabled(enabled, meshBuilder) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.splitAll(meshBuilder);
    } else {
      for (const entry of this.supers.values()) {
        entry.stableFrames = 0;
      }
    }
  }

  onChunkDirty(meshBuilder, cx, cy, cz) {
    if (!this.enabled) return;
    const scx = Math.floor(cx / this.span);
    const scy = Math.floor(cy / this.span);
    const scz = Math.floor(cz / this.span);
    this.splitSuper(meshBuilder, scx, scy, scz);
  }

  onChunkRebuilt(meshBuilder, cx, cy, cz) {
    if (!this.enabled) return;
    const scx = Math.floor(cx / this.span);
    const scy = Math.floor(cy / this.span);
    const scz = Math.floor(cz / this.span);
    const key = superKey(scx, scy, scz);
    const entry = this.supers.get(key);
    if (entry && !entry.merged) {
      entry.stableFrames = 0;
    }
  }

  splitAll(meshBuilder) {
    for (const key of [...this.supers.keys()]) {
      const [scx, scy, scz] = key.split(',').map(Number);
      this.splitSuper(meshBuilder, scx, scy, scz);
    }
  }

  splitSuper(meshBuilder, scx, scy, scz) {
    const key = superKey(scx, scy, scz);
    const entry = this.supers.get(key);
    if (!entry) {
      this.supers.set(key, { stableFrames: 0, merged: false, mesh: null });
      return;
    }

    if (entry.mesh) {
      entry.mesh.geometry.dispose();
      this.group.remove(entry.mesh);
      entry.mesh = null;
    }
    entry.merged = false;
    entry.stableFrames = 0;

    if (meshBuilder) {
      for (let dx = 0; dx < this.span; dx++) {
        for (let dy = 0; dy < this.span; dy++) {
          for (let dz = 0; dz < this.span; dz++) {
            const cx = scx * this.span + dx;
            const cy = scy * this.span + dy;
            const cz = scz * this.span + dz;
            meshBuilder.setChunkPrimaryMeshVisible(cx, cy, cz, true);
          }
        }
      }
    }
  }

  /**
   * @param {import('../world/mesh-builder.js').MeshBuilder} meshBuilder
   * @param {object} quality
   */
  update(meshBuilder, quality) {
    const enabled = quality?.chunkMeshMerge !== false && this.enabled;
    if (!enabled || !meshBuilder) {
      if (!enabled && this.stats.merged > 0) {
        this.setEnabled(false, meshBuilder);
      }
      this._refreshStats();
      return;
    }

    const candidates = [];
    const supersX = Math.floor(meshBuilder.chunksX / this.span);
    const supersY = Math.floor(meshBuilder.chunksY / this.span);
    const supersZ = Math.floor(meshBuilder.chunksZ / this.span);

    for (let scx = 0; scx < supersX; scx++) {
      for (let scy = 0; scy < supersY; scy++) {
        for (let scz = 0; scz < supersZ; scz++) {
          const key = superKey(scx, scy, scz);
          let entry = this.supers.get(key);
          if (!entry) {
            entry = { stableFrames: 0, merged: false, mesh: null };
            this.supers.set(key, entry);
          }

          if (entry.merged) continue;

          if (!this.canMerge(meshBuilder, scx, scy, scz)) {
            entry.stableFrames = 0;
            continue;
          }

          entry.stableFrames += 1;
          if (entry.stableFrames >= this.stableFramesRequired) {
            candidates.push({ scx, scy, scz, stableFrames: entry.stableFrames });
          }
        }
      }
    }

    candidates.sort((a, b) => b.stableFrames - a.stableFrames);

    let mergedThisFrame = 0;
    for (const cand of candidates) {
      if (mergedThisFrame >= this.maxPerFrame) break;
      if (this.mergeSuper(meshBuilder, cand.scx, cand.scy, cand.scz)) {
        mergedThisFrame += 1;
      }
    }

    this._refreshStats();
  }

  canMerge(meshBuilder, scx, scy, scz) {
    if (!meshBuilder.isRegionMergeable(scx, scy, scz, this.span)) {
      return false;
    }

    for (let dx = 0; dx < this.span; dx++) {
      for (let dy = 0; dy < this.span; dy++) {
        for (let dz = 0; dz < this.span; dz++) {
          const cx = scx * this.span + dx;
          const cy = scy * this.span + dy;
          const cz = scz * this.span + dz;
          const key = `${cx},${cy},${cz}`;
          if (meshBuilder.dirtyChunks.has(key)) return false;
          const chunk = meshBuilder.chunks.get(key);
          if (!chunk?.hasGeometry) return false;
          const primary = chunk.meshes.get(meshBuilder.getPrimaryMergeKey());
          if (!primary?.geometry?.attributes?.position?.count) return false;
        }
      }
    }
    return true;
  }

  mergeSuper(meshBuilder, scx, scy, scz) {
    const key = superKey(scx, scy, scz);
    const entry = this.supers.get(key);
    if (!entry || entry.merged) return false;
    if (!this.canMerge(meshBuilder, scx, scy, scz)) return false;

    const { buffer } = meshBuilder.buildPrimaryRegionBuffers(scx, scy, scz, this.span);
    if (!buffer || buffer.positions.length === 0) {
      entry.stableFrames = 0;
      return false;
    }

    this.splitSuper(meshBuilder, scx, scy, scz);

    const mesh = meshBuilder.createPrimaryMeshFromBuffer(buffer, scx, scy, scz, this.span);
    mesh.frustumCulled = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.group.add(mesh);

    for (let dx = 0; dx < this.span; dx++) {
      for (let dy = 0; dy < this.span; dy++) {
        for (let dz = 0; dz < this.span; dz++) {
          meshBuilder.setChunkPrimaryMeshVisible(
            scx * this.span + dx,
            scy * this.span + dy,
            scz * this.span + dz,
            false,
          );
        }
      }
    }

    const box = meshBuilder.getSuperRegionBox(scx, scy, scz, this.span);
    entry.mesh = mesh;
    entry.merged = true;
    entry.stableFrames = this.stableFramesRequired;
    entry.boxMin = box.min;
    entry.boxMax = box.max;
    return true;
  }

  /** Sync merged group visibility from child chunk visibility flags. */
  syncVisibility(meshBuilder) {
    if (!meshBuilder) return;
    for (const [key, entry] of this.supers) {
      if (!entry.merged || !entry.mesh) continue;
      const [scx, scy, scz] = key.split(',').map(Number);
      let anyVisible = false;
      for (let dx = 0; dx < this.span && !anyVisible; dx++) {
        for (let dy = 0; dy < this.span && !anyVisible; dy++) {
          for (let dz = 0; dz < this.span && !anyVisible; dz++) {
            const cx = scx * this.span + dx;
            const cy = scy * this.span + dy;
            const cz = scz * this.span + dz;
            const chunk = meshBuilder.chunks.get(`${cx},${cy},${cz}`);
            if (chunk?.group.visible) anyVisible = true;
          }
        }
      }
      entry.mesh.visible = anyVisible;
    }
  }

  _refreshStats() {
    let merged = 0;
    let pending = 0;
    let triangles = 0;
    let meshes = 0;

    for (const entry of this.supers.values()) {
      if (entry.merged && entry.mesh) {
        merged += 1;
        meshes += 1;
        const geo = entry.mesh.geometry;
        if (geo.index) {
          triangles += geo.index.count / 3;
        } else {
          triangles += (geo.attributes.position?.count ?? 0) / 3;
        }
      } else if (entry.stableFrames > 0) {
        pending += 1;
      }
    }

    this.stats = { merged, pending, triangles, meshes };
  }

  getStats() {
    return { ...this.stats };
  }

  dispose(meshBuilder) {
    this.detach(meshBuilder);
    this.supers.clear();
  }
}
