import { BLOCK_SUPPORT } from '../constants.js';
import { hasDrops, isOrganic, isStructuralSolid } from '../materials/registry.js';
import { collectOrganicComponent, collectOrganicNeighbors } from '../world/trees.js';

const NEIGHBORS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

function cellKey(x, y, z) {
  return `${x},${y},${z}`;
}

function collectSolidNeighbors(grid, x, y, z) {
  const neighbors = [];

  for (const [dx, dy, dz] of NEIGHBORS) {
    const nx = x + dx;
    const ny = y + dy;
    const nz = z + dz;
    if (!grid.inBounds(nx, ny, nz)) continue;
    if (!isStructuralSolid(grid.get(nx, ny, nz))) continue;
    neighbors.push([nx, ny, nz]);
  }

  return neighbors;
}

/**
 * True if removing (rx,ry,rz) cannot cut support paths:
 * 0–1 solid neighbors, or all face-neighbors stay linked inside the 3×3×3 around the hole.
 */
export function maySkipSupportCheck(grid, rx, ry, rz) {
  const neighbors = collectSolidNeighbors(grid, rx, ry, rz);
  if (neighbors.length <= 1) return true;

  const start = neighbors[0];
  const visited = new Set([cellKey(start[0], start[1], start[2])]);
  const queue = [start];
  let head = 0;

  const minX = rx - 1;
  const maxX = rx + 1;
  const minY = ry - 1;
  const maxY = ry + 1;
  const minZ = rz - 1;
  const maxZ = rz + 1;

  while (head < queue.length) {
    const [x, y, z] = queue[head++];

    for (const [dx, dy, dz] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;

      if (nx === rx && ny === ry && nz === rz) continue;
      if (nx < minX || nx > maxX || ny < minY || ny > maxY || nz < minZ || nz > maxZ) continue;
      if (!grid.inBounds(nx, ny, nz)) continue;
      if (!isStructuralSolid(grid.get(nx, ny, nz))) continue;

      const key = cellKey(nx, ny, nz);
      if (visited.has(key)) continue;

      visited.add(key);
      queue.push([nx, ny, nz]);
    }
  }

  for (let i = 1; i < neighbors.length; i++) {
    const [nx, ny, nz] = neighbors[i];
    if (!visited.has(cellKey(nx, ny, nz))) return false;
  }

  return true;
}

/** Synchronous full BFS — kept for tests / debugging. */
export function computeSupportedSet(grid) {
  const supported = new Set();
  const queue = [];
  let head = 0;

  for (let x = 0; x < grid.size.x; x++) {
    for (let z = 0; z < grid.size.z; z++) {
      if (!isStructuralSolid(grid.get(x, 0, z))) continue;
      const key = cellKey(x, 0, z);
      supported.add(key);
      queue.push(x, 0, z);
    }
  }

  while (head < queue.length) {
    const x = queue[head++];
    const y = queue[head++];
    const z = queue[head++];

    for (const [dx, dy, dz] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;

      if (!grid.inBounds(nx, ny, nz)) continue;
      if (!isStructuralSolid(grid.get(nx, ny, nz))) continue;

      const key = cellKey(nx, ny, nz);
      if (supported.has(key)) continue;

      supported.add(key);
      queue.push(nx, ny, nz);
    }
  }

  return supported;
}

/**
 * Multi-source BFS over floating solids from seed cells.
 * Each cell gets `distance` = steps from the nearest seed (break site).
 */
export function collectFloatingChunk(grid, supported, seeds) {
  const chunk = [];
  const visited = new Set();
  const queue = [];
  let head = 0;

  for (const [sx, sy, sz] of seeds) {
    if (!grid.inBounds(sx, sy, sz)) continue;
    const materialId = grid.get(sx, sy, sz);
    if (!isStructuralSolid(materialId)) continue;
    const key = cellKey(sx, sy, sz);
    if (supported.has(key) || visited.has(key)) continue;
    visited.add(key);
    queue.push(sx, sy, sz, materialId, 0);
  }

  while (head < queue.length) {
    const x = queue[head++];
    const y = queue[head++];
    const z = queue[head++];
    const materialId = queue[head++];
    const distance = queue[head++];
    chunk.push({ x, y, z, materialId, distance });

    for (const [dx, dy, dz] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;

      if (!grid.inBounds(nx, ny, nz)) continue;
      const nextId = grid.get(nx, ny, nz);
      if (!isStructuralSolid(nextId)) continue;

      const key = cellKey(nx, ny, nz);
      if (supported.has(key) || visited.has(key)) continue;

      visited.add(key);
      queue.push(nx, ny, nz, nextId, distance + 1);
    }
  }

  return chunk;
}

function createSupportJob(airX, airY, airZ, revision) {
  return {
    airX,
    airY,
    airZ,
    revision,
    phase: 'seed',
    seedX: 0,
    supported: new Set(),
    queue: [],
    head: 0,
    complete: false,
  };
}

function resetSupportJob(job, revision) {
  job.revision = revision;
  job.phase = 'seed';
  job.seedX = 0;
  job.supported = new Set();
  job.queue = [];
  job.head = 0;
  job.complete = false;
}

export class BlockSupportSystem {
  constructor(world, particleSystem, sound = null, projectileSystem = null, lootSystem = null) {
    this.world = world;
    this.particleSystem = particleSystem;
    this.sound = sound;
    this.projectileSystem = projectileSystem;
    this.lootSystem = lootSystem;
    this.pending = [];
    this.pendingByKey = new Map();
    this.jobs = [];
    this.worldRevision = 0;
  }

  bumpWorldRevision() {
    this.worldRevision++;
  }

  onBlockRemoved(x, y, z, source) {
    // Doomed cascade chunks do not re-check support.
    if (source === 'collapse') return;

    if (maySkipSupportCheck(this.world.grid, x, y, z)) return;

    this.bumpWorldRevision();
    this.enqueueSupportJob(x, y, z);
  }

  /** After chopping organic: cascade-destroy unrooted wood/organic. */
  onOrganicRemoved(x, y, z, source) {
    if (source === 'collapse') return;

    const { grid } = this.world;
    const seen = new Set();
    const toBreak = [];

    for (const [nx, ny, nz] of collectOrganicNeighbors(grid, x, y, z)) {
      const seedKey = `${nx},${ny},${nz}`;
      if (seen.has(seedKey)) continue;

      const component = collectOrganicComponent(grid, nx, ny, nz);
      if (!component) continue;

      for (const block of component.blocks) {
        seen.add(`${block.x},${block.y},${block.z}`);
      }

      if (component.rooted) continue;

      for (const block of component.blocks) {
        toBreak.push({ ...block, destroyOnly: true });
      }
    }

    if (toBreak.length === 0) return;
    this.scheduleChunk(toBreak);
  }

  onBlockPlaced(x, y, z, materialId) {
    if (this.jobs.length > 0) {
      this.bumpWorldRevision();
    }

    if (this.pendingByKey.size === 0) return;

    const key = cellKey(x, y, z);
    if (this.pendingByKey.has(key)) return;

    let bestTimer = Infinity;
    let bestDistance = Infinity;

    for (const [nx, ny, nz] of collectSolidNeighbors(this.world.grid, x, y, z)) {
      const neighbor = this.pendingByKey.get(cellKey(nx, ny, nz));
      if (!neighbor) continue;
      if (neighbor.timer < bestTimer) {
        bestTimer = neighbor.timer;
        bestDistance = neighbor.distance;
      }
    }

    if (bestDistance === Infinity) return;

    this.scheduleChunk([{
      x,
      y,
      z,
      materialId,
      distance: bestDistance + 1,
      timer: bestTimer + BLOCK_SUPPORT.breakDelay,
    }]);
  }

  enqueueSupportJob(airX, airY, airZ) {
    this.jobs.push(createSupportJob(airX, airY, airZ, this.worldRevision));
  }

  stepSupportJob(job, deadline) {
    if (job.revision !== this.worldRevision) {
      resetSupportJob(job, this.worldRevision);
    }

    const { grid } = this.world;
    const checkEvery = BLOCK_SUPPORT.bfsDeadlineCheckEvery;

    if (job.phase === 'seed') {
      let columns = 0;
      while (job.seedX < grid.size.x) {
        const x = job.seedX;
        for (let z = 0; z < grid.size.z; z++) {
          if (!isStructuralSolid(grid.get(x, 0, z))) continue;
          const key = cellKey(x, 0, z);
          job.supported.add(key);
          job.queue.push(x, 0, z);
        }
        job.seedX++;
        columns++;
        if ((columns & 7) === 0 && performance.now() >= deadline) return;
      }
      job.phase = 'bfs';
    }

    if (job.phase === 'bfs') {
      let visits = 0;
      while (job.head < job.queue.length) {
        const x = job.queue[job.head++];
        const y = job.queue[job.head++];
        const z = job.queue[job.head++];
        visits++;

        for (const [dx, dy, dz] of NEIGHBORS) {
          const nx = x + dx;
          const ny = y + dy;
          const nz = z + dz;

          if (!grid.inBounds(nx, ny, nz)) continue;
          if (!isStructuralSolid(grid.get(nx, ny, nz))) continue;

          const key = cellKey(nx, ny, nz);
          if (job.supported.has(key)) continue;

          job.supported.add(key);
          job.queue.push(nx, ny, nz);
        }

        if ((visits % checkEvery) === 0 && performance.now() >= deadline) return;
      }
      job.complete = true;
    }
  }

  finishSupportJob(job) {
    const { grid } = this.world;
    const seeds = collectSolidNeighbors(grid, job.airX, job.airY, job.airZ);
    const chunk = collectFloatingChunk(grid, job.supported, seeds);
    if (chunk.length === 0) return;
    this.scheduleChunk(chunk);
  }

  advanceSupportJobs() {
    if (this.jobs.length === 0) return;

    const deadline = performance.now() + BLOCK_SUPPORT.bfsBudgetMs;
    let index = 0;

    while (index < this.jobs.length && performance.now() < deadline) {
      const job = this.jobs[index];
      this.stepSupportJob(job, deadline);

      if (job.complete) {
        this.finishSupportJob(job);
        this.jobs.splice(index, 1);
      } else {
        index++;
      }
    }
  }

  scheduleChunk(chunk) {
    for (const block of chunk) {
      const key = cellKey(block.x, block.y, block.z);
      if (this.pendingByKey.has(key)) continue;

      const entry = {
        x: block.x,
        y: block.y,
        z: block.z,
        materialId: block.materialId,
        distance: block.distance,
        timer: block.timer ?? block.distance * BLOCK_SUPPORT.breakDelay,
        destroyOnly: block.destroyOnly === true || isOrganic(block.materialId),
      };

      this.pendingByKey.set(key, entry);
      this.pending.push(entry);
    }
  }

  collapseBlock(entry) {
    const { x, y, z, materialId, destroyOnly } = entry;
    const key = cellKey(x, y, z);

    this.pendingByKey.delete(key);

    if (this.world.getBlock(x, y, z) !== materialId) return;

    if (!this.world.setBlock(x, y, z, 'air', { source: 'collapse' })) return;

    this.sound?.playBlockBreak(materialId);

    // Organic / tree cascade: destroy blocks; wood/ores with drops spawn loot entities.
    if (destroyOnly || isOrganic(materialId)) {
      this.particleSystem?.spawnBlockBreak(x, y, z, materialId);
      if (hasDrops(materialId)) {
        this.lootSystem?.spawnBurst(materialId, x, y, z);
      }
      return;
    }

    if (hasDrops(materialId)) {
      this.particleSystem?.spawnBlockBreak(x, y, z, materialId);
      this.lootSystem?.spawnBurst(materialId, x, y, z);
      return;
    }

    const spawned = this.projectileSystem?.spawnFromCollapse(materialId, x, y, z);
    if (!spawned) {
      this.particleSystem?.spawnBlockBreak(x, y, z, materialId);
    }
  }

  findReadyIndex() {
    let best = -1;
    let bestDistance = Infinity;

    for (let i = 0; i < this.pending.length; i++) {
      const entry = this.pending[i];
      if (entry.timer > 0) continue;

      if (entry.distance < bestDistance) {
        bestDistance = entry.distance;
        best = i;
      }
    }

    return best;
  }

  update(dt) {
    this.advanceSupportJobs();

    for (const entry of this.pending) {
      entry.timer -= dt;
    }

    while (true) {
      const idx = this.findReadyIndex();
      if (idx === -1) break;
      this.collapseBlock(this.pending.splice(idx, 1)[0]);
    }
  }

  dispose() {
    this.pending = [];
    this.pendingByKey.clear();
    this.jobs = [];
  }
}
