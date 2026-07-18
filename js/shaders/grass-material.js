import * as THREE from 'three';
import { getBlockTexture } from '../materials/textures.js';
import {
  brightnessUniforms,
  BRIGHTNESS_GLSL,
  DYNAMIC_LIGHT_GLSL,
} from './voxel-brightness-material.js';

export const grassTimeUniform = { value: 0 };

const FOLIAGE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vTint;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  uniform float uTime;
  uniform float uWindStrength;
  uniform float uBladeHeight;

  void main() {
    vUv = uv;
    vTint = instanceColor.rgb;

    vec3 transformed = position;
    float tip = clamp(transformed.y / max(uBladeHeight, 0.001), 0.0, 1.0);
    tip *= tip;
    vec3 instOrigin = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vWorldPos = instOrigin + transformed;
    vWorldNormal = vec3(0.0, 1.0, 0.0);
    float phase = instOrigin.x * 0.7 + instOrigin.z * 0.55;
    float wind = sin(uTime * 1.8 + phase) * uWindStrength * tip;
    transformed.x += wind;
    transformed.z += cos(uTime * 1.35 + phase * 1.1) * uWindStrength * 0.55 * tip;

    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(transformed, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FOLIAGE_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uAlphaTest;
  uniform float uDaySkyLight;
  uniform float uMinBrightness;
  uniform float uMaxBrightness;
  varying vec2 vUv;
  varying vec3 vTint;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  ${BRIGHTNESS_GLSL}
  ${DYNAMIC_LIGHT_GLSL}

  void main() {
    vec4 tex = texture2D(uMap, vUv);
    if (tex.a < uAlphaTest) discard;

    vec3 staticBlock = sampleStaticLight(vWorldPos, vWorldNormal).rgb;
    vec3 block = combineBlockLight(staticBlock, vWorldPos, vWorldNormal);
    float sky = sampleSkyLight(0.0, vWorldPos, vWorldNormal, staticBlock);
    vec3 light = mcLightColor(sky, block, uDaySkyLight, uMinBrightness, uMaxBrightness);
    vec3 albedo = tex.rgb * vTint;
    gl_FragColor = vec4(albedo * light, 1.0);
    gl_FragColor = linearToOutputTexel(gl_FragColor);
  }
`;

/**
 * Foliage: texture + alpha test + MC brightness from static/dynamic light atlases.
 */
export function createFoliageMaterial(textureId, windStrength = 0.05, bladeHeight = 0.28) {
  const map = getBlockTexture(textureId);
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uAlphaTest: { value: 0.45 },
      uTime: grassTimeUniform,
      uWindStrength: { value: windStrength },
      uBladeHeight: { value: bladeHeight },
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
    },
    vertexShader: FOLIAGE_VERTEX,
    fragmentShader: FOLIAGE_FRAGMENT,
    transparent: false,
    depthWrite: true,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

export function updateGrassShaderTime(dt) {
  grassTimeUniform.value += dt;
}
