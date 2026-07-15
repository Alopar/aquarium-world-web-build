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
  renderer.shadowMap.enabled = false;
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

/** No Three.js lights — brightness comes from voxel light fields only. */
export function createLights(_scene) {
  return {};
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
