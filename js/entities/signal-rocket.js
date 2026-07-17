import * as THREE from 'three';
import { SIGNAL_ROCKET, VOXEL_SIZE } from '../constants.js';
import { isSolid } from '../materials/registry.js';
import { createVoxelBrightnessMaterial, setGeometryFullBright } from '../shaders/voxel-brightness-material.js';
import { applyMeshVoxelBrightness } from '../lighting/brightness-sampling.js';

let _signalRocketLightSeq = 0;

function worldToBlock(x, y, z) {
  return {
    x: Math.floor(x / VOXEL_SIZE),
    y: Math.floor(y / VOXEL_SIZE),
    z: Math.floor(z / VOXEL_SIZE),
  };
}

function cellSolid(grid, x, y, z) {
  if (!grid.inBounds(x, y, z)) return true;
  return isSolid(grid.get(x, y, z));
}

/**
 * Signal flare: straight trajectory, red dynamic light, burns in place after impact.
 */
export class SignalRocket {
  constructor(position, velocity) {
    this.position = position.clone();
    this.velocity = velocity.clone();
    this.age = 0;
    this.alive = true;
    this.burning = false;
    this.burnLeft = 0;
    this.lastAirCell = null;
    this.lightId = `signal-rocket-${++_signalRocketLightSeq}`;

    const geometry = new THREE.BoxGeometry(
      SIGNAL_ROCKET.size,
      SIGNAL_ROCKET.size,
      SIGNAL_ROCKET.length,
    );
    setGeometryFullBright(geometry);
    this.mesh = new THREE.Mesh(
      geometry,
      createVoxelBrightnessMaterial({
        color: SIGNAL_ROCKET.color,
        emissive: SIGNAL_ROCKET.emissive,
        emissiveIntensity: 1.8,
      }),
    );
    this.orientMesh();
    this.syncMesh();
  }

  orientMesh() {
    const dir = this.velocity.clone();
    if (dir.lengthSq() < 1e-8) return;
    dir.normalize();
    this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  }

  syncMesh(lighting = null) {
    this.mesh.position.copy(this.position);
    applyMeshVoxelBrightness(this.mesh, lighting, this.position.x, this.position.y, this.position.z);
    if (this.mesh.material.uniforms?.uEmissiveMul) {
      const pulse = this.burning
        ? 0.7 + 0.5 * (0.5 + 0.5 * Math.sin(this.age * 10))
        : 1.2;
      this.mesh.material.uniforms.uEmissiveMul.value = pulse;
    }
  }

  sampleCell(grid, bx, by, bz) {
    if (!grid.inBounds(bx, by, bz)) return 'out';
    if (cellSolid(grid, bx, by, bz)) return 'solid';
    const id = grid.get(bx, by, bz);
    if (id === 'air') return 'air';
    return 'pass';
  }

  beginBurn() {
    this.burning = true;
    this.burnLeft = SIGNAL_ROCKET.burnTime;
    this.velocity.set(0, 0, 0);
  }

  update(grid, dt, lighting = null) {
    if (!this.alive) return;

    this.age += dt;

    if (this.burning) {
      this.burnLeft -= dt;
      this.syncMesh(lighting);
      if (this.burnLeft <= 0) {
        this.alive = false;
      }
      return;
    }

    if (this.age >= SIGNAL_ROCKET.maxLifetime) {
      this.beginBurn();
      this.syncMesh(lighting);
      return;
    }

    const subDt = dt / SIGNAL_ROCKET.subSteps;
    let hit = false;

    for (let step = 0; step < SIGNAL_ROCKET.subSteps; step++) {
      this.position.x += this.velocity.x * subDt;
      this.position.y += this.velocity.y * subDt;
      this.position.z += this.velocity.z * subDt;

      const { x: bx, y: by, z: bz } = worldToBlock(
        this.position.x,
        this.position.y,
        this.position.z,
      );
      const sample = this.sampleCell(grid, bx, by, bz);

      if (sample === 'air' || sample === 'pass') {
        this.lastAirCell = { x: bx, y: by, z: bz };
      } else if (sample === 'solid' || sample === 'out') {
        hit = true;
        break;
      }
    }

    if (hit) {
      if (this.lastAirCell) {
        this.position.set(
          (this.lastAirCell.x + 0.5) * VOXEL_SIZE,
          (this.lastAirCell.y + 0.5) * VOXEL_SIZE,
          (this.lastAirCell.z + 0.5) * VOXEL_SIZE,
        );
      }
      this.beginBurn();
    }

    this.orientMesh();
    this.syncMesh(lighting);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
