import * as THREE from 'three';
import { HOTBAR_SLOTS, RAYCAST_MAX_DISTANCE, VOXEL_SIZE } from '../constants.js';
import { hasDrops, isBreakable, isCollectible, isPlaceable, isResourceBlock, isSolid } from '../materials/registry.js';
import { isExplosive, isItem } from '../items/registry.js';
import { getFluid } from '../fluids/registry.js';
import { getGas } from '../gases/registry.js';
import { blockIntersectsPlayerAabb } from '../physics/voxel-collision.js';

export function voxelRaycast(origin, direction, grid, maxDistance = RAYCAST_MAX_DISTANCE) {
  const ox = origin.x / VOXEL_SIZE;
  const oy = origin.y / VOXEL_SIZE;
  const oz = origin.z / VOXEL_SIZE;

  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);

  const dx = direction.x;
  const dy = direction.y;
  const dz = direction.z;

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;

  const frac = (v) => v - Math.floor(v);

  let tMaxX = stepX > 0 ? (1 - frac(ox)) * tDeltaX : stepX < 0 ? frac(ox) * tDeltaX : Infinity;
  let tMaxY = stepY > 0 ? (1 - frac(oy)) * tDeltaY : stepY < 0 ? frac(oy) * tDeltaY : Infinity;
  let tMaxZ = stepZ > 0 ? (1 - frac(oz)) * tDeltaZ : stepZ < 0 ? frac(oz) * tDeltaZ : Infinity;

  let faceX = 0;
  let faceY = 0;
  let faceZ = 0;
  let traveled = 0;

  const maxSteps = Math.ceil(maxDistance / VOXEL_SIZE) + 2;

  for (let i = 0; i < maxSteps; i++) {
    if (!grid.inBounds(x, y, z)) break;

    const id = grid.get(x, y, z);
    if (isSolid(id)) {
      return {
        block: { x, y, z },
        face: { x: x + faceX, y: y + faceY, z: z + faceZ },
        materialId: id,
      };
    }

    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        traveled = tMaxX;
        if (traveled > maxDistance) break;
        x += stepX;
        faceX = -stepX;
        faceY = 0;
        faceZ = 0;
        tMaxX += tDeltaX;
      } else {
        traveled = tMaxZ;
        if (traveled > maxDistance) break;
        z += stepZ;
        faceX = 0;
        faceY = 0;
        faceZ = -stepZ;
        tMaxZ += tDeltaZ;
      }
    } else if (tMaxY < tMaxZ) {
      traveled = tMaxY;
      if (traveled > maxDistance) break;
      y += stepY;
      faceX = 0;
      faceY = -stepY;
      faceZ = 0;
      tMaxY += tDeltaY;
    } else {
      traveled = tMaxZ;
      if (traveled > maxDistance) break;
      z += stepZ;
      faceX = 0;
      faceY = 0;
      faceZ = -stepZ;
      tMaxZ += tDeltaZ;
    }
  }

  return null;
}

export class BlockInteraction {
  constructor(world, camera, canvas, playerController, inventory, sound = null, projectileSystem = null, particleSystem = null, lootSystem = null, bombSystem = null) {
    this.world = world;
    this.camera = camera;
    this.canvas = canvas;
    this.playerController = playerController;
    this.inventory = inventory;
    this.sound = sound;
    this.projectileSystem = projectileSystem;
    this.particleSystem = particleSystem;
    this.lootSystem = lootSystem;
    this.bombSystem = bombSystem;
    this.placeMode = 'place';
    this.highlight = null;
    this.listeners = new Set();
    /** When true, ignore dig/place and hotbar keys (inventory panel open). */
    this.inputBlocked = false;

    this.onMouseDown = this.onMouseDown.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('keydown', this.onKeyDown);
  }

  get slots() {
    return this.inventory.hotbar;
  }

  get selectedSlot() {
    return this.inventory.selectedSlot;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    for (const fn of this.listeners) fn();
  }

  get placeModeLabel() {
    return this.placeMode === 'place' ? 'ставить' : 'бросать';
  }

  togglePlaceMode() {
    this.placeMode = this.placeMode === 'place' ? 'throw' : 'place';
    this.notify();
  }

  canAcceptGameplayInput() {
    if (this.inputBlocked) return false;
    if (this.playerController?.touchActive) return true;
    return document.pointerLockElement === this.canvas;
  }

  dig() {
    if (!this.canAcceptGameplayInput()) return;
    this.sound?.resume();

    const hit = this.getTarget();
    if (!hit) return;
    const { x, y, z } = hit.block;
    const { materialId } = hit;
    if (!isBreakable(materialId)) return;
    if (this.world.setBlock(x, y, z, 'air')) {
      this.sound?.playBlockBreak(materialId);
      this.particleSystem?.spawnBlockBreak(x, y, z, materialId);
      if (isResourceBlock(materialId) || hasDrops(materialId)) {
        this.lootSystem?.spawnBurst(materialId, x, y, z);
      } else if (isCollectible(materialId)) {
        this.addToInventory(materialId);
      }
    }
  }

  useSelected() {
    if (!this.canAcceptGameplayInput()) return;
    this.sound?.resume();

    const materialId = this.getSelectedMaterial();
    if (!materialId) return;

    if (isItem(materialId)) {
      const direction = new THREE.Vector3();
      this.camera.getWorldDirection(direction);

      if (isExplosive(materialId)) {
        if (!this.bombSystem) return;
        if (this.bombSystem.throw(this.camera.position, direction)) {
          this.removeFromSelectedSlot();
        }
        return;
      }

      if (!this.lootSystem) return;
      if (this.lootSystem.throw(materialId, this.camera.position, direction)) {
        this.removeFromSelectedSlot();
      }
      return;
    }

    if (!isPlaceable(materialId)) return;

    if (this.placeMode === 'throw') {
      if (!this.projectileSystem) return;
      const direction = new THREE.Vector3();
      this.camera.getWorldDirection(direction);
      if (this.projectileSystem.throw(materialId, this.camera.position, direction)) {
        this.removeFromSelectedSlot();
      }
      return;
    }

    const hit = this.getTarget();
    if (!hit) return;
    const { x, y, z } = hit.face;
    if (!this.world.grid.inBounds(x, y, z)) return;
    const targetId = this.world.getBlock(x, y, z);
    if (targetId !== 'air' && !getFluid(targetId) && !getGas(targetId)) return;
    if (this.wouldIntersectPlayer(x, y, z)) return;

    const fluid = getFluid(materialId);
    const gas = getGas(materialId);
    let placed = false;
    if (fluid) {
      placed = this.world.setFluid(x, y, z, materialId, fluid.maxVolume);
    } else if (gas) {
      placed = this.world.setGas(x, y, z, materialId, gas.maxVolume);
    } else {
      placed = this.world.setBlock(x, y, z, materialId);
    }

    if (placed) {
      this.sound?.playBlockPlace(materialId);
      this.removeFromSelectedSlot();
    }
  }

  getSelectedMaterial() {
    return this.inventory.getSelectedMaterial();
  }

  /**
   * Seed a hotbar slot (0-based). Used for starting fluids / tools.
   */
  setSlot(index, materialId, count) {
    this.inventory.setHotbarSlot(index, materialId, count);
  }

  addToInventory(materialId, amount = 1, options = {}) {
    return this.inventory.add(materialId, amount, options);
  }

  removeFromSelectedSlot(amount = 1) {
    return this.inventory.removeFromSelected(amount);
  }

  selectSlot(index) {
    this.inventory.selectSlot(index);
  }

  getTarget() {
    const origin = this.camera.position.clone();
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    return voxelRaycast(origin, direction, this.world.grid);
  }

  updateHighlight(scene) {
    if (this.inputBlocked) {
      if (this.highlight) this.highlight.visible = false;
      return;
    }

    const hit = this.getTarget();

    if (!this.highlight) {
      const geometry = new THREE.BoxGeometry(VOXEL_SIZE * 1.002, VOXEL_SIZE * 1.002, VOXEL_SIZE * 1.002);
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.25,
        wireframe: true,
        depthTest: true,
      });
      this.highlight = new THREE.Mesh(geometry, material);
      scene.add(this.highlight);
    }

    if (hit) {
      this.highlight.visible = true;
      this.highlight.position.set(
        hit.block.x * VOXEL_SIZE + VOXEL_SIZE * 0.5,
        hit.block.y * VOXEL_SIZE + VOXEL_SIZE * 0.5,
        hit.block.z * VOXEL_SIZE + VOXEL_SIZE * 0.5,
      );
    } else {
      this.highlight.visible = false;
    }
  }

  wouldIntersectPlayer(x, y, z) {
    if (!this.playerController) return false;
    const playerAabb = this.playerController.getAabb();
    return blockIntersectsPlayerAabb(playerAabb, x, y, z, VOXEL_SIZE);
  }

  onMouseDown(e) {
    // Touch devices use on-screen buttons; ignore synthetic mouse from the canvas.
    if (this.playerController?.touchMode) return;
    if (!this.canAcceptGameplayInput()) return;

    if (e.button === 0) {
      this.dig();
    } else if (e.button === 2) {
      this.useSelected();
    }
  }

  onKeyDown(e) {
    if (this.inputBlocked) return;

    if (e.code === 'KeyQ') {
      e.preventDefault();
      this.togglePlaceMode();
      return;
    }

    if (e.code.startsWith('Digit')) {
      const num = Number(e.code.replace('Digit', ''));
      if (num >= 1 && num <= HOTBAR_SLOTS) {
        this.selectSlot(num - 1);
      }
    }
  }

  dispose() {
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('keydown', this.onKeyDown);
    this.highlight?.parent?.remove(this.highlight);
    this.highlight?.geometry?.dispose();
    this.highlight?.material?.dispose();
  }
}
