import * as THREE from 'three';
import { CAMERA, COLORS } from '../constants.js';

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

export function createLights(scene) {
  const ambient = new THREE.AmbientLight(0xb8d8ff, 0.55);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff4d6, 1.1);
  sun.position.set(48, 64, 32);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 160;
  sun.shadow.camera.left = -48;
  sun.shadow.camera.right = 48;
  sun.shadow.camera.top = 48;
  sun.shadow.camera.bottom = -48;
  scene.add(sun);

  const fill = new THREE.PointLight(0x4aa8ff, 0.35, 80);
  fill.position.set(32, 20, 32);
  scene.add(fill);

  return { ambient, sun, fill };
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
