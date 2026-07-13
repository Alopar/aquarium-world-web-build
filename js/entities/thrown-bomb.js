import * as THREE from 'three';
import { BOMB } from '../constants.js';
import { isSolid } from '../materials/registry.js';

function cellSolid(grid, x, y, z) {
  if (!grid.inBounds(x, y, z)) return true;
  return isSolid(grid.get(x, y, z));
}

/**
 * Thrown bomb entity — loot-like physics with a fuse, no pickup.
 */
export class ThrownBomb {
  constructor(position, velocity) {
    this.position = position.clone();
    this.velocity = velocity.clone();
    this.age = 0;
    this.fuseLeft = BOMB.fuseTime;
    this.onGround = false;
    this.alive = true;
    this.detonated = false;

    const geometry = new THREE.BoxGeometry(BOMB.size, BOMB.size, BOMB.size);
    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: 0x2a1a12,
        roughness: 0.7,
        metalness: 0.25,
        emissive: 0xff4400,
        emissiveIntensity: 0.4,
      }),
    );
    this.syncMesh();
  }

  syncMesh(dt = 0) {
    this.mesh.position.copy(this.position);
    const blink = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.age * BOMB.blinkSpeed * Math.PI * 2));
    const urgency = 1 - Math.max(0, this.fuseLeft) / BOMB.fuseTime;
    this.mesh.material.emissiveIntensity = blink * (0.35 + urgency * 1.4);
    if (dt > 0) {
      this.mesh.rotation.x += dt * BOMB.spinSpeed * 0.55;
      this.mesh.rotation.y += dt * BOMB.spinSpeed;
    }
  }

  update(grid, dt) {
    if (!this.alive) return;

    this.age += dt;
    this.fuseLeft -= dt;
    if (this.fuseLeft <= 0) {
      this.detonated = true;
      this.alive = false;
      return;
    }

    const subDt = dt / BOMB.subSteps;
    this.onGround = false;

    for (let step = 0; step < BOMB.subSteps; step++) {
      this.velocity.y -= BOMB.gravity * subDt;
      this.velocity.y = Math.max(this.velocity.y, -BOMB.maxFallSpeed);

      const drag = Math.max(0, 1 - BOMB.airDrag * subDt);
      this.velocity.x *= drag;
      this.velocity.z *= drag;

      this.moveAxis(grid, 'x', this.velocity.x * subDt);
      this.moveAxis(grid, 'y', this.velocity.y * subDt);
      this.moveAxis(grid, 'z', this.velocity.z * subDt);
    }

    if (this.onGround) {
      const friction = Math.max(0, 1 - BOMB.groundFriction * dt);
      this.velocity.x *= friction;
      this.velocity.z *= friction;
      if (Math.abs(this.velocity.x) < 0.02) this.velocity.x = 0;
      if (Math.abs(this.velocity.z) < 0.02) this.velocity.z = 0;
    }

    this.syncMesh(dt);
  }

  moveAxis(grid, axis, delta) {
    if (delta === 0) return;

    const half = BOMB.size * 0.5;
    this.position[axis] += delta;

    const probe = {
      x: this.position.x + (axis === 'x' ? Math.sign(delta) * half : 0),
      y: this.position.y + (axis === 'y' ? Math.sign(delta) * half : 0),
      z: this.position.z + (axis === 'z' ? Math.sign(delta) * half : 0),
    };
    const bx = Math.floor(probe.x);
    const by = Math.floor(probe.y);
    const bz = Math.floor(probe.z);

    if (!cellSolid(grid, bx, by, bz)) return;

    if (delta > 0) {
      const face = axis === 'x' ? bx : axis === 'y' ? by : bz;
      this.position[axis] = face - half - 1e-4;
    } else {
      const face = (axis === 'x' ? bx : axis === 'y' ? by : bz) + 1;
      this.position[axis] = face + half + 1e-4;
    }

    if (axis === 'y' && delta < 0) {
      this.velocity.y *= -BOMB.bounce;
      if (Math.abs(this.velocity.y) < 1.1) this.velocity.y = 0;
      this.onGround = true;
    } else {
      this.velocity[axis] *= -BOMB.bounce;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
