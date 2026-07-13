import * as THREE from 'three';
import { getMaterial } from '../materials/registry.js';
import { GasVolumeTexture } from '../gases/gas-volume-texture.js';
import {
  createSmokeVolumeMaterial,
  setSmokeVolumeBounds,
  updateSmokeShaderTime,
} from '../shaders/smoke-material.js';

/**
 * Volumetric smoke: one AABB + raymarch through a soft 3D density field.
 * Looks like a single smoke-grenade cloud; optical depth = sum of densities along the view ray.
 */
export class GasMeshBuilder {
  constructor(grid, gasField) {
    this.grid = grid;
    this.gasField = gasField;
    this.group = new THREE.Group();
    this.group.name = 'gas-meshes';

    this.volume = new GasVolumeTexture(grid.size);
    const smokeMat = getMaterial('smoke');
    this.material = createSmokeVolumeMaterial(
      this.volume.texture,
      grid.size,
      smokeMat?.color ?? 0x6e7682,
    );

    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.geometry.computeBoundingSphere();
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'smoke-volume';
    this.mesh.renderOrder = 2;
    // Scaled AABB + moving camera: engine culling was dropping the volume intermittently
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.group.add(this.mesh);

    this.time = 0;
    this.flushScheduled = false;
    this.flushFrameId = null;
    /** @type {boolean} hysteretic camera-inside flag */
    this.cameraInside = false;
  }

  update(dt, camera = null) {
    this.time += dt;
    updateSmokeShaderTime(this.time);
    if (this.volume.dirty) {
      this.scheduleFlush();
    }
    this.syncCameraInside(camera);
  }

  /**
   * Hysteresis so running around the AABB edge doesn't flip front/back every frame.
   */
  syncCameraInside(camera) {
    if (!camera || !this.mesh.visible || !this.volume.bounds) {
      this.cameraInside = false;
      this.material.uniforms.uInside.value = 0;
      this.material.depthTest = true;
      return;
    }

    const b = this.volume.bounds;
    const p = camera.position;
    const enterPad = 0.05;
    const exitPad = 0.75;

    const insideEnter = p.x >= b.minX + enterPad && p.x <= b.maxX - enterPad
      && p.y >= b.minY + enterPad && p.y <= b.maxY - enterPad
      && p.z >= b.minZ + enterPad && p.z <= b.maxZ - enterPad;

    const insideExit = p.x >= b.minX - exitPad && p.x <= b.maxX + exitPad
      && p.y >= b.minY - exitPad && p.y <= b.maxY + exitPad
      && p.z >= b.minZ - exitPad && p.z <= b.maxZ + exitPad;

    if (this.cameraInside) {
      this.cameraInside = insideExit;
    } else {
      this.cameraInside = insideEnter;
    }

    this.material.uniforms.uInside.value = this.cameraInside ? 1 : 0;
    this.material.depthTest = !this.cameraInside;
  }

  markDirtyAt(_x, _y, _z) {
    this.volume.markDirty();
    this.scheduleFlush();
  }

  scheduleFlush() {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    this.flushFrameId = requestAnimationFrame(() => this.flush());
  }

  cancelScheduledFlush() {
    if (this.flushFrameId != null) {
      cancelAnimationFrame(this.flushFrameId);
      this.flushFrameId = null;
    }
    this.flushScheduled = false;
  }

  flush() {
    this.flushScheduled = false;
    this.flushFrameId = null;
    this.rebuildVolume();
  }

  rebuildVolume() {
    this.volume.sync(this.grid, this.gasField);
    const bounds = this.volume.bounds;

    if (!bounds) {
      this.mesh.visible = false;
      this.cameraInside = false;
      return;
    }

    const sx = bounds.maxX - bounds.minX;
    const sy = bounds.maxY - bounds.minY;
    const sz = bounds.maxZ - bounds.minZ;
    this.mesh.scale.set(sx, sy, sz);
    this.mesh.position.set(
      bounds.minX + sx * 0.5,
      bounds.minY + sy * 0.5,
      bounds.minZ + sz * 0.5,
    );
    setSmokeVolumeBounds(this.material, bounds);
    this.mesh.visible = true;
    this.mesh.updateMatrixWorld(true);
  }

  rebuildAll() {
    this.cancelScheduledFlush();
    this.rebuildVolume();
  }

  dispose() {
    this.cancelScheduledFlush();
    this.group.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.volume.dispose();
  }
}
