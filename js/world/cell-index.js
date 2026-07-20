import { AQUARIUM_SIZE } from '../constants.js';

/** Fixed aquarium dimensions used by packed cell indices. */
export const CELL_SIZE_X = AQUARIUM_SIZE.x;
export const CELL_SIZE_Y = AQUARIUM_SIZE.y;
export const CELL_SIZE_Z = AQUARIUM_SIZE.z;
export const CELL_PLANE = CELL_SIZE_X * CELL_SIZE_Z;
export const CELL_VOLUME = CELL_SIZE_X * CELL_SIZE_Y * CELL_SIZE_Z;

/**
 * Linear index matching VoxelLightingSystem: y * sx * sz + z * sx + x
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {{ x: number, y: number, z: number }} [size]
 */
export function cellIndex(x, y, z, size = AQUARIUM_SIZE) {
  return y * size.x * size.z + z * size.x + x;
}

/**
 * Pack voxel coords into a linear int key (aquarium size).
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
export function packCell(x, y, z) {
  return y * CELL_PLANE + z * CELL_SIZE_X + x;
}

/**
 * Unpack a linear int key into { x, y, z }.
 * @param {number} i
 * @returns {{ x: number, y: number, z: number }}
 */
export function unpackCell(i) {
  const y = Math.floor(i / CELL_PLANE);
  const rem = i - y * CELL_PLANE;
  const z = Math.floor(rem / CELL_SIZE_X);
  const x = rem - z * CELL_SIZE_X;
  return { x, y, z };
}

/**
 * Write unpacked coords into an existing object (avoids alloc in hot loops).
 * @param {number} i
 * @param {{ x: number, y: number, z: number }} out
 */
export function unpackCellInto(i, out) {
  const y = (i / CELL_PLANE) | 0;
  const rem = i - y * CELL_PLANE;
  const z = (rem / CELL_SIZE_X) | 0;
  out.x = rem - z * CELL_SIZE_X;
  out.y = y;
  out.z = z;
  return out;
}
