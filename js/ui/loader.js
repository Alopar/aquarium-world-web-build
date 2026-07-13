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
