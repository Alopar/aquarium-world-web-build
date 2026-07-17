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
  uMaxBrightness: { value: LIGHTING.maxBrightness },
  uBrightTime: { value: 0 },
  uBrightLerp: { value: LIGHTING.brightnessLerpSeconds },
  uDynamicLight: { value: _emptyDynTex },
  uWorldSize: { value: new THREE.Vector3(1, 1, 1) },
  uUseDynamicLight: { value: 0 },
};

export function setBrightnessUniforms(dayAmount) {
  brightnessUniforms.uDaySkyLight.value = Math.max(0, dayAmount);
  brightnessUniforms.uMinBrightness.value = LIGHTING.minBrightness;
  brightnessUniforms.uMaxBrightness.value = LIGHTING.maxBrightness;
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

/**
 * Display brightness for normalized light level 0…1.
 * Log curve keeps relative steps even between minBrightness and maxBrightness.
 */
export function mcBrightness(
  level,
  minBright = LIGHTING.minBrightness,
  maxBright = LIGHTING.maxBrightness,
) {
  const x = Math.min(1, Math.max(0, level));
  const lo = Math.max(minBright, 1e-6);
  const hi = Math.max(maxBright, lo);
  if (x <= 0) return lo;
  if (x >= 1) return hi;
  return Math.exp(Math.log(lo) * (1 - x) + Math.log(hi) * x);
}

/** Colored light: albedo × curved max(skyWhite, blockRGB). */
export const BRIGHTNESS_GLSL = /* glsl */ `
  float mcBrightCurve(float x, float ambient, float peak) {
    x = clamp(x, 0.0, 1.0);
    float lo = max(ambient, 1e-6);
    float hi = max(peak, lo);
    if (x <= 0.0) return lo;
    if (x >= 1.0) return hi;
    return exp(log(lo) * (1.0 - x) + log(hi) * x);
  }

  vec3 mcLightColor(float sky, vec3 blockRgb, float daySky, float minBright, float maxBright) {
    vec3 skyLit = vec3(clamp(sky * daySky, 0.0, 1.0));
    vec3 blockLit = clamp(blockRgb, 0.0, 1.0);
    vec3 level = max(skyLit, blockLit);
    return vec3(
      mcBrightCurve(level.r, minBright, maxBright),
      mcBrightCurve(level.g, minBright, maxBright),
      mcBrightCurve(level.b, minBright, maxBright)
    );
  }
`;

/** Sample transient dynamicLight field from Y-sliced 2D atlas. */
export const DYNAMIC_LIGHT_GLSL = /* glsl */ `
  uniform sampler2D uDynamicLight;
  uniform vec3 uWorldSize;
  uniform float uUseDynamicLight;

  vec3 sampleDynamicCell(float x, float y, float z) {
    if (x < 0.0 || y < 0.0 || z < 0.0) return vec3(0.0);
    if (x >= uWorldSize.x || y >= uWorldSize.y || z >= uWorldSize.z) return vec3(0.0);
    float texW = uWorldSize.x * uWorldSize.z;
    float u = (x + z * uWorldSize.x + 0.5) / texW;
    float v = (y + 0.5) / uWorldSize.y;
    return texture2D(uDynamicLight, vec2(u, v)).rgb;
  }

  // MC face rule: sample the air/outward cell. Bias + max of a tiny 2-tap
  // kills boundary floor() flicker on integer face planes.
  vec3 sampleDynamicLight(vec3 worldPos, vec3 worldNormal) {
    if (uUseDynamicLight < 0.5) return vec3(0.0);
    vec3 n = worldNormal;
    float n2 = dot(n, n);
    if (n2 > 1e-6) n *= inversesqrt(n2);
    else n = vec3(0.0, 1.0, 0.0);

    vec3 outward = worldPos + n * 0.08;
    vec3 c0 = floor(outward);
    vec3 c1 = floor(worldPos + n * 0.02);
    return max(sampleDynamicCell(c0.x, c0.y, c0.z), sampleDynamicCell(c1.x, c1.y, c1.z));
  }

  vec3 combineBlockLight(vec3 staticBlock, vec3 worldPos, vec3 worldNormal) {
    return max(staticBlock, sampleDynamicLight(worldPos, worldNormal));
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
    uMaxBrightness: brightnessUniforms.uMaxBrightness,
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
  varying vec3 vWorldNormal;

  ${BRIGHTNESS_BLEND_GLSL}

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
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
  uniform float uMaxBrightness;

  varying vec2 vUv;
  varying float vSky;
  varying vec3 vBlock;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  ${BRIGHTNESS_GLSL}
  ${DYNAMIC_LIGHT_GLSL}

  void main() {
    vec4 tex = uUseMap > 0.5 ? texture2D(uMap, vUv) : vec4(1.0);
    if (uAlphaTest > 0.0 && tex.a < uAlphaTest) discard;

    vec3 block = uEmissiveMul > 0.0
      ? vec3(0.0)
      : combineBlockLight(vBlock, vWorldPos, vWorldNormal);
    vec3 light = mcLightColor(vSky, block, uDaySkyLight, uMinBrightness, uMaxBrightness);
    vec3 albedo = tex.rgb * uColor;
    vec3 lit = albedo * light;

    // Emissive: own glow only — no colored blocklight (self or neighbors).
    if (uEmissiveMul > 0.0) {
      lit += uEmissive * uEmissiveMul;
    }

    gl_FragColor = vec4(lit, tex.a * uOpacity);
    gl_FragColor = linearToOutputTexel(gl_FragColor);
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
    toneMapped: false,
  });
}

/**
 * Brightness-only material for simple solid-color meshes (no texture).
 * Uses the same aSky / color(block RGB) layout as createVoxelBrightnessMaterial.
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
    vertexShader: VOXEL_VERTEX,
    fragmentShader: VOXEL_FRAGMENT,
    transparent,
    depthWrite: !transparent,
    toneMapped: false,
  });
}

/**
 * Full-bright attributes for entity meshes on createVoxelBrightnessMaterial.
 * color = static block RGB; aSky = skylight (matches world voxel layout).
 */
export function setGeometryFullBright(geometry) {
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  const skies = new Float32Array(count);
  const prevBlocks = new Float32Array(count * 3);
  const prevSkies = new Float32Array(count);
  const blendStarts = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    skies[i] = 1;
    prevSkies[i] = 1;
    blendStarts[i] = -1e6;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSky', new THREE.BufferAttribute(skies, 1));
  geometry.setAttribute('aPrevBlock', new THREE.BufferAttribute(prevBlocks, 3));
  geometry.setAttribute('aPrevSky', new THREE.BufferAttribute(prevSkies, 1));
  geometry.setAttribute('aBlendStart', new THREE.BufferAttribute(blendStarts, 1));
}
