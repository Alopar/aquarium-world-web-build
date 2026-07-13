import { GAS } from '../constants.js';
import { getGas, isActiveGasVolume } from './registry.js';
import { isSolid } from '../materials/registry.js';

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
 * Discrete gas simulation: volume per cell, omni flow while above activeThreshold,
 * then calm dissolve toward 0. Active queue + disturbance contagion mirror fluids.
 */
export class GasSystem {
  /**
   * @param {import('../world/world.js').AquariumWorld} world
   */
  constructor(world, { maxTicksPerFrame = GAS.maxTicksPerFrame } = {}) {
    this.world = world;
    this.maxTicksPerFrame = maxTicksPerFrame;
    /** @type {Set<string>} */
    this.active = new Set();
    /** @type {Set<string>} */
    this.disturbed = new Set();
    this.accumulator = 0;
    this.rescanAccumulator = 0;
    this.dissolveAccumulator = 0;
    this.tickInterval = getGas('smoke')?.tickInterval ?? 0.1;
    this.dissolveInterval = getGas('smoke')?.dissolveInterval ?? 1;
  }

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

      if (getGas(grid.get(nx, ny, nz))) {
        this.markDisturbed(nx, ny, nz);
      }
    }
  }

  wakeAround(x, y, z) {
    this.propagateDisturbance(x, y, z);
    this.step();
  }

  update(dt) {
    if (this.maxTicksPerFrame <= 0) return;

    this.accumulator += dt;
    this.rescanAccumulator += dt;
    this.dissolveAccumulator += dt;

    if (this.dissolveAccumulator >= this.dissolveInterval) {
      this.dissolveAccumulator = 0;
      this.dissolvePass();
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

    if (this.rescanAccumulator >= GAS.rescanInterval) {
      this.rescanAccumulator = 0;
      this.rescanUnsettled();
    }
  }

  /**
   * Calm gas (≤ activeThreshold) gradually dissolves toward 0.
   */
  dissolvePass() {
    const field = this.world.gasField;
    if (field.count() === 0) return;

    const batch = [];
    let inspected = 0;
    for (const { x, y, z, volume } of field.entries()) {
      if (inspected >= GAS.maxDissolvePerPass) break;
      inspected++;

      const id = this.world.grid.get(x, y, z);
      const gas = getGas(id);
      if (!gas) continue;
      if (volume <= 0 || volume > gas.activeThreshold) continue;

      const next = Math.max(0, volume - gas.dissolveAmount);
      if (next === volume) continue;

      batch.push({ x, y, z, id, next });
    }

    for (const { x, y, z, id, next } of batch) {
      this.world.setGas(x, y, z, id, next, { fromSim: true, dissolve: true });
    }
  }

  step() {
    if (this.active.size === 0) return;

    const toProcess = [...this.active];
    this.active.clear();

    let processed = 0;
    for (const key of toProcess) {
      if (processed >= GAS.maxCellsPerTick) {
        this.active.add(key);
        continue;
      }
      const { x, y, z } = parseKey(key);
      this.simulateCell(x, y, z);
      processed++;
    }
  }

  rescanUnsettled() {
    const field = this.world.gasField;
    if (field.count() === 0) return;

    let inspected = 0;
    for (const { x, y, z, volume } of field.entries()) {
      if (inspected >= GAS.maxRescanPerPass) break;
      inspected++;

      if (volume <= 0) continue;
      const id = this.world.grid.get(x, y, z);
      const gas = getGas(id);
      if (!gas) continue;

      if (this.isUnsettled(x, y, z, id, gas, volume)) {
        this.activate(x, y, z);
      }
    }
  }

  isUnsettled(x, y, z, id, gas, volume) {
    if (!isActiveGasVolume(volume, gas)) return false;

    const threshold = gas.restThreshold;
    const maxV = gas.maxVolume;

    for (const [ox, oy, oz] of FACE_NEIGHBORS) {
      const nx = x + ox;
      const ny = y + oy;
      const nz = z + oz;
      if (!this.world.grid.inBounds(nx, ny, nz)) continue;

      const nid = this.world.grid.get(nx, ny, nz);
      if (isSolid(nid)) continue;

      if (nid === 'air') {
        if (volume > 0) return true;
        continue;
      }

      if (nid !== id) continue;

      const nVol = this.world.getGasVolume(nx, ny, nz);
      if (nVol >= maxV) continue;

      if (volume - nVol > threshold) return true;
    }

    return false;
  }

  simulateCell(x, y, z) {
    const grid = this.world.grid;
    if (!grid.inBounds(x, y, z)) return;

    const id = grid.get(x, y, z);
    const gas = getGas(id);
    if (!gas) return;

    const volume = this.world.getGasVolume(x, y, z);
    if (volume <= 0) return;

    const key = cellKey(x, y, z);
    if (this.disturbed.has(key)) this.disturbed.delete(key);

    // Calm band: no flow (dissolve handles thinning).
    if (!isActiveGasVolume(volume, gas)) return;

    this.flowOmni(x, y, z, id, gas, volume);
  }

  /**
   * Equalize into face-neighbors; prefers horizontal + down over up.
   */
  flowOmni(x, y, z, id, gas, volume) {
    if (volume <= 0) return;

    const maxV = gas.maxVolume;
    const threshold = gas.restThreshold;
    const weightSide = gas.flowWeightSide ?? 1;
    const weightDown = gas.flowWeightDown ?? 1;
    const weightUp = gas.flowWeightUp ?? 0.3;
    const candidates = [];

    for (const [ox, oy, oz] of FACE_NEIGHBORS) {
      const nx = x + ox;
      const ny = y + oy;
      const nz = z + oz;
      if (!this.world.grid.inBounds(nx, ny, nz)) continue;

      const nid = this.world.grid.get(nx, ny, nz);
      if (isSolid(nid)) continue;

      let nVol = 0;
      if (nid === 'air') {
        nVol = 0;
      } else if (nid === id) {
        nVol = this.world.getGasVolume(nx, ny, nz);
      } else {
        continue;
      }

      if (nVol >= maxV) continue;

      const diff = volume - nVol;
      if (diff <= threshold) continue;

      let weight = weightSide;
      if (oy < 0) weight = weightDown;
      else if (oy > 0) weight = weightUp;

      candidates.push({ x: nx, y: ny, z: nz, volume: nVol, weight });
    }

    if (candidates.length === 0) return;

    // Prefer heavier directions first, then emptier neighbors.
    candidates.sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      return a.volume - b.volume;
    });

    let remaining = volume;
    let budget = gas.flowOmni;

    for (const target of candidates) {
      if (remaining <= 0 || budget <= 0) break;

      const diff = remaining - target.volume;
      if (diff <= threshold) continue;

      const desired = Math.max(1, Math.floor((diff / 2) * target.weight));
      const space = maxV - target.volume;
      const transfer = Math.min(desired, space, budget, remaining);
      if (transfer <= 0) continue;

      const newTarget = target.volume + transfer;
      remaining -= transfer;
      budget -= transfer;
      target.volume = newTarget;

      this.world.setGas(target.x, target.y, target.z, id, newTarget, { fromSim: true });
    }

    if (remaining !== volume) {
      this.world.setGas(x, y, z, id, remaining, { fromSim: true });
    }
  }
}
