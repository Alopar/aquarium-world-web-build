import * as THREE from 'three';
import { GameHud } from './ui/hud.js';
import { Profiler } from './ui/profiler.js';
import { BlockDebugPanel } from './ui/block-debug-panel.js';
import { InventoryPanel } from './ui/inventory-panel.js';
import { CraftingPanel } from './ui/crafting-panel.js';
import { MobileControls } from './ui/mobile-controls.js';
import { OrientationGate } from './ui/orientation-gate.js';
import { GraphicsPanel } from './ui/graphics-panel.js';
import { GodPanel } from './ui/god-panel.js';
import { AquariumWorld } from './world/world.js';
import {
  bindResize,
  createCamera,
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
import { applyUserFog } from './systems/fog-controller.js';
import { applyAquariumDecorEnabled } from './systems/aquarium-decor.js';
import { applyPixelScale } from './systems/pixel-scale.js';
import { GameLoader } from './ui/loader.js';
import { tickBrightnessTime } from './shaders/voxel-brightness-material.js';

export class App {
  constructor({
    canvas,
    loaderEl = null,
    menuEl,
    startBtn,
    seedInput,
    hudEl,
    hotbarEl,
    placeModeEl,
    profilerEl,
    blockDebugEl = null,
    healthEls,
    dayNightEls,
    inventoryEl,
    craftingEl,
    mobileControlsEl = null,
    orientationGateEl = null,
    graphicsPanelEl = null,
    godPanelEl = null,
    graphicsBtnEl = null,
    isMobile = false,
  }) {
    this.canvas = canvas;
    this.loaderEl = loaderEl;
    this.gameLoader = loaderEl ? new GameLoader(loaderEl) : null;
    this.menuEl = menuEl;
    this.startBtn = startBtn;
    this.seedInput = seedInput;
    this.isMobile = !!isMobile;
    this.quality = createQualitySettings(this.isMobile);
    this.hud = new GameHud(hudEl, hotbarEl, placeModeEl, healthEls, dayNightEls);
    this.profiler = new Profiler(profilerEl);
    this.blockDebug = blockDebugEl ? new BlockDebugPanel(blockDebugEl) : null;
    this.graphicsPanel = graphicsPanelEl ? new GraphicsPanel(graphicsPanelEl, this) : null;
    this.godPanel = godPanelEl ? new GodPanel(godPanelEl, this) : null;
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
    this.running = false;

    this.onCanvasClick = () => {
      if (this.state !== 'playing') return;
      if (this.isMobile) return;
      if (this.inventoryPanel?.open || this.craftingPanel?.open) return;
      if (this.graphicsPanel?.open || this.godPanel?.open) return;
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
    const uiOpen = this.inventoryPanel?.open || this.craftingPanel?.open
      || this.graphicsPanel?.open || this.godPanel?.open;
    this.mobileControls?.setGameplayActive(!blocking && !uiOpen);
  }

  async startGame() {
    if (this.state !== 'menu') return;

    this.menuEl.classList.add('hidden');
    this.gameLoader?.show();
    this.state = 'loading';

    const load = this.gameLoader;
    const step = async (progress, status, fn) => {
      load?.setProgress(progress);
      load?.setStatus(status);
      await load?.tick();
      return fn();
    };

    const lowQuality = this.quality.lowQuality;

    await step(0.05, 'Инициализация рендера...', () => {
      this.renderer = createRenderer(this.canvas, { lowQuality });
      this.scene = createScene();
      this.camera = createCamera();
      this.dayNight = new DayNightSystem(this.scene);
    });

    await step(0.15, 'Загрузка текстур...', () => loadBlockTextures());

    const seed = resolveWorldSeed(this.seedInput.value);
    storeSeed(seed);

    await step(0.35, 'Создание аквариума...', () => {
      this.world = new AquariumWorld(this.scene, { quality: this.quality });
      this.world.createTank();
    });

    let treePlans;
    await step(0.55, 'Генерация мира...', () => {
      treePlans = this.world.generate(seed);
    });

    await step(0.7, 'Подготовка симуляции...', () => {
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
    });

    await step(0.82, 'Загрузка окружения...', async () => {
      this.spaceSky = await SpaceSky.create(this.scene);
      this.weather = new WeatherSystem(this.world, this.scene, this.particleSystem, this.sound, {
        rainEnabled: this.quality.rainEnabled,
      });
    });

    await step(0.9, 'Настройка управления...', () => {
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
      this.blockInteraction.setSlot(5, 'bomb', 16);
      this.blockInteraction.setSlot(6, 'lumen', 99);
      this.blockInteraction.setSlot(7, 'water', 99);
      this.blockInteraction.setSlot(8, 'smoke', 99);
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
          godPanel: this.godPanel,
        });
        this.mobileControls.show();
        const hint = document.getElementById('hud-hint');
        if (hint) {
          hint.textContent = 'Стик — ходьба · зона справа — обзор · кнопки — действия';
        }
      }
    });

    await step(0.97, 'Финальная подготовка...', () => {
      this.unbindResize = bindResize(this.renderer, this.camera, () => {
        applyPixelScale(this.renderer, this.quality.pixelScale, this.quality.lowQuality);
      });
      applyPixelScale(this.renderer, this.quality.pixelScale, this.quality.lowQuality);
      this.renderer.compile(this.scene, this.camera);
      applyAquariumDecorEnabled(this, this.quality.aquariumDecorEnabled !== false);
      this.chunkVisibility.update(this.camera, this.world, this.quality, { force: true });
    });

    await load?.hide();
    this.hud.show();
    this.state = 'playing';

    if (this.mobileControls) {
      this.onOrientationChange(this.orientationGate?.isBlocking ?? false);
    }

    this.running = true;
    this.clock.start();
    this.animate();
  }

  animate() {
    if (!this.running) return;

    requestAnimationFrame(() => this.animate());

    const t0 = performance.now();
    const dt = Math.min(this.clock.getDelta(), 0.05);
    tickBrightnessTime(dt);
    this.world?.update(dt);
    this.blockSupport?.update(dt);
    this.treeGrowth?.update(dt);
    this.fluidSystem?.update(dt);
    this.world?.fluidMeshBuilder?.update(dt);
    this.gasSystem?.update(dt);
    this.world?.grassFoliageBuilder?.update(dt);
    this.playerController?.update(dt);
    this.mobileControls?.tick(dt);
    this.playerHealth?.update(dt);
    this.blockInteraction?.updateHeldLight?.();
    this.projectileSystem?.update(dt);
    this.lootSystem?.update(dt);
    this.bombSystem?.update(dt);
    this.world?.lighting?.tickDynamicLights(dt);
    this.spaceSky?.update(this.camera);
    this.dayNight?.update(dt, this.playerController, this.spaceSky, this.world?.fluidField, this.world);
    this.weather?.update(dt, this.playerController, this.dayNight);
    applyUserFog(this.scene, this.quality);
    this.hud.updateDayNight(this.dayNight);
    this.blockInteraction?.updateHighlight(this.scene);
    this.particleSystem?.update(dt);
    this.chunkVisibility?.update(this.camera, this.world, this.quality);
    const updateMs = performance.now() - t0;

    this.renderer.render(this.scene, this.camera);

    this.profiler.frame({
      dt,
      updateMs,
      world: this.world,
      renderer: this.renderer,
      playerController: this.playerController,
    });

    if (this.blockDebug) {
      const hit = this.state === 'playing' && !this.blockInteraction?.inputBlocked
        ? this.blockInteraction?.getTarget?.() ?? null
        : null;
      this.blockDebug.update({
        hit,
        world: this.world,
        dayAmount: this.dayNight?.skyLightFactor ?? 1,
      });
    }
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
    this.blockDebug?.dispose();
    this.graphicsPanel?.dispose();
    this.godPanel?.dispose();
    this.renderer?.dispose();
  }
}
