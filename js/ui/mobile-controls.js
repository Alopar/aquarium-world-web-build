const LOOK_SENSITIVITY = 0.0032;
const STICK_DEADZONE = 0.22;

/**
 * On-screen twin-stick + action buttons for touch devices.
 * Writes into PlayerController.keys / look and BlockInteraction dig/use.
 */
export class MobileControls {
  constructor(root, { playerController, blockInteraction, inventoryPanel, craftingPanel, graphicsPanel } = {}) {
    this.root = root;
    this.playerController = playerController ?? null;
    this.blockInteraction = blockInteraction ?? null;
    this.inventoryPanel = inventoryPanel ?? null;
    this.craftingPanel = craftingPanel ?? null;
    this.graphicsPanel = graphicsPanel ?? null;

    this.moveStick = root.querySelector('#mobile-move-stick');
    this.moveKnob = root.querySelector('#mobile-move-knob');
    this.lookPad = root.querySelector('#mobile-look-pad');
    this.actionsEl = root.querySelector('#mobile-actions');
    this.toolbarEl = root.querySelector('#mobile-toolbar');

    this._moveId = null;
    this._lookId = null;
    this._lookLast = null;
    this._heldKeys = new Set();
    this._digTimer = null;
    this._useTimer = null;
    this._visible = false;

    this._onMoveStart = this.onMoveStart.bind(this);
    this._onMoveMove = this.onMoveMove.bind(this);
    this._onMoveEnd = this.onMoveEnd.bind(this);
    this._onLookStart = this.onLookStart.bind(this);
    this._onLookMove = this.onLookMove.bind(this);
    this._onLookEnd = this.onLookEnd.bind(this);
    this._onActionDown = this.onActionDown.bind(this);
    this._onActionUp = this.onActionUp.bind(this);
    this._onToolbarClick = this.onToolbarClick.bind(this);

    this.moveStick?.addEventListener('pointerdown', this._onMoveStart);
    this.lookPad?.addEventListener('pointerdown', this._onLookStart);
    window.addEventListener('pointermove', this._onMoveMove);
    window.addEventListener('pointermove', this._onLookMove);
    window.addEventListener('pointerup', this._onMoveEnd);
    window.addEventListener('pointercancel', this._onMoveEnd);
    window.addEventListener('pointerup', this._onLookEnd);
    window.addEventListener('pointercancel', this._onLookEnd);

    this.actionsEl?.addEventListener('pointerdown', this._onActionDown);
    this.actionsEl?.addEventListener('pointerup', this._onActionUp);
    this.actionsEl?.addEventListener('pointercancel', this._onActionUp);
    this.actionsEl?.addEventListener('pointerleave', this._onActionUp);
    this.toolbarEl?.addEventListener('click', this._onToolbarClick);
  }

  setDeps({ playerController, blockInteraction, inventoryPanel, craftingPanel, graphicsPanel }) {
    if (playerController) this.playerController = playerController;
    if (blockInteraction) this.blockInteraction = blockInteraction;
    if (inventoryPanel) this.inventoryPanel = inventoryPanel;
    if (craftingPanel) this.craftingPanel = craftingPanel;
    if (graphicsPanel) this.graphicsPanel = graphicsPanel;
  }

  show() {
    this._visible = true;
    this.root.classList.remove('hidden');
    this.root.setAttribute('aria-hidden', 'false');
    this.playerController?.activateTouch?.();
  }

  hide() {
    this._visible = false;
    this.root.classList.add('hidden');
    this.root.setAttribute('aria-hidden', 'true');
    this.resetInput();
    this.playerController?.deactivateTouch?.();
  }

  /** Hide while inventory/crafting open or orientation gate blocks. */
  setGameplayActive(active) {
    if (active && this._visible) {
      this.root.classList.remove('mobile-controls--dimmed');
      this.playerController?.activateTouch?.();
    } else {
      this.root.classList.add('mobile-controls--dimmed');
      this.resetInput();
      this.playerController?.deactivateTouch?.();
    }
  }

  resetInput() {
    this.clearMove();
    this._lookId = null;
    this._lookLast = null;
    this.releaseHeldKeys();
    this.stopRepeat('_digTimer');
    this.stopRepeat('_useTimer');
  }

  releaseHeldKeys() {
    for (const code of this._heldKeys) {
      this.playerController?.setKey?.(code, false);
    }
    this._heldKeys.clear();
  }

  holdKey(code, down) {
    if (!this.playerController) return;
    if (down) {
      this._heldKeys.add(code);
      this.playerController.setKey(code, true);
    } else {
      this._heldKeys.delete(code);
      this.playerController.setKey(code, false);
    }
  }

  stopRepeat(timerKey) {
    if (this[timerKey]) {
      clearInterval(this[timerKey]);
      this[timerKey] = null;
    }
  }

  onMoveStart(e) {
    if (!this._visible || this.blockInteraction?.inputBlocked) return;
    if (this._moveId != null) return;
    e.preventDefault();
    this.moveStick.setPointerCapture?.(e.pointerId);
    this._moveId = e.pointerId;
    this.updateMove(e);
  }

  onMoveMove(e) {
    if (e.pointerId !== this._moveId) return;
    e.preventDefault();
    this.updateMove(e);
  }

  onMoveEnd(e) {
    if (e.pointerId !== this._moveId) return;
    this.clearMove();
  }

  updateMove(e) {
    const rect = this.moveStick.getBoundingClientRect();
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * 0.5;
    const radius = rect.width * 0.5;
    let dx = (e.clientX - cx) / radius;
    let dy = (e.clientY - cy) / radius;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }

    const knobR = radius * 0.42;
    if (this.moveKnob) {
      this.moveKnob.style.transform = `translate(calc(-50% + ${dx * knobR}px), calc(-50% + ${dy * knobR}px))`;
    }

    const mag = Math.hypot(dx, dy);
    const forward = mag >= STICK_DEADZONE && -dy > STICK_DEADZONE * 0.55;
    const back = mag >= STICK_DEADZONE && dy > STICK_DEADZONE * 0.55;
    const left = mag >= STICK_DEADZONE && -dx > STICK_DEADZONE * 0.55;
    const right = mag >= STICK_DEADZONE && dx > STICK_DEADZONE * 0.55;

    this.playerController?.setKey?.('KeyW', forward);
    this.playerController?.setKey?.('KeyS', back);
    this.playerController?.setKey?.('KeyA', left);
    this.playerController?.setKey?.('KeyD', right);
  }

  clearMove() {
    this._moveId = null;
    if (this.moveKnob) {
      this.moveKnob.style.transform = 'translate(-50%, -50%)';
    }
    this.playerController?.setKey?.('KeyW', false);
    this.playerController?.setKey?.('KeyS', false);
    this.playerController?.setKey?.('KeyA', false);
    this.playerController?.setKey?.('KeyD', false);
  }

  onLookStart(e) {
    if (!this._visible || this.blockInteraction?.inputBlocked) return;
    if (this._lookId != null) return;
    e.preventDefault();
    this.lookPad.setPointerCapture?.(e.pointerId);
    this._lookId = e.pointerId;
    this._lookLast = { x: e.clientX, y: e.clientY };
  }

  onLookMove(e) {
    if (e.pointerId !== this._lookId || !this._lookLast) return;
    e.preventDefault();
    const dx = e.clientX - this._lookLast.x;
    const dy = e.clientY - this._lookLast.y;
    this._lookLast = { x: e.clientX, y: e.clientY };
    this.playerController?.applyLookDelta?.(dx * LOOK_SENSITIVITY, dy * LOOK_SENSITIVITY);
  }

  onLookEnd(e) {
    if (e.pointerId !== this._lookId) return;
    this._lookId = null;
    this._lookLast = null;
  }

  onActionDown(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn || !this._visible || this.blockInteraction?.inputBlocked) return;
    e.preventDefault();
    const action = btn.dataset.action;

    if (action === 'jump') {
      this.holdKey('Space', true);
    } else if (action === 'crouch') {
      this.holdKey('ControlLeft', true);
    } else if (action === 'sprint') {
      this.holdKey('ShiftLeft', true);
    } else if (action === 'dig') {
      this.blockInteraction?.dig?.();
      this.stopRepeat('_digTimer');
        this._digTimer = setInterval(() => {
          if (this.blockInteraction?.inputBlocked) {
            this.stopRepeat('_digTimer');
            return;
          }
          this.blockInteraction?.dig?.();
        }, 220);
    } else if (action === 'use') {
      this.blockInteraction?.useSelected?.();
      this.stopRepeat('_useTimer');
      this._useTimer = setInterval(() => {
        if (this.blockInteraction?.inputBlocked) {
          this.stopRepeat('_useTimer');
          return;
        }
        this.blockInteraction?.useSelected?.();
      }, 280);
    }
  }

  onActionUp(e) {
    const btn = e.target.closest?.('[data-action]');
    const action = btn?.dataset?.action;
    if (e.type === 'pointerleave' && e.currentTarget === this.actionsEl) {
      this.holdKey('Space', false);
      this.holdKey('ControlLeft', false);
      this.holdKey('ShiftLeft', false);
      this.stopRepeat('_digTimer');
      this.stopRepeat('_useTimer');
      return;
    }
    if (!action) return;

    if (action === 'jump') this.holdKey('Space', false);
    if (action === 'crouch') this.holdKey('ControlLeft', false);
    if (action === 'sprint') this.holdKey('ShiftLeft', false);
    if (action === 'dig') this.stopRepeat('_digTimer');
    if (action === 'use') this.stopRepeat('_useTimer');
  }

  onToolbarClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    e.preventDefault();
    const action = btn.dataset.action;

    if (action === 'inventory') {
      this.inventoryPanel?.toggle?.();
    } else if (action === 'craft') {
      this.craftingPanel?.toggle?.();
    } else if (action === 'mode') {
      if (this.blockInteraction?.inputBlocked) return;
      this.blockInteraction?.togglePlaceMode?.();
    } else if (action === 'fly') {
      if (this.blockInteraction?.inputBlocked) return;
      this.playerController?.toggleFlyMode?.();
    } else if (action === 'graphics') {
      this.graphicsPanel?.toggle?.();
    }
  }

  dispose() {
    this.hide();
    this.moveStick?.removeEventListener('pointerdown', this._onMoveStart);
    this.lookPad?.removeEventListener('pointerdown', this._onLookStart);
    window.removeEventListener('pointermove', this._onMoveMove);
    window.removeEventListener('pointermove', this._onLookMove);
    window.removeEventListener('pointerup', this._onMoveEnd);
    window.removeEventListener('pointercancel', this._onMoveEnd);
    window.removeEventListener('pointerup', this._onLookEnd);
    window.removeEventListener('pointercancel', this._onLookEnd);
    this.actionsEl?.removeEventListener('pointerdown', this._onActionDown);
    this.actionsEl?.removeEventListener('pointerup', this._onActionUp);
    this.actionsEl?.removeEventListener('pointercancel', this._onActionUp);
    this.actionsEl?.removeEventListener('pointerleave', this._onActionUp);
    this.toolbarEl?.removeEventListener('click', this._onToolbarClick);
  }
}
