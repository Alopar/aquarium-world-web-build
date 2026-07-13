import * as THREE from 'three';
import { CAMERA, COLORS } from '../constants.js';

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
  renderer.shadowMap.enabled = !lowQuality;
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

  // Slightly brighter ambient when shadows are off so terrain stays readable.
  const ambient = new THREE.AmbientLight(0xb8d8ff, shadows ? 0.55 : 0.72);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff4d6, 1.1);
  sun.position.set(48, 64, 32);
  sun.castShadow = shadows;
  if (shadows) {
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 160;
    sun.shadow.camera.left = -48;
    sun.shadow.camera.right = 48;
    sun.shadow.camera.top = 48;
    sun.shadow.camera.bottom = -48;
  }
  scene.add(sun);

  const fill = new THREE.PointLight(0x4aa8ff, 0.35, 80);
  fill.position.set(32, 20, 32);
  scene.add(fill);

  return { ambient, sun, fill, shadowsEnabled: shadows };
}

export function bindResize(renderer, camera) {
  function onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}
