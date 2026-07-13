import { DEFAULT_WORLD_SEED } from './constants.js';

const STORAGE_KEY = 'aquarium-world-seed';

export function resolveWorldSeed(rawValue) {
  const trimmed = String(rawValue).trim();
  if (!trimmed) return DEFAULT_WORLD_SEED;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return DEFAULT_WORLD_SEED;

  return Math.trunc(parsed);
}

export function loadStoredSeed() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) return resolveWorldSeed(raw);
  } catch {
    /* private mode / blocked storage */
  }
  return DEFAULT_WORLD_SEED;
}

export function storeSeed(seed) {
  try {
    localStorage.setItem(STORAGE_KEY, String(seed));
  } catch {
    /* ignore */
  }
}
