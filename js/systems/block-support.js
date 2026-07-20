import { BLOCK_SUPPORT, BOMB } from '../constants.js';
import { hasDrops, isBreakable, isOrganic, isSolid, isStructuralSolid } from '../materials/registry.js';
import { collectOrganicComponent, collectOrganicNeighbors } from '../world/trees.js';
import { packCell } from '../world/cell-index.js';
import { isThrowableMaterial } from './projectile-system.js';

const NEIGHBORS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

function cellKey(x, y, z) {
  return packCell(x, y, z);
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
 * True if (x,y,z) reaches floor (y=0 structural) through structural solids.
 * Organic neighbors do not count as support.
 */
export function isStructurallySupported(grid, x, y, z) {
  if (!grid.inBounds(x, y, z)) return false;
  if (!isStructuralSolid(grid.get(x, y, z))) return false;
  if (y === 0) return true;

  const visited = new Set([cellKey(x, y, z)]);
  const queue = [x, y, z];
  let head = 0;

  while (head < queue.length) {
    const cx = queue[head++];
    const cy = queue[head++];
    const cz = queue[head++];

    for (const [dx, dy, dz] of NEIGHBORS) {
      const nx = cx + dx;
      const ny = cy + dy;
      const nz = cz + dz;
      if (!grid.inBounds(nx, ny, nz)) continue;
      if (!isStructuralSolid(grid.get(nx, ny, nz))) continue;

      const key = cellKey(nx, ny, nz);
      if (visited.has(key)) continue;
      if (ny === 0) return true;

      visited.add(key);
      queue.push(nx, ny, nz);
    }
  }

  return false;
}

/**
 * Cheap support probe: continuous structural column down to y=0 in the same (x,z).
 * True ⇒ definitely supported. False ⇒ might still be supported sideways (needs full BFS).
 */
export function hasVerticalColumnSupport(grid, x, y, z) {
  if (!grid.inBounds(x, y, z)) return false;
  for (let cy = y; cy >= 0; cy--) {
    if (!isStructuralSolid(grid.get(x, cy, z))) return false;
  }
  return true;
}

/**
 * True if removing (rx,ry,rz) cannot leave unsupported face-neighbors:
 * every remaining solid neighbor still has a vertical column to the floor.
 * Sideways-only support returns false so a full floor BFS runs.
 */
export function maySkipSupportCheck(grid, rx, ry, rz) {
  const neighbors = collectSolidNeighbors(grid, rx, ry, rz);
  if (neighbors.length === 0) return true;

  for (const [nx, ny, nz] of neighbors) {
    if (!hasVerticalColumnSupport(grid, nx, ny, nz)) return false;
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

function createSupportJob(airX, airY, airZ, revision, seeds = null, edgeCandidates = null) {
  return {
    airX,
    airY,
    airZ,
    /** Optional explicit floating seeds (blast rim); otherwise neighbors of air cell. */
    seeds,
    /** Blast crater-edge peel — applied after this job's normal floating cascade. */
    edgeCandidates,
    revision,
    phase: 'seed',
    seedX: 0,
    supported: new Set(),
    queue: [],
    head: 0,
    complete: false,
  };
}

/** Dominant face axis from blast origin toward (x,y,z). */
function blastOutwardAxis(ox, oy, oz, x, y, z) {
  const dx = x - ox;
  const dy = y - oy;
  const dz = z - oz;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const az = Math.abs(dz);
  if (ax < 1e-9 && ay < 1e-9 && az < 1e-9) return null;
  if (ax >= ay && ax >= az) return [dx >= 0 ? 1 : -1, 0, 0];
  if (ay >= az) return [0, dy >= 0 ? 1 : -1, 0];
  return [0, 0, dz >= 0 ? 1 : -1];
}

/** True if the outward face is open — nothing solid blocking flight away from the blast. */
function canBlastEject(grid, x, y, z, dir) {
  const nx = x + dir[0];
  const ny = y + dir[1];
  const nz = z + dir[2];
  if (!grid.inBounds(nx, ny, nz)) return true;
  return !isSolid(grid.get(nx, ny, nz));
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
  constructor(
    world,
    particleSystem,
    sound = null,
    projectileSystem = null,
    lootSystem = null,
    detachedBlocks = null,
    treeMeshes = null,
  ) {
    this.world = world;
    this.particleSystem = particleSystem;
    this.sound = sound;
    this.projectileSystem = projectileSystem;
    this.lootSystem = lootSystem;
    this.detachedBlocks = detachedBlocks;
    this.treeMeshes = treeMeshes;
    this.pending = [];
    this.pendingByKey = new Map();
    this.jobs = [];
    this.worldRevision = 0;
    /** Flat [x,y,z, ...] structural cells destroyed during a blast batch. */
    this._blastDestroyed = [];
  }

  bumpWorldRevision() {
    this.worldRevision++;
  }

  cancelPendingAt(x, y, z) {
    const key = cellKey(x, y, z);
    const entry = this.pendingByKey.get(key);
    if (!entry) {
      this.detachedBlocks?.cancelAt(x, y, z);
      return;
    }

    this.pendingByKey.delete(key);
    const idx = this.pending.indexOf(entry);
    if (idx !== -1) this.pending.splice(idx, 1);
    this.detachedBlocks?.cancelAt(x, y, z);
  }

  onBlockRemoved(x, y, z, source) {
    // Doomed cascade chunks do not re-check support.
    if (source === 'collapse') return;

    // Dig / bomb / etc. while a cell was cascade-pending or disturbed overlay.
    this.cancelPendingAt(x, y, z);

    // Blast defers to onBlastFinished — one rim check instead of N floor BFS jobs.
    if (source === 'blast') {
      this._blastDestroyed.push(x, y, z);
      return;
    }

    if (maySkipSupportCheck(this.world.grid, x, y, z)) return;

    this.bumpWorldRevision();
    this.enqueueSupportJob(x, y, z);
  }

  /**
   * After a multi-block blast:
   * 1) same-frame outward eject for free rim faces;
   * 2) deferred floor-support cascade + peel for leftovers with nothing below.
   * @param {number} cx
   * @param {number} cy
   * @param {number} cz
   */
  onBlastFinished(cx, cy, cz) {
    const destroyed = this._blastDestroyed;
    if (destroyed.length === 0) return;
    this._blastDestroyed = [];

    const blastOrigin = { x: cx, y: cy, z: cz };
    const edgeCandidates = this.collectBlastEdgeCandidates(destroyed);

    // Impulse kicks must land in the explosion frame — not after support BFS.
    this.applyBlastEdgeEject(edgeCandidates, blastOrigin);

    const queued = this.enqueueBlastRimSupport(destroyed, edgeCandidates);
    if (!queued) {
      this.scheduleBlastEdgePeel(edgeCandidates);
    }
  }

  /**
   * Breakable rim solids adjacent to destroyed cells (shock / cave edge).
   * @param {number[]} destroyed flat [x,y,z, ...]
   * @returns {{ x: number, y: number, z: number, materialId: string }[]}
   */
  collectBlastEdgeCandidates(destroyed) {
    const { grid } = this.world;
    const seen = new Set();
    const candidates = [];

    for (let i = 0; i < destroyed.length; i += 3) {
      const x = destroyed[i];
      const y = destroyed[i + 1];
      const z = destroyed[i + 2];

      for (const [dx, dy, dz] of NEIGHBORS) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (!grid.inBounds(nx, ny, nz)) continue;

        const key = cellKey(nx, ny, nz);
        if (seen.has(key)) continue;
        seen.add(key);

        if (ny < 0) continue;

        const materialId = grid.get(nx, ny, nz);
        if (!isSolid(materialId) || !isBreakable(materialId)) continue;

        candidates.push({ x: nx, y: ny, z: nz, materialId });
      }
    }

    return candidates;
  }

  /**
   * Same-frame blast kick: rim blocks with a free outward face become projectiles.
   * @param {{ x: number, y: number, z: number, materialId: string }[]} candidates
   * @param {{ x: number, y: number, z: number }} blastOrigin
   */
  applyBlastEdgeEject(candidates, blastOrigin) {
    if (!candidates?.length || !blastOrigin) return;

    const { grid } = this.world;

    this.world.beginEditBatch();
    try {
      for (const c of candidates) {
        const materialId = grid.get(c.x, c.y, c.z);
        if (materialId !== c.materialId) continue;
        if (!isSolid(materialId) || !isBreakable(materialId)) continue;
        this.tryBlastEdgeEject(c.x, c.y, c.z, materialId, blastOrigin);
      }
    } finally {
      this.world.endEditBatch();
    }
  }

  /**
   * Deferred peel: leftovers with nothing below enter cascade (after support job if any).
   * Skips blocks already pending or already ejected.
   * @param {{ x: number, y: number, z: number, materialId: string }[]} candidates
   */
  scheduleBlastEdgePeel(candidates) {
    if (!candidates?.length) return;

    const { grid } = this.world;
    const toFall = [];

    for (const c of candidates) {
      const key = cellKey(c.x, c.y, c.z);
      if (this.pendingByKey.has(key)) continue;

      const materialId = grid.get(c.x, c.y, c.z);
      if (materialId !== c.materialId) continue;
      if (!isSolid(materialId) || !isBreakable(materialId)) continue;
      if (c.y <= 0 || isSolid(grid.get(c.x, c.y - 1, c.z))) continue;

      toFall.push({
        x: c.x,
        y: c.y,
        z: c.z,
        materialId,
        distance: 0,
        timer: BLOCK_SUPPORT.breakDelay,
      });
    }

    if (toFall.length > 0) {
      this.scheduleChunk(toFall);
    }
  }

  /**
   * If outward face (away from blast) is clear, remove the block and fling it.
   * @returns {boolean} true if handled (ejected or destroyed as drops)
   */
  tryBlastEdgeEject(x, y, z, materialId, blastOrigin) {
    const dir = blastOutwardAxis(blastOrigin.x, blastOrigin.y, blastOrigin.z, x, y, z);
    if (!dir) return false;
    if (!canBlastEject(this.world.grid, x, y, z, dir)) return false;

    this.detachedBlocks?.cancelAt(x, y, z);
    this.treeMeshes?.removeCell(x, y, z);

    if (!this.world.setBlock(x, y, z, 'air', { source: 'collapse', skipMesh: true })) {
      return false;
    }

    this.sound?.playBlockBreak(materialId);

    if (isOrganic(materialId)) {
      this.particleSystem?.spawnBlockBreak(x, y, z, materialId);
      if (hasDrops(materialId)) {
        this.lootSystem?.spawnBurst(materialId, x, y, z);
      }
      return true;
    }

    if (hasDrops(materialId)) {
      this.particleSystem?.spawnBlockBreak(x, y, z, materialId);
      this.lootSystem?.spawnBurst(materialId, x, y, z);
      return true;
    }

    if (!isThrowableMaterial(materialId)) {
      this.particleSystem?.spawnBlockBreak(x, y, z, materialId);
      return true;
    }

    const dx = x - blastOrigin.x;
    const dy = y - blastOrigin.y;
    const dz = z - blastOrigin.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const speed = BOMB.edgeImpulse;
    const vx = (dx / len) * speed;
    const vy = (dy / len) * speed + BOMB.edgeImpulseUp;
    const vz = (dz / len) * speed;

    const spawned = this.projectileSystem?.spawnFromImpulse(materialId, x, y, z, vx, vy, vz);
    if (!spawned) {
      this.particleSystem?.spawnBlockBreak(x, y, z, materialId);
    }
    return true;
  }

  /**
   * Rim solids that lack a vertical column seed one floor-BFS support job.
   * @param {number[]} destroyed flat [x,y,z, ...]
   * @param {{ x: number, y: number, z: number, materialId: string }[]} edgeCandidates
   * @returns {boolean} true if a support job was queued
   */
  enqueueBlastRimSupport(destroyed, edgeCandidates = null) {
    const { grid } = this.world;
    const rim = new Map();

    for (let i = 0; i < destroyed.length; i += 3) {
      const x = destroyed[i];
      const y = destroyed[i + 1];
      const z = destroyed[i + 2];
      for (const [nx, ny, nz] of collectSolidNeighbors(grid, x, y, z)) {
        rim.set(cellKey(nx, ny, nz), [nx, ny, nz]);
      }
    }

    if (rim.size === 0) return false;

    const suspicious = [];
    for (const pos of rim.values()) {
      if (hasVerticalColumnSupport(grid, pos[0], pos[1], pos[2])) continue;
      suspicious.push(pos);
    }

    if (suspicious.length === 0) return false;

    this.bumpWorldRevision();
    const [sx, sy, sz] = suspicious[0];
    this.jobs.push(createSupportJob(
      sx,
      sy,
      sz,
      this.worldRevision,
      suspicious,
      edgeCandidates,
    ));
    return true;
  }

  /** After chopping organic: cascade-destroy unrooted wood/organic. */
  onOrganicRemoved(x, y, z, source) {
    if (source === 'collapse') return;

    this.cancelPendingAt(x, y, z);

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

    if (!isStructuralSolid(materialId)) return;

    const key = cellKey(x, y, z);
    if (this.pendingByKey.has(key)) return;

    if (this.pendingByKey.size > 0) {
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

      if (bestDistance !== Infinity) {
        this.scheduleChunk([{
          x,
          y,
          z,
          materialId,
          distance: bestDistance + 1,
          timer: bestTimer + BLOCK_SUPPORT.breakDelay,
        }], { remesh: false });
        return;
      }
    }

    // Stuck only to organic / floating — place ok, then peel off via cascade.
    if (!isStructurallySupported(this.world.grid, x, y, z)) {
      this.scheduleChunk([{
        x,
        y,
        z,
        materialId,
        distance: 0,
        timer: BLOCK_SUPPORT.breakDelay,
      }], { remesh: false });
    }
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
    const seeds = job.seeds ?? collectSolidNeighbors(grid, job.airX, job.airY, job.airZ);
    const chunk = collectFloatingChunk(grid, job.supported, seeds);
    if (chunk.length > 0) {
      this.scheduleChunk(chunk);
    }
    // After normal floating cascade: peel crater-edge leftovers still hanging.
    if (job.edgeCandidates) {
      this.scheduleBlastEdgePeel(job.edgeCandidates);
    }
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

  scheduleChunk(chunk, { remesh = true } = {}) {
    const newly = [];

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
      newly.push(entry);
    }

    if (newly.length > 0) {
      // Tree cells already have per-block overlays — skip detach + chunk remesh.
      const forDetach = newly.filter((b) => !this.treeMeshes?.owns(b.x, b.y, b.z));
      if (forDetach.length > 0) {
        this.detachedBlocks?.detachPendingMany(forDetach, { remesh });
      }
    }
  }

  collapseBlock(entry) {
    const { x, y, z, materialId, destroyOnly } = entry;
    const key = cellKey(x, y, z);

    this.pendingByKey.delete(key);

    if (this.world.getBlock(x, y, z) !== materialId) {
      this.treeMeshes?.removeCell(x, y, z);
      this.detachedBlocks?.cancelAt(x, y, z);
      return;
    }

    // Mesh already pulled out at schedule time — clear overlay without remeshing chunks.
    // Tree cells are owned by TreeMeshSystem (cleared in setBlock → onOrganicRemoved).
    if (!this.treeMeshes?.owns(x, y, z)) {
      this.detachedBlocks?.takeMesh(x, y, z, { dispose: true });
    }

    if (!this.world.setBlock(x, y, z, 'air', { source: 'collapse', skipMesh: true })) {
      this.detachedBlocks?.placeDisturbed(x, y, z, materialId);
      return;
    }

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

    // Batch lighting for all collapses this frame; chunk meshes stay untouched (skipMesh).
    this.world.beginEditBatch();
    try {
      while (true) {
        const idx = this.findReadyIndex();
        if (idx === -1) break;
        this.collapseBlock(this.pending.splice(idx, 1)[0]);
      }
    } finally {
      this.world.endEditBatch();
    }
  }

  dispose() {
    for (const entry of this.pending) {
      this.detachedBlocks?.cancelAt(entry.x, entry.y, entry.z);
    }
    this.pending = [];
    this.pendingByKey.clear();
    this.jobs = [];
    this._blastDestroyed = [];
  }
}
