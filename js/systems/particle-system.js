import * as THREE from 'three';
import { PARTICLES, VOXEL_SIZE } from '../constants.js';
import { getMaterial } from '../materials/registry.js';

function randomUnitVector() {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  return new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta),
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi),
  );
}

export class ParticleSystem {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.bursts = [];
  }

  spawnBlockBreak(x, y, z, materialId) {
    const cfg = PARTICLES.blockBreak;
    const centerX = (x + 0.5) * VOXEL_SIZE;
    const centerY = (y + 0.5) * VOXEL_SIZE;
    const centerZ = (z + 0.5) * VOXEL_SIZE;

    const mat = getMaterial(materialId);
    const color = new THREE.Color(mat.color ?? 0xaaaaaa);
    this.spawnBurst(centerX, centerY, centerZ, color, cfg, 0.35);
  }

  /**
   * Short upward spray when a raindrop hits the ground (world coords).
   */
  spawnSplash(worldX, worldY, worldZ) {
    const cfg = PARTICLES.rainSplash;
    const color = new THREE.Color(0xb8d4ea);
    this.spawnBurst(worldX, worldY, worldZ, color, cfg, 0.85);
  }

  spawnExplosion(worldX, worldY, worldZ) {
    const cfg = PARTICLES.explosion;
    this.spawnBurst(worldX, worldY, worldZ, new THREE.Color(0xff6a20), cfg, 0.15);
    this.spawnBurst(worldX, worldY, worldZ, new THREE.Color(0xffcc44), {
      ...cfg,
      count: Math.floor(cfg.count * 0.55),
      speed: cfg.speed * 0.7,
      size: cfg.size * 0.7,
      lifetime: cfg.lifetime * 0.85,
    }, 0.4);
  }

  spawnBurst(centerX, centerY, centerZ, color, cfg, upwardBias) {
    const count = cfg.count;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const velocities = [];

    for (let i = 0; i < count; i++) {
      positions[i * 3] = centerX + (Math.random() - 0.5) * 0.15;
      positions[i * 3 + 1] = centerY + Math.random() * 0.08;
      positions[i * 3 + 2] = centerZ + (Math.random() - 0.5) * 0.15;

      const shade = 0.75 + Math.random() * 0.35;
      colors[i * 3] = color.r * shade;
      colors[i * 3 + 1] = color.g * shade;
      colors[i * 3 + 2] = color.b * shade;

      const dir = randomUnitVector();
      const speed = cfg.speed * (0.6 + Math.random() * 0.6);
      dir.y += upwardBias;
      dir.normalize();
      velocities.push(dir.multiplyScalar(speed));
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: cfg.size,
      transparent: true,
      opacity: 1,
      vertexColors: true,
      depthWrite: false,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geometry, material);
    this.group.add(points);

    this.bursts.push({
      points,
      geometry,
      material,
      positions,
      velocities,
      age: 0,
      maxAge: cfg.lifetime,
      gravity: cfg.gravity,
      size: cfg.size,
    });
  }

  update(dt) {
    const drag = 4;

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i];
      burst.age += dt;

      if (burst.age >= burst.maxAge) {
        this.removeBurst(i);
        continue;
      }

      const life = 1 - burst.age / burst.maxAge;
      const gravity = burst.gravity ?? PARTICLES.blockBreak.gravity;
      const baseSize = burst.size ?? PARTICLES.blockBreak.size;

      for (let p = 0; p < burst.velocities.length; p++) {
        const vel = burst.velocities[p];
        vel.y -= gravity * dt;
        vel.multiplyScalar(Math.max(0, 1 - drag * dt));

        burst.positions[p * 3] += vel.x * dt;
        burst.positions[p * 3 + 1] += vel.y * dt;
        burst.positions[p * 3 + 2] += vel.z * dt;
      }

      burst.geometry.attributes.position.needsUpdate = true;
      burst.material.opacity = life;
      burst.material.size = baseSize * (0.4 + 0.6 * life);
    }
  }

  removeBurst(index) {
    const burst = this.bursts[index];
    this.group.remove(burst.points);
    burst.geometry.dispose();
    burst.material.dispose();
    this.bursts.splice(index, 1);
  }

  dispose() {
    while (this.bursts.length > 0) {
      this.removeBurst(0);
    }
    this.group.parent?.remove(this.group);
  }
}
