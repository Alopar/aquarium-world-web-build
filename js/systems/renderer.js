import * as THREE from 'three';
import { AQUARIUM_SIZE, CAMERA, COLORS, DAY_NIGHT, VOXEL_SIZE } from '../constants.js';

/**
 * Ortho shadow frustum centered on the aquarium (not world origin).
 * @param {THREE.DirectionalLight} sun
 */
export function configureSunShadowCamera(sun) {
  const cx = DAY_NIGHT.worldCenter.x * VOXEL_SIZE;
  const cy = (AQUARIUM_SIZE.y * VOXEL_SIZE) * 0.5;
  const cz = DAY_NIGHT.worldCenter.z * VOXEL_SIZE;
  sun.target.position.set(cx, cy, cz);

  const halfXZ = Math.max(AQUARIUM_SIZE.x, AQUARIUM_SIZE.z) * VOXEL_SIZE * 0.5 + 6;
  const cam = sun.shadow.camera;
  cam.left = -halfXZ;
  cam.right = halfXZ;
  cam.top = halfXZ;
  cam.bottom = -halfXZ;
  cam.near = 0.5;
  cam.far = AQUARIUM_SIZE.y * VOXEL_SIZE + 140;
  cam.updateProjectionMatrix();

  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.025;
}

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {{ sun: THREE.DirectionalLight, ambient: THREE.AmbientLight }} lights
 * @param {import('./day-night.js').DayNightSystem | null} dayNight
 * @param {boolean} enabled
 */
export function applyShadowsEnabled(renderer, lights, dayNight, enabled) {
  if (!renderer || !lights?.sun) return;
  const on = enabled !== false;
  renderer.shadowMap.enabled = on;
  if (dayNight) {
    dayNight.setUserShadowsEnabled(on);
  } else {
    lights.sun.castShadow = on;
  }
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ lowQuality?: boolean }} [options]
 */
export function createRenderer(canvas, options = {}) {
  const lowQuality = !!options.lowQuality;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !lowQuality,
    alpha: false,
  });
  const maxRatio = lowQuality ? 1 : 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.sortObjects = true;
  return renderer;
}

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.sky);
  scene.fog = new THREE.Fog(COLORS.fog, 60, 180);
  return scene;
}

export function createCamera() {
  const camera = new THREE.PerspectiveCamera(
    CAMERA.fov,
    window.innerWidth / window.innerHeight,
    CAMERA.near,
    CAMERA.far,
  );
  camera.position.set(
    CAMERA.startPosition.x,
    CAMERA.startPosition.y,
    CAMERA.startPosition.z,
  );
  return camera;
}

/**
 * @param {THREE.Scene} scene
 * @param {{ shadows?: boolean }} [options]
 */
export function createLights(scene, options = {}) {
  const shadows = options.shadows !== false;

  const ambient = new THREE.AmbientLight(0xb8d8ff, shadows ? 0.55 : 0.72);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff4d6, 1.1);
  sun.position.set(48, 64, 32);
  configureSunShadowCamera(sun);
  sun.castShadow = shadows;
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.PointLight(0x4aa8ff, 0.35, 80);
  fill.position.set(32, 20, 32);
  scene.add(fill);

  return { ambient, sun, fill, shadowsEnabled: shadows };
}

export function bindResize(renderer, camera, onResize) {
  function handleResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    onResize?.();
  }
  window.addEventListener('resize', handleResize);
  return () => window.removeEventListener('resize', handleResize);
}
