const ROOT_SIDES = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

const CANOPY_OFFSETS = [
  [0, 0, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [1, 0, 1],
  [1, 0, -1],
  [-1, 0, 1],
  [-1, 0, -1],
  [0, 1, 0],
  [1, 1, 0],
  [-1, 1, 0],
  [0, 1, 1],
  [0, 1, -1],
  [0, 2, 0],
];

const ORGANIC_NEIGHBORS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

function canReplaceWithDirt(id) {
  return id === 'dirt' || id === 'grass' || id === 'sand' || id === 'gravel';
}

function canPlaceTrunk(id) {
  return id === 'air' || id === 'grass';
}

function canPlaceCanopy(id) {
  return id === 'air';
}

/** Wood enclosed by dirt on all sides except the top. */
export function isTreeRoot(grid, x, y, z) {
  if (grid.get(x, y, z) !== 'wood') return false;
  for (const [dx, dy, dz] of ROOT_SIDES) {
    const nx = x + dx;
    const ny = y + dy;
    const nz = z + dz;
    if (!grid.inBounds(nx, ny, nz)) return false;
    if (grid.get(nx, ny, nz) !== 'dirt') return false;
  }
  return true;
}

export function collectOrganicNeighbors(grid, x, y, z) {
  const neighbors = [];
  for (const [dx, dy, dz] of ORGANIC_NEIGHBORS) {
    const nx = x + dx;
    const ny = y + dy;
    const nz = z + dz;
    if (!grid.inBounds(nx, ny, nz)) continue;
    const id = grid.get(nx, ny, nz);
    if (id !== 'wood' && id !== 'organic') continue;
    neighbors.push([nx, ny, nz, id]);
  }
  return neighbors;
}

function cellKey(x, y, z) {
  return `${x},${y},${z}`;
}

/**
 * BFS organic (wood/organic) component from a seed.
 * @returns {{ blocks: Array, rooted: boolean } | null}
 */
export function collectOrganicComponent(grid, sx, sy, sz) {
  const startId = grid.get(sx, sy, sz);
  if (startId !== 'wood' && startId !== 'organic') return null;

  const visited = new Set();
  const queue = [sx, sy, sz, startId, 0];
  const blocks = [];
  let head = 0;
  let rooted = false;

  visited.add(cellKey(sx, sy, sz));

  while (head < queue.length) {
    const x = queue[head++];
    const y = queue[head++];
    const z = queue[head++];
    const materialId = queue[head++];
    const distance = queue[head++];
    blocks.push({ x, y, z, materialId, distance });

    if (isTreeRoot(grid, x, y, z)) rooted = true;

    for (const [dx, dy, dz] of ORGANIC_NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (!grid.inBounds(nx, ny, nz)) continue;
      const nextId = grid.get(nx, ny, nz);
      if (nextId !== 'wood' && nextId !== 'organic') continue;
      const key = cellKey(nx, ny, nz);
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push(nx, ny, nz, nextId, distance + 1);
    }
  }

  return { blocks, rooted };
}

/** Unrooted organic component, or null if missing / still rooted. */
export function collectUnrootedOrganicComponent(grid, sx, sy, sz) {
  const component = collectOrganicComponent(grid, sx, sy, sz);
  if (!component || component.rooted) return null;
  return component.blocks;
}

/** Ordered growth plan: root → trunk (bottom-up) → canopy. */
export function buildTreeBlocks(x, rootY, z, trunkHeight) {
  const blocks = [{ x, y: rootY, z, materialId: 'wood' }];

  for (let ty = rootY + 1; ty <= rootY + trunkHeight; ty++) {
    blocks.push({ x, y: ty, z, materialId: 'wood' });
  }

  const canopyY = rootY + trunkHeight;
  for (const [dx, dy, dz] of CANOPY_OFFSETS) {
    if (dx === 0 && dy === 0 && dz === 0) continue;
    blocks.push({
      x: x + dx,
      y: canopyY + dy,
      z: z + dz,
      materialId: 'organic',
    });
  }

  return blocks;
}

function canPlantTree(grid, x, rootY, z, trunkHeight) {
  const { y: sy } = grid.size;
  const topY = rootY + trunkHeight + 2;
  if (rootY < 1 || topY >= sy) return false;
  if (!grid.inBounds(x, rootY, z)) return false;

  for (let ty = rootY + 1; ty <= rootY + trunkHeight; ty++) {
    if (!canPlaceTrunk(grid.get(x, ty, z))) return false;
  }

  for (const [dx, dy, dz] of ROOT_SIDES) {
    const nx = x + dx;
    const ny = rootY + dy;
    const nz = z + dz;
    if (!grid.inBounds(nx, ny, nz)) return false;
    if (!canReplaceWithDirt(grid.get(nx, ny, nz))) return false;
  }

  const canopyY = rootY + trunkHeight;
  for (const [dx, dy, dz] of CANOPY_OFFSETS) {
    if (dx === 0 && dy === 0 && dz === 0) continue;
    const cx = x + dx;
    const cy = canopyY + dy;
    const cz = z + dz;
    if (!grid.inBounds(cx, cy, cz)) return false;
    if (!canPlaceCanopy(grid.get(cx, cy, cz))) return false;
  }

  return true;
}

/** Places root wood + dirt shell only. */
export function plantTreeRoot(grid, x, rootY, z) {
  if (!grid.inBounds(x, rootY, z)) return false;

  for (const [dx, dy, dz] of ROOT_SIDES) {
    const nx = x + dx;
    const ny = rootY + dy;
    const nz = z + dz;
    if (!grid.inBounds(nx, ny, nz)) return false;
    if (!canReplaceWithDirt(grid.get(nx, ny, nz))) return false;
  }

  grid.set(x, rootY, z, 'wood');
  for (const [dx, dy, dz] of ROOT_SIDES) {
    grid.set(x + dx, rootY + dy, z + dz, 'dirt');
  }

  return true;
}

/**
 * Plants a tree seed (root only) and returns a growth plan, or null if invalid.
 */
export function tryPlantTree(grid, x, rootY, z, trunkHeight = 4) {
  if (!canPlantTree(grid, x, rootY, z, trunkHeight)) return null;
  if (!plantTreeRoot(grid, x, rootY, z)) return null;

  return {
    x,
    rootY,
    z,
    trunkHeight,
    blocks: buildTreeBlocks(x, rootY, z, trunkHeight),
  };
}

/**
 * Instantly places a full tree (debug / tests).
 * @returns {boolean}
 */
export function placeTree(grid, x, rootY, z, trunkHeight = 4) {
  const plan = tryPlantTree(grid, x, rootY, z, trunkHeight);
  if (!plan) return false;

  for (let i = 1; i < plan.blocks.length; i++) {
    const block = plan.blocks[i];
    grid.set(block.x, block.y, block.z, block.materialId);
  }

  return true;
}

/**
 * Scatter full-grown trees on grass surfaces using seed noise.
 * Returns growth plans so cut trees can regenerate later.
 */
export function generateTrees(grid, heights, perm, fractalNoise) {
  const { x: sx, y: sy, z: sz } = grid.size;
  const minSpacing = 4;
  const plans = [];

  for (let x = 2; x < sx - 2; x++) {
    for (let z = 2; z < sz - 2; z++) {
      const h = heights[x * sz + z];
      if (h < 1 || h + 8 >= sy) continue;
      if (grid.get(x, h, z) !== 'grass') continue;

      const density = fractalNoise(perm, x * 0.18 + 91, z * 0.18 + 91, 2);
      if (density < 0.62) continue;

      const cellNoise = fractalNoise(perm, x * 0.37 + 13, z * 0.37 + 13, 1);
      if (cellNoise < 0.48) continue;

      let crowded = false;
      for (let dx = -minSpacing; dx <= minSpacing && !crowded; dx++) {
        for (let dz = -minSpacing; dz <= minSpacing && !crowded; dz++) {
          if (dx === 0 && dz === 0) continue;
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= sx || nz >= sz) continue;
          const nh = heights[nx * sz + nz];
          if (grid.get(nx, nh, nz) === 'wood') crowded = true;
        }
      }
      if (crowded) continue;

      const trunkHeight = 3 + Math.floor(fractalNoise(perm, x * 0.21 + 7, z * 0.21 + 7, 1) * 3);
      const plan = tryPlantTree(grid, x, h, z, trunkHeight);
      if (!plan) continue;

      for (let i = 1; i < plan.blocks.length; i++) {
        const block = plan.blocks[i];
        grid.set(block.x, block.y, block.z, block.materialId);
      }

      plans.push(plan);
    }
  }

  return plans;
}
