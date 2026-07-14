const LOOK_SENSITIVITY = 0.0032;
const MOVE_TURN_SPEED = 2.4;
const STICK_DEADZONE = 0.22;

/**
 * Touch controls: left half = floating move stick, right half = look pad + action buttons.
 */
export class MobileControls {
  constructor(root, { touchRoot = null, playerController, blockInteraction, inventoryPanel, craftingPanel, graphicsPanel, godPanel } = {}) {
    this.root = root;
    this.touchRoot = touchRoot ?? document.getElementById('mobile-touch-zones');
    this.playerController = playerController ?? null;
    this.blockInteraction = blockInteraction ?? null;
    this.inventoryPanel = inventoryPanel ?? null;
    this.craftingPanel = craftingPanel ?? null;
    this.graphicsPanel = graphicsPanel ?? null;
    this.godPanel = godPanel ?? null;

    this.movePad = this.touchRoot?.querySelector('#mobile-move-pad');
    this.lookPad = this.touchRoot?.querySelector('#mobile-look-pad');
    this.moveStick = this.touchRoot?.querySelector('#mobile-move-stick');
    this.moveKnob = this.touchRoot?.querySelector('#mobile-move-knob');
    this.actionSelectEl = root.querySelector('#mobile-action-select');
    this.toolbarEl = root.querySelector('#mobile-toolbar');

    this._moveId = null;
    this._moveAnchor = null;
    this._moveRadius = 59;
    this._moveDx = 0;
    this._moveDy = 0;
    this._lookId = null;
    this._lookLast = null;
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

    this.movePad?.addEventListener('pointerdown', this._onMoveStart);
    this.lookPad?.addEventListener('pointerdown', this._onLookStart);
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

  setDeps({ playerController, blockInteraction, inventoryPanel, craftingPanel, graphicsPanel, godPanel }) {
    if (playerController) this.playerController = playerController;
    if (blockInteraction) this.blockInteraction = blockInteraction;
    if (inventoryPanel) this.inventoryPanel = inventoryPanel;
    if (craftingPanel) this.craftingPanel = craftingPanel;
    if (graphicsPanel) this.graphicsPanel = graphicsPanel;
    if (godPanel) this.godPanel = godPanel;
  }

  show() {
    this._visible = true;
    this.root.classList.remove('hidden');
    this.root.setAttribute('aria-hidden', 'false');
    this.touchRoot?.classList.remove('hidden');
    this.touchRoot?.setAttribute('aria-hidden', 'false');
    this.refreshMoveRadius();
    this.playerController?.activateTouch?.();
  }

  hide() {
    this._visible = false;
    this.root.classList.add('hidden');
    this.root.setAttribute('aria-hidden', 'true');
    this.touchRoot?.classList.add('hidden');
    this.touchRoot?.setAttribute('aria-hidden', 'true');
    this.resetInput();
    this.playerController?.deactivateTouch?.();
  }

  setLayerClass(className, add) {
    for (const el of [this.root, this.touchRoot]) {
      el?.classList.toggle(className, add);
    }
  }

  setGameplayActive(active) {
    if (active && this._visible) {
      this.setLayerClass('mobile-controls--dimmed', false);
      this.playerController?.activateTouch?.();
    } else {
      this.setLayerClass('mobile-controls--dimmed', true);
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

  refreshMoveRadius() {
    if (!this.moveStick) return;
    const rect = this.moveStick.getBoundingClientRect();
    this._moveRadius = rect.width * 0.5;
  }

  selectAction(action) {
    this._selectedAction = action;
    this.actionSelectEl?.querySelectorAll('[data-action]').forEach((btn) => {
      const active = btn.dataset.action === action;
      btn.classList.toggle('mobile-action-btn--selected', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  readVirtualStickDeflection(e) {
    if (!this._moveAnchor) return { dx: 0, dy: 0 };

    let dx = (e.clientX - this._moveAnchor.x) / this._moveRadius;
    let dy = (e.clientY - this._moveAnchor.y) / this._moveRadius;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    return { dx, dy };
  }

  positionKnob(dx, dy) {
    if (!this.moveKnob) return;
    const knobR = this._moveRadius * 0.42;
    this.moveKnob.style.transform = `translate(calc(-50% + ${dx * knobR}px), calc(-50% + ${dy * knobR}px))`;
  }

  fireAction(action, { repeat = false } = {}) {
    if (!this._visible || this.blockInteraction?.inputBlocked) return;

    if (action === 'jump') {
      this.holdKey('Space', true);
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
    if (this._moveId == null) return;

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

  onMoveStart(e) {
    if (!this._visible || this.blockInteraction?.inputBlocked) return;
    if (this._moveId != null) return;
    e.preventDefault();
    this.refreshMoveRadius();
    this.movePad.setPointerCapture?.(e.pointerId);
    this._moveId = e.pointerId;
    this._moveAnchor = { x: e.clientX, y: e.clientY };
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
    const { dx, dy } = this.readVirtualStickDeflection(e);
    this._moveDx = dx;
    this._moveDy = dy;
    this.positionKnob(dx, dy);
  }

  clearMove() {
    this._moveId = null;
    this._moveAnchor = null;
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
    if (e.target.closest('.mobile-action-btn, .mobile-toolbar, .mobile-tool')) return;
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
    this.clearLook();
  }

  clearLook() {
    this._lookId = null;
    this._lookLast = null;
  }

  onActionDown(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn || !this._visible || this.blockInteraction?.inputBlocked) return;
    e.preventDefault();
    e.stopPropagation();

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
    e.stopPropagation();
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
    } else if (action === 'god') {
      this.godPanel?.toggle?.();
    }
  }

  dispose() {
    this.hide();
    this.movePad?.removeEventListener('pointerdown', this._onMoveStart);
    this.lookPad?.removeEventListener('pointerdown', this._onLookStart);
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
