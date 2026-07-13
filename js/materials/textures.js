import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const cache = new Map();
let solidAtlas = null;
/** @type {Map<string, { ox: number, oy: number, sx: number, sy: number }>} */
let solidAtlasUv = new Map();

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

/**
 * Builds a texture atlas for solid opaque blocks (world terrain).
 * Excludes alpha / emissive specials which keep their own materials.
 *
 * The atlas is built from textures already loaded into `cache`.
 * Any material without a texture can still be included via `fillColor`.
 *
 * @param {Array<{ id: string, texture?: string, color?: number, opaque?: boolean, opacity?: number, emissive?: number }>} materials
 */
export function buildSolidAtlas(materials) {
  if (solidAtlas) return solidAtlas;

  const tiles = [];
  for (const m of materials) {
    if (!m?.id) continue;
    if (m.opaque !== true) continue;
    if (m.opacity != null && m.opacity < 1) continue;
    if (m.emissive != null) continue;

    const texId = m.texture ?? null;
    const tex = texId ? cache.get(texId) : null;
    if (tex) {
      tiles.push({ id: m.id, type: 'tex', tex });
    } else if (Number.isFinite(m.color)) {
      tiles.push({ id: m.id, type: 'color', color: m.color });
    }
  }

  if (tiles.length === 0) return null;

  const firstTex = tiles.find((t) => t.type === 'tex')?.tex ?? null;
  const baseTile = firstTex?.image?.width ?? 16;
  const tileSize = Math.max(8, Math.min(64, baseTile | 0));
  const pad = 1;
  const cell = tileSize + pad * 2;

  const cols = Math.ceil(Math.sqrt(tiles.length));
  const rows = Math.ceil(tiles.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return null;

  ctx.imageSmoothingEnabled = false;
  solidAtlasUv = new Map();

  function drawPaddedSolid(x, y, color) {
    const hex = Number(color) >>> 0;
    const r = (hex >> 16) & 0xff;
    const g = (hex >> 8) & 0xff;
    const b = hex & 0xff;
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(x, y, cell, cell);
  }

  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = c * cell;
    const y = r * cell;
    const innerX = x + pad;
    const innerY = y + pad;

    if (t.type === 'tex') {
      const img = t.tex.image;
      // Base fill to reduce any uninitialized edge artifacts in mips.
      ctx.fillStyle = 'rgb(0,0,0)';
      ctx.fillRect(x, y, cell, cell);
      ctx.drawImage(img, innerX, innerY, tileSize, tileSize);

      // Edge padding (copy 1px border) to reduce bleeding between tiles.
      // Left/right
      ctx.drawImage(canvas, innerX, innerY, 1, tileSize, x, innerY, pad, tileSize);
      ctx.drawImage(canvas, innerX + tileSize - 1, innerY, 1, tileSize, innerX + tileSize, innerY, pad, tileSize);
      // Top/bottom
      ctx.drawImage(canvas, innerX, innerY, tileSize, 1, innerX, y, tileSize, pad);
      ctx.drawImage(canvas, innerX, innerY + tileSize - 1, tileSize, 1, innerX, innerY + tileSize, tileSize, pad);
      // Corners
      ctx.drawImage(canvas, innerX, innerY, 1, 1, x, y, pad, pad);
      ctx.drawImage(canvas, innerX + tileSize - 1, innerY, 1, 1, innerX + tileSize, y, pad, pad);
      ctx.drawImage(canvas, innerX, innerY + tileSize - 1, 1, 1, x, innerY + tileSize, pad, pad);
      ctx.drawImage(canvas, innerX + tileSize - 1, innerY + tileSize - 1, 1, 1, innerX + tileSize, innerY + tileSize, pad, pad);
    } else {
      drawPaddedSolid(x, y, t.color);
    }

    const ox = (x + pad) / canvas.width;
    const oy = (y + pad) / canvas.height;
    const sx = tileSize / canvas.width;
    const sy = tileSize / canvas.height;
    solidAtlasUv.set(t.id, { ox, oy, sx, sy });
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;

  solidAtlas = tex;
  return solidAtlas;
}

export function getSolidAtlasTexture() {
  return solidAtlas;
}

export function getSolidAtlasUv(blockId) {
  return solidAtlasUv.get(blockId) ?? null;
}

export function disposeBlockTextures() {
  for (const tex of cache.values()) {
    tex.dispose();
  }
  cache.clear();
  if (solidAtlas) {
    solidAtlas.dispose();
    solidAtlas = null;
  }
  solidAtlasUv.clear();
}
