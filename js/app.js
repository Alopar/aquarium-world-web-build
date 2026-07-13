import * as THREE from 'three';
import { GameHud } from './ui/hud.js';
import { Profiler } from './ui/profiler.js';
import { InventoryPanel } from './ui/inventory-panel.js';
import { CraftingPanel } from './ui/crafting-panel.js';
import { MobileControls } from './ui/mobile-controls.js';
import { OrientationGate } from './ui/orientation-gate.js';
import { GraphicsPanel } from './ui/graphics-panel.js';
import { AquariumWorld } from './world/world.js';
import {
  bindResize,
  createCamera,
  createLights,
  createRenderer,
  createScene,
} from './systems/renderer.js';
import { PlayerController } from './systems/player-controller.js';
import { PlayerHealth } from './systems/player-health.js';
import { Inventory } from './systems/inventory.js';
import { BlockInteraction } from './systems/block-interaction.js';
import { ProjectileSystem } from './systems/projectile-system.js';
import { LootSystem } from './systems/loot-system.js';
import { BombSystem } from './systems/bomb-system.js';
import { SoundSystem } from './systems/sound.js';
import { loadBlockTextures, disposeBlockTextures } from './materials/textures.js';
import { SpaceSky } from './systems/space-sky.js';
import { ParticleSystem } from './systems/particle-system.js';
import { BlockSupportSystem } from './systems/block-support.js';
import { TreeGrowthSystem } from './systems/tree-growth.js';
import { FluidSystem } from './fluids/fluid-system.js';
import { GasSystem } from './gases/gas-system.js';
import { DayNightSystem } from './systems/day-night.js';
import { WeatherSystem } from './systems/weather-system.js';
import { resolveWorldSeed, storeSeed } from './seed.js';
import { createQualitySettings } from './quality-settings.js';
import { ChunkVisibilitySystem } from './systems/chunk-visibility.js';
import { MeshMergeSystem } from './systems/mesh-merge.js';
import { applyUserFog } from './systems/fog-controller.js';
import { applyAquariumDecorEnabled } from './systems/aquarium-decor.js';

export class App {
  constructor({
    canvas,
    menuEl,
    startBtn,
    seedInput,
    hudEl,
    hotbarEl,
    placeModeEl,
    profilerEl,
    healthEls,
    dayNightEls,
    inventoryEl,
    craftingEl,
    mobileControlsEl = null,
    orientationGateEl = null,
    graphicsPanelEl = null,
    graphicsBtnEl = null,
    isMobile = false,
  }) {
    this.canvas = canvas;
    this.menuEl = menuEl;
    this.startBtn = startBtn;
    this.seedInput = seedInput;
    this.isMobile = !!isMobile;
    this.quality = createQualitySettings(this.isMobile);
    this.hud = new GameHud(hudEl, hotbarEl, placeModeEl, healthEls, dayNightEls);
    this.profiler = new Profiler(profilerEl);
    this.graphicsPanel = graphicsPanelEl ? new GraphicsPanel(graphicsPanelEl, this) : null;
    if (graphicsBtnEl) {
      graphicsBtnEl.addEventListener('click', () => {
        if (this.state === 'playing') this.graphicsPanel?.toggle();
      });
    }
    this.inventoryPanel = new InventoryPanel(inventoryEl);
    this.craftingPanel = new CraftingPanel(craftingEl, { inventoryPanel: this.inventoryPanel });
    this.inventoryPanel.setDeps({ craftingPanel: this.craftingPanel });
    this.mobileControls = this.isMobile && mobileControlsEl
      ? new MobileControls(mobileControlsEl)
      : null;
    this.orientationGate = new OrientationGate(orientationGateEl, {
      enabled: this.isMobile,
      onChange: (blocking) => this.onOrientationChange(blocking),
    });
    this.clock = new THREE.Clock();
    this.state = 'menu';
    this.unbindResize = null;
    this.playerController = null;
    this.playerHealth = null;
    this.inventory = null;
    this.blockInteraction = null;
    this.projectileSystem = null;
    this.lootSystem = null;
    this.bombSystem = null;
    this.spaceSky = null;
    this.dayNight = null;
    this.weather = null;
    this.sound = null;
    this.particleSystem = null;
    this.blockSupport = null;
    this.treeGrowth = null;
    this.fluidSystem = null;
    this.gasSystem = null;
    this.world = null;
    this.chunkVisibility = new ChunkVisibilitySystem();
    this.meshMerge = new MeshMergeSystem();
    this.running = false;

    this.onCanvasClick = () => {
      if (this.state !== 'playing') return;
      if (this.isMobile) return;
      if (this.inventoryPanel?.open || this.craftingPanel?.open) return;
      if (this.graphicsPanel?.open) return;
      if (!this.playerController?.isLocked) {
        this.playerController?.requestLock();
      }
    };

    this.onContextMenu = (e) => e.preventDefault();

    startBtn.addEventListener('click', () => this.startGame());
    this.seedInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.startGame();
    });
    canvas.addEventListener('click', this.onCanvasClick);
    canvas.addEventListener('contextmenu', this.onContextMenu);

    // Debug handle (useful for mobile perf tuning via DevTools).
    window.__app = this;
  }

  onOrientationChange(blocking) {
    if (!this.isMobile || this.state !== 'playing') return;
    const uiOpen = this.inventoryPanel?.open || this.craftingPanel?.open || this.graphicsPanel?.open;
    this.mobileControls?.setGameplayActive(!blocking && !uiOpen);
  }

  async startGame() {
    if (this.state !== 'menu') return;

    this.menuEl.classList.add('hidden');
    this.hud.show();
    this.state = 'playing';

    const lowQuality = this.quality.lowQuality;
    this.renderer = createRenderer(this.canvas, { lowQuality });
    this.scene = createScene();
    this.camera = createCamera();
    const lights = createLights(this.scene, { shadows: !lowQuality });
    this.dayNight = new DayNightSystem(this.scene, lights);

    await loadBlockTextures();

    this.world = new AquariumWorld(this.scene, { quality: this.quality });
    this.world.createTank();
    const seed = resolveWorldSeed(this.seedInput.value);
    storeSeed(seed);
    const treePlans = this.world.generate(seed);

    this.sound = new SoundSystem();
    this.particleSystem = new ParticleSystem(this.scene);
    this.blockSupport = new BlockSupportSystem(this.world, this.particleSystem, this.sound);
    this.world.setBlockSupport(this.blockSupport);
    this.treeGrowth = new TreeGrowthSystem(this.world);
    this.world.setTreeGrowth(this.treeGrowth);
    this.treeGrowth.loadPlans(treePlans);
    this.fluidSystem = new FluidSystem(this.world, {
      maxTicksPerFrame: this.quality.fluidTicksPerFrame,
    });
    this.world.setFluidSystem(this.fluidSystem);
    this.gasSystem = new GasSystem(this.world, {
      maxTicksPerFrame: this.quality.gasTicksPerFrame,
    });
    this.world.setGasSystem(this.gasSystem);
    this.playerController = new PlayerController(
      this.camera,
      this.canvas,
      this.world.grid,
      this.sound,
      this.world.fluidField,
    );
    this.playerHealth = new PlayerHealth(this.playerController, this.sound);
    this.spaceSky = await SpaceSky.create(this.scene);
    this.weather = new WeatherSystem(this.world, this.scene, this.particleSystem, this.sound, {
      rainEnabled: this.quality.rainEnabled,
    });
    this.inventory = new Inventory();
    this.playerHealth.setInventory(this.inventory);
    this.blockInteraction = new BlockInteraction(
      this.world,
      this.camera,
      this.canvas,
      this.playerController,
      this.inventory,
      this.sound,
      null,
      this.particleSystem,
    );
    this.projectileSystem = new ProjectileSystem(
      this.scene,
      this.world,
      this.playerController,
      this.blockInteraction,
      this.sound,
    );
    this.lootSystem = new LootSystem(
      this.scene,
      this.world,
      this.playerController,
      this.blockInteraction,
      this.sound,
    );
    this.bombSystem = new BombSystem(
      this.scene,
      this.world,
      this.playerController,
      this.playerHealth,
      this.particleSystem,
      this.sound,
      this.lootSystem,
    );
    this.blockSupport.projectileSystem = this.projectileSystem;
    this.blockSupport.lootSystem = this.lootSystem;
    this.blockInteraction.projectileSystem = this.projectileSystem;
    this.blockInteraction.lootSystem = this.lootSystem;
    this.blockInteraction.bombSystem = this.bombSystem;
    // Key 6 → index 5: bombs; key 7 → lumen; key 8 → water; key 9 → smoke
    this.blockInteraction.setSlot(5, 'bomb', 16);
    this.blockInteraction.setSlot(6, 'lumen', 99);
    this.blockInteraction.setSlot(7, 'water', 99);
    this.blockInteraction.setSlot(8, 'smoke', 99);
    // Starter gear already equipped
    this.inventory.equipment.mainhand = { materialId: 'club', count: 1 };
    this.inventory.equipment.chest = { materialId: 'shirt', count: 1 };
    this.inventory.equipment.legs = { materialId: 'pants', count: 1 };
    this.inventory.notify();
    this.hud.bind(this.blockInteraction);
    this.hud.bindInventory(this.inventory);
    this.hud.bindHealth(this.playerHealth);
    this.inventoryPanel.setDeps({
      playerController: this.playerController,
      blockInteraction: this.blockInteraction,
      craftingPanel: this.craftingPanel,
    });
    this.inventoryPanel.bind(this.inventory);
    this.craftingPanel.setDeps({
      playerController: this.playerController,
      blockInteraction: this.blockInteraction,
      inventoryPanel: this.inventoryPanel,
    });
    this.craftingPanel.bind(this.inventory);

    if (this.mobileControls) {
      this.mobileControls.setDeps({
        playerController: this.playerController,
        blockInteraction: this.blockInteraction,
        inventoryPanel: this.inventoryPanel,
        craftingPanel: this.craftingPanel,
        graphicsPanel: this.graphicsPanel,
      });
      this.mobileControls.show();
      const hint = document.getElementById('hud-hint');
      if (hint) {
        hint.textContent = 'Стик — ходьба · зона справа — обзор · кнопки — действия';
      }
      this.onOrientationChange(this.orientationGate?.isBlocking ?? false);
    }

    this.unbindResize = bindResize(this.renderer, this.camera);
    // Warm MeshStandard shaders with the fixed block-light pool so placing
    // lumen mid-game does not trigger a WebGL program recompile hitch.
    this.renderer.compile(this.scene, this.camera);
    this.meshMerge.attach(this.world.meshBuilder);
    this.meshMerge.setEnabled(this.quality.chunkMeshMerge !== false, this.world.meshBuilder);
    applyAquariumDecorEnabled(this, this.quality.aquariumDecorEnabled !== false);
    this.chunkVisibility.update(this.camera, this.world, this.quality, { force: true });
    this.running = true;
    this.clock.start();
    this.animate();
  }

  animate() {
    if (!this.running) return;

    requestAnimationFrame(() => this.animate());

    const t0 = performance.now();
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.blockSupport?.update(dt);
    this.treeGrowth?.update(dt);
    this.fluidSystem?.update(dt);
    this.world?.fluidMeshBuilder?.update(dt);
    this.gasSystem?.update(dt);
    this.world?.gasMeshBuilder?.update(dt, this.camera);
    this.world?.grassFoliageBuilder?.update(dt);
    this.playerController?.update(dt);
    this.playerHealth?.update(dt);
    this.projectileSystem?.update(dt);
    this.lootSystem?.update(dt);
    this.bombSystem?.update(dt);
    this.spaceSky?.update(this.camera);
    this.dayNight?.update(dt, this.playerController, this.spaceSky, this.world?.fluidField);
    this.weather?.update(dt, this.playerController, this.dayNight);
    applyUserFog(this.scene, this.quality);
    this.hud.updateDayNight(this.dayNight);
    this.blockInteraction?.updateHighlight(this.scene);
    this.particleSystem?.update(dt);
    this.chunkVisibility?.update(this.camera, this.world, this.quality);
    this.meshMerge?.syncVisibility(this.world?.meshBuilder);
    this.meshMerge?.update(this.world?.meshBuilder, this.quality);
    const updateMs = performance.now() - t0;

    this.renderer.render(this.scene, this.camera);

    this.profiler.frame({
      dt,
      updateMs,
      world: this.world,
      renderer: this.renderer,
      playerController: this.playerController,
      meshMerge: this.meshMerge,
    });
  }

  dispose() {
    this.running = false;
    this.canvas.removeEventListener('click', this.onCanvasClick);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.unbindResize?.();
    this.mobileControls?.dispose();
    this.orientationGate?.dispose();
    this.blockInteraction?.dispose();
    this.blockSupport?.dispose();
    this.treeGrowth?.dispose();
    this.projectileSystem?.dispose();
    this.lootSystem?.dispose();
    this.bombSystem?.dispose();
    this.weather?.dispose();
    this.particleSystem?.dispose();
    this.sound?.dispose();
    this.playerController?.dispose();
    this.spaceSky?.dispose();
    this.world?.dispose();
    disposeBlockTextures();
    this.inventoryPanel?.dispose();
    this.craftingPanel?.dispose();
    this.hud.dispose();
    this.profiler.dispose();
    this.graphicsPanel?.dispose();
    this.meshMerge?.dispose(this.world?.meshBuilder);
    this.renderer?.dispose();
  }
}
