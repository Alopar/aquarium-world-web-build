import * as THREE from 'three';
import { getBlockTexture } from '../materials/textures.js';
import {
  brightnessUniforms,
  BRIGHTNESS_GLSL,
  BRIGHTNESS_BLEND_GLSL,
} from './voxel-brightness-material.js';

export const grassTimeUniform = { value: 0 };

const FOLIAGE_VERTEX = /* glsl */ `
  attribute float aSkyLight;
  attribute vec3 aBlockLight;
  attribute float aPrevSkyLight;
  attribute vec3 aPrevBlockLight;
  attribute float aBlendStart;
  varying vec2 vUv;
  varying float vSky;
  varying vec3 vBlock;
  varying vec3 vTint;

  uniform float uTime;
  uniform float uBrightTime;
  uniform float uBrightLerp;
  uniform float uWindStrength;
  uniform float uBladeHeight;

  ${BRIGHTNESS_BLEND_GLSL}

  void main() {
    vUv = uv;
    blendFaceLight(
      aSkyLight, aBlockLight, aPrevSkyLight, aPrevBlockLight, aBlendStart,
      uBrightTime, uBrightLerp, vSky, vBlock
    );
    vTint = instanceColor.rgb;

    vec3 transformed = position;
    float tip = clamp(transformed.y / max(uBladeHeight, 0.001), 0.0, 1.0);
    tip *= tip;
    vec3 instOrigin = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
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
  varying vec2 vUv;
  varying float vSky;
  varying vec3 vBlock;
  varying vec3 vTint;

  ${BRIGHTNESS_GLSL}

  void main() {
    vec4 tex = texture2D(uMap, vUv);
    if (tex.a < uAlphaTest) discard;

    vec3 light = mcLightColor(vSky, vBlock, uDaySkyLight, uMinBrightness);
    vec3 albedo = tex.rgb * vTint;
    gl_FragColor = vec4(albedo * light, 1.0);
  }
`;

/**
 * Foliage: texture + alpha test + MC brightness from instanced light attrs.
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
      uBrightTime: brightnessUniforms.uBrightTime,
      uBrightLerp: brightnessUniforms.uBrightLerp,
    },
    vertexShader: FOLIAGE_VERTEX,
    fragmentShader: FOLIAGE_FRAGMENT,
    transparent: false,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
}

export function updateGrassShaderTime(dt) {
  grassTimeUniform.value += dt;
}
