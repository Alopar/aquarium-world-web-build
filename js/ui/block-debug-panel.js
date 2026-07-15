import { getMaterial, getLightLevel } from '../materials/registry.js';
import { LIGHTING } from '../constants.js';

function row(label, value) {
  const el = document.createElement('div');
  el.className = 'block-debug__row';
  const l = document.createElement('span');
  l.className = 'block-debug__label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'block-debug__value';
  v.textContent = value;
  el.append(l, v);
  return { el, valueEl: v };
}

/**
 * Debug panel next to the profiler — solid / liquid / gas under the crosshair.
 */
export class BlockDebugPanel {
  /**
   * @param {HTMLElement} root
   */
  constructor(root) {
    this.root = root;
    this.root.classList.add('block-debug');
    this.root.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'block-debug__title';
    title.textContent = 'Блок';
    this.root.appendChild(title);

    this.emptyEl = document.createElement('div');
    this.emptyEl.className = 'block-debug__empty';
    this.emptyEl.textContent = '— нет цели —';
    this.root.appendChild(this.emptyEl);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'block-debug__body hidden';
    this.root.appendChild(this.bodyEl);

    this.rows = {
      id: row('id', ''),
      name: row('name', ''),
      xyz: row('xyz', ''),
      solid: row('solid', ''),
      opaque: row('opaque', ''),
      organic: row('organic', ''),
      liquid: row('liquid', ''),
      gas: row('gas', ''),
      lightLevel: row('emit', ''),
      sky: row('skylight', ''),
      block: row('blocklight', ''),
      blockRgb: row('block rgb', ''),
      bright: row('bright', ''),
      volume: row('volume', ''),
    };

    for (const key of Object.keys(this.rows)) {
      this.bodyEl.appendChild(this.rows[key].el);
    }

    this._lastKey = '';
  }

  /**
   * @param {{
   *   hit: { block: { x: number, y: number, z: number } } | null,
   *   world: import('../world/world.js').AquariumWorld | null,
   *   dayAmount?: number,
   * }} opts
   */
  update({ hit, world, dayAmount = 1 }) {
    if (!hit?.block || !world) {
      this._showEmpty();
      return;
    }

    const { x, y, z } = hit.block;
    const id = world.getBlock(x, y, z);
    if (!id || id === 'air') {
      this._showEmpty();
      return;
    }

    const mat = getMaterial(id);
    const sky = world.lighting?.getSkylight(x, y, z) ?? 0;
    const block = world.lighting?.getBlockLight(x, y, z) ?? 0;
    const rgb = world.lighting?.getBlockLightRgb?.(x, y, z) ?? { r: 0, g: 0, b: 0 };
    const emit = getLightLevel(id);
    const skyLv = (sky / LIGHTING.maxLevel) * dayAmount;
    const blockR = rgb.r / LIGHTING.maxLevel;
    const blockG = rgb.g / LIGHTING.maxLevel;
    const blockB = rgb.b / LIGHTING.maxLevel;
    const level = Math.max(skyLv, blockR, blockG, blockB);
    const bright = LIGHTING.minBrightness + (1 - LIGHTING.minBrightness) * level;

    let volume = '';
    if (mat.liquid) volume = String(world.getFluidVolume(x, y, z));
    else if (mat.gas) volume = String(world.getGasVolume(x, y, z));

    const key = `${x},${y},${z},${id},${sky},${rgb.r},${rgb.g},${rgb.b},${volume},${dayAmount.toFixed(2)}`;
    if (key === this._lastKey) return;
    this._lastKey = key;

    this.emptyEl.classList.add('hidden');
    this.bodyEl.classList.remove('hidden');

    this.rows.id.valueEl.textContent = id;
    this.rows.name.valueEl.textContent = mat.name ?? '—';
    this.rows.xyz.valueEl.textContent = `${x} ${y} ${z}`;
    this.rows.solid.valueEl.textContent = mat.solid ? 'yes' : 'no';
    this.rows.opaque.valueEl.textContent = mat.opaque ? 'yes' : 'no';
    this.rows.organic.valueEl.textContent = mat.organic ? 'yes' : 'no';
    this.rows.liquid.valueEl.textContent = mat.liquid ? 'yes' : 'no';
    this.rows.gas.valueEl.textContent = mat.gas ? 'yes' : 'no';
    this.rows.lightLevel.valueEl.textContent = String(emit);
    this.rows.sky.valueEl.textContent = `${sky}/${LIGHTING.maxLevel}`;
    this.rows.block.valueEl.textContent = `${block}/${LIGHTING.maxLevel}`;
    this.rows.blockRgb.valueEl.textContent = `${rgb.r} ${rgb.g} ${rgb.b}`;
    this.rows.bright.valueEl.textContent = bright.toFixed(3);

    this.rows.volume.el.classList.toggle('hidden', volume === '');
    if (volume !== '') this.rows.volume.valueEl.textContent = volume;
  }

  _showEmpty() {
    if (this._lastKey === '') return;
    this._lastKey = '';
    this.emptyEl.classList.remove('hidden');
    this.bodyEl.classList.add('hidden');
  }

  dispose() {
    this.root.innerHTML = '';
  }
}
