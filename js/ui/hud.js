import { getStackDef } from '../items/stack.js';
import { isExplosive, isItem } from '../items/registry.js';
import { DAY_NIGHT, HOTBAR_SLOTS } from '../constants.js';

const PERIOD_LABELS = {
  dawn: 'Рассвет',
  day: 'День',
  dusk: 'Закат',
  night: 'Ночь',
};

export class GameHud {
  constructor(root, hotbarEl, placeModeEl, healthEls = null, dayNightEls = null) {
    this.root = root;
    this.hotbarEl = hotbarEl;
    this.placeModeEl = placeModeEl;
    this.healthFillEl = healthEls?.fill ?? null;
    this.healthLabelEl = healthEls?.label ?? null;
    this.dayNightRoot = dayNightEls?.root ?? null;
    this.dayNightHand = dayNightEls?.hand ?? null;
    this.dayNightLabel = dayNightEls?.label ?? null;
    this.underwaterVeil = root?.querySelector?.('#underwater-veil') ?? null;
    this.interaction = null;
    this.inventory = null;
    this.playerHealth = null;
    this.slotEls = [];
    this.unsub = null;
    this.unsubInventory = null;
    this.unsubHealth = null;
    this._lastPeriod = '';
    this._lastUnderwater = -1;

    this.buildHotbar();
  }

  buildHotbar() {
    this.hotbarEl.innerHTML = '';
    this.slotEls = [];

    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const slot = document.createElement('div');
      slot.className = 'hotbar-slot';
      slot.dataset.index = String(i);

      const key = document.createElement('span');
      key.className = 'hotbar-key';
      key.textContent = String(i + 1);

      const swatch = document.createElement('span');
      swatch.className = 'hotbar-swatch';

      const label = document.createElement('span');
      label.className = 'hotbar-label';
      label.textContent = 'Пусто';

      const count = document.createElement('span');
      count.className = 'hotbar-count';
      count.textContent = '';

      slot.append(key, swatch, label, count);
      slot.addEventListener('click', () => {
        this.interaction?.selectSlot(i);
      });

      this.hotbarEl.appendChild(slot);
      this.slotEls.push({ slot, swatch, label, count });
    }
  }

  bind(interaction) {
    this.interaction = interaction;
    this.unsub?.();
    this.unsub = interaction.onChange(() => this.refresh());
    this.refresh();
  }

  bindInventory(inventory) {
    this.inventory = inventory;
    this.unsubInventory?.();
    this.unsubInventory = inventory.onChange(() => this.refresh());
    this.refresh();
  }

  bindHealth(playerHealth) {
    this.playerHealth = playerHealth;
    this.unsubHealth?.();
    this.unsubHealth = playerHealth.onChange(() => this.refreshHealth());
    this.refreshHealth();
  }

  /**
   * @param {{ phase: number, getPeriod: () => string, getPeriodLabel: () => string, underwaterFactor?: number } | null} dayNight
   */
  updateDayNight(dayNight) {
    if (!dayNight || !this.dayNightHand) return;

    // Noon at top: phase 0.25 → 0deg
    const degrees = dayNight.phase * 360 - 90;
    this.dayNightHand.style.transform = `rotate(${degrees}deg)`;

    const period = dayNight.getPeriod();
    if (period !== this._lastPeriod) {
      this._lastPeriod = period;
      if (this.dayNightRoot) this.dayNightRoot.dataset.period = period;
      if (this.dayNightLabel) {
        this.dayNightLabel.textContent = dayNight.getPeriodLabel?.()
          ?? PERIOD_LABELS[period]
          ?? period;
      }
    }

    this.updateUnderwater(dayNight.underwaterFactor ?? 0);
  }

  /**
   * Full-screen blue veil while submerged — fills the empty interior of liquid voxels.
   * @param {number} factor 0…1
   */
  updateUnderwater(factor) {
    if (!this.underwaterVeil) return;
    const t = Math.max(0, Math.min(1, factor));
    const rounded = Math.round(t * 100) / 100;
    if (rounded === this._lastUnderwater) return;
    this._lastUnderwater = rounded;

    const maxOpacity = DAY_NIGHT?.underwater?.veilOpacity ?? 0.62;
    this.underwaterVeil.style.opacity = String(rounded * maxOpacity);
  }

  refreshHealth() {
    if (!this.playerHealth || !this.healthFillEl) return;

    const ratio = Math.max(0, Math.min(1, this.playerHealth.ratio));
    const hp = Math.ceil(this.playerHealth.health);
    this.healthFillEl.style.width = `${ratio * 100}%`;
    this.healthFillEl.dataset.low = ratio <= 0.3 ? 'true' : 'false';
    if (this.healthLabelEl) {
      this.healthLabelEl.textContent = String(hp);
    }
  }

  refresh() {
    if (this.placeModeEl && this.interaction) {
      const touch = document.body.classList.contains('is-mobile');
      const useLabel = touch ? 'Использовать' : 'ПКМ';
      const selected = this.inventory?.getSelectedMaterial?.()
        ?? this.interaction?.getSelectedMaterial?.();
      if (selected && isExplosive(selected)) {
        this.placeModeEl.textContent = `${useLabel}: бросить бомбу`;
        this.placeModeEl.dataset.mode = 'bomb';
      } else if (selected && isItem(selected)) {
        this.placeModeEl.textContent = `${useLabel}: выкинуть вещь`;
        this.placeModeEl.dataset.mode = 'item';
      } else {
        const mode = this.interaction.placeMode;
        this.placeModeEl.textContent = mode === 'place'
          ? `${useLabel}: ставить блок`
          : `${useLabel}: бросить блок`;
        this.placeModeEl.dataset.mode = mode;
      }
    }

    const slots = this.inventory?.hotbar ?? this.interaction?.slots;
    const selected = this.inventory?.selectedSlot ?? this.interaction?.selectedSlot ?? 0;
    if (!slots) return;

    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const { slot, swatch, label, count } = this.slotEls[i];
      const data = slots[i];

      slot.classList.toggle('active', i === selected);

      if (data?.materialId) {
        const mat = getStackDef(data.materialId);
        const hex = (mat.color ?? 0xffffff).toString(16).padStart(6, '0');
        swatch.style.backgroundColor = `#${hex}`;
        label.textContent = mat.name ?? data.materialId;
        count.textContent = data.count > 0 ? String(data.count) : '';
      } else {
        swatch.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
        label.textContent = 'Пусто';
        count.textContent = '';
      }
    }
  }

  show() {
    this.root.classList.remove('hidden');
  }

  hide() {
    this.root.classList.add('hidden');
  }

  dispose() {
    this.unsub?.();
    this.unsubInventory?.();
    this.unsubHealth?.();
  }
}
