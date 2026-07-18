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

const _emptyStaticTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
_emptyStaticTex.format = THREE.RGBAFormat;
_emptyStaticTex.type = THREE.UnsignedByteType;
_emptyStaticTex.minFilter = THREE.NearestFilter;
_emptyStaticTex.magFilter = THREE.NearestFilter;
_emptyStaticTex.needsUpdate = true;

/** Shared uniforms — day/night scales skylight; static+dynamic from atlas textures. */
export const brightnessUniforms = {
  uDaySkyLight: { value: 1 },
  uMinBrightness: { value: LIGHTING.minBrightness },
  uMaxBrightness: { value: LIGHTING.maxBrightness },
  uBrightTime: { value: 0 },
  uBrightLerp: { value: LIGHTING.brightnessLerpSeconds },
  uDynamicLight: { value: _emptyDynTex },
  uStaticLight: { value: _emptyStaticTex },
  uWorldSize: { value: new THREE.Vector3(1, 1, 1) },
  uUseDynamicLight: { value: 0 },
  uUseStaticLight: { value: 0 },
  uSkyShadeEn: { value: 1 },
  uSkyShadePos: { value: new THREE.Vector3(0.92, 1, 0.92) },
  uSkyShadeNeg: { value: new THREE.Vector3(0.88, 0.8, 0.88) },
};

export function syncSkyFaceShadeUniforms() {
  const s = LIGHTING.skyFaceShade;
  brightnessUniforms.uSkyShadeEn.value = LIGHTING.skyFaceShadeEnabled !== false ? 1 : 0;
  brightnessUniforms.uSkyShadePos.value.set(s.east, s.top, s.south);
  brightnessUniforms.uSkyShadeNeg.value.set(s.west, s.bottom, s.north);
}

export function setBrightnessUniforms(dayAmount) {
  brightnessUniforms.uDaySkyLight.value = Math.max(0, dayAmount);
  brightnessUniforms.uMinBrightness.value = LIGHTING.minBrightness;
  brightnessUniforms.uMaxBrightness.value = LIGHTING.maxBrightness;
  brightnessUniforms.uBrightLerp.value = LIGHTING.brightnessLerpSeconds;
  syncSkyFaceShadeUniforms();
}

/** Bind the world's static + dynamic light atlases to all brightness materials. */
export function bindDynamicLightTexture(lighting) {
  if (!lighting?.dynamicTexture && !lighting?.staticTexture) {
    brightnessUniforms.uDynamicLight.value = _emptyDynTex;
    brightnessUniforms.uStaticLight.value = _emptyStaticTex;
    brightnessUniforms.uUseDynamicLight.value = 0;
    brightnessUniforms.uUseStaticLight.value = 0;
    return;
  }
  if (lighting.dynamicTexture) {
    brightnessUniforms.uDynamicLight.value = lighting.dynamicTexture;
    brightnessUniforms.uUseDynamicLight.value = 1;
  }
  if (lighting.staticTexture) {
    brightnessUniforms.uStaticLight.value = lighting.staticTexture;
    brightnessUniforms.uUseStaticLight.value = 1;
  }
  brightnessUniforms.uWorldSize.value.set(lighting.sizeX, lighting.sizeY, lighting.sizeZ);
  syncSkyFaceShadeUniforms();
}

/** @deprecated alias — both atlases are bound together */
export const bindLightTextures = bindDynamicLightTexture;

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

/**
 * Sample static (RGB=block, A=sky) + dynamic light fields from Y-sliced 2D atlases.
 * MC face rule: sample the air/outward cell with a tiny 2-tap anti-flicker.
 */
export const DYNAMIC_LIGHT_GLSL = /* glsl */ `
  uniform sampler2D uDynamicLight;
  uniform sampler2D uStaticLight;
  uniform vec3 uWorldSize;
  uniform float uUseDynamicLight;
  uniform float uUseStaticLight;
  uniform float uSkyShadeEn;
  uniform vec3 uSkyShadePos;
  uniform vec3 uSkyShadeNeg;

  vec4 sampleAtlasCell(sampler2D tex, float x, float y, float z) {
    if (x < 0.0 || y < 0.0 || z < 0.0) return vec4(0.0);
    if (x >= uWorldSize.x || y >= uWorldSize.y || z >= uWorldSize.z) return vec4(0.0);
    float texW = uWorldSize.x * uWorldSize.z;
    float u = (x + z * uWorldSize.x + 0.5) / texW;
    float v = (y + 0.5) / uWorldSize.y;
    return texture2D(tex, vec2(u, v));
  }

  vec3 sampleDynamicCell(float x, float y, float z) {
    return sampleAtlasCell(uDynamicLight, x, y, z).rgb;
  }

  vec4 sampleStaticCell(float x, float y, float z) {
    return sampleAtlasCell(uStaticLight, x, y, z);
  }

  void faceSampleCoords(vec3 worldPos, vec3 worldNormal, out vec3 c0, out vec3 c1) {
    vec3 n = worldNormal;
    float n2 = dot(n, n);
    if (n2 > 1e-6) n *= inversesqrt(n2);
    else n = vec3(0.0, 1.0, 0.0);
    c0 = floor(worldPos + n * 0.08);
    c1 = floor(worldPos + n * 0.02);
  }

  float skyFaceShadeMul(vec3 worldNormal) {
    if (uSkyShadeEn < 0.5) return 1.0;
    vec3 n = worldNormal;
    float n2 = dot(n, n);
    if (n2 > 1e-6) n *= inversesqrt(n2);
    else n = vec3(0.0, 1.0, 0.0);
    vec3 an = abs(n);
    if (an.y >= an.x && an.y >= an.z) {
      return n.y >= 0.0 ? uSkyShadePos.y : uSkyShadeNeg.y;
    }
    if (an.x >= an.z) {
      return n.x >= 0.0 ? uSkyShadePos.x : uSkyShadeNeg.x;
    }
    return n.z >= 0.0 ? uSkyShadePos.z : uSkyShadeNeg.z;
  }

  vec3 sampleDynamicLight(vec3 worldPos, vec3 worldNormal) {
    if (uUseDynamicLight < 0.5) return vec3(0.0);
    vec3 c0;
    vec3 c1;
    faceSampleCoords(worldPos, worldNormal, c0, c1);
    return max(sampleDynamicCell(c0.x, c0.y, c0.z), sampleDynamicCell(c1.x, c1.y, c1.z));
  }

  vec4 sampleStaticLight(vec3 worldPos, vec3 worldNormal) {
    if (uUseStaticLight < 0.5) return vec4(0.0, 0.0, 0.0, 1.0);
    vec3 c0;
    vec3 c1;
    faceSampleCoords(worldPos, worldNormal, c0, c1);
    vec4 a = sampleStaticCell(c0.x, c0.y, c0.z);
    vec4 b = sampleStaticCell(c1.x, c1.y, c1.z);
    return vec4(max(a.rgb, b.rgb), max(a.a, b.a));
  }

  vec3 combineBlockLight(vec3 staticBlock, vec3 worldPos, vec3 worldNormal) {
    vec3 fromAtlas = sampleStaticLight(worldPos, worldNormal).rgb;
    vec3 base = uUseStaticLight > 0.5 ? fromAtlas : staticBlock;
    return max(base, sampleDynamicLight(worldPos, worldNormal));
  }

  float sampleSkyLight(float vertexSky, vec3 worldPos, vec3 worldNormal, vec3 staticBlockRgb) {
    float sky = vertexSky;
    if (uUseStaticLight > 0.5) {
      sky = sampleStaticLight(worldPos, worldNormal).a;
    }
    float blockPeak = max(staticBlockRgb.r, max(staticBlockRgb.g, staticBlockRgb.b));
    if (blockPeak <= 0.001 && sky > 0.0) {
      sky *= skyFaceShadeMul(worldNormal);
    }
    return sky;
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
    uStaticLight: brightnessUniforms.uStaticLight,
    uWorldSize: brightnessUniforms.uWorldSize,
    uUseDynamicLight: brightnessUniforms.uUseDynamicLight,
    uUseStaticLight: brightnessUniforms.uUseStaticLight,
    uSkyShadeEn: brightnessUniforms.uSkyShadeEn,
    uSkyShadePos: brightnessUniforms.uSkyShadePos,
    uSkyShadeNeg: brightnessUniforms.uSkyShadeNeg,
  };
}

const VOXEL_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
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
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  ${BRIGHTNESS_GLSL}
  ${DYNAMIC_LIGHT_GLSL}

  void main() {
    vec4 tex = uUseMap > 0.5 ? texture2D(uMap, vUv) : vec4(1.0);
    if (uAlphaTest > 0.0 && tex.a < uAlphaTest) discard;

    vec3 staticBlock = sampleStaticLight(vWorldPos, vWorldNormal).rgb;
    vec3 block = uEmissiveMul > 0.0
      ? vec3(0.0)
      : combineBlockLight(staticBlock, vWorldPos, vWorldNormal);
    float sky = sampleSkyLight(0.0, vWorldPos, vWorldNormal, staticBlock);
    vec3 light = mcLightColor(sky, block, uDaySkyLight, uMinBrightness, uMaxBrightness);
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
 * Full-bright attributes for entity meshes (legacy attrs; lighting comes from atlas).
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

syncSkyFaceShadeUniforms();
