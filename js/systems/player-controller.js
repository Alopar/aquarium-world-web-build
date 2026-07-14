import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { CAMERA, PHYSICS, PLAYER } from '../constants.js';
import { createAabb } from '../physics/aabb.js';
import { samplePlayerFluidState } from '../physics/fluid-query.js';
import {
  findFreeSpawnY,
  getPlayerAabb,
  resolveMovement,
} from '../physics/voxel-collision.js';

const MOVE_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'Space',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
]);

const _lookEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _PI_2 = Math.PI / 2;

export class PlayerController {
  constructor(camera, domElement, grid, sound = null, fluidField = null) {
    this.camera = camera;
    this.domElement = domElement;
    this.grid = grid;
    this.fluidField = fluidField;
    this.sound = sound;
    this.controls = new PointerLockControls(camera, domElement);
    this.keys = new Set();
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.wishVelocity = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.flatForward = new THREE.Vector3();
    this.playerAabb = createAabb();
    this.mode = 'walk';
    this.onGround = false;
    this.inFluid = false;
    this.landingImpactSpeed = 0;
    this.halfWidth = PLAYER.width * 0.5;
    /** Touch / mobile virtual controls active (no Pointer Lock). */
    this.touchMode = false;
    this.touchActive = false;

    this.onKeyDown = (e) => {
      if (e.code === 'KeyF') {
        e.preventDefault();
        this.toggleFlyMode();
        return;
      }

      if (MOVE_KEYS.has(e.code)) {
        e.preventDefault();
        this.keys.add(e.code);
      }
    };
    this.onKeyUp = (e) => {
      this.keys.delete(e.code);
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    this.resetToSpawn();
  }

  toggleFlyMode() {
    this.mode = this.mode === 'walk' ? 'fly' : 'walk';
    if (this.mode === 'fly') {
      this.velocity.set(0, 0, 0);
    }
  }

  setKey(code, down) {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  clearKeys() {
    this.keys.clear();
  }

  /**
   * Apply look delta in radians (same YXZ convention as PointerLockControls).
   */
  applyLookDelta(dx, dy) {
    _lookEuler.setFromQuaternion(this.camera.quaternion);
    _lookEuler.y -= dx;
    _lookEuler.x -= dy;
    _lookEuler.x = Math.max(-_PI_2, Math.min(_PI_2, _lookEuler.x));
    this.camera.quaternion.setFromEuler(_lookEuler);
  }

  activateTouch() {
    this.touchMode = true;
    this.touchActive = true;
  }

  deactivateTouch() {
    this.touchActive = false;
    this.clearKeys();
  }

  resetToSpawn() {
    const { x, y, z } = CAMERA.startPosition;
    const feetY = y - PLAYER.eyeHeight;
    const spawnY = findFreeSpawnY(this.grid, x, z, feetY, this.halfWidth, PLAYER.height);
    this.position.set(x, spawnY, z);
    this.velocity.set(0, 0, 0);
    this.onGround = false;
    this.inFluid = false;
    this.landingImpactSpeed = 0;
    this.syncCamera();
  }

  get canControl() {
    return this.controls.isLocked || this.touchActive;
  }

  get isLocked() {
    return this.canControl;
  }

  get modeLabel() {
    if (this.mode === 'fly') return 'полёт';
    if (this.inFluid) return 'плавание';
    return 'ходьба';
  }

  requestLock() {
    if (this.touchMode) {
      this.touchActive = true;
      return;
    }
    this.controls.lock();
  }

  unlock() {
    if (this.touchMode) {
      this.deactivateTouch();
      return;
    }
    this.controls.unlock();
  }

  /** After closing inventory/crafting on touch. */
  resumeAfterUi() {
    if (this.touchMode) {
      this.touchActive = !document.body.classList.contains('orientation-blocked');
    }
  }

  getAabb(target = this.playerAabb) {
    return getPlayerAabb(target, this.position, this.halfWidth, PLAYER.height);
  }

  syncCamera() {
    this.camera.position.set(
      this.position.x,
      this.position.y + PLAYER.eyeHeight,
      this.position.z,
    );
  }

  isSprinting() {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  getMoveSpeed(baseSpeed) {
    return baseSpeed * (this.isSprinting() ? PLAYER.sprintMultiplier : 1);
  }

  getSwimSpeed() {
    const mul = this.isSprinting() ? PLAYER.swimSprintMultiplier : 1;
    return PLAYER.swimSpeed * mul;
  }

  updateFlatDirections() {
    this.camera.getWorldDirection(this.flatForward);
    this.flatForward.y = 0;
    if (this.flatForward.lengthSq() < 1e-6) {
      this.flatForward.set(0, 0, -1);
    } else {
      this.flatForward.normalize();
    }
    this.right.crossVectors(this.flatForward, this.camera.up).normalize();
  }

  refreshFluidState() {
    const state = samplePlayerFluidState(
      this.grid,
      this.fluidField,
      this.position,
      PLAYER.height,
      PLAYER.eyeHeight,
    );
    this.inFluid = state.inFluid;
    return state;
  }

  updateSwim(dt, allowInput = true) {
    // Kill high fall speed on first contact with deep liquid.
    if (this.velocity.y < PLAYER.swimEnterDampThreshold) {
      this.velocity.y *= PLAYER.swimEnterDamp;
    }

    const drag = Math.exp(-PLAYER.swimDrag * dt);
    this.velocity.x *= drag;
    this.velocity.z *= drag;
    this.velocity.y *= Math.exp(-PLAYER.swimDrag * 0.55 * dt);

    this.velocity.y -= PLAYER.swimGravity * dt;
    this.velocity.y = Math.max(this.velocity.y, -PLAYER.swimMaxSinkSpeed);
    this.velocity.y = Math.min(this.velocity.y, PLAYER.swimMaxRiseSpeed);

    this.updateFlatDirections();

    this.wishVelocity.set(0, 0, 0);
    if (allowInput) {
      if (this.keys.has('KeyW')) this.wishVelocity.add(this.flatForward);
      if (this.keys.has('KeyS')) this.wishVelocity.sub(this.flatForward);
      if (this.keys.has('KeyA')) this.wishVelocity.sub(this.right);
      if (this.keys.has('KeyD')) this.wishVelocity.add(this.right);
    }

    const speed = this.getSwimSpeed();
    if (this.wishVelocity.lengthSq() > 0) {
      this.wishVelocity.normalize().multiplyScalar(speed);
      this.velocity.x = this.wishVelocity.x;
      this.velocity.z = this.wishVelocity.z;
    }

    const up = allowInput && this.keys.has('Space');
    const down = allowInput && (this.keys.has('ControlLeft') || this.keys.has('ControlRight'));

    if (up && !down) {
      // From the bottom, Space gives a stronger push so you can break the surface.
      this.velocity.y = this.onGround
        ? Math.max(PLAYER.swimUpSpeed, PLAYER.jumpSpeed * 0.72)
        : PLAYER.swimUpSpeed;
    } else if (down && !up) {
      this.velocity.y = -PLAYER.swimDownSpeed;
    }

    this.landingImpactSpeed = 0;
  }

  updateWalk(dt, allowInput = true) {
    this.velocity.y -= PLAYER.gravity * dt;
    this.velocity.y = Math.max(this.velocity.y, -PHYSICS.maxFallSpeed);

    this.updateFlatDirections();

    this.wishVelocity.set(0, 0, 0);
    if (allowInput) {
      if (this.keys.has('KeyW')) this.wishVelocity.add(this.flatForward);
      if (this.keys.has('KeyS')) this.wishVelocity.sub(this.flatForward);
      if (this.keys.has('KeyA')) this.wishVelocity.sub(this.right);
      if (this.keys.has('KeyD')) this.wishVelocity.add(this.right);
    }

    if (this.wishVelocity.lengthSq() > 0) {
      this.wishVelocity.normalize().multiplyScalar(this.getMoveSpeed(PLAYER.walkSpeed));
      this.velocity.x = this.wishVelocity.x;
      this.velocity.z = this.wishVelocity.z;
    } else if (this.onGround) {
      const friction = Math.max(0, 1 - PLAYER.groundFriction * dt);
      this.velocity.x *= friction;
      this.velocity.z *= friction;
    }

    if (allowInput && this.keys.has('Space') && this.onGround) {
      this.velocity.y = PLAYER.jumpSpeed;
      this.onGround = false;
      this.sound?.resume();
      this.sound?.playJump();
    }
  }

  updateFly() {
    const speed = this.getMoveSpeed(PLAYER.flySpeed);

    this.forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);

    this.velocity.set(0, 0, 0);

    if (this.keys.has('KeyW')) this.velocity.add(this.forward);
    if (this.keys.has('KeyS')) this.velocity.sub(this.forward);
    if (this.keys.has('KeyA')) this.velocity.sub(this.right);
    if (this.keys.has('KeyD')) this.velocity.add(this.right);
    if (this.keys.has('Space')) this.velocity.y += 1;
    if (this.keys.has('ControlLeft') || this.keys.has('ControlRight')) this.velocity.y -= 1;

    if (this.velocity.lengthSq() > 0) {
      this.velocity.normalize().multiplyScalar(speed);
    }
  }

  update(dt) {
    const allowInput = this.canControl;

    if (this.mode === 'fly') {
      if (!allowInput) return;
      this.inFluid = false;
      this.updateFly();
    } else {
      this.refreshFluidState();
      if (this.inFluid) {
        this.updateSwim(dt, allowInput);
      } else {
        this.updateWalk(dt, allowInput);
      }
    }

    const collision = resolveMovement(
      this.grid,
      this.position,
      this.velocity,
      this.halfWidth,
      PLAYER.height,
      dt,
    );

    this.onGround = collision.onGround;
    if (this.inFluid) {
      this.landingImpactSpeed = 0;
    } else {
      this.landingImpactSpeed = collision.landingSpeed ?? 0;
    }
    this.syncCamera();
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.controls.disconnect();
  }
}
