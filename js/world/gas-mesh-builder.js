import * as THREE from 'three';
import { VOXEL_SIZE } from '../constants.js';
import { getMaterial } from '../materials/registry.js';
import { getGas } from '../gases/registry.js';
import { GasVolumeTexture } from '../gases/gas-volume-texture.js';
import {
  createSmokeVolumeMaterial,
  setSmokeVolumeBounds,
  updateSmokeShaderTime,
} from '../shaders/smoke-material.js';

const FACE_NEIGHBORS = [
  { dir: [1, 0, 0], normal: [1, 0, 0] },
  { dir: [-1, 0, 0], normal: [-1, 0, 0] },
  { dir: [0, 1, 0], normal: [0, 1, 0] },
  { dir: [0, -1, 0], normal: [0, -1, 0] },
  { dir: [0, 0, 1], normal: [0, 0, 1] },
  { dir: [0, 0, -1], normal: [0, 0, -1] },
];

function shouldRenderGasFace(grid, x, y, z, nx, ny, nz) {
  if (!grid.inBounds(nx, ny, nz)) return true;
  const neighbor = grid.get(nx, ny, nz);
  if (neighbor === 'air') return true;
  const mat = getMaterial(neighbor);
  return !mat.opaque;
}

function buildSimpleSmokeBuffers(grid, gasField) {
  const gas = getGas('smoke');
  const maxV = gas?.maxVolume ?? 1000;
  const smokeMat = getMaterial('smoke');
  const baseOpacity = smokeMat.opacity ?? 0.55;
  const color = new THREE.Color(smokeMat.color ?? 0xd4dae3);

  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];

  for (const { x, y, z, volume } of gasField.entries()) {
    if (volume <= 0 || grid.get(x, y, z) !== 'smoke') continue;

    const fill = Math.min(1, volume / maxV);
    const alpha = baseOpacity * (0.35 + fill * 0.65);
    const r = color.r * alpha;
    const g = color.g * alpha;
    const b = color.b * alpha;

    const x0 = x * VOXEL_SIZE;
    const y0 = y * VOXEL_SIZE;
    const z0 = z * VOXEL_SIZE;
    const x1 = x0 + VOXEL_SIZE;
    const y1 = y0 + VOXEL_SIZE;
    const z1 = z0 + VOXEL_SIZE;

    for (const { dir, normal } of FACE_NEIGHBORS) {
      const nx = x + dir[0];
      const ny = y + dir[1];
      const nz = z + dir[2];
      if (!shouldRenderGasFace(grid, x, y, z, nx, ny, nz)) continue;

      const base = positions.length / 3;
      const corners = faceCorners(x0, y0, z0, x1, y1, z1, dir);
      for (const c of corners) {
        positions.push(c[0], c[1], c[2]);
        normals.push(normal[0], normal[1], normal[2]);
        colors.push(r, g, b);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  return { positions, normals, colors, indices };
}

function faceCorners(x0, y0, z0, x1, y1, z1, dir) {
  if (dir[0] === 1) {
    return [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]];
  }
  if (dir[0] === -1) {
    return [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]];
  }
  if (dir[1] === 1) {
    return [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]];
  }
  if (dir[1] === -1) {
    return [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]];
  }
  if (dir[2] === 1) {
    return [[x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1]];
  }
  return [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]];
}

/**
 * Volumetric smoke (raymarch) or simple semi-transparent voxel faces.
 */
export class GasMeshBuilder {
  constructor(grid, gasField, { simpleRender = false } = {}) {
    this.grid = grid;
    this.gasField = gasField;
    this.simpleRender = simpleRender;
    this.group = new THREE.Group();
    this.group.name = 'gas-meshes';

    this.volume = new GasVolumeTexture(grid.size);
    const smokeMat = getMaterial('smoke');
    this.volumeMaterial = createSmokeVolumeMaterial(
      this.volume.texture,
      grid.size,
      smokeMat?.color ?? 0x6e7682,
    );

    this.volumeGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.volumeGeometry.computeBoundingSphere();
    this.volumeMesh = new THREE.Mesh(this.volumeGeometry, this.volumeMaterial);
    this.volumeMesh.name = 'smoke-volume';
    this.volumeMesh.renderOrder = 2;
    this.volumeMesh.frustumCulled = false;
    this.volumeMesh.visible = false;
    this.group.add(this.volumeMesh);

    this.blocksMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.blocksMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.blocksMaterial);
    this.blocksMesh.name = 'smoke-blocks';
    this.blocksMesh.renderOrder = 2;
    this.blocksMesh.frustumCulled = false;
    this.blocksMesh.visible = false;
    this.group.add(this.blocksMesh);

    this.time = 0;
    this.flushScheduled = false;
    this.flushFrameId = null;
    this.cameraInside = false;
  }

  setSimpleRender(simple) {
    if (this.simpleRender === simple) return;
    this.simpleRender = simple;
    this.cameraInside = false;
    this.rebuildAll();
  }

  update(dt, camera = null) {
    if (this.simpleRender) return;
    this.time += dt;
    updateSmokeShaderTime(this.time);
    if (this.volume.dirty) {
      this.scheduleFlush();
    }
    this.syncCameraInside(camera);
  }

  syncCameraInside(camera) {
    if (!camera || !this.volumeMesh.visible || !this.volume.bounds) {
      this.cameraInside = false;
      this.volumeMaterial.uniforms.uInside.value = 0;
      this.volumeMaterial.depthTest = true;
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

    this.volumeMaterial.uniforms.uInside.value = this.cameraInside ? 1 : 0;
    this.volumeMaterial.depthTest = !this.cameraInside;
  }

  markDirtyAt(_x, _y, _z) {
    if (this.simpleRender) {
      this.scheduleFlush();
      return;
    }
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
    if (this.simpleRender) {
      this.rebuildBlocks();
    } else {
      this.rebuildVolume();
    }
  }

  rebuildBlocks() {
    this.volumeMesh.visible = false;
    const buf = buildSimpleSmokeBuffers(this.grid, this.gasField);

    this.blocksMesh.geometry.dispose();
    if (buf.positions.length === 0) {
      this.blocksMesh.geometry = new THREE.BufferGeometry();
      this.blocksMesh.visible = false;
      return;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(buf.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buf.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(buf.colors, 3));
    geometry.setIndex(buf.indices);
    geometry.computeBoundingSphere();
    this.blocksMesh.geometry = geometry;
    this.blocksMesh.visible = true;
  }

  rebuildVolume() {
    this.blocksMesh.visible = false;
    this.volume.sync(this.grid, this.gasField);
    const bounds = this.volume.bounds;

    if (!bounds) {
      this.volumeMesh.visible = false;
      this.cameraInside = false;
      return;
    }

    const sx = bounds.maxX - bounds.minX;
    const sy = bounds.maxY - bounds.minY;
    const sz = bounds.maxZ - bounds.minZ;
    this.volumeMesh.scale.set(sx, sy, sz);
    this.volumeMesh.position.set(
      bounds.minX + sx * 0.5,
      bounds.minY + sy * 0.5,
      bounds.minZ + sz * 0.5,
    );
    setSmokeVolumeBounds(this.volumeMaterial, bounds);
    this.volumeMesh.visible = true;
    this.volumeMesh.updateMatrixWorld(true);
  }

  rebuildAll() {
    this.cancelScheduledFlush();
    if (this.simpleRender) {
      this.rebuildBlocks();
    } else {
      this.rebuildVolume();
    }
  }

  dispose() {
    this.cancelScheduledFlush();
    this.group.remove(this.volumeMesh);
    this.group.remove(this.blocksMesh);
    this.volumeGeometry.dispose();
    this.volumeMaterial.dispose();
    this.blocksMesh.geometry.dispose();
    this.blocksMaterial.dispose();
    this.volume.dispose();
  }
}
