import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const cache = new Map();

export const TEXTURE_FILES = {
  stone: 'assets/textures/stone.png',
  dirt: 'assets/textures/dirt.png',
  grass: 'assets/textures/grass.png',
  grass_blade: 'assets/textures/grass_blade.png',
  flower_poppy: 'assets/textures/flower_poppy.png',
  flower_dandelion: 'assets/textures/flower_dandelion.png',
  flower_cornflower: 'assets/textures/flower_cornflower.png',
  flower_daisy: 'assets/textures/flower_daisy.png',
  flower_allium: 'assets/textures/flower_allium.png',
  sand: 'assets/textures/sand.png',
  gravel: 'assets/textures/gravel.png',
  cobblestone: 'assets/textures/cobblestone.png',
  wood: 'assets/textures/wood.png',
  organic: 'assets/textures/organic.png',
  iron_ore: 'assets/textures/iron_ore.png',
  coal_ore: 'assets/textures/coal_ore.png',
  copper_ore: 'assets/textures/copper_ore.png',
  crystal_ore: 'assets/textures/crystal_ore.png',
  iron: 'assets/textures/iron.png',
  coal: 'assets/textures/coal.png',
  copper: 'assets/textures/copper.png',
  crystal: 'assets/textures/crystal.png',
  lava_rock: 'assets/textures/lava_rock.png',
};

export function loadBlockTextures() {
  return Promise.all(
    Object.entries(TEXTURE_FILES).map(
      ([id, url]) =>
        new Promise((resolve, reject) => {
          loader.load(
            url,
            (tex) => {
              tex.colorSpace = THREE.SRGBColorSpace;
              if (id === 'grass_blade' || id.startsWith('flower_')) {
                tex.wrapS = THREE.ClampToEdgeWrapping;
                tex.wrapT = THREE.ClampToEdgeWrapping;
                tex.magFilter = THREE.NearestFilter;
                tex.minFilter = THREE.NearestFilter;
                tex.generateMipmaps = false;
              } else {
                tex.wrapS = THREE.RepeatWrapping;
                tex.wrapT = THREE.RepeatWrapping;
                tex.magFilter = THREE.LinearFilter;
                tex.minFilter = THREE.LinearMipmapLinearFilter;
              }
              cache.set(id, tex);
              resolve();
            },
            undefined,
            reject,
          );
        }),
    ),
  );
}

export function getBlockTexture(id) {
  return cache.get(id) ?? null;
}

export function disposeBlockTextures() {
  for (const tex of cache.values()) {
    tex.dispose();
  }
  cache.clear();
}
