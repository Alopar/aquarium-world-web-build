import { App } from './app.js';
import { loadStoredSeed } from './seed.js';
import { detectMobileInput } from './systems/input-mode.js';
import { runBootLoader } from './ui/loader.js';

const canvas = document.getElementById('game');
const loaderEl = document.getElementById('loader');
const menuEl = document.getElementById('menu');
const startBtn = document.getElementById('btn-start');
const seedInput = document.getElementById('seed-input');
const hudEl = document.getElementById('hud');
const hotbarEl = document.getElementById('hotbar');
const placeModeEl = document.getElementById('hud-place-mode');
const profilerEl = document.getElementById('profiler');
const inventoryEl = document.getElementById('inventory-panel');
const craftingEl = document.getElementById('crafting-panel');
const mobileControlsEl = document.getElementById('mobile-controls');
const orientationGateEl = document.getElementById('orientation-gate');
const healthEls = {
  fill: document.getElementById('health-bar-fill'),
  label: document.getElementById('health-bar-label'),
};
const dayNightEls = {
  root: document.getElementById('day-night-clock'),
  hand: document.getElementById('day-night-hand'),
  label: document.getElementById('day-night-label'),
};

const params = new URLSearchParams(window.location.search);
const isMobile = params.get('mobile') === '1' || detectMobileInput();
if (isMobile) {
  document.body.classList.add('is-mobile');
}

seedInput.value = String(loadStoredSeed());

await runBootLoader({ loaderEl, menuEl });

new App({
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
  mobileControlsEl,
  orientationGateEl,
  isMobile,
});
