import * as THREE from 'three';
import { VOXEL_SIZE } from '../constants.js';
import { getMaterial } from '../materials/registry.js';
import { getGas } from '../gases/registry.js';

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

function buildSmokeBuffers(grid, gasField) {
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

/** Semi-transparent voxel faces for smoke cells. */
export class GasMeshBuilder {
  constructor(grid, gasField) {
    this.grid = grid;
    this.gasField = gasField;
    this.group = new THREE.Group();
    this.group.name = 'gas-meshes';

    this.material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.name = 'smoke-blocks';
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.group.add(this.mesh);

    this.flushScheduled = false;
    this.flushFrameId = null;
  }

  markDirtyAt(_x, _y, _z) {
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
    this.rebuild();
  }

  rebuild() {
    const buf = buildSmokeBuffers(this.grid, this.gasField);

    this.mesh.geometry.dispose();
    if (buf.positions.length === 0) {
      this.mesh.geometry = new THREE.BufferGeometry();
      this.mesh.visible = false;
      return;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(buf.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buf.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(buf.colors, 3));
    geometry.setIndex(buf.indices);
    geometry.computeBoundingSphere();
    this.mesh.geometry = geometry;
    this.mesh.visible = true;
  }

  rebuildAll() {
    this.cancelScheduledFlush();
    this.rebuild();
  }

  dispose() {
    this.cancelScheduledFlush();
    this.group.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
