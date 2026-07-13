import { VOXEL_SIZE } from '../constants.js';
import { getFluid } from '../fluids/registry.js';

/**
 * Liquid fill fraction 0…1 for a cell (1 if liquid continues above).
 */
export function getFluidFill(grid, fluidField, x, y, z) {
  if (!grid?.inBounds(x, y, z)) return 0;

  const id = grid.get(x, y, z);
  const fluid = getFluid(id);
  if (!fluid) return 0;

  if (!fluidField) return 1;

  const vol = fluidField.getVolume(x, y, z);
  if (vol <= 0) return 0;

  const hasLiquidAbove = grid.inBounds(x, y + 1, z)
    && grid.get(x, y + 1, z) === id
    && fluidField.getVolume(x, y + 1, z) > 0;

  return hasLiquidAbove ? 1 : vol / fluid.maxVolume;
}

/** True if a world-space point sits inside liquid fill. */
export function isPointInFluid(grid, fluidField, worldX, worldY, worldZ) {
  if (!grid) return false;

  const x = Math.floor(worldX / VOXEL_SIZE);
  const y = Math.floor(worldY / VOXEL_SIZE);
  const z = Math.floor(worldZ / VOXEL_SIZE);
  if (!grid.inBounds(x, y, z)) return false;

  const fill = getFluidFill(grid, fluidField, x, y, z);
  if (fill <= 0) return false;

  const top = (y + fill) * VOXEL_SIZE;
  return worldY < top - 0.02 && worldY >= y * VOXEL_SIZE - 0.02;
}

/**
 * Body immersion for swimming / underwater FX.
 * Swim when mid-torso or eyes are in liquid (shallow puddles stay walkable).
 */
export function samplePlayerFluidState(grid, fluidField, feetPos, height, eyeHeight) {
  const x = feetPos.x;
  const z = feetPos.z;
  const feetY = feetPos.y + 0.15;
  const midY = feetPos.y + height * 0.45;
  const eyeY = feetPos.y + eyeHeight;

  const feetInFluid = isPointInFluid(grid, fluidField, x, feetY, z);
  const midInFluid = isPointInFluid(grid, fluidField, x, midY, z);
  const eyesInFluid = isPointInFluid(grid, fluidField, x, eyeY, z);

  return {
    inFluid: midInFluid || eyesInFluid,
    feetInFluid,
    midInFluid,
    eyesInFluid,
  };
}
