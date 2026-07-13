import * as THREE from 'three';
import { PROJECTILE, VOXEL_SIZE } from '../constants.js';
import { getMaterial, isSolid } from '../materials/registry.js';
import { getBlockTexture } from '../materials/textures.js';

function createProjectileMaterial(materialDef) {
  const texture = materialDef.texture ? getBlockTexture(materialDef.texture) : null;
  const params = {
    color: texture ? 0xffffff : materialDef.color,
    transparent: materialDef.opacity != null && materialDef.opacity < 1,
    opacity: materialDef.opacity ?? 1,
    roughness: 0.92,
  };
  if (texture) params.map = texture;
  if (materialDef.emissive != null) {
    params.emissive = materialDef.emissive;
    params.emissiveIntensity = materialDef.emissiveIntensity ?? 0.6;
  }
  return new THREE.MeshStandardMaterial(params);
}

function worldToBlock(x, y, z) {
  return {
    x: Math.floor(x / VOXEL_SIZE),
    y: Math.floor(y / VOXEL_SIZE),
    z: Math.floor(z / VOXEL_SIZE),
  };
}

export class Projectile {
  constructor(materialId, position, velocity) {
    this.materialId = materialId;
    this.position = position.clone();
    this.velocity = velocity.clone();
    this.age = 0;
    this.alive = true;
    this.lastAirCell = null;

    const materialDef = getMaterial(materialId);
    const geometry = new THREE.BoxGeometry(VOXEL_SIZE * 0.92, VOXEL_SIZE * 0.92, VOXEL_SIZE * 0.92);
    const meshMaterial = createProjectileMaterial(materialDef);
    this.mesh = new THREE.Mesh(geometry, meshMaterial);
    this.syncMesh();
  }

  syncMesh() {
    this.mesh.position.copy(this.position);
  }

  sampleCell(grid, bx, by, bz) {
    if (!grid.inBounds(bx, by, bz)) return 'out';
    const id = grid.get(bx, by, bz);
    if (isSolid(id)) return 'solid';
    if (id === 'air') return 'air';
    // Liquids and other non-solids — pass through, still valid place cells.
    return 'pass';
  }

  update(grid, dt) {
    if (!this.alive) return null;

    this.age += dt;
    if (this.age >= PROJECTILE.maxLifetime) {
      this.alive = false;
      return { type: 'expired', cell: this.lastAirCell };
    }

    const subDt = dt / PROJECTILE.subSteps;
    let hit = null;

    for (let step = 0; step < PROJECTILE.subSteps; step++) {
      this.velocity.y -= PROJECTILE.gravity * subDt;
      this.velocity.y = Math.max(this.velocity.y, -PROJECTILE.maxFallSpeed);

      this.position.x += this.velocity.x * subDt;
      this.position.y += this.velocity.y * subDt;
      this.position.z += this.velocity.z * subDt;

      const { x: bx, y: by, z: bz } = worldToBlock(
        this.position.x,
        this.position.y,
        this.position.z,
      );
      const sample = this.sampleCell(grid, bx, by, bz);

      // Air and liquid are both passable — remember last cell for placement.
      if (sample === 'air' || sample === 'pass') {
        this.lastAirCell = { x: bx, y: by, z: bz };
      } else if (sample === 'solid' || sample === 'out') {
        hit = { type: sample, cell: this.lastAirCell };
        break;
      }
    }

    this.syncMesh();

    if (hit) {
      this.alive = false;
      return hit;
    }

    return null;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
