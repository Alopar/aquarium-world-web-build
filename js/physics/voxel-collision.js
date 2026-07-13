import { PHYSICS, VOXEL_SIZE } from '../constants.js';
import { isSolid } from '../materials/registry.js';
import {
  aabbIntersectsBlock,
  createAabb,
  forEachBlockInAabb,
  setAabbFromFeet,
} from './aabb.js';

const AXES = ['y', 'x', 'z'];
const EPSILON = 1e-4;

function isCollidableBlock(grid, x, y, z, isCollidable) {
  if (!grid.inBounds(x, y, z)) return true;
  return isCollidable(grid.get(x, y, z));
}

function resolveAxis(grid, aabb, axis, delta, isCollidable) {
  if (delta === 0) return false;

  const movingPositive = delta > 0;
  let bestCorrection = 0;
  let hit = false;

  forEachBlockInAabb(aabb, VOXEL_SIZE, (bx, by, bz) => {
    if (!isCollidableBlock(grid, bx, by, bz, isCollidable)) return;
    if (!aabbIntersectsBlock(aabb, bx, by, bz, VOXEL_SIZE)) return;

    let correction = 0;

    if (axis === 'x') {
      if (movingPositive) {
        const limit = bx * VOXEL_SIZE - EPSILON;
        if (aabb.maxX > limit) correction = limit - aabb.maxX;
      } else {
        const limit = (bx + 1) * VOXEL_SIZE + EPSILON;
        if (aabb.minX < limit) correction = limit - aabb.minX;
      }
      if (correction !== 0) {
        if (!hit || (movingPositive ? correction < bestCorrection : correction > bestCorrection)) {
          bestCorrection = correction;
        }
        hit = true;
      }
    } else if (axis === 'y') {
      if (movingPositive) {
        const limit = by * VOXEL_SIZE - EPSILON;
        if (aabb.maxY > limit) correction = limit - aabb.maxY;
      } else {
        const limit = (by + 1) * VOXEL_SIZE + EPSILON;
        if (aabb.minY < limit) correction = limit - aabb.minY;
      }
      if (correction !== 0) {
        if (!hit || (movingPositive ? correction < bestCorrection : correction > bestCorrection)) {
          bestCorrection = correction;
        }
        hit = true;
      }
    } else if (axis === 'z') {
      if (movingPositive) {
        const limit = bz * VOXEL_SIZE - EPSILON;
        if (aabb.maxZ > limit) correction = limit - aabb.maxZ;
      } else {
        const limit = (bz + 1) * VOXEL_SIZE + EPSILON;
        if (aabb.minZ < limit) correction = limit - aabb.minZ;
      }
      if (correction !== 0) {
        if (!hit || (movingPositive ? correction < bestCorrection : correction > bestCorrection)) {
          bestCorrection = correction;
        }
        hit = true;
      }
    }
  });

  if (hit) {
    applyAxisDelta(aabb, axis, bestCorrection);
  }

  return hit;
}

function applyAxisDelta(aabb, axis, delta) {
  if (axis === 'x') {
    aabb.minX += delta;
    aabb.maxX += delta;
  } else if (axis === 'y') {
    aabb.minY += delta;
    aabb.maxY += delta;
  } else {
    aabb.minZ += delta;
    aabb.maxZ += delta;
  }
}

function getSubStepCount(velocity, dt) {
  const maxMove = Math.max(
    Math.abs(velocity.x * dt),
    Math.abs(velocity.y * dt),
    Math.abs(velocity.z * dt),
  );
  if (maxMove <= PHYSICS.subStepThreshold) return 1;
  return Math.min(PHYSICS.maxSubSteps, Math.ceil(maxMove / PHYSICS.subStepThreshold));
}

function feetCenterFromAabb(aabb, halfWidth) {
  return {
    x: (aabb.minX + aabb.maxX) * 0.5,
    y: aabb.minY,
    z: (aabb.minZ + aabb.maxZ) * 0.5,
  };
}

/**
 * Resolves movement against a voxel grid using axis-separated collision.
 * Mutates position and velocity in place.
 */
export function resolveMovement(
  grid,
  position,
  velocity,
  halfWidth,
  height,
  dt,
  isCollidable = isSolid,
) {
  const aabb = createAabb();
  const result = {
    onGround: false,
    onCeiling: false,
    collided: false,
    landingSpeed: 0,
  };

  const subSteps = getSubStepCount(velocity, dt);
  const subDt = dt / subSteps;

  for (let step = 0; step < subSteps; step++) {
    setAabbFromFeet(aabb, position.x, position.y, position.z, halfWidth, height);

    for (const axis of AXES) {
      const delta = velocity[axis] * subDt;
      if (delta === 0) continue;

      applyAxisDelta(aabb, axis, delta);
      const hit = resolveAxis(grid, aabb, axis, delta, isCollidable);

      if (hit) {
        result.collided = true;
        if (axis === 'y') {
          if (delta < 0) {
            result.onGround = true;
            result.landingSpeed = Math.max(result.landingSpeed, Math.abs(velocity.y));
            if (velocity.y < 0) velocity.y = 0;
          } else {
            result.onCeiling = true;
            if (velocity.y > 0) velocity.y = 0;
          }
        } else if (axis === 'x' && velocity.x !== 0) {
          velocity.x = 0;
        } else if (axis === 'z' && velocity.z !== 0) {
          velocity.z = 0;
        }
      }

      const feet = feetCenterFromAabb(aabb, halfWidth);
      position.x = feet.x;
      position.y = feet.y;
      position.z = feet.z;
    }
  }

  return result;
}

export function isPositionFree(grid, x, y, z, halfWidth, height, isCollidable = isSolid) {
  const aabb = createAabb();
  setAabbFromFeet(aabb, x, y, z, halfWidth, height);

  let blocked = false;
  forEachBlockInAabb(aabb, VOXEL_SIZE, (bx, by, bz) => {
    if (isCollidableBlock(grid, bx, by, bz, isCollidable)) {
      if (aabbIntersectsBlock(aabb, bx, by, bz, VOXEL_SIZE)) {
        blocked = true;
      }
    }
  });

  return !blocked;
}

export function findFreeSpawnY(grid, x, z, startY, halfWidth, height, isCollidable = isSolid) {
  const maxY = grid.size.y - height - EPSILON;
  let y = Math.min(startY, maxY);

  for (let i = 0; i < grid.size.y; i++) {
    if (isPositionFree(grid, x, y, z, halfWidth, height, isCollidable)) {
      return y;
    }
    y = Math.min(y + 1, maxY);
  }

  return Math.max(0, startY);
}

export function getPlayerAabb(aabb, position, halfWidth, height) {
  setAabbFromFeet(aabb, position.x, position.y, position.z, halfWidth, height);
  return aabb;
}

export function blockIntersectsPlayerAabb(playerAabb, bx, by, bz, voxelSize = VOXEL_SIZE) {
  return aabbIntersectsBlock(playerAabb, bx, by, bz, voxelSize);
}
