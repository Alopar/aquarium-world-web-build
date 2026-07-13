import { TREE_GROWTH } from '../constants.js';
import { isTreeRoot } from '../world/trees.js';

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

function rootKey(x, y, z) {
  return cellKey(x, y, z);
}

function canPlaceGrowthBlock(grid, block) {
  const current = grid.get(block.x, block.y, block.z);
  if (block.materialId === 'wood') {
    return current === 'air' || current === 'grass';
  }
  if (block.materialId === 'organic') {
    return current === 'air';
  }
  return false;
}

function findTrunkTopIndex(blocks) {
  let last = 0;
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i].materialId === 'wood') last = i;
    else break;
  }
  return last;
}

/** First block in the plan that is missing or wrong in the grid. */
export function computeTreeResumeIndex(grid, blocks) {
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i];
    if (grid.get(b.x, b.y, b.z) !== b.materialId) return i;
  }
  return blocks.length;
}

function buildExistingTreeSet(grid, blocks) {
  const existing = new Set();
  for (const b of blocks) {
    if (grid.get(b.x, b.y, b.z) === b.materialId) {
      existing.add(cellKey(b.x, b.y, b.z));
    }
  }
  return existing;
}

function hasOrganicSupport(grid, block, blocks) {
  const existing = buildExistingTreeSet(grid, blocks);
  for (const [dx, dy, dz] of FACE_NEIGHBORS) {
    const nx = block.x + dx;
    const ny = block.y + dy;
    const nz = block.z + dz;
    const id = grid.get(nx, ny, nz);
    if ((id === 'wood' || id === 'organic') && existing.has(cellKey(nx, ny, nz))) {
      return true;
    }
  }
  return false;
}

function createTreeEntry(plan, grid) {
  const trunkTopIndex = findTrunkTopIndex(plan.blocks);
  return {
    blocks: plan.blocks,
    trunkTopIndex,
    nextIndex: computeTreeResumeIndex(grid, plan.blocks),
    timer: TREE_GROWTH.interval,
  };
}

function isGrowthAllowed(grid, tree, nextIndex) {
  const block = tree.blocks[nextIndex];
  const root = tree.blocks[0];

  if (grid.get(root.x, root.y, root.z) !== 'wood') return false;
  if (!isTreeRoot(grid, root.x, root.y, root.z)) return false;

  if (block.materialId === 'wood') {
    return grid.get(block.x, block.y - 1, block.z) === 'wood';
  }

  const trunkTop = tree.blocks[tree.trunkTopIndex];
  if (grid.get(trunkTop.x, trunkTop.y, trunkTop.z) !== 'wood') return false;

  return hasOrganicSupport(grid, block, tree.blocks);
}

export class TreeGrowthSystem {
  constructor(world) {
    this.world = world;
    /** @type {Map<string, object>} */
    this.registry = new Map();
    this.active = [];
  }

  /** @param {Array} plans from generateTrees / tryPlantTree */
  loadPlans(plans) {
    for (const plan of plans) {
      this.registerPlan(plan);
    }
  }

  registerPlan(plan) {
    if (!plan?.blocks?.length) return;

    const entry = createTreeEntry(plan, this.world.grid);
    const key = rootKey(plan.blocks[0].x, plan.blocks[0].y, plan.blocks[0].z);
    this.registry.set(key, entry);

    if (entry.nextIndex < entry.blocks.length) {
      this.enqueue(entry);
    }
  }

  enqueue(entry) {
    if (!this.active.includes(entry)) {
      this.active.push(entry);
    }
  }

  dequeue(entry) {
    const idx = this.active.indexOf(entry);
    if (idx !== -1) this.active.splice(idx, 1);
  }

  /** Resume regrowth from the remaining stump after a block is removed. */
  onTreeDamaged(x, y, z) {
    const { grid } = this.world;

    for (const entry of this.registry.values()) {
      const hit = entry.blocks.some((b) => b.x === x && b.y === y && b.z === z);
      if (!hit) continue;

      const root = entry.blocks[0];
      const key = rootKey(root.x, root.y, root.z);

      if (!isTreeRoot(grid, root.x, root.y, root.z)) {
        this.registry.delete(key);
        this.dequeue(entry);
        return;
      }

      entry.nextIndex = computeTreeResumeIndex(grid, entry.blocks);
      if (entry.nextIndex < entry.blocks.length) {
        entry.timer = TREE_GROWTH.interval;
        this.enqueue(entry);
      } else {
        this.dequeue(entry);
      }
      return;
    }
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const tree = this.active[i];
      const { grid } = this.world;
      const root = tree.blocks[0];
      const key = rootKey(root.x, root.y, root.z);

      if (!isTreeRoot(grid, root.x, root.y, root.z)) {
        this.registry.delete(key);
        this.active.splice(i, 1);
        continue;
      }

      tree.nextIndex = computeTreeResumeIndex(grid, tree.blocks);
      if (tree.nextIndex >= tree.blocks.length) {
        this.active.splice(i, 1);
        continue;
      }

      tree.timer -= dt;
      if (tree.timer > 0) continue;
      tree.timer = TREE_GROWTH.interval;

      const nextIndex = tree.nextIndex;
      const block = tree.blocks[nextIndex];

      if (!isGrowthAllowed(grid, tree, nextIndex)) continue;

      if (canPlaceGrowthBlock(grid, block)) {
        this.world.setBlock(block.x, block.y, block.z, block.materialId, { source: 'tree-growth' });
      }

      tree.nextIndex++;
      if (tree.nextIndex >= tree.blocks.length) {
        this.active.splice(i, 1);
      }
    }
  }

  dispose() {
    this.registry.clear();
    this.active = [];
  }
}
