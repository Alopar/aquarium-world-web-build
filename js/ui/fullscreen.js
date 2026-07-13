function getFullscreenElement() {
  return document.fullscreenElement
    || document.webkitFullscreenElement
    || null;
}

function canFullscreen() {
  const el = document.documentElement;
  return !!(el.requestFullscreen || el.webkitRequestFullscreen);
}

export function isFullscreen() {
  return !!getFullscreenElement();
}

export async function toggleFullscreen() {
  if (!canFullscreen()) return false;

  if (isFullscreen()) {
    if (document.exitFullscreen) await document.exitFullscreen();
    else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
    return false;
  }

  const el = document.documentElement;
  if (el.requestFullscreen) await el.requestFullscreen();
  else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
  return true;
}

/**
 * Side fullscreen control for the main menu.
 * @param {HTMLButtonElement | null} button
 */
export function bindFullscreenButton(button) {
  if (!button) return () => {};

  if (!canFullscreen()) {
    button.hidden = true;
    return () => {};
  }

  const sync = () => {
    const on = isFullscreen();
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    button.title = on ? 'Выйти из полноэкранного режима' : 'На весь экран';
    button.textContent = on ? '⧉' : '⛶';
  };

  const onClick = async () => {
    try {
      await toggleFullscreen();
    } catch {
      // Browser may reject without a recent user gesture or on unsupported devices.
    }
    sync();
  };

  button.addEventListener('click', onClick);
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  sync();

  return () => {
    button.removeEventListener('click', onClick);
    document.removeEventListener('fullscreenchange', sync);
    document.removeEventListener('webkitfullscreenchange', sync);
  };
}
