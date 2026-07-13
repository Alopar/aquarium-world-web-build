import { VOXEL_SIZE } from '../constants.js';

export function createAabb() {
  return { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
}

/**
 * Position is feet center: (x, y, z) at bottom-center of the player box.
 */
export function setAabbFromFeet(aabb, x, y, z, halfWidth, height) {
  aabb.minX = x - halfWidth;
  aabb.maxX = x + halfWidth;
  aabb.minY = y;
  aabb.maxY = y + height;
  aabb.minZ = z - halfWidth;
  aabb.maxZ = z + halfWidth;
}

export function aabbIntersectsBlock(aabb, bx, by, bz, voxelSize = VOXEL_SIZE) {
  const blockMinX = bx * voxelSize;
  const blockMinY = by * voxelSize;
  const blockMinZ = bz * voxelSize;
  const blockMaxX = blockMinX + voxelSize;
  const blockMaxY = blockMinY + voxelSize;
  const blockMaxZ = blockMinZ + voxelSize;

  return aabb.minX < blockMaxX
    && aabb.maxX > blockMinX
    && aabb.minY < blockMaxY
    && aabb.maxY > blockMinY
    && aabb.minZ < blockMaxZ
    && aabb.maxZ > blockMinZ;
}

export function forEachBlockInAabb(aabb, voxelSize, callback) {
  const minBX = Math.floor(aabb.minX / voxelSize);
  const maxBX = Math.floor((aabb.maxX - 1e-6) / voxelSize);
  const minBY = Math.floor(aabb.minY / voxelSize);
  const maxBY = Math.floor((aabb.maxY - 1e-6) / voxelSize);
  const minBZ = Math.floor(aabb.minZ / voxelSize);
  const maxBZ = Math.floor((aabb.maxZ - 1e-6) / voxelSize);

  for (let x = minBX; x <= maxBX; x++) {
    for (let y = minBY; y <= maxBY; y++) {
      for (let z = minBZ; z <= maxBZ; z++) {
        callback(x, y, z);
      }
    }
  }
}

export function aabbIntersectsBlockCoords(aabb, bx, by, bz, voxelSize = VOXEL_SIZE) {
  return aabbIntersectsBlock(aabb, bx, by, bz, voxelSize);
}
