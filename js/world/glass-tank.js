import * as THREE from 'three';
import { AQUARIUM_SIZE, VOXEL_SIZE } from '../constants.js';

export function getTankBounds(size = AQUARIUM_SIZE, voxelSize = VOXEL_SIZE) {
  const sx = size.x * voxelSize;
  const sz = size.z * voxelSize;
  return { minX: 0, maxX: sx, minZ: 0, maxZ: sz, minY: 0 };
}

export function createAquariumTank(scene, size = AQUARIUM_SIZE, { simpleGlass = false } = {}) {
  const group = new THREE.Group();
  group.name = 'aquarium-tank';

  const wallMaterial = simpleGlass
    ? new THREE.MeshBasicMaterial({
      color: 0x88ccff,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    : new THREE.MeshPhysicalMaterial({
      color: 0x88ccff,
      transparent: true,
      opacity: 0.22,
      roughness: 0.04,
      metalness: 0.05,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

  const floorMaterial = simpleGlass
    ? new THREE.MeshBasicMaterial({
      color: 0x1a3050,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    })
    : new THREE.MeshStandardMaterial({
      color: 0x1a3050,
      roughness: 0.9,
      metalness: 0.05,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });

  const sx = size.x * VOXEL_SIZE;
  const sy = size.y * VOXEL_SIZE;
  const sz = size.z * VOXEL_SIZE;
  const wallThickness = 0.15;

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(sx + 0.4, 0.2, sz + 0.4),
    floorMaterial,
  );
  floor.position.set(sx * 0.5, -0.1, sz * 0.5);
  floor.receiveShadow = true;
  floor.renderOrder = 1;
  group.add(floor);

  const wallGeoSide = new THREE.BoxGeometry(wallThickness, sy, sz + 0.4);
  const wallGeoFront = new THREE.BoxGeometry(sx + 0.4, sy, wallThickness);

  const walls = [
    { mesh: new THREE.Mesh(wallGeoSide, wallMaterial), x: -wallThickness * 0.5, y: sy * 0.5, z: sz * 0.5 },
    { mesh: new THREE.Mesh(wallGeoSide, wallMaterial), x: sx + wallThickness * 0.5, y: sy * 0.5, z: sz * 0.5 },
    { mesh: new THREE.Mesh(wallGeoFront, wallMaterial), x: sx * 0.5, y: sy * 0.5, z: -wallThickness * 0.5 },
    { mesh: new THREE.Mesh(wallGeoFront, wallMaterial), x: sx * 0.5, y: sy * 0.5, z: sz + wallThickness * 0.5 },
  ];

  for (const { mesh, x, y, z } of walls) {
    mesh.position.set(x, y, z);
    mesh.renderOrder = 1;
    group.add(mesh);
  }

  scene.add(group);
  return group;
}
