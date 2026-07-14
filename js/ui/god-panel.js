const TOGGLE_KEY = 'F3';

export class GodPanel {
  /**
   * @param {HTMLElement} rootEl
   * @param {import('../app.js').App} app
   */
  constructor(rootEl, app) {
    this.root = rootEl;
    this.app = app;
    this.open = false;

    this.dayNightCycleInput = null;
    this.rainCycleInput = null;
    this.forceDayBtn = null;
    this.forceNightBtn = null;
    this.forceRainBtn = null;
    this.forceDryBtn = null;

    this.onKeyDown = this.onKeyDown.bind(this);
    this.build();
    window.addEventListener('keydown', this.onKeyDown);
  }

  build() {
    this.root.className = 'god-panel hidden';
    this.root.setAttribute('aria-hidden', 'true');

    const backdrop = document.createElement('div');
    backdrop.className = 'god-panel__backdrop';
    backdrop.addEventListener('click', () => this.close());

    const windowEl = document.createElement('div');
    windowEl.className = 'god-panel__window';
    windowEl.addEventListener('click', (e) => e.stopPropagation());

    const title = document.createElement('h2');
    title.className = 'god-panel__title';
    title.textContent = 'Панель Бога';

    const hint = document.createElement('p');
    hint.className = 'god-panel__hint';
    hint.textContent = 'F3 — открыть/закрыть · управление временем и погодой';

    const list = document.createElement('div');
    list.className = 'god-panel__list';

    const dayNightCycleRow = this.createToggleRow(
      'day-night-cycle',
      'Смена дня и ночи',
      'Автоматический цикл суток',
      (checked) => this.onDayNightCycle(checked),
    );
    this.dayNightCycleInput = dayNightCycleRow.input;
    list.appendChild(dayNightCycleRow.row);

    const dayNightForce = this.createForceGroup(
      'Время суток',
      'Принудительно установить',
      [
        { id: 'day', label: 'День', onClick: () => this.onForcePeriod('day') },
        { id: 'night', label: 'Ночь', onClick: () => this.onForcePeriod('night') },
      ],
    );
    this.forceDayBtn = dayNightForce.buttons.get('day');
    this.forceNightBtn = dayNightForce.buttons.get('night');
    list.appendChild(dayNightForce.group);

    const rainCycleRow = this.createToggleRow(
      'rain-cycle',
      'Цикл дождя',
      'Автоматическая смена дождя и ясной погоды',
      (checked) => this.onRainCycle(checked),
    );
    this.rainCycleInput = rainCycleRow.input;
    list.appendChild(rainCycleRow.row);

    const rainForce = this.createForceGroup(
      'Погода',
      'Принудительно установить',
      [
        { id: 'rain', label: 'Дождь', onClick: () => this.onForceRain(true) },
        { id: 'dry', label: 'Без дождя', onClick: () => this.onForceRain(false) },
      ],
    );
    this.forceRainBtn = rainForce.buttons.get('rain');
    this.forceDryBtn = rainForce.buttons.get('dry');
    list.appendChild(rainForce.group);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'god-panel__close';
    closeBtn.textContent = 'Закрыть';
    closeBtn.addEventListener('click', () => this.close());

    windowEl.append(title, hint, list, closeBtn);
    this.root.append(backdrop, windowEl);
  }

  createToggleRow(id, label, sub, onChange) {
    const row = document.createElement('label');
    row.className = 'god-panel__row';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'god-panel__checkbox';
    input.id = `god-${id}`;
    input.checked = true;
    input.addEventListener('change', () => onChange(input.checked));

    const text = document.createElement('span');
    text.className = 'god-panel__row-text';

    const name = document.createElement('span');
    name.className = 'god-panel__row-label';
    name.textContent = label;

    const hintEl = document.createElement('span');
    hintEl.className = 'god-panel__row-hint';
    hintEl.textContent = sub;

    text.append(name, hintEl);
    row.append(input, text);
    return { row, input };
  }

  createForceGroup(title, hint, buttons) {
    const group = document.createElement('div');
    group.className = 'god-panel__force-group';

    const head = document.createElement('div');
    head.className = 'god-panel__force-head';

    const titleEl = document.createElement('span');
    titleEl.className = 'god-panel__row-label';
    titleEl.textContent = title;

    const hintEl = document.createElement('span');
    hintEl.className = 'god-panel__row-hint';
    hintEl.textContent = hint;

    head.append(titleEl, hintEl);

    const btnRow = document.createElement('div');
    btnRow.className = 'god-panel__force-btns';

    const map = new Map();
    for (const btn of buttons) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'god-panel__force-btn';
      el.dataset.force = btn.id;
      el.textContent = btn.label;
      el.addEventListener('click', btn.onClick);
      btnRow.appendChild(el);
      map.set(btn.id, el);
    }

    group.append(head, btnRow);
    return { group, buttons: map };
  }

  syncFromSystems() {
    const dayNight = this.app?.dayNight;
    const weather = this.app?.weather;

    if (this.dayNightCycleInput && dayNight) {
      this.dayNightCycleInput.checked = dayNight.cycleEnabled;
    }

    if (this.rainCycleInput && weather) {
      this.rainCycleInput.checked = weather.cycleEnabled;
    }

    const period = dayNight?.getPeriod();
    this.forceDayBtn?.classList.toggle('god-panel__force-btn--active', period === 'day');
    this.forceNightBtn?.classList.toggle('god-panel__force-btn--active', period === 'night');

    const raining = weather && weather.intensity > 0.15;
    const forced = weather?.forcedRain;
    this.forceRainBtn?.classList.toggle(
      'god-panel__force-btn--active',
      forced === true || (forced === null && raining),
    );
    this.forceDryBtn?.classList.toggle(
      'god-panel__force-btn--active',
      forced === false || (forced === null && !raining),
    );
  }

  onDayNightCycle(enabled) {
    this.app?.dayNight?.setCycleEnabled(enabled);
    this.syncFromSystems();
  }

  onForcePeriod(period) {
    this.app?.dayNight?.setPeriod(period);
    this.syncFromSystems();
  }

  onRainCycle(enabled) {
    this.app?.weather?.setCycleEnabled(enabled);
    this.syncFromSystems();
  }

  onForceRain(raining) {
    const weather = this.app?.weather;
    if (!weather) return;
    weather.rainEnabled = true;
    weather.setForcedRain(raining);
    this.syncFromSystems();
  }

  onKeyDown(e) {
    if (e.code !== TOGGLE_KEY || e.repeat) return;
    if (this.app?.state !== 'playing') return;
    if (this.isOtherPanelOpen()) return;
    e.preventDefault();
    this.toggle();
  }

  isOtherPanelOpen() {
    return this.app.inventoryPanel?.open
      || this.app.craftingPanel?.open
      || this.app.graphicsPanel?.open;
  }

  toggle() {
    if (this.open) this.close();
    else this.openPanel();
  }

  openPanel() {
    this.syncFromSystems();
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
      const uiOpen = this.isOtherPanelOpen();
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
