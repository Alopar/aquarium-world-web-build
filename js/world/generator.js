import { DEFAULT_WORLD_SEED } from '../constants.js';
import { generateTrees } from './trees.js';

const NOISE_SIZE = 256;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildPermutation(seed) {
  const perm = Array.from({ length: NOISE_SIZE }, (_, i) => i);
  let s = seed;
  for (let i = NOISE_SIZE - 1; i > 0; i--) {
    s = (s * 16807 + 0) % 2147483647;
    const j = s % (i + 1);
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  return perm.concat(perm);
}

function valueNoise2D(perm, x, z) {
  const xi = Math.floor(x) & 255;
  const zi = Math.floor(z) & 255;
  const xf = x - Math.floor(x);
  const zf = z - Math.floor(z);
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);

  const aa = perm[perm[xi] + zi] / 255;
  const ab = perm[perm[xi] + zi + 1] / 255;
  const ba = perm[perm[xi + 1] + zi] / 255;
  const bb = perm[perm[xi + 1] + zi + 1] / 255;

  const x1 = aa + u * (ba - aa);
  const x2 = ab + u * (bb - ab);
  return x1 + v * (x2 - x1);
}

function fractalNoise(perm, x, z, octaves = 4) {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let total = 0;

  for (let i = 0; i < octaves; i++) {
    value += valueNoise2D(perm, x * frequency, z * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return value / total;
}

function surfaceHeight(perm, x, z, minH, maxH) {
  const broad = fractalNoise(perm, x * 0.04, z * 0.04, 4);
  const hills = fractalNoise(perm, x * 0.09 + 17, z * 0.09 + 17, 3);
  const detail = fractalNoise(perm, x * 0.2 + 41, z * 0.2 + 41, 2);
  const basin = fractalNoise(perm, x * 0.05 + 73, z * 0.05 + 73, 3);

  let shape = broad * 0.55 + hills * 0.3 + detail * 0.15;

  if (basin < 0.32) {
    shape -= ((0.32 - basin) / 0.32) * 0.22;
  }

  if (basin > 0.72) {
    shape += ((basin - 0.72) / 0.28) * 0.14;
  }

  return Math.floor(minH + clamp(shape, 0, 1) * (maxH - minH));
}

function pickColumnMaterial(depth, topSoilDepth, slope, soilNoise, moisture, isBasin) {
  if (depth === 0) {
    if (isBasin) return 'sand';
    if (slope >= 2 && soilNoise > 0.62) return 'gravel';
    return 'grass';
  }

  if (depth <= topSoilDepth) {
    if (isBasin && depth <= 1) return 'sand';
    if (slope >= 2 && soilNoise > 0.7) return 'gravel';
    return 'dirt';
  }

  if (depth <= topSoilDepth + 2) {
    return moisture > 0.55 ? 'gravel' : 'stone';
  }

  return 'stone';
}

export function generateTerrain(grid, seed = DEFAULT_WORLD_SEED) {
  const perm = buildPermutation(seed);
  const { x: sx, y: sy, z: sz } = grid.size;

  // Дно мира — лавовые камни (не вода).
  grid.fillLayer(0, 'lava_rock');

  const heights = new Uint8Array(sx * sz);
  for (let x = 0; x < sx; x++) {
    for (let z = 0; z < sz; z++) {
      heights[x * sz + z] = surfaceHeight(perm, x, z, 5, 14);
    }
  }

  for (let x = 0; x < sx; x++) {
    for (let z = 0; z < sz; z++) {
      const h = heights[x * sz + z];
      const soilNoise = fractalNoise(perm, x * 0.11 + 11, z * 0.11 + 11, 2);
      const moisture = fractalNoise(perm, x * 0.06 + 29, z * 0.06 + 29, 3);
      const topSoilDepth = 2 + Math.floor(fractalNoise(perm, x * 0.13 + 53, z * 0.13 + 53, 2) * 2);

      const slope = Math.max(
        Math.abs(h - heights[Math.max(0, x - 1) * sz + z]),
        Math.abs(h - heights[Math.min(sx - 1, x + 1) * sz + z]),
        Math.abs(h - heights[x * sz + Math.max(0, z - 1)]),
        Math.abs(h - heights[x * sz + Math.min(sz - 1, z + 1)]),
      );
      const isBasin = h <= 7 && moisture < 0.42;

      for (let y = 1; y <= h && y < sy; y++) {
        // Нижний слой над дном тоже лавовый камень.
        if (y <= 1) {
          grid.set(x, y, z, 'lava_rock');
          continue;
        }
        const depth = h - y;
        const material = pickColumnMaterial(depth, topSoilDepth, slope, soilNoise, moisture, isBasin);
        grid.set(x, y, z, material);
      }

      if (soilNoise > 0.86 && slope >= 2 && h + 1 < sy) {
        grid.set(x, h + 1, z, 'cobblestone');
      }
    }
  }

  for (let i = 0; i < 8; i++) {
    const cx = 8 + Math.floor(fractalNoise(perm, i * 2.7, i * 1.9) * (sx - 16));
    const cz = 8 + Math.floor(fractalNoise(perm, i * 4.1, i * 3.3) * (sz - 16));
    const radius = 2 + Math.floor(fractalNoise(perm, i + 7, i + 19) * 2);
    const carveDepth = 1 + Math.floor(fractalNoise(perm, i + 31, i + 47) * 2);

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const x = cx + dx;
        const z = cz + dz;
        if (x < 0 || z < 0 || x >= sx || z >= sz) continue;

        const distance = Math.sqrt(dx * dx + dz * dz);
        if (distance > radius) continue;

        const surface = heights[x * sz + z];
        const depth = Math.max(0, Math.round((1 - distance / radius) * carveDepth));
        if (depth === 0) continue;

        for (let y = surface; y > surface - depth && y > 0; y--) {
          grid.set(x, y, z, 'air');
        }

        const newSurface = surface - depth;
        if (newSurface <= 0) continue;

        grid.set(x, newSurface, z, depth > 1 ? 'sand' : 'grass');
        if (newSurface - 1 > 0) {
          grid.set(x, newSurface - 1, z, 'dirt');
        }
      }
    }
  }

  // Heights after carving: surface may have dropped in pockets.
  for (let x = 0; x < sx; x++) {
    for (let z = 0; z < sz; z++) {
      let y = heights[x * sz + z];
      while (y > 0 && grid.get(x, y, z) === 'air') y--;
      heights[x * sz + z] = y;
    }
  }

  const treePlans = generateTrees(grid, heights, perm, fractalNoise);
  generateOreVeins(grid, heights, perm, fractalNoise);
  return treePlans;
}

/**
 * Scatter ore pockets inside stone below the surface.
 * Each ore uses its own noise channel so types don't wipe each other out.
 */
function generateOreVeins(grid, heights, perm, noiseFn) {
  const { x: sx, y: sy, z: sz } = grid.size;
  // Rarest first. Thresholds tuned for a ~64³ world: noticeable but not flooded.
  const oreTypes = [
    { id: 'crystal_ore', threshold: 0.83, depthMin: 3, scale: 0.38, salt: 401, maxExtra: 3 },
    { id: 'copper_ore', threshold: 0.79, depthMin: 2, scale: 0.34, salt: 307, maxExtra: 4 },
    { id: 'iron_ore', threshold: 0.76, depthMin: 2, scale: 0.30, salt: 211, maxExtra: 4 },
    { id: 'coal_ore', threshold: 0.72, depthMin: 1, scale: 0.28, salt: 113, maxExtra: 5 },
  ];

  const neighbors = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];

  const growBlob = (ox, oy, oz, oreId, maxExtra) => {
    let placed = 0;
    const queue = [[ox, oy, oz]];
    const seen = new Set([`${ox},${oy},${oz}`]);

    while (queue.length > 0 && placed < maxExtra) {
      const [cx, cy, cz] = queue.shift();
      const order = neighbors.slice().sort((a, b) => {
        const ka = ((cx + a[0]) * 73856093) ^ ((cy + a[1]) * 19349663) ^ ((cz + a[2]) * 83492791);
        const kb = ((cx + b[0]) * 73856093) ^ ((cy + b[1]) * 19349663) ^ ((cz + b[2]) * 83492791);
        return (ka & 255) - (kb & 255);
      });

      for (const [dx, dy, dz] of order) {
        if (placed >= maxExtra) break;
        const nx = cx + dx;
        const ny = cy + dy;
        const nz = cz + dz;
        const key = `${nx},${ny},${nz}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!grid.inBounds(nx, ny, nz)) continue;
        if (grid.get(nx, ny, nz) !== 'stone') continue;
        const surface = heights[nx * sz + nz];
        if (ny >= surface) continue;
        grid.set(nx, ny, nz, oreId);
        placed++;
        if (((nx * 31 + ny * 17 + nz * 13) & 255) < 170) queue.push([nx, ny, nz]);
      }
    }
  };

  for (const ore of oreTypes) {
    for (let x = 1; x < sx - 1; x++) {
      for (let z = 1; z < sz - 1; z++) {
        const surface = heights[x * sz + z];
        for (let y = 1; y < surface && y < sy; y++) {
          if (grid.get(x, y, z) !== 'stone') continue;
          const depth = surface - y;
          if (depth < ore.depthMin) continue;

          const n =
            noiseFn(perm, x * ore.scale + ore.salt, z * ore.scale + ore.salt * 0.7, 3) * 0.55 +
            noiseFn(
              perm,
              x * (ore.scale * 2.1) + y * 0.37 + ore.salt * 0.13,
              z * (ore.scale * 2.1) + y * 0.29 + ore.salt * 0.17,
              2,
            ) * 0.45;

          if (n < ore.threshold) continue;

          grid.set(x, y, z, ore.id);
          const strength = (n - ore.threshold) / Math.max(0.05, 1 - ore.threshold);
          const extra = Math.min(ore.maxExtra, 1 + Math.floor(strength * ore.maxExtra));
          if (extra > 0) growBlob(x, y, z, ore.id, extra);
        }
      }
    }
  }
}
