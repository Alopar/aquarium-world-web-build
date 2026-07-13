import * as THREE from 'three';

/** Shared clock for all fluid shader materials. */
export const fluidTimeUniform = { value: 0 };

/** Shared lighting — updated by DayNightSystem so water matches scene lights. */
export const fluidLightUniforms = {
  uSunDir: { value: new THREE.Vector3(48, 64, 32).normalize() },
  uSunColor: { value: new THREE.Color(0xfff4d6) },
  uAmbientColor: { value: new THREE.Color(0xb8d8ff).multiplyScalar(0.55) },
};

/**
 * @param {THREE.Vector3} sunDir
 * @param {THREE.Color} sunColor
 * @param {number} sunIntensity
 * @param {THREE.Color} ambientColor
 * @param {number} ambientIntensity
 */
export function setFluidLightUniforms(sunDir, sunColor, sunIntensity, ambientColor, ambientIntensity) {
  fluidLightUniforms.uSunDir.value.copy(sunDir);
  // Day sun intensity is 1.1 on the scene light; water shader historically used unscaled color.
  const sunScale = sunIntensity / 1.1;
  fluidLightUniforms.uSunColor.value.copy(sunColor).multiplyScalar(Math.max(0, sunScale));
  fluidLightUniforms.uAmbientColor.value.copy(ambientColor).multiplyScalar(Math.max(0, ambientIntensity));
}

const WATER_VERTEX = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  varying float vSurface;

  attribute float aSurface;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vSurface = aSurface;
    vViewDir = cameraPosition - worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const WATER_FRAGMENT = /* glsl */ `
  uniform vec3 uShallowColor;
  uniform vec3 uDeepColor;
  uniform float uOpacity;
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uAmbientColor;

  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  varying float vSurface;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = p * 2.05 + vec2(17.1, 9.3);
      a *= 0.5;
    }
    return v;
  }

  float waveHeight(vec2 p, float t, float strength) {
    float w1 = sin(p.x * 1.55 + t * 1.15) * cos(p.y * 1.2 - t * 0.95);
    float w2 = sin(p.x * 2.7 - t * 1.55 + p.y * 2.1) * 0.5;
    float w3 = sin(dot(p, vec2(0.85, 1.35)) * 3.6 + t * 2.1) * 0.25;
    return (w1 + w2 + w3) * strength;
  }

  // Continuous world-space waves — no per-block vertex displacement.
  vec3 surfaceWaveNormal(vec3 worldPos, float strength) {
    float t = uTime;
    vec2 xz = worldPos.xz;
    float e = 0.12;
    float h = waveHeight(xz, t, strength);
    float hx = waveHeight(xz + vec2(e, 0.0), t, strength);
    float hz = waveHeight(xz + vec2(0.0, e), t, strength);
    return normalize(vec3(-(hx - h) / e, 1.0, -(hz - h) / e));
  }

  float caustics(vec2 p, float t) {
    vec2 q = p * 0.45;
    float a = fbm(q + t * 0.14);
    float b = fbm(q * 1.6 - t * 0.11 + a * 1.4);
    float c = fbm(q * 2.6 + b * 1.1 + t * 0.09);
    return pow(max(0.0, 1.0 - abs(a + b * 0.55 - c) * 1.7), 2.5);
  }

  void main() {
    vec3 viewDir = normalize(vViewDir);
    vec3 geoN = normalize(vNormalW);
    if (!gl_FrontFacing) geoN = -geoN;

    float surfaceMix = vSurface * smoothstep(0.2, 0.75, abs(geoN.y));

    // Surface lighting from continuous world waves; sides keep geometry normal.
    vec3 waveN = surfaceWaveNormal(vWorldPos, 0.16);
    if (!gl_FrontFacing) waveN = -waveN;
    vec3 n = normalize(mix(geoN, waveN, surfaceMix));

    float ndv = max(0.0, dot(n, viewDir));
    float fresnel = mix(0.06, 1.0, pow(1.0 - ndv, 3.0));

    float depthHint = 1.0 - clamp(vWorldPos.y / 28.0, 0.0, 1.0);
    vec3 waterColor = mix(uShallowColor, uDeepColor, depthHint * 0.7 + (1.0 - surfaceMix) * 0.3);

    float cau = caustics(vWorldPos.xz, uTime);
    waterColor += uShallowColor * cau * (0.1 + surfaceMix * 0.18);

    // Underside of the water surface — brighter meniscus so the free surface reads from below.
    float underside = (gl_FrontFacing ? 0.0 : 1.0) * surfaceMix;
    waterColor = mix(waterColor, mix(uShallowColor, vec3(0.85, 0.95, 1.0), 0.55), underside * 0.75);

    vec3 lightDir = normalize(uSunDir);
    float wrap = max(0.0, dot(n, lightDir)) * 0.6 + 0.4;

    vec3 halfDir = normalize(lightDir + viewDir);
    // Soft wide specular — hard sparkles were reading as block edges.
    float spec = pow(max(0.0, dot(n, halfDir)), mix(24.0, 56.0, surfaceMix));

    vec3 lit = waterColor * (uAmbientColor + uSunColor * wrap * 0.8);
    lit += uSunColor * spec * (0.22 + surfaceMix * 0.28);
    lit += mix(uDeepColor, uShallowColor, 0.55) * fresnel * 0.18;
    lit += uShallowColor * underside * (0.45 + fresnel * 0.55);
    lit = mix(lit, vec3(0.55, 0.82, 1.0), underside * fresnel * 0.4);

    float alpha = uOpacity;
    alpha = mix(alpha * 0.9, min(0.88, alpha + 0.22), fresnel);
    alpha = mix(alpha, min(0.9, alpha + 0.08), surfaceMix * 0.4);
    alpha = mix(alpha, min(0.95, 0.55 + fresnel * 0.4), underside);
    alpha = clamp(alpha, 0.22, 0.95);

    gl_FragColor = vec4(lit, alpha);
  }
`;

const LAVA_VERTEX = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying float vSurface;
  attribute float aSurface;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vSurface = aSurface;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const LAVA_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uEmissive;
  uniform float uOpacity;
  uniform float uTime;

  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying float vSurface;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  void main() {
    vec3 n = normalize(vNormalW);
    float crust = noise(vWorldPos.xz * 1.8 + uTime * 0.15);
    float glow = noise(vWorldPos.xz * 3.4 - uTime * 0.35);
    float crack = smoothstep(0.35, 0.75, crust);
    float pulse = 0.75 + 0.25 * sin(uTime * 2.2 + glow * 6.28);

    vec3 col = mix(uColor * 0.45, uEmissive, crack * pulse);
    col += uEmissive * glow * 0.35 * (0.5 + vSurface * 0.5);
    col *= 0.85 + 0.15 * max(0.0, n.y);

    gl_FragColor = vec4(col, uOpacity);
  }
`;

function colorFromHex(hex) {
  return new THREE.Color(hex);
}

/**
 * Build a Three.js material for a liquid definition from the materials registry.
 */
export function createFluidShaderMaterial(materialDef) {
  if (materialDef.emissive != null) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: colorFromHex(materialDef.color) },
        uEmissive: { value: colorFromHex(materialDef.emissive) },
        uOpacity: { value: materialDef.opacity ?? 0.85 },
        uTime: fluidTimeUniform,
      },
      vertexShader: LAVA_VERTEX,
      fragmentShader: LAVA_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      fog: false,
    });
  }

  const base = colorFromHex(materialDef.color);
  const shallow = base.clone().lerp(new THREE.Color(0xa8e8ff), 0.35);
  const deep = base.clone().multiplyScalar(0.45).lerp(new THREE.Color(0x0a3a6e), 0.4);

  return new THREE.ShaderMaterial({
    uniforms: {
      uShallowColor: { value: shallow },
      uDeepColor: { value: deep },
      uOpacity: { value: materialDef.opacity ?? 0.5 },
      uTime: fluidTimeUniform,
      uSunDir: fluidLightUniforms.uSunDir,
      uSunColor: fluidLightUniforms.uSunColor,
      uAmbientColor: fluidLightUniforms.uAmbientColor,
    },
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
}

export function updateFluidShaderTime(elapsedSeconds) {
  fluidTimeUniform.value = elapsedSeconds;
}
