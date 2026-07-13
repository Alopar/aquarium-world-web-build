import { FLUID } from '../constants.js';
import { getFluid, isCalmVolume } from './registry.js';
import { isSolid } from '../materials/registry.js';

const SIDE_NEIGHBORS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
];

const FACE_NEIGHBORS = [
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

function parseKey(key) {
  const [x, y, z] = key.split(',').map(Number);
  return { x, y, z };
}

/**
 * Discrete fluid simulation: volume per cell, down then sideways, active queue.
 * Evaporation runs before flow each second: quantize to step-10, thin films → 0,
 * near-full cells with air above → surfaceEvaporateFloor.
 * Calm bands (≤calmVolumeLow and ≥calmVolumeHigh) skip auto sideways flow
 * unless marked disturbed. Placing a cube wakeAround-infects neighbors; each
 * flow transfer propagateDisturbance so equalization spreads through the pool.
 */
export class FluidSystem {
  /**
   * @param {import('../world/world.js').AquariumWorld} world
   */
  constructor(world, { maxTicksPerFrame = FLUID.maxTicksPerFrame } = {}) {
    this.world = world;
    this.maxTicksPerFrame = maxTicksPerFrame;
    /** @type {Set<string>} */
    this.active = new Set();
    /** @type {Set<string>} cells allowed to sideways-flow despite calm bands */
    this.disturbed = new Set();
    this.accumulator = 0;
    this.rescanAccumulator = 0;
    this.evaporateAccumulator = 0;
    /** Shared tick interval from water (all fluids use same clock for now). */
    this.tickInterval = getFluid('water')?.tickInterval ?? 0.1;
    this.evaporateInterval = getFluid('water')?.evaporateInterval ?? 1;
    /** When false (e.g. during rain), skip evaporatePass entirely. */
    this.evaporationEnabled = true;
  }

  /**
   * Mark a cell and its face-neighbors as needing simulation.
   */
  activate(x, y, z) {
    const grid = this.world.grid;
    this.active.add(cellKey(x, y, z));
    for (const [ox, oy, oz] of FACE_NEIGHBORS) {
      const nx = x + ox;
      const ny = y + oy;
      const nz = z + oz;
      if (!grid.inBounds(nx, ny, nz)) continue;
      this.active.add(cellKey(nx, ny, nz));
    }
  }

  markDisturbed(x, y, z) {
    this.disturbed.add(cellKey(x, y, z));
  }

  /**
   * Place/flow contagion: cell + face-neighbors join the queue;
   * every neighboring fluid cell is marked disturbed so calm bands keep equalizing.
   */
  propagateDisturbance(x, y, z) {
    const grid = this.world.grid;
    this.activate(x, y, z);
    this.markDisturbed(x, y, z);

    for (const [ox, oy, oz] of FACE_NEIGHBORS) {
      const nx = x + ox;
      const ny = y + oy;
      const nz = z + oz;
      if (!grid.inBounds(nx, ny, nz)) continue;

      this.active.add(cellKey(nx, ny, nz));
      this.markDisturbed(nx, ny, nz);

      if (getFluid(grid.get(nx, ny, nz))) {
        this.markDisturbed(nx, ny, nz);
      }
    }
  }

  /**
   * Player place/throw or solid edit: propagate disturbance and step once now.
   */
  wakeAround(x, y, z) {
    this.propagateDisturbance(x, y, z);
    this.step();
  }

  update(dt) {
    if (this.maxTicksPerFrame <= 0) return;

    this.accumulator += dt;
    this.rescanAccumulator += dt;

    // Evaporation before flow so quantized / surface-trimmed volumes drive transfer.
    if (this.evaporationEnabled) {
      this.evaporateAccumulator += dt;
      if (this.evaporateAccumulator >= this.evaporateInterval) {
        this.evaporateAccumulator = 0;
        this.evaporatePass();
      }
    } else {
      this.evaporateAccumulator = 0;
    }

    let ticks = 0;
    while (this.accumulator >= this.tickInterval && ticks < this.maxTicksPerFrame) {
      this.accumulator -= this.tickInterval;
      this.step();
      ticks++;
    }

    if (this.accumulator > this.tickInterval * this.maxTicksPerFrame) {
      this.accumulator = this.tickInterval * this.maxTicksPerFrame;
    }

    if (this.rescanAccumulator >= FLUID.rescanInterval) {
      this.rescanAccumulator = 0;
      this.rescanUnsettled();
    }
  }

  hasAirAbove(x, y, z) {
    const aboveY = y + 1;
    if (!this.world.grid.inBounds(x, aboveY, z)) return true;
    return this.world.grid.get(x, aboveY, z) === 'air';
  }

  /**
   * One evaporation step for a cell. Returns new volume (may be unchanged).
   * Priority: thin film → quantize to step → surface trim with air above.
   */
  computeEvaporatedVolume(x, y, z, fluid, volume) {
    if (volume <= 0) return 0;

    const amount = fluid.evaporateAmount;

    // 0…calmVolumeLow: dry out completely over time.
    if (volume <= fluid.calmVolumeLow) {
      return Math.max(0, volume - amount);
    }

    // Not a multiple of quantizeStep (e.g. 755 → 754 → … → 750).
    const step = fluid.quantizeStep;
    if (volume % step !== 0) {
      return Math.max(0, volume - amount);
    }

    // Near-full with open air above: trim down to surfaceEvaporateFloor.
    if (
      volume > fluid.surfaceEvaporateFloor
      && volume <= fluid.maxVolume
      && this.hasAirAbove(x, y, z)
    ) {
      return Math.max(fluid.surfaceEvaporateFloor, volume - amount);
    }

    return volume;
  }

  /**
   * Apply one evaporation tick to all eligible fluid cells.
   */
  evaporatePass() {
    const field = this.world.fluidField;
    if (field.count() === 0) return;

    const batch = [];
    let inspected = 0;
    for (const { x, y, z, volume } of field.entries()) {
      if (inspected >= FLUID.maxEvaporatePerPass) break;
      inspected++;

      const id = this.world.grid.get(x, y, z);
      const fluid = getFluid(id);
      if (!fluid) continue;

      const next = this.computeEvaporatedVolume(x, y, z, fluid, volume);
      if (next === volume) continue;

      batch.push({ x, y, z, id, next });
    }

    for (const { x, y, z, id, next } of batch) {
      this.world.setFluid(x, y, z, id, next, { fromSim: true, evaporate: true });
    }
  }

  step() {
    if (this.active.size === 0) return;

    const toProcess = [...this.active];
    this.active.clear();

    let processed = 0;
    for (const key of toProcess) {
      if (processed >= FLUID.maxCellsPerTick) {
        this.active.add(key);
        continue;
      }
      const { x, y, z } = parseKey(key);
      this.simulateCell(x, y, z);
      processed++;
    }
  }

  /**
   * Walk existing fluid and re-queue cells that can still fall or level out.
   */
  rescanUnsettled() {
    const field = this.world.fluidField;
    if (field.count() === 0) return;

    let inspected = 0;
    for (const { x, y, z, volume } of field.entries()) {
      if (inspected >= FLUID.maxRescanPerPass) break;
      inspected++;

      if (volume <= 0) continue;
      const id = this.world.grid.get(x, y, z);
      const fluid = getFluid(id);
      if (!fluid) continue;

      if (this.isUnsettled(x, y, z, id, fluid, volume)) {
        this.activate(x, y, z);
      }
    }
  }

  isUnsettled(x, y, z, id, fluid, volume) {
    // Always collapse if floating / can pour down.
    if (this.canFall(x, y, z, id, fluid)) return true;

    // Calm bands do not auto-spread; wait for wakeAround disturbance.
    if (isCalmVolume(volume, fluid)) return false;

    const threshold = fluid.restThreshold;
    for (const [ox, , oz] of SIDE_NEIGHBORS) {
      const nx = x + ox;
      const nz = z + oz;
      if (!this.world.grid.inBounds(nx, y, nz)) continue;

      const nid = this.world.grid.get(nx, y, nz);
      if (isSolid(nid)) continue;

      if (nid === 'air') {
        if (volume > 0) return true;
        continue;
      }

      if (nid !== id) continue;

      const nVol = this.world.getFluidVolume(nx, y, nz);
      if (nVol >= fluid.maxVolume) continue;

      const diff = volume - nVol;
      if (diff > threshold) return true;
      if (diff > 0 && this.hasDownslope(nx, y, nz, id, nVol, x, z)) return true;
    }

    return false;
  }

  canFall(x, y, z, id, fluid) {
    const belowY = y - 1;
    if (!this.world.grid.inBounds(x, belowY, z)) return false;

    const belowId = this.world.grid.get(x, belowY, z);
    if (isSolid(belowId)) return false;
    if (belowId === 'air') return true;
    if (belowId === id) {
      return this.world.getFluidVolume(x, belowY, z) < fluid.maxVolume;
    }
    return false;
  }

  simulateCell(x, y, z) {
    const grid = this.world.grid;
    if (!grid.inBounds(x, y, z)) return;

    const id = grid.get(x, y, z);
    const fluid = getFluid(id);
    if (!fluid) return;

    let volume = this.world.getFluidVolume(x, y, z);
    if (volume <= 0) return;

    const key = cellKey(x, y, z);
    const wasDisturbed = this.disturbed.has(key);
    if (wasDisturbed) this.disturbed.delete(key);

    volume = this.flowDown(x, y, z, id, fluid, volume);
    if (volume <= 0) return;

    // Tiny leftover must not sit above empty/partial space for a frame.
    if (volume < fluid.minStableVolume && this.canFall(x, y, z, id, fluid)) {
      this.drainDownCascade(x, y, z, id, fluid);
      volume = this.world.getFluidVolume(x, y, z);
      if (volume <= 0) return;
    }

    // Calm bands only sideways-flow after an explicit disturbance (block edit).
    if (isCalmVolume(volume, fluid) && !wasDisturbed) return;

    this.flowSideways(x, y, z, id, fluid, volume);
  }

  /**
   * Keep pouring downward while this column can fall and volume is still
   * below minStableVolume (or below is empty air). Same-tick — no hover flicker.
   */
  drainDownCascade(startX, startY, startZ, id, fluid) {
    let x = startX;
    let y = startY;
    let z = startZ;
    const minV = fluid.minStableVolume;

    for (let guard = 0; guard < 64; guard++) {
      let volume = this.world.getFluidVolume(x, y, z);
      if (volume <= 0) return;

      if (!this.canFall(x, y, z, id, fluid)) return;

      const belowId = this.world.grid.get(x, y - 1, z);
      const mustFall = volume < minV || belowId === 'air'
        || (belowId === id && this.world.getFluidVolume(x, y - 1, z) < fluid.maxVolume);

      if (!mustFall) return;

      const before = volume;
      volume = this.flowDown(x, y, z, id, fluid, volume);
      if (volume >= before) return;

      if (volume <= 0) {
        y -= 1;
        const belowVol = this.world.getFluidVolume(x, y, z);
        if (belowVol <= 0) return;
        if (belowVol < minV || this.canFall(x, y, z, id, fluid)) continue;
        return;
      }
    }
  }

  flowDown(x, y, z, id, fluid, volume) {
    const belowY = y - 1;
    if (!this.world.grid.inBounds(x, belowY, z)) return volume;

    const belowId = this.world.grid.get(x, belowY, z);
    if (isSolid(belowId)) return volume;

    const maxV = fluid.maxVolume;
    let space = 0;
    let belowVol = 0;

    if (belowId === 'air') {
      space = maxV;
    } else if (belowId === id) {
      belowVol = this.world.getFluidVolume(x, belowY, z);
      space = maxV - belowVol;
    } else {
      return volume;
    }

    if (space <= 0) return volume;

    const flowLimit = fluid.flowDown === Infinity ? space : Math.min(space, fluid.flowDown);
    const transfer = Math.min(volume, flowLimit);
    if (transfer <= 0) return volume;

    const newBelow = belowVol + transfer;
    const newHere = volume - transfer;

    this.world.setFluid(x, belowY, z, id, newBelow, { fromSim: true });
    this.world.setFluid(x, y, z, id, newHere, { fromSim: true });

    return newHere;
  }

  flowSideways(x, y, z, id, fluid, volume) {
    if (volume <= 0) return;

    const maxV = fluid.maxVolume;
    const threshold = fluid.restThreshold;
    const candidates = [];

    for (const [ox, , oz] of SIDE_NEIGHBORS) {
      const nx = x + ox;
      const nz = z + oz;
      if (!this.world.grid.inBounds(nx, y, nz)) continue;

      const nid = this.world.grid.get(nx, y, nz);
      if (isSolid(nid)) continue;

      let nVol = 0;
      if (nid === 'air') {
        nVol = 0;
      } else if (nid === id) {
        nVol = this.world.getFluidVolume(nx, y, nz);
      } else {
        continue;
      }

      if (nVol >= maxV) continue;

      const diff = volume - nVol;
      if (diff <= 0) continue;
      if (diff <= threshold && !this.hasDownslope(nx, y, nz, id, nVol, x, z)) continue;

      candidates.push({ x: nx, y, z: nz, volume: nVol });
    }

    if (candidates.length === 0) return;

    candidates.sort((a, b) => a.volume - b.volume);

    let remaining = volume;
    let sideBudget = fluid.flowSide;

    for (const target of candidates) {
      if (remaining <= 0 || sideBudget <= 0) break;

      const diff = remaining - target.volume;
      if (diff <= 0) continue;
      if (diff <= threshold && !this.hasDownslope(target.x, target.y, target.z, id, target.volume, x, z)) {
        continue;
      }

      const desired = diff <= threshold
        ? Math.min(diff, Math.max(1, Math.floor(fluid.flowSide / 8)))
        : Math.max(1, Math.floor(diff / 2));
      const space = maxV - target.volume;
      const transfer = Math.min(desired, space, sideBudget, remaining);
      if (transfer <= 0) continue;

      const newTarget = target.volume + transfer;
      remaining -= transfer;
      sideBudget -= transfer;
      target.volume = newTarget;

      this.world.setFluid(target.x, target.y, target.z, id, newTarget, { fromSim: true });
      // Collapse splash into the column below before the next rendered frame.
      this.drainDownCascade(target.x, target.y, target.z, id, fluid);
    }

    if (remaining !== volume) {
      this.world.setFluid(x, y, z, id, remaining, { fromSim: true });
      if (remaining > 0 && remaining < fluid.minStableVolume) {
        this.drainDownCascade(x, y, z, id, fluid);
      }
    }
  }

  /**
   * True if neighbor sits on a descending slope (has a further cell with even less fluid).
   */
  hasDownslope(nx, y, nz, id, nVol, fromX, fromZ) {
    for (const [ox, , oz] of SIDE_NEIGHBORS) {
      const bx = nx + ox;
      const bz = nz + oz;
      if (bx === fromX && bz === fromZ) continue;
      if (!this.world.grid.inBounds(bx, y, bz)) continue;

      const bid = this.world.grid.get(bx, y, bz);
      if (isSolid(bid)) continue;

      let bVol = 0;
      if (bid === 'air') {
        bVol = 0;
      } else if (bid === id) {
        bVol = this.world.getFluidVolume(bx, y, bz);
      } else {
        continue;
      }

      if (bVol < nVol) return true;
    }
    return false;
  }
}
