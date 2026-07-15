import { LIGHTING } from '../constants.js';
import { brightnessUniforms } from '../shaders/voxel-brightness-material.js';

/**
 * Tracks voxels whose baked light changed and exposes prev→target for
 * shader-side linear interpolation (~brightnessLerpSeconds).
 * Blocklight prev/target are RGB channels.
 */
export class BrightnessBlendSystem {
  /**
   * @param {import('./voxel-lighting.js').VoxelLightingSystem} lighting
   */
  constructor(lighting) {
    this.lighting = lighting;
    this.duration = LIGHTING.brightnessLerpSeconds;
    this.volume = lighting.volume;
    this.sizeX = lighting.sizeX;
    this.sizeY = lighting.sizeY;
    this.sizeZ = lighting.sizeZ;

    this.fromSky = new Uint8Array(this.volume);
    this.fromBlockR = new Uint8Array(this.volume);
    this.fromBlockG = new Uint8Array(this.volume);
    this.fromBlockB = new Uint8Array(this.volume);
    this.committedSky = new Uint8Array(this.volume);
    this.committedBlockR = new Uint8Array(this.volume);
    this.committedBlockG = new Uint8Array(this.volume);
    this.committedBlockB = new Uint8Array(this.volume);
    this.startTime = new Float32Array(this.volume);
    this.activeFlag = new Uint8Array(this.volume);
    /** @type {number[]} */
    this.active = [];

    /** Adapter for sampleFaceBrightness using from-* light. */
    this._prevView = {
      grid: lighting.grid,
      getSkylight: (x, y, z) => this.getPrevSkylight(x, y, z),
      getBlockLight: (x, y, z) => this.getPrevBlockLight(x, y, z),
      getBlockLightRgb: (x, y, z) => this.getPrevBlockLightRgb(x, y, z),
    };
  }

  get time() {
    return brightnessUniforms.uBrightTime.value;
  }

  /** Snap display to lighting with no fade (world generate / first load). */
  snapAll() {
    this.fromSky.set(this.lighting.skylight);
    this.fromBlockR.set(this.lighting.blockLightR);
    this.fromBlockG.set(this.lighting.blockLightG);
    this.fromBlockB.set(this.lighting.blockLightB);
    this.committedSky.set(this.lighting.skylight);
    this.committedBlockR.set(this.lighting.blockLightR);
    this.committedBlockG.set(this.lighting.blockLightG);
    this.committedBlockB.set(this.lighting.blockLightB);
    this.active.length = 0;
    this.activeFlag.fill(0);
  }

  /**
   * After lighting flood: start blends for cells that changed in the box.
   */
  captureRegion(x0, y0, z0, x1, y1, z1) {
    const lx0 = Math.max(0, x0);
    const ly0 = Math.max(0, y0);
    const lz0 = Math.max(0, z0);
    const lx1 = Math.min(this.sizeX - 1, x1);
    const ly1 = Math.min(this.sizeY - 1, y1);
    const lz1 = Math.min(this.sizeZ - 1, z1);
    if (lx0 > lx1 || ly0 > ly1 || lz0 > lz1) return;

    const sky = this.lighting.skylight;
    const br = this.lighting.blockLightR;
    const bg = this.lighting.blockLightG;
    const bb = this.lighting.blockLightB;
    const now = this.time;
    const duration = Math.max(1e-4, this.duration);

    for (let x = lx0; x <= lx1; x++) {
      for (let z = lz0; z <= lz1; z++) {
        for (let y = ly0; y <= ly1; y++) {
          const i = this.lighting._index(x, y, z);
          const nextSky = sky[i];
          const nextR = br[i];
          const nextG = bg[i];
          const nextB = bb[i];
          if (
            nextSky === this.committedSky[i]
            && nextR === this.committedBlockR[i]
            && nextG === this.committedBlockG[i]
            && nextB === this.committedBlockB[i]
          ) {
            continue;
          }

          if (this.activeFlag[i]) {
            const t = Math.min(1, Math.max(0, (now - this.startTime[i]) / duration));
            this.fromSky[i] = Math.round(this.fromSky[i] + (this.committedSky[i] - this.fromSky[i]) * t);
            this.fromBlockR[i] = Math.round(
              this.fromBlockR[i] + (this.committedBlockR[i] - this.fromBlockR[i]) * t,
            );
            this.fromBlockG[i] = Math.round(
              this.fromBlockG[i] + (this.committedBlockG[i] - this.fromBlockG[i]) * t,
            );
            this.fromBlockB[i] = Math.round(
              this.fromBlockB[i] + (this.committedBlockB[i] - this.fromBlockB[i]) * t,
            );
          } else {
            this.fromSky[i] = this.committedSky[i];
            this.fromBlockR[i] = this.committedBlockR[i];
            this.fromBlockG[i] = this.committedBlockG[i];
            this.fromBlockB[i] = this.committedBlockB[i];
            this.activeFlag[i] = 1;
            this.active.push(i);
          }

          this.startTime[i] = now;
          this.committedSky[i] = nextSky;
          this.committedBlockR[i] = nextR;
          this.committedBlockG[i] = nextG;
          this.committedBlockB[i] = nextB;
        }
      }
    }
  }

  /** Prune finished blends (clock lives in brightnessUniforms.uBrightTime). */
  update(_dt) {
    this.duration = LIGHTING.brightnessLerpSeconds;
    const duration = this.duration;
    const now = this.time;
    const list = this.active;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const idx = list[i];
      if (now - this.startTime[idx] >= duration) {
        this.fromSky[idx] = this.committedSky[idx];
        this.fromBlockR[idx] = this.committedBlockR[idx];
        this.fromBlockG[idx] = this.committedBlockG[idx];
        this.fromBlockB[idx] = this.committedBlockB[idx];
        this.activeFlag[idx] = 0;
      } else {
        list[w++] = idx;
      }
    }
    list.length = w;
  }

  getPrevSkylight(x, y, z) {
    if (!this.lighting.grid.inBounds(x, y, z)) return this.lighting.getSkylight(x, y, z);
    const i = this.lighting._index(x, y, z);
    return this.activeFlag[i] ? this.fromSky[i] : this.lighting.skylight[i];
  }

  getPrevBlockLight(x, y, z) {
    const rgb = this.getPrevBlockLightRgb(x, y, z);
    return Math.max(rgb.r, rgb.g, rgb.b);
  }

  getPrevBlockLightRgb(x, y, z) {
    if (!this.lighting.grid.inBounds(x, y, z)) return this.lighting.getBlockLightRgb(x, y, z);
    const i = this.lighting._index(x, y, z);
    if (this.activeFlag[i]) {
      return { r: this.fromBlockR[i], g: this.fromBlockG[i], b: this.fromBlockB[i] };
    }
    return {
      r: this.lighting.blockLightR[i],
      g: this.lighting.blockLightG[i],
      b: this.lighting.blockLightB[i],
    };
  }

  cellBlendStart(x, y, z) {
    if (!this.lighting.grid.inBounds(x, y, z)) return -1e6;
    const i = this.lighting._index(x, y, z);
    return this.activeFlag[i] ? this.startTime[i] : -1e6;
  }

  prevLightingView() {
    return this._prevView;
  }

  faceBlendStart(x, y, z, dir) {
    const a = this.cellBlendStart(x + dir[0], y + dir[1], z + dir[2]);
    const b = this.cellBlendStart(x, y, z);
    if (a < -1e5 && b < -1e5) return -1e6;
    if (a < -1e5) return b;
    if (b < -1e5) return a;
    return Math.min(a, b);
  }
}
