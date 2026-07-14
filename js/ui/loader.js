const FADE_MS = 220;

function preloadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

function waitForFonts() {
  if (document.fonts?.ready) return document.fonts.ready;
  return Promise.resolve();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runBootLoader({ loaderEl, menuEl }) {
  await Promise.all([
    preloadImage('assets/menu-bg.png'),
    waitForFonts(),
  ]);

  loaderEl.classList.add('loader--out');
  await delay(FADE_MS);

  loaderEl.classList.add('hidden');
  menuEl.classList.remove('hidden');
}

export class GameLoader {
  constructor(loaderEl) {
    this.loaderEl = loaderEl;
    this.statusEl = loaderEl?.querySelector('.loader-status');
    this.progressEl = loaderEl?.querySelector('.loader-progress__bar');
  }

  show() {
    if (!this.loaderEl) return;
    this.loaderEl.classList.remove('hidden', 'loader--out');
    this.setProgress(0);
    this.setStatus('Подготовка...');
  }

  setStatus(text) {
    if (this.statusEl) this.statusEl.textContent = text;
  }

  setProgress(ratio) {
    if (this.progressEl) {
      const pct = Math.max(0, Math.min(100, ratio * 100));
      this.progressEl.style.width = `${pct}%`;
    }
  }

  tick() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }

  async hide() {
    if (!this.loaderEl) return;
    this.setProgress(1);
    this.setStatus('Готово');
    this.loaderEl.classList.add('loader--out');
    await delay(FADE_MS);
    this.loaderEl.classList.add('hidden');
    this.loaderEl.classList.remove('loader--out');
  }
}
