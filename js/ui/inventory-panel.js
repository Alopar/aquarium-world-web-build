import { getStackDef } from '../items/stack.js';
import {
  EQUIPMENT_SLOT_LABELS,
  EQUIPMENT_SLOTS,
  HOTBAR_SLOTS,
  INVENTORY_STORAGE_COLS,
  INVENTORY_STORAGE_ROWS,
} from '../constants.js';

function paintSlotVisual(els, data, { showKey = false, keyLabel = '', active = false, emptyLabel = 'Пусто' } = {}) {
  const { slot, swatch, label, count, key } = els;
  slot.classList.toggle('active', active);
  if (key) {
    key.textContent = showKey ? keyLabel : '';
    key.classList.toggle('hidden', !showKey);
  }

  if (data?.materialId) {
    const mat = getStackDef(data.materialId);
    const hex = (mat.color ?? 0xffffff).toString(16).padStart(6, '0');
    swatch.style.backgroundColor = `#${hex}`;
    label.textContent = mat.name ?? data.materialId;
    count.textContent = data.count > 1 ? String(data.count) : '';
    slot.classList.remove('inv-slot--empty');
  } else {
    swatch.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
    label.textContent = emptyLabel;
    count.textContent = '';
    slot.classList.add('inv-slot--empty');
  }
}

function createSlotElement({ className, keyText = '' }) {
  const slot = document.createElement('button');
  slot.type = 'button';
  slot.className = className;

  const key = document.createElement('span');
  key.className = 'hotbar-key';
  if (keyText) key.textContent = keyText;
  else key.classList.add('hidden');

  const swatch = document.createElement('span');
  swatch.className = 'hotbar-swatch';

  const label = document.createElement('span');
  label.className = 'hotbar-label';
  label.textContent = 'Пусто';

  const count = document.createElement('span');
  count.className = 'hotbar-count';

  slot.append(key, swatch, label, count);
  return { slot, swatch, label, count, key };
}

/**
 * Inventory overlay: equipment + backpack grid + hotbar row, Minecraft-style click transfer.
 */
export class InventoryPanel {
  constructor(rootEl, { playerController = null, blockInteraction = null, craftingPanel = null } = {}) {
    this.root = rootEl;
    this.playerController = playerController;
    this.blockInteraction = blockInteraction;
    this.craftingPanel = craftingPanel;
    this.inventory = null;
    this.open = false;
    this.storageEls = [];
    this.hotbarEls = [];
    this.equipmentEls = [];
    this.unsub = null;
    this.cursorEl = null;

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onContextMenu = this.onContextMenu.bind(this);

    this.build();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('pointermove', this.onPointerMove);
    this.root.addEventListener('contextmenu', this.onContextMenu);
  }

  setDeps({ playerController, blockInteraction, craftingPanel }) {
    this.playerController = playerController ?? this.playerController;
    this.blockInteraction = blockInteraction ?? this.blockInteraction;
    this.craftingPanel = craftingPanel ?? this.craftingPanel;
  }

  build() {
    this.root.innerHTML = '';
    this.root.classList.add('inventory-panel', 'hidden');
    this.root.setAttribute('aria-hidden', 'true');

    const backdrop = document.createElement('div');
    backdrop.className = 'inventory-panel__backdrop';
    backdrop.addEventListener('click', () => this.close());

    const panel = document.createElement('div');
    panel.className = 'inventory-panel__window';
    panel.addEventListener('click', (e) => e.stopPropagation());

    const title = document.createElement('h2');
    title.className = 'inventory-panel__title';
    title.textContent = 'Инвентарь';

    const hint = document.createElement('p');
    hint.className = 'inventory-panel__hint';
    hint.textContent = 'ЛКМ — взять / положить · ПКМ — половина / по одному · E или Esc — закрыть';

    const body = document.createElement('div');
    body.className = 'inventory-panel__body';

    const equipCol = document.createElement('div');
    equipCol.className = 'inventory-panel__equipment';

    const equipLabel = document.createElement('div');
    equipLabel.className = 'inventory-panel__section-label';
    equipLabel.textContent = 'Экипировка';
    equipCol.appendChild(equipLabel);

    this.equipmentEls = [];
    for (let i = 0; i < EQUIPMENT_SLOTS.length; i++) {
      const slotKey = EQUIPMENT_SLOTS[i];
      const wrap = document.createElement('div');
      wrap.className = 'inventory-panel__equip-row';

      const tag = document.createElement('span');
      tag.className = 'inventory-panel__equip-tag';
      tag.textContent = EQUIPMENT_SLOT_LABELS[slotKey] ?? slotKey;

      const els = createSlotElement({ className: 'hotbar-slot inv-slot inv-slot--equip' });
      els.slot.dataset.region = 'equipment';
      els.slot.dataset.index = String(i);
      els.slot.dataset.equip = slotKey;
      els.slot.title = EQUIPMENT_SLOT_LABELS[slotKey] ?? slotKey;
      els.slot.addEventListener('mousedown', (e) => this.onSlotMouseDown(e, 'equipment', i));

      wrap.append(tag, els.slot);
      equipCol.appendChild(wrap);
      this.equipmentEls.push(els);
    }

    const mainCol = document.createElement('div');
    mainCol.className = 'inventory-panel__main';

    const storageLabel = document.createElement('div');
    storageLabel.className = 'inventory-panel__section-label';
    storageLabel.textContent = 'Рюкзак';

    const storageGrid = document.createElement('div');
    storageGrid.className = 'inventory-panel__grid';
    storageGrid.style.setProperty('--inv-cols', String(INVENTORY_STORAGE_COLS));

    this.storageEls = [];
    for (let i = 0; i < INVENTORY_STORAGE_ROWS * INVENTORY_STORAGE_COLS; i++) {
      const els = createSlotElement({ className: 'hotbar-slot inv-slot' });
      els.slot.dataset.region = 'storage';
      els.slot.dataset.index = String(i);
      els.slot.addEventListener('mousedown', (e) => this.onSlotMouseDown(e, 'storage', i));
      storageGrid.appendChild(els.slot);
      this.storageEls.push(els);
    }

    const hotbarLabel = document.createElement('div');
    hotbarLabel.className = 'inventory-panel__section-label';
    hotbarLabel.textContent = 'Панель быстрого доступа';

    const hotbarRow = document.createElement('div');
    hotbarRow.className = 'inventory-panel__hotbar';

    this.hotbarEls = [];
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const els = createSlotElement({
        className: 'hotbar-slot inv-slot',
        keyText: String(i + 1),
      });
      els.slot.dataset.region = 'hotbar';
      els.slot.dataset.index = String(i);
      els.slot.addEventListener('mousedown', (e) => this.onSlotMouseDown(e, 'hotbar', i));
      hotbarRow.appendChild(els.slot);
      this.hotbarEls.push(els);
    }

    mainCol.append(storageLabel, storageGrid, hotbarLabel, hotbarRow);
    body.append(equipCol, mainCol);
    panel.append(title, hint, body);
    this.root.append(backdrop, panel);

    this.cursorEl = document.createElement('div');
    this.cursorEl.className = 'inventory-cursor hidden';
    this.cursorEl.innerHTML = `
      <span class="inventory-cursor__swatch"></span>
      <span class="inventory-cursor__count"></span>
    `;
    this.root.appendChild(this.cursorEl);
  }

  bind(inventory) {
    this.inventory = inventory;
    this.unsub?.();
    this.unsub = inventory.onChange(() => this.refresh());
    this.refresh();
  }

  onSlotMouseDown(e, region, index) {
    if (!this.open || !this.inventory) return;
    e.preventDefault();
    e.stopPropagation();
    this.inventory.clickSlot(region, index, e.button);
  }

  onContextMenu(e) {
    if (this.open) e.preventDefault();
  }

  onPointerMove(e) {
    if (!this.open || !this.cursorEl) return;
    this.cursorEl.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 12}px)`;
  }

  onKeyDown(e) {
    if (e.code !== 'KeyE' && e.code !== 'Escape') return;
    if (!this.inventory) return;

    // Escape only closes; E toggles. Ignore when typing in inputs.
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.code === 'Escape') {
      if (!this.open) return;
      e.preventDefault();
      this.close();
      return;
    }

    e.preventDefault();
    this.toggle();
  }

  toggle() {
    if (this.open) this.close();
    else this.openPanel();
  }

  setWorldHotbarVisible(visible) {
    const hotbar = document.getElementById('hotbar');
    const hint = document.getElementById('hud-hint');
    const placeMode = document.getElementById('hud-place-mode');
    const mobile = document.getElementById('mobile-controls');
    const touchZones = document.getElementById('mobile-touch-zones');
    hotbar?.classList.toggle('hidden', !visible);
    hint?.classList.toggle('hidden', !visible);
    placeMode?.classList.toggle('hidden', !visible);
    mobile?.classList.toggle('mobile-controls--ui-hidden', !visible);
    touchZones?.classList.toggle('mobile-controls--ui-hidden', !visible);
  }

  openPanel() {
    if (this.open || !this.inventory) return;
    if (this.craftingPanel?.open) this.craftingPanel.close();
    this.open = true;
    this.root.classList.remove('hidden');
    this.root.setAttribute('aria-hidden', 'false');
    this.setWorldHotbarVisible(false);
    this.playerController?.unlock();
    if (this.blockInteraction) this.blockInteraction.inputBlocked = true;
    this.refresh();
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.inventory?.stashHeld();
    this.root.classList.add('hidden');
    this.root.setAttribute('aria-hidden', 'true');
    this.cursorEl?.classList.add('hidden');
    this.setWorldHotbarVisible(true);
    if (this.blockInteraction) this.blockInteraction.inputBlocked = false;
    this.playerController?.resumeAfterUi?.();
  }

  refresh() {
    if (!this.inventory) return;

    for (let i = 0; i < this.equipmentEls.length; i++) {
      const slotKey = EQUIPMENT_SLOTS[i];
      paintSlotVisual(this.equipmentEls[i], this.inventory.equipment[slotKey], {
        emptyLabel: EQUIPMENT_SLOT_LABELS[slotKey] ?? 'Пусто',
      });
    }

    for (let i = 0; i < this.storageEls.length; i++) {
      paintSlotVisual(this.storageEls[i], this.inventory.storage[i]);
    }

    for (let i = 0; i < this.hotbarEls.length; i++) {
      paintSlotVisual(this.hotbarEls[i], this.inventory.hotbar[i], {
        showKey: true,
        keyLabel: String(i + 1),
        active: i === this.inventory.selectedSlot,
      });
    }

    this.refreshCursor();
  }

  refreshCursor() {
    if (!this.cursorEl || !this.inventory) return;
    const held = this.inventory.held;
    if (!held?.materialId) {
      this.cursorEl.classList.add('hidden');
      return;
    }

    const mat = getStackDef(held.materialId);
    const hex = (mat.color ?? 0xffffff).toString(16).padStart(6, '0');
    const swatch = this.cursorEl.querySelector('.inventory-cursor__swatch');
    const count = this.cursorEl.querySelector('.inventory-cursor__count');
    if (swatch) swatch.style.backgroundColor = `#${hex}`;
    if (count) count.textContent = held.count > 1 ? String(held.count) : '';
    this.cursorEl.classList.remove('hidden');
  }

  dispose() {
    this.unsub?.();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    this.root.removeEventListener('contextmenu', this.onContextMenu);
  }
}
