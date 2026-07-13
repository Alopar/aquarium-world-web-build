import {
  EQUIPMENT_SLOTS,
  HOTBAR_SLOTS,
  INVENTORY_STORAGE_SLOTS,
} from '../constants.js';
import { getMaterial, isCollectible, isResourceBlock } from '../materials/registry.js';
import { getEquipSlot, getItem, isEquipable, isItem } from '../items/registry.js';

export function createEmptySlot() {
  return { materialId: null, count: 0 };
}

function cloneSlot(slot) {
  return { materialId: slot.materialId, count: slot.count };
}

function clearSlot(slot) {
  slot.materialId = null;
  slot.count = 0;
}

/**
 * Hotbar (9) + backpack storage + equipment. Source of truth for collectible stacks.
 * Stack ids may be block materials OR craft items (see items/registry).
 */
export class Inventory {
  constructor() {
    this.hotbar = Array.from({ length: HOTBAR_SLOTS }, createEmptySlot);
    this.storage = Array.from({ length: INVENTORY_STORAGE_SLOTS }, createEmptySlot);
    /** @type {Record<string, { materialId: string | null, count: number }>} */
    this.equipment = Object.fromEntries(
      EQUIPMENT_SLOTS.map((key) => [key, createEmptySlot()]),
    );
    this.selectedSlot = 0;
    /** @type {{ materialId: string, count: number } | null} */
    this.held = null;
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    for (const fn of this.listeners) fn();
  }

  get slots() {
    return this.hotbar;
  }

  getEquipmentSlotKey(index) {
    return EQUIPMENT_SLOTS[index] ?? null;
  }

  getSlot(region, index) {
    if (region === 'equipment') {
      const key = this.getEquipmentSlotKey(index);
      return key ? this.equipment[key] : null;
    }
    const list = region === 'storage' ? this.storage : this.hotbar;
    if (index < 0 || index >= list.length) return null;
    return list[index];
  }

  getEquipped(slotKey) {
    const slot = this.equipment[slotKey];
    if (!slot?.materialId || slot.count <= 0) return null;
    return slot.materialId;
  }

  getTotalArmor() {
    let total = 0;
    for (const key of EQUIPMENT_SLOTS) {
      const id = this.getEquipped(key);
      if (!id) continue;
      total += getItem(id)?.armor ?? 0;
    }
    return total;
  }

  setHotbarSlot(index, materialId, count) {
    if (index < 0 || index >= HOTBAR_SLOTS) return;
    this.hotbar[index] = { materialId, count };
    this.notify();
  }

  selectSlot(index) {
    if (index < 0 || index >= HOTBAR_SLOTS) return;
    this.selectedSlot = index;
    this.notify();
  }

  getSelectedMaterial() {
    const slot = this.hotbar[this.selectedSlot];
    if (!slot.materialId || slot.count <= 0) return null;
    return slot.materialId;
  }

  canAccept(materialId, options = {}) {
    if (!materialId) return false;
    if (isItem(materialId)) return true;
    if (isResourceBlock(materialId)) return false;
    if (!isCollectible(materialId)) return false;
    const mat = getMaterial(materialId);
    if ((mat.liquid || mat.gas) && !options.allowFluid) return false;
    return true;
  }

  /**
   * Prefer stacking in backpack, then hotbar; new stacks go to storage first.
   */
  add(materialId, amount = 1, options = {}) {
    if (!this.canAccept(materialId, options)) return false;
    if (amount <= 0) return false;

    const tryStack = (list) => {
      for (const slot of list) {
        if (slot.materialId === materialId) {
          slot.count += amount;
          return true;
        }
      }
      return false;
    };

    const tryEmpty = (list, preferredIndex = -1) => {
      if (preferredIndex >= 0 && preferredIndex < list.length) {
        const preferred = list[preferredIndex];
        if (!preferred.materialId) {
          preferred.materialId = materialId;
          preferred.count = amount;
          return true;
        }
      }
      for (const slot of list) {
        if (!slot.materialId) {
          slot.materialId = materialId;
          slot.count = amount;
          return true;
        }
      }
      return false;
    };

    if (tryStack(this.storage) || tryStack(this.hotbar)) {
      this.notify();
      return true;
    }

    if (tryEmpty(this.storage) || tryEmpty(this.hotbar, this.selectedSlot)) {
      this.notify();
      return true;
    }

    return false;
  }

  removeFromSelected(amount = 1) {
    const slot = this.hotbar[this.selectedSlot];
    if (!slot.materialId || slot.count < amount) return false;
    slot.count -= amount;
    if (slot.count <= 0) clearSlot(slot);
    this.notify();
    return true;
  }

  /** Count stacks across backpack, hotbar, and cursor (not equipment). */
  countItem(materialId) {
    if (!materialId) return 0;
    let total = 0;
    for (const slot of this.storage) {
      if (slot.materialId === materialId) total += slot.count;
    }
    for (const slot of this.hotbar) {
      if (slot.materialId === materialId) total += slot.count;
    }
    if (this.held?.materialId === materialId) total += this.held.count;
    return total;
  }

  /**
   * Remove from storage first, then hotbar, then held cursor.
   * Does not touch equipment.
   */
  removeItem(materialId, amount = 1) {
    if (!materialId || amount <= 0) return false;
    if (this.countItem(materialId) < amount) return false;

    let left = amount;
    const drain = (slot) => {
      if (left <= 0 || slot.materialId !== materialId) return;
      const take = Math.min(slot.count, left);
      slot.count -= take;
      left -= take;
      if (slot.count <= 0) clearSlot(slot);
    };

    for (const slot of this.storage) drain(slot);
    for (const slot of this.hotbar) drain(slot);
    if (left > 0 && this.held?.materialId === materialId) {
      const take = Math.min(this.held.count, left);
      this.held.count -= take;
      left -= take;
      if (this.held.count <= 0) this.held = null;
    }

    this.notify();
    return left === 0;
  }

  /** True if output can merge into an existing stack or an empty slot exists. */
  canFit(materialId, amount = 1) {
    if (!this.canAccept(materialId, { allowFluid: true })) return false;
    if (amount <= 0) return false;
    for (const slot of [...this.storage, ...this.hotbar]) {
      if (slot.materialId === materialId) return true;
    }
    for (const slot of [...this.storage, ...this.hotbar]) {
      if (!slot.materialId) return true;
    }
    return false;
  }

  /**
   * Whether crafting would leave room for the output (including slots freed
   * when an ingredient stack is fully consumed).
   */
  canFitAfterCraft(recipe) {
    if (this.canFit(recipe.output, recipe.count ?? 1)) return true;

    const need = new Map();
    for (const ing of recipe.ingredients) {
      need.set(ing.id, (need.get(ing.id) ?? 0) + ing.count);
    }

    for (const slot of [...this.storage, ...this.hotbar]) {
      if (!slot.materialId) continue;
      const left = need.get(slot.materialId);
      if (left == null) continue;
      if (slot.count <= left) return true;
    }
    return false;
  }

  canCraft(recipe) {
    if (!recipe?.output || !recipe.ingredients?.length) return false;
    for (const ing of recipe.ingredients) {
      if (this.countItem(ing.id) < ing.count) return false;
    }
    return this.canFitAfterCraft(recipe);
  }

  craft(recipe) {
    if (!recipe?.output || !recipe.ingredients?.length) return false;
    for (const ing of recipe.ingredients) {
      if (this.countItem(ing.id) < ing.count) return false;
    }
    if (!this.canFitAfterCraft(recipe)) return false;

    const removed = [];
    for (const ing of recipe.ingredients) {
      if (!this.removeItem(ing.id, ing.count)) {
        for (const r of removed) this.add(r.id, r.count, { allowFluid: true });
        return false;
      }
      removed.push({ id: ing.id, count: ing.count });
    }

    if (!this.add(recipe.output, recipe.count ?? 1, { allowFluid: true })) {
      for (const r of removed) this.add(r.id, r.count, { allowFluid: true });
      return false;
    }
    return true;
  }

  fitsEquipmentSlot(slotKey, materialId) {
    if (!materialId || !isEquipable(materialId)) return false;
    return getEquipSlot(materialId) === slotKey;
  }

  /**
   * Minecraft-style left click: pick up, place, merge, or swap with held stack.
   * Equipment slots only accept matching gear and hold at most 1.
   */
  clickSlot(region, index, button = 0) {
    if (region === 'equipment') {
      this.clickEquipmentSlot(index, button);
      return;
    }

    const slot = this.getSlot(region, index);
    if (!slot) return;

    if (button === 2) {
      this.rightClickSlot(slot);
      return;
    }

    if (!this.held) {
      if (!slot.materialId || slot.count <= 0) return;
      this.held = cloneSlot(slot);
      clearSlot(slot);
      this.notify();
      return;
    }

    if (!slot.materialId) {
      slot.materialId = this.held.materialId;
      slot.count = this.held.count;
      this.held = null;
      this.notify();
      return;
    }

    if (slot.materialId === this.held.materialId) {
      slot.count += this.held.count;
      this.held = null;
      this.notify();
      return;
    }

    const tmp = cloneSlot(slot);
    slot.materialId = this.held.materialId;
    slot.count = this.held.count;
    this.held = tmp;
    this.notify();
  }

  clickEquipmentSlot(index, button = 0) {
    const slotKey = this.getEquipmentSlotKey(index);
    const slot = slotKey ? this.equipment[slotKey] : null;
    if (!slot) return;

    // Empty cursor: pick up equipped item (LMB or RMB).
    if (!this.held) {
      if (!slot.materialId || slot.count <= 0) return;
      this.held = cloneSlot(slot);
      clearSlot(slot);
      this.notify();
      return;
    }

    if (!this.fitsEquipmentSlot(slotKey, this.held.materialId)) return;

    // Place one into empty equipment slot.
    if (!slot.materialId) {
      slot.materialId = this.held.materialId;
      slot.count = 1;
      this.held.count -= 1;
      if (this.held.count <= 0) this.held = null;
      this.notify();
      return;
    }

    // Same item already equipped — nothing to do (max 1).
    if (slot.materialId === this.held.materialId) return;

    // Swap: take equipped item, leave one of held in the slot.
    const equipped = cloneSlot(slot);
    slot.materialId = this.held.materialId;
    slot.count = 1;
    this.held.count -= 1;
    if (this.held.count <= 0) {
      this.held = equipped;
    } else {
      // Leftover held stack — put equipped back into inventory, keep held.
      if (!this.add(equipped.materialId, equipped.count, { allowFluid: true })) {
        // Inventory full: put equipped on cursor by swapping leftover away.
        const leftover = cloneSlot(this.held);
        this.held = equipped;
        if (!this.add(leftover.materialId, leftover.count, { allowFluid: true })) {
          this.hotbar[this.selectedSlot] = leftover;
        }
      }
    }
    this.notify();
  }

  rightClickSlot(slot) {
    if (!this.held) {
      if (!slot.materialId || slot.count <= 0) return;
      const half = Math.ceil(slot.count / 2);
      this.held = { materialId: slot.materialId, count: half };
      slot.count -= half;
      if (slot.count <= 0) clearSlot(slot);
      this.notify();
      return;
    }

    if (!slot.materialId) {
      slot.materialId = this.held.materialId;
      slot.count = 1;
      this.held.count -= 1;
      if (this.held.count <= 0) this.held = null;
      this.notify();
      return;
    }

    if (slot.materialId === this.held.materialId) {
      slot.count += 1;
      this.held.count -= 1;
      if (this.held.count <= 0) this.held = null;
      this.notify();
    }
  }

  /** Put cursor stack back into inventory (storage first, then hotbar). */
  stashHeld() {
    if (!this.held) return;
    const { materialId, count } = this.held;
    this.held = null;
    if (!this.add(materialId, count, { allowFluid: true })) {
      // Inventory full — force into first empty or merge anywhere.
      const force = (list) => {
        for (const slot of list) {
          if (slot.materialId === materialId) {
            slot.count += count;
            return true;
          }
        }
        for (const slot of list) {
          if (!slot.materialId) {
            slot.materialId = materialId;
            slot.count = count;
            return true;
          }
        }
        return false;
      };
      if (!force(this.storage) && !force(this.hotbar)) {
        // Last resort: overwrite selected hotbar slot.
        this.hotbar[this.selectedSlot] = { materialId, count };
      }
    }
    this.notify();
  }
}
