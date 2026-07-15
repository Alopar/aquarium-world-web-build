import * as THREE from 'three';
import { LIGHTING } from '../constants.js';
import { getBlockTexture } from '../materials/textures.js';

const _whiteTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
_whiteTex.needsUpdate = true;
_whiteTex.colorSpace = THREE.SRGBColorSpace;

const _emptyDynTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
_emptyDynTex.format = THREE.RGBAFormat;
_emptyDynTex.type = THREE.UnsignedByteType;
_emptyDynTex.minFilter = THREE.NearestFilter;
_emptyDynTex.magFilter = THREE.NearestFilter;
_emptyDynTex.needsUpdate = true;

/** Shared uniforms — day/night scales skylight only; dynamic from atlas tex. */
export const brightnessUniforms = {
  uDaySkyLight: { value: 1 },
  uMinBrightness: { value: LIGHTING.minBrightness },
  uBrightTime: { value: 0 },
  uBrightLerp: { value: LIGHTING.brightnessLerpSeconds },
  uDynamicLight: { value: _emptyDynTex },
  uWorldSize: { value: new THREE.Vector3(1, 1, 1) },
  uUseDynamicLight: { value: 0 },
};

export function setBrightnessUniforms(dayAmount) {
  brightnessUniforms.uDaySkyLight.value = Math.max(0, dayAmount);
  brightnessUniforms.uMinBrightness.value = LIGHTING.minBrightness;
  brightnessUniforms.uBrightLerp.value = LIGHTING.brightnessLerpSeconds;
}

/** Bind the world's dynamic light 3D texture to all brightness materials. */
export function bindDynamicLightTexture(lighting) {
  if (!lighting?.dynamicTexture) {
    brightnessUniforms.uDynamicLight.value = _emptyDynTex;
    brightnessUniforms.uUseDynamicLight.value = 0;
    return;
  }
  brightnessUniforms.uDynamicLight.value = lighting.dynamicTexture;
  brightnessUniforms.uWorldSize.value.set(lighting.sizeX, lighting.sizeY, lighting.sizeZ);
  brightnessUniforms.uUseDynamicLight.value = 1;
}

/** Advance shared clock for brightness blend shaders. */
export function tickBrightnessTime(dt) {
  brightnessUniforms.uBrightTime.value += dt;
}

/** Minecraft-style colored light: albedo × max(skyWhite, blockRGB) per channel. */
export const BRIGHTNESS_GLSL = /* glsl */ `
  vec3 mcLightColor(float sky, vec3 blockRgb, float daySky, float minBright) {
    vec3 skyLit = vec3(clamp(sky * daySky, 0.0, 1.0));
    vec3 blockLit = clamp(blockRgb, 0.0, 1.0);
    vec3 level = max(skyLit, blockLit);
    return mix(vec3(minBright), vec3(1.0), level);
  }
`;

/** Sample transient dynamicLight field from Y-sliced 2D atlas. */
export const DYNAMIC_LIGHT_GLSL = /* glsl */ `
  uniform sampler2D uDynamicLight;
  uniform vec3 uWorldSize;
  uniform float uUseDynamicLight;

  vec3 sampleDynamicLight(vec3 worldPos) {
    if (uUseDynamicLight < 0.5) return vec3(0.0);
    float x = floor(worldPos.x);
    float y = floor(worldPos.y);
    float z = floor(worldPos.z);
    if (x < 0.0 || y < 0.0 || z < 0.0) return vec3(0.0);
    if (x >= uWorldSize.x || y >= uWorldSize.y || z >= uWorldSize.z) return vec3(0.0);
    float texW = uWorldSize.x * uWorldSize.z;
    float u = (x + z * uWorldSize.x + 0.5) / texW;
    float v = (y + 0.5) / uWorldSize.y;
    return texture2D(uDynamicLight, vec2(u, v)).rgb;
  }

  vec3 combineBlockLight(vec3 staticBlock, vec3 worldPos) {
    return max(staticBlock, sampleDynamicLight(worldPos));
  }
`;

/** Mix prev→target sky + RGB using per-vertex blend start + shared clock. */
export const BRIGHTNESS_BLEND_GLSL = /* glsl */ `
  void blendFaceLight(
    float targetSky, vec3 targetBlock,
    float prevSky, vec3 prevBlock, float blendStart,
    float brightTime, float lerpDur,
    out float sky, out vec3 block
  ) {
    float t = clamp((brightTime - blendStart) / max(lerpDur, 0.0001), 0.0, 1.0);
    sky = mix(prevSky, targetSky, t);
    block = mix(prevBlock, targetBlock, t);
  }
`;

function sharedLightUniforms() {
  return {
    uDaySkyLight: brightnessUniforms.uDaySkyLight,
    uMinBrightness: brightnessUniforms.uMinBrightness,
    uBrightTime: brightnessUniforms.uBrightTime,
    uBrightLerp: brightnessUniforms.uBrightLerp,
    uDynamicLight: brightnessUniforms.uDynamicLight,
    uWorldSize: brightnessUniforms.uWorldSize,
    uUseDynamicLight: brightnessUniforms.uUseDynamicLight,
  };
}

const VOXEL_VERTEX = /* glsl */ `
  attribute vec3 color;
  attribute float aSky;
  attribute vec3 aPrevBlock;
  attribute float aPrevSky;
  attribute float aBlendStart;
  uniform float uBrightTime;
  uniform float uBrightLerp;
  varying vec2 vUv;
  varying float vSky;
  varying vec3 vBlock;
  varying vec3 vWorldPos;

  ${BRIGHTNESS_BLEND_GLSL}

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    blendFaceLight(
      aSky, color, aPrevSky, aPrevBlock, aBlendStart,
      uBrightTime, uBrightLerp, vSky, vBlock
    );
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const VOXEL_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uUseMap;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uAlphaTest;
  uniform vec3 uEmissive;
  uniform float uEmissiveMul;
  uniform float uDaySkyLight;
  uniform float uMinBrightness;

  varying vec2 vUv;
  varying float vSky;
  varying vec3 vBlock;
  varying vec3 vWorldPos;

  ${BRIGHTNESS_GLSL}
  ${DYNAMIC_LIGHT_GLSL}

  void main() {
    vec4 tex = uUseMap > 0.5 ? texture2D(uMap, vUv) : vec4(1.0);
    if (uAlphaTest > 0.0 && tex.a < uAlphaTest) discard;

    vec3 block = combineBlockLight(vBlock, vWorldPos);
    vec3 light = mcLightColor(vSky, block, uDaySkyLight, uMinBrightness);
    vec3 albedo = tex.rgb * uColor;
    vec3 lit = albedo * light;

    if (uEmissiveMul > 0.0) {
      lit = max(lit, albedo * light + uEmissive * uEmissiveMul);
    }

    gl_FragColor = vec4(lit, tex.a * uOpacity);
  }
`;

/**
 * Unlit voxel material: texture × MC brightness (skylight + colored blocklight).
 * @param {import('../materials/registry.js').MaterialDef} materialDef
 */
export function createVoxelBrightnessMaterial(materialDef) {
  const map = materialDef.texture ? getBlockTexture(materialDef.texture) : null;
  const transparent = materialDef.opacity != null && materialDef.opacity < 1;
  const emissiveMul = materialDef.emissive != null
    ? (materialDef.emissiveIntensity ?? 0.6)
    : 0;

  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map ?? _whiteTex },
      uUseMap: { value: map ? 1 : 0 },
      uColor: { value: new THREE.Color(map ? 0xffffff : (materialDef.color ?? 0xffffff)) },
      uOpacity: { value: materialDef.opacity ?? 1 },
      uAlphaTest: { value: 0 },
      uEmissive: { value: new THREE.Color(materialDef.emissive ?? 0x000000) },
      uEmissiveMul: { value: emissiveMul },
      ...sharedLightUniforms(),
    },
    vertexShader: VOXEL_VERTEX,
    fragmentShader: VOXEL_FRAGMENT,
    transparent,
    depthWrite: !transparent,
    side: THREE.FrontSide,
  });
}

/**
 * Brightness-only material for simple meshes (entities, uniform light).
 * Scalar path: color.r = sky, color.g = block (white tint).
 * @param {{ color?: number, opacity?: number, transparent?: boolean }} [opts]
 */
export function createUniformBrightnessMaterial(opts = {}) {
  const transparent = !!opts.transparent;
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: _whiteTex },
      uUseMap: { value: 0 },
      uColor: { value: new THREE.Color(opts.color ?? 0xffffff) },
      uOpacity: { value: opts.opacity ?? 1 },
      uAlphaTest: { value: 0 },
      uEmissive: { value: new THREE.Color(0x000000) },
      uEmissiveMul: { value: 0 },
      ...sharedLightUniforms(),
    },
    vertexShader: /* glsl */ `
      attribute vec3 color;
      varying vec2 vUv;
      varying float vSky;
      varying vec3 vBlock;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv;
        vSky = color.r;
        vBlock = vec3(color.g);
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: VOXEL_FRAGMENT,
    transparent,
    depthWrite: !transparent,
  });
}

/** Attach full-bright white vertex colors so uniform meshes stay visible. */
export function setGeometryFullBright(geometry) {
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = 1;
    colors[i * 3 + 1] = 0;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}
