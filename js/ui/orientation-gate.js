import { isLandscape } from '../systems/input-mode.js';

/**
 * Full-screen prompt: rotate device to landscape (mobile only).
 */
export class OrientationGate {
  constructor(root, { enabled = false, onChange = null } = {}) {
    this.root = root;
    this.enabled = enabled;
    this.onChange = onChange;
    this._onViewport = this.refresh.bind(this);

    if (!enabled || !root) return;

    window.addEventListener('resize', this._onViewport);
    window.addEventListener('orientationchange', this._onViewport);
    if (screen.orientation?.addEventListener) {
      screen.orientation.addEventListener('change', this._onViewport);
    }
    this.refresh();
  }

  get isBlocking() {
    return this.enabled && !isLandscape();
  }

  refresh() {
    if (!this.enabled || !this.root) return;

    const block = !isLandscape();
    this.root.classList.toggle('hidden', !block);
    this.root.setAttribute('aria-hidden', block ? 'false' : 'true');
    document.body.classList.toggle('orientation-blocked', block);
    this.onChange?.(block);
  }

  dispose() {
    if (!this.enabled) return;
    window.removeEventListener('resize', this._onViewport);
    window.removeEventListener('orientationchange', this._onViewport);
    if (screen.orientation?.removeEventListener) {
      screen.orientation.removeEventListener('change', this._onViewport);
    }
  }
}
