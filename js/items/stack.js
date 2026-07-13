import { getItem } from './registry.js';
import { getMaterial } from '../materials/registry.js';

/** Hotbar / loot display: prefer item def, else block material. */
export function getStackDef(id) {
  return getItem(id) ?? getMaterial(id);
}
