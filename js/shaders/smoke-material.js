import * as THREE from 'three';

/** Shared clock for smoke volume raymarch. */
export const smokeTimeUniform = { value: 0 };

const SMOKE_VOLUME_VERTEX = /* glsl */ `
  out vec3 vWorldPos;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const SMOKE_VOLUME_FRAGMENT = /* glsl */ `
  precision highp float;
  precision highp sampler3D;

  uniform sampler3D uDensity;
  uniform vec3 uGridSize;
  uniform vec3 uBoundsMin;
  uniform vec3 uBoundsMax;
  uniform vec3 uColorLight;
  uniform vec3 uColorDark;
  uniform float uAbsorption;
  uniform float uDensityPower;
  uniform float uTime;
  uniform float uStepSize;
  uniform float uInside;

  in vec3 vWorldPos;
  out vec4 fragColor;

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

  // Flowing smoke noise — drifts upward and swirls like water caustics
  float smokeFlow(vec3 p, float t) {
    vec2 xz = p.xz * 0.55;
    // Rise + slow swirl
    xz += vec2(t * 0.12, t * 0.08);
    xz.y -= t * 0.35; // upward drift in world Y mapped into scroll

    float n1 = fbm(xz + vec2(t * 0.15, -t * 0.11));
    float n2 = fbm(xz * 1.7 - vec2(t * 0.22, t * 0.18) + n1 * 1.3);
    float n3 = fbm(xz * 2.8 + vec2(-t * 0.09, t * 0.27) + n2 * 0.9);

    // Vertical billows
    float billow = fbm(vec2(p.x * 0.4 + p.z * 0.4, p.y * 0.7 - t * 0.55));
    return clamp(n1 * 0.4 + n2 * 0.35 + n3 * 0.15 + billow * 0.25, 0.0, 1.0);
  }

  vec2 intersectAABB(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax) {
    vec3 inv = 1.0 / rd;
    vec3 t0 = (bmin - ro) * inv;
    vec3 t1 = (bmax - ro) * inv;
    vec3 tmin3 = min(t0, t1);
    vec3 tmax3 = max(t0, t1);
    float tmin = max(max(tmin3.x, tmin3.y), tmin3.z);
    float tmax = min(min(tmax3.x, tmax3.y), tmax3.z);
    return vec2(tmin, tmax);
  }

  float sampleDensity(vec3 worldPos, float flow) {
    vec3 uvw = worldPos / uGridSize;
    if (uvw.x < 0.0 || uvw.y < 0.0 || uvw.z < 0.0) return 0.0;
    if (uvw.x > 1.0 || uvw.y > 1.0 || uvw.z > 1.0) return 0.0;

    vec3 warp = vec3(
      (flow - 0.5) * 0.12,
      (flow - 0.5) * 0.08,
      (flow - 0.5) * 0.12
    );
    uvw += warp / uGridSize;

    float d = texture(uDensity, clamp(uvw, 0.001, 0.999)).r;
    d = smoothstep(0.12, 0.42, d);
    d = d * d;
    d *= mix(0.55, 1.2, flow);
    return pow(max(d, 0.0), uDensityPower);
  }

  void main() {
    if (uInside < 0.5) {
      if (!gl_FrontFacing) discard;
    } else {
      if (gl_FrontFacing) discard;
    }

    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorldPos - cameraPosition);

    vec2 hit = intersectAABB(ro, rd, uBoundsMin, uBoundsMax);
    if (hit.x > hit.y) discard;

    float tEnter = max(hit.x, 0.0);
    float tExit = hit.y;
    if (tExit <= tEnter) discard;

    float pathLen = tExit - tEnter;
    float stepSize = max(uStepSize, pathLen / 80.0);
    float jitter = hash21(gl_FragCoord.xy + vec2(uTime * 0.05, 1.7));
    float t = tEnter + jitter * stepSize;

    float transmittance = 1.0;
    vec3 scattered = vec3(0.0);

    for (int i = 0; i < 80; i++) {
      if (t >= tExit || transmittance < 0.015) break;

      vec3 p = ro + rd * t;
      float flow = smokeFlow(p, uTime);
      float dens = sampleDensity(p, flow);

      if (dens > 0.002) {
        float absorb = dens * uAbsorption * stepSize;
        absorb = min(absorb, 5.0);

        vec3 smokeCol = mix(uColorLight, uColorDark, clamp(dens * 0.7, 0.0, 1.0));
        smokeCol *= mix(0.78, 1.18, flow);
        smokeCol = mix(smokeCol, uColorLight * 1.15, flow * 0.35);

        float alphaStep = 1.0 - exp(-absorb);
        scattered += smokeCol * alphaStep * transmittance;
        transmittance *= (1.0 - alphaStep);
      }

      t += stepSize;
    }

    float alpha = 1.0 - transmittance;
    if (alpha < 0.02) discard;

    fragColor = vec4(scattered, alpha);
  }
`;

/**
 * Volumetric smoke — raymarches density field like a smoke-grenade cloud.
 * @param {THREE.Data3DTexture} densityTexture
 * @param {{ x: number, y: number, z: number }} gridSize
 * @param {number|THREE.Color} baseColor
 */
export function createSmokeVolumeMaterial(densityTexture, gridSize, baseColor) {
  const light = new THREE.Color(0xe8ecf2);
  const dark = new THREE.Color(0xb0b6c0);

  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uDensity: { value: densityTexture },
      uGridSize: { value: new THREE.Vector3(gridSize.x, gridSize.y, gridSize.z) },
      uBoundsMin: { value: new THREE.Vector3() },
      uBoundsMax: { value: new THREE.Vector3(gridSize.x, gridSize.y, gridSize.z) },
      uColorLight: { value: light },
      uColorDark: { value: dark },
      uAbsorption: { value: 3.2 },
      uDensityPower: { value: 1.0 },
      uTime: smokeTimeUniform,
      uStepSize: { value: 0.28 },
      uInside: { value: 0 },
    },
    vertexShader: SMOKE_VOLUME_VERTEX,
    fragmentShader: SMOKE_VOLUME_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: false,
  });
}

export function updateSmokeShaderTime(elapsedSeconds) {
  smokeTimeUniform.value = elapsedSeconds;
}

/**
 * @param {THREE.ShaderMaterial} material
 * @param {{ minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number }} bounds
 */
export function setSmokeVolumeBounds(material, bounds) {
  material.uniforms.uBoundsMin.value.set(bounds.minX, bounds.minY, bounds.minZ);
  material.uniforms.uBoundsMax.value.set(bounds.maxX, bounds.maxY, bounds.maxZ);
}
