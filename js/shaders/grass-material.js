import * as THREE from 'three';
import { getBlockTexture } from '../materials/textures.js';

/** Shared clock for grass / flower wind. */
export const grassTimeUniform = { value: 0 };

/**
 * Lit foliage material with tip wind + alpha-tested sprite.
 * @param {string} textureId
 * @param {number} [windStrength]
 * @param {number} [bladeHeight] world-space height (for wind tip falloff)
 */
export function createFoliageMaterial(textureId, windStrength = 0.05, bladeHeight = 0.28) {
  const map = getBlockTexture(textureId);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map,
    alphaTest: 0.45,
    transparent: false,
    depthWrite: true,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = grassTimeUniform;
    shader.uniforms.uWindStrength = { value: windStrength };
    shader.uniforms.uBladeHeight = { value: bladeHeight };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform float uWindStrength;
        uniform float uBladeHeight;
        `,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        float tip = clamp(transformed.y / max(uBladeHeight, 0.001), 0.0, 1.0);
        tip *= tip;
        vec3 instOrigin = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float phase = instOrigin.x * 0.7 + instOrigin.z * 0.55;
        float wind = sin(uTime * 1.8 + phase) * uWindStrength * tip;
        transformed.x += wind;
        transformed.z += cos(uTime * 1.35 + phase * 1.1) * uWindStrength * 0.55 * tip;
        `,
      );
  };

  material.customProgramCacheKey = () => `foliage-${textureId}-${windStrength}-${bladeHeight}`;
  return material;
}

/** @deprecated use createFoliageMaterial('grass_blade', ...) */
export function createGrassMaterial(windStrength = 0.05, bladeHeight = 0.28) {
  return createFoliageMaterial('grass_blade', windStrength, bladeHeight);
}

export function updateGrassShaderTime(dt) {
  grassTimeUniform.value += dt;
}
