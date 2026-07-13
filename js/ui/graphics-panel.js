import {
  GRAPHICS_OPTIONS,
  GRAPHICS_SLIDERS,
  clearGraphicsOverrides,
  createQualitySettings,
  isTickOptionEnabled,
} from '../quality-settings.js';
import {
  DESKTOP_QUALITY,
  MOBILE_QUALITY,
  applyGraphicsPreset,
  setGraphicsOption,
  setGraphicsSlider,
} from '../graphics-controller.js';
import { clampFogViewDistance } from '../systems/fog-controller.js';
import { clampPixelScale } from '../systems/pixel-scale.js';

const TOGGLE_KEY = 'KeyG';

function isOptionChecked(quality, opt) {
  const value = quality[opt.key];
  if (opt.tickKey) return isTickOptionEnabled(value);
  return !!value;
}

export class GraphicsPanel {
  /**
   * @param {HTMLElement} rootEl
   * @param {import('../app.js').App} app
   */
  constructor(rootEl, app) {
    this.root = rootEl;
    this.app = app;
    this.open = false;
    this.toggleInputs = new Map();
    this.sliderInputs = new Map();
    this.sliderValueEls = new Map();

    this.onKeyDown = this.onKeyDown.bind(this);
    this.build();
    window.addEventListener('keydown', this.onKeyDown);
  }

  build() {
    this.root.className = 'graphics-panel hidden';
    this.root.setAttribute('aria-hidden', 'true');

    const backdrop = document.createElement('div');
    backdrop.className = 'graphics-panel__backdrop';
    backdrop.addEventListener('click', () => this.close());

    const windowEl = document.createElement('div');
    windowEl.className = 'graphics-panel__window';
    windowEl.addEventListener('click', (e) => e.stopPropagation());

    const title = document.createElement('h2');
    title.className = 'graphics-panel__title';
    title.textContent = 'Графика';

    const hint = document.createElement('p');
    hint.className = 'graphics-panel__hint';
    hint.textContent = 'G — открыть/закрыть · настройки сохраняются локально';

    const list = document.createElement('div');
    list.className = 'graphics-panel__list';

    for (const opt of GRAPHICS_OPTIONS) {
      const row = document.createElement('label');
      row.className = 'graphics-panel__row';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'graphics-panel__checkbox';
      input.dataset.key = opt.key;
      input.addEventListener('change', () => this.onToggle(opt.key, input.checked));

      const text = document.createElement('span');
      text.className = 'graphics-panel__row-text';

      const name = document.createElement('span');
      name.className = 'graphics-panel__row-label';
      name.textContent = opt.label;

      const sub = document.createElement('span');
      sub.className = 'graphics-panel__row-hint';
      sub.textContent = opt.hint;

      text.append(name, sub);
      row.append(input, text);
      list.appendChild(row);
      this.toggleInputs.set(opt.key, input);
    }

    const sliders = document.createElement('div');
    sliders.className = 'graphics-panel__sliders';

    for (const slider of GRAPHICS_SLIDERS) {
      const row = document.createElement('div');
      row.className = 'graphics-panel__slider-row';
      row.dataset.requires = slider.requires ?? '';

      const head = document.createElement('div');
      head.className = 'graphics-panel__slider-head';

      const name = document.createElement('span');
      name.className = 'graphics-panel__row-label';
      name.textContent = slider.label;

      const valueEl = document.createElement('span');
      valueEl.className = 'graphics-panel__slider-value';
      valueEl.dataset.key = slider.key;

      head.append(name, valueEl);

      const sub = document.createElement('span');
      sub.className = 'graphics-panel__row-hint';
      sub.textContent = slider.hint;

      const range = document.createElement('input');
      range.type = 'range';
      range.className = 'graphics-panel__range';
      range.min = String(slider.min);
      range.max = String(slider.max);
      range.step = String(slider.step);
      range.dataset.key = slider.key;
      range.addEventListener('input', () => this.onSlider(slider.key, Number(range.value)));

      row.append(head, sub, range);
      sliders.appendChild(row);
      this.sliderInputs.set(slider.key, range);
      this.sliderValueEls.set(slider.key, valueEl);
    }

    const presets = document.createElement('div');
    presets.className = 'graphics-panel__presets';

    const btnDesktop = document.createElement('button');
    btnDesktop.type = 'button';
    btnDesktop.className = 'graphics-panel__preset-btn';
    btnDesktop.textContent = 'ПК (макс.)';
    btnDesktop.addEventListener('click', () => this.applyPreset(DESKTOP_QUALITY));

    const btnMobile = document.createElement('button');
    btnMobile.type = 'button';
    btnMobile.className = 'graphics-panel__preset-btn';
    btnMobile.textContent = 'Телефон';
    btnMobile.addEventListener('click', () => this.applyPreset(MOBILE_QUALITY));

    const btnReset = document.createElement('button');
    btnReset.type = 'button';
    btnReset.className = 'graphics-panel__preset-btn graphics-panel__preset-btn--muted';
    btnReset.textContent = 'Сбросить сохранённые';
    btnReset.addEventListener('click', () => this.resetSaved());

    presets.append(btnDesktop, btnMobile, btnReset);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'graphics-panel__close';
    closeBtn.textContent = 'Закрыть';
    closeBtn.addEventListener('click', () => this.close());

    windowEl.append(title, hint, list, sliders, presets, closeBtn);
    this.root.append(backdrop, windowEl);
  }

  syncFromQuality() {
    const quality = this.app?.quality;
    if (!quality) return;
    for (const opt of GRAPHICS_OPTIONS) {
      const input = this.toggleInputs.get(opt.key);
      if (input) input.checked = isOptionChecked(quality, opt);
    }
    for (const slider of GRAPHICS_SLIDERS) {
      const input = this.sliderInputs.get(slider.key);
      const valueEl = this.sliderValueEls.get(slider.key);
      const raw = quality[slider.key];
      const value = slider.key === 'pixelScale'
        ? clampPixelScale(raw)
        : clampFogViewDistance(raw);
      if (input) input.value = String(value);
      if (valueEl) {
        const text = slider.key === 'pixelScale'
          ? value.toFixed(2)
          : String(Math.round(value));
        valueEl.textContent = `${text} ${slider.unit ?? ''}`.trim();
      }
      const row = input?.closest('.graphics-panel__slider-row');
      const requires = slider.requires;
      const enabled = !requires || !!quality[requires];
      if (row) row.classList.toggle('graphics-panel__slider-row--disabled', !enabled);
      if (input) input.disabled = !enabled;
    }
    const lambertInput = this.toggleInputs.get('lambertTerrain');
    if (lambertInput) {
      const flatOn = !!quality.flatColorsTerrain;
      lambertInput.disabled = flatOn;
      lambertInput.closest('.graphics-panel__row')?.classList.toggle('graphics-panel__row--disabled', flatOn);
    }
  }

  onSlider(key, value) {
    if (!this.app) return;
    setGraphicsSlider(this.app, key, value);
    this.syncFromQuality();
  }

  onToggle(key, checked) {
    if (!this.app) return;
    if (key === 'flatColorsTerrain' && checked) {
      setGraphicsOption(this.app, 'lambertTerrain', false);
    }
    setGraphicsOption(this.app, key, checked);
    this.syncFromQuality();
  }

  applyPreset(preset) {
    if (!this.app) return;
    applyGraphicsPreset(this.app, preset);
    this.syncFromQuality();
  }

  resetSaved() {
    if (!this.app) return;
    clearGraphicsOverrides();
    const fresh = createQualitySettings(this.app.isMobile);
    applyGraphicsPreset(this.app, fresh);
    this.syncFromQuality();
  }

  onKeyDown(e) {
    if (e.code !== TOGGLE_KEY || e.repeat) return;
    if (this.app?.state !== 'playing') return;
    if (this.app.inventoryPanel?.open || this.app.craftingPanel?.open) return;
    e.preventDefault();
    this.toggle();
  }

  toggle() {
    if (this.open) this.close();
    else this.openPanel();
  }

  openPanel() {
    this.syncFromQuality();
    this.open = true;
    this.root.classList.remove('hidden');
    this.root.setAttribute('aria-hidden', 'false');
    if (this.app?.blockInteraction) this.app.blockInteraction.inputBlocked = true;
    this.app?.playerController?.exitLock?.();
    this.app?.mobileControls?.setGameplayActive(false);
  }

  close() {
    this.open = false;
    this.root.classList.add('hidden');
    this.root.setAttribute('aria-hidden', 'true');
    if (this.app?.state === 'playing') {
      const uiOpen = this.app.inventoryPanel?.open || this.app.craftingPanel?.open;
      if (this.app.blockInteraction && !uiOpen) {
        this.app.blockInteraction.inputBlocked = false;
      }
      const blocking = this.app.orientationGate?.isBlocking ?? false;
      this.app.mobileControls?.setGameplayActive(!blocking && !uiOpen);
    }
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
  }
}
