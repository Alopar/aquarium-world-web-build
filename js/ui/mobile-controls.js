const LOOK_STICK_SPEED = 2.6;
const MOVE_TURN_SPEED = 2.4;
const STICK_DEADZONE = 0.22;
const TAP_MOVE_THRESHOLD = 14;
const TAP_TIME_THRESHOLD = 300;

/**
 * On-screen twin-stick + action buttons for touch devices.
 * Left stick: forward/back + gradual yaw turn (no strafe).
 * Right stick: camera look; tap fires the selected action button.
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
    this.lookStick = root.querySelector('#mobile-look-stick');
    this.lookKnob = root.querySelector('#mobile-look-knob');
    this.actionSelectEl = root.querySelector('#mobile-action-select');
    this.toolbarEl = root.querySelector('#mobile-toolbar');

    this._moveId = null;
    this._moveDx = 0;
    this._moveDy = 0;
    this._lookId = null;
    this._lookDx = 0;
    this._lookDy = 0;
    this._lookTapStart = null;
    this._lookMoved = false;
    this._heldKeys = new Set();
    this._digTimer = null;
    this._useTimer = null;
    this._selectedAction = null;
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
    this.lookStick?.addEventListener('pointerdown', this._onLookStart);
    window.addEventListener('pointermove', this._onMoveMove);
    window.addEventListener('pointermove', this._onLookMove);
    window.addEventListener('pointerup', this._onMoveEnd);
    window.addEventListener('pointercancel', this._onMoveEnd);
    window.addEventListener('pointerup', this._onLookEnd);
    window.addEventListener('pointercancel', this._onLookEnd);

    this.actionSelectEl?.addEventListener('pointerdown', this._onActionDown);
    this.actionSelectEl?.addEventListener('pointerup', this._onActionUp);
    this.actionSelectEl?.addEventListener('pointercancel', this._onActionUp);
    this.actionSelectEl?.addEventListener('pointerleave', this._onActionUp);
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
    this.clearLook();
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

  selectAction(action) {
    this._selectedAction = action;
    this.actionSelectEl?.querySelectorAll('[data-action]').forEach((btn) => {
      const active = btn.dataset.action === action;
      btn.classList.toggle('mobile-action-btn--selected', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  readStickDeflection(stickEl, e) {
    const rect = stickEl.getBoundingClientRect();
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
    return { dx, dy, radius };
  }

  positionKnob(knobEl, dx, dy, radius) {
    if (!knobEl) return;
    const knobR = radius * 0.42;
    knobEl.style.transform = `translate(calc(-50% + ${dx * knobR}px), calc(-50% + ${dy * knobR}px))`;
  }

  fireAction(action, { momentary = false, repeat = false } = {}) {
    if (!this._visible || this.blockInteraction?.inputBlocked) return;

    if (action === 'jump') {
      this.holdKey('Space', true);
      if (momentary) {
        window.setTimeout(() => this.holdKey('Space', false), 80);
      }
    } else if (action === 'dig') {
      this.blockInteraction?.dig?.();
      if (repeat) {
        this.stopRepeat('_digTimer');
        this._digTimer = setInterval(() => {
          if (this.blockInteraction?.inputBlocked) {
            this.stopRepeat('_digTimer');
            return;
          }
          this.blockInteraction?.dig?.();
        }, 220);
      }
    } else if (action === 'use') {
      this.blockInteraction?.useSelected?.();
      if (repeat) {
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
  }

  releaseAction(action) {
    if (action === 'jump') this.holdKey('Space', false);
    if (action === 'dig') this.stopRepeat('_digTimer');
    if (action === 'use') this.stopRepeat('_useTimer');
  }

  tick(dt) {
    if (!this._visible || !this.playerController || this.blockInteraction?.inputBlocked) return;

    if (this._moveId != null) {
      const dx = this._moveDx;
      const dy = this._moveDy;
      const mag = Math.hypot(dx, dy);
      if (mag >= STICK_DEADZONE) {
        const turnX = Math.abs(dx) > STICK_DEADZONE * 0.35 ? dx : 0;
        if (turnX) {
          this.playerController.applyLookDelta(turnX * MOVE_TURN_SPEED * dt, 0);
        }

        const back = dy > STICK_DEADZONE * 0.35;
        const forward = !back && (
          -dy > STICK_DEADZONE * 0.35 || Math.abs(dx) > STICK_DEADZONE * 0.35
        );

        this.playerController.setKey('KeyW', forward);
        this.playerController.setKey('KeyS', back);
        this.playerController.setKey('KeyA', false);
        this.playerController.setKey('KeyD', false);
      } else {
        this.playerController.setKey('KeyW', false);
        this.playerController.setKey('KeyS', false);
      }
    }

    if (this._lookId != null) {
      const mag = Math.hypot(this._lookDx, this._lookDy);
      if (mag >= STICK_DEADZONE) {
        this.playerController.applyLookDelta(
          this._lookDx * LOOK_STICK_SPEED * dt,
          this._lookDy * LOOK_STICK_SPEED * dt,
        );
      }
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
    const { dx, dy, radius } = this.readStickDeflection(this.moveStick, e);
    this._moveDx = dx;
    this._moveDy = dy;
    this.positionKnob(this.moveKnob, dx, dy, radius);
  }

  clearMove() {
    this._moveId = null;
    this._moveDx = 0;
    this._moveDy = 0;
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
    this.lookStick.setPointerCapture?.(e.pointerId);
    this._lookId = e.pointerId;
    this._lookTapStart = { x: e.clientX, y: e.clientY, time: performance.now() };
    this._lookMoved = false;
    this.updateLook(e);
  }

  onLookMove(e) {
    if (e.pointerId !== this._lookId) return;
    e.preventDefault();
    if (this._lookTapStart) {
      const dist = Math.hypot(
        e.clientX - this._lookTapStart.x,
        e.clientY - this._lookTapStart.y,
      );
      if (dist > TAP_MOVE_THRESHOLD) this._lookMoved = true;
    }
    this.updateLook(e);
  }

  onLookEnd(e) {
    if (e.pointerId !== this._lookId) return;

    if (
      !this._lookMoved
      && this._lookTapStart
      && this._selectedAction
      && performance.now() - this._lookTapStart.time < TAP_TIME_THRESHOLD
    ) {
      this.fireAction(this._selectedAction, { momentary: true });
    }

    this.clearLook();
  }

  updateLook(e) {
    const { dx, dy, radius } = this.readStickDeflection(this.lookStick, e);
    this._lookDx = dx;
    this._lookDy = dy;
    this.positionKnob(this.lookKnob, dx, dy, radius);
  }

  clearLook() {
    this._lookId = null;
    this._lookDx = 0;
    this._lookDy = 0;
    this._lookTapStart = null;
    this._lookMoved = false;
    if (this.lookKnob) {
      this.lookKnob.style.transform = 'translate(-50%, -50%)';
    }
  }

  onActionDown(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn || !this._visible || this.blockInteraction?.inputBlocked) return;
    e.preventDefault();

    const action = btn.dataset.action;
    this.selectAction(action);
    this.fireAction(action, { repeat: action === 'dig' || action === 'use' });
  }

  onActionUp(e) {
    const btn = e.target.closest?.('[data-action]');
    const action = btn?.dataset?.action;

    if (e.type === 'pointerleave' && e.currentTarget === this.actionSelectEl) {
      this.releaseHeldKeys();
      this.stopRepeat('_digTimer');
      this.stopRepeat('_useTimer');
      return;
    }

    if (!action) return;
    this.releaseAction(action);
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
    this.lookStick?.removeEventListener('pointerdown', this._onLookStart);
    window.removeEventListener('pointermove', this._onMoveMove);
    window.removeEventListener('pointermove', this._onLookMove);
    window.removeEventListener('pointerup', this._onMoveEnd);
    window.removeEventListener('pointercancel', this._onMoveEnd);
    window.removeEventListener('pointerup', this._onLookEnd);
    window.removeEventListener('pointercancel', this._onLookEnd);
    this.actionSelectEl?.removeEventListener('pointerdown', this._onActionDown);
    this.actionSelectEl?.removeEventListener('pointerup', this._onActionUp);
    this.actionSelectEl?.removeEventListener('pointercancel', this._onActionUp);
    this.actionSelectEl?.removeEventListener('pointerleave', this._onActionUp);
    this.toolbarEl?.removeEventListener('click', this._onToolbarClick);
  }
}
