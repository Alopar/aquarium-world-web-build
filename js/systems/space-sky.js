import * as THREE from 'three';
import { SPACE_SKY } from '../constants.js';
import { getTankBounds } from '../world/glass-tank.js';

const loader = new THREE.TextureLoader();

const SKY_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPos;

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec3 uCameraPos;
  uniform float uMinX;
  uniform float uMaxX;
  uniform float uMinZ;
  uniform float uMaxZ;
  uniform float uMinY;
  uniform float uFadeStart;
  uniform float uFadeEnd;
  uniform float uDirectionPower;

  varying vec2 vUv;
  varying vec3 vWorldPos;

  float smstep(float edge0, float edge1, float x) {
    float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
  }

  float planeVisibility(float distToPlane, vec3 dir, vec3 outwardNormal) {
    float proximity = 1.0 - smstep(uFadeEnd, uFadeStart, distToPlane);
    float facing = pow(max(0.0, dot(dir, outwardNormal)), uDirectionPower);
    return proximity * facing;
  }

  void main() {
    vec3 dir = normalize(vWorldPos - uCameraPos);

    float visibility = 0.0;
    visibility = max(visibility, planeVisibility(uCameraPos.y - uMinY, dir, vec3(0.0, -1.0, 0.0)));
    visibility = max(visibility, planeVisibility(uCameraPos.x - uMinX, dir, vec3(-1.0, 0.0, 0.0)));
    visibility = max(visibility, planeVisibility(uMaxX - uCameraPos.x, dir, vec3(1.0, 0.0, 0.0)));
    visibility = max(visibility, planeVisibility(uCameraPos.z - uMinZ, dir, vec3(0.0, 0.0, -1.0)));
    visibility = max(visibility, planeVisibility(uMaxZ - uCameraPos.z, dir, vec3(0.0, 0.0, 1.0)));

    vec4 tex = texture2D(uTexture, vUv);
    gl_FragColor = vec4(tex.rgb, tex.a * visibility);
  }
`;

function loadMenuBgTexture() {
  return new Promise((resolve, reject) => {
    loader.load(
      SPACE_SKY.texture,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        resolve(texture);
      },
      undefined,
      reject,
    );
  });
}

function distanceToGlass(position, bounds) {
  return Math.min(
    position.x - bounds.minX,
    bounds.maxX - position.x,
    position.z - bounds.minZ,
    bounds.maxZ - position.z,
    position.y - bounds.minY,
  );
}

export class SpaceSky {
  static async create(scene) {
    const texture = await loadMenuBgTexture();
    return new SpaceSky(scene, texture);
  }

  constructor(scene, texture) {
    this.bounds = getTankBounds();

    const geometry = new THREE.SphereGeometry(
      SPACE_SKY.radius,
      64,
      32,
    );

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: texture },
        uCameraPos: { value: new THREE.Vector3() },
        uMinX: { value: this.bounds.minX },
        uMaxX: { value: this.bounds.maxX },
        uMinZ: { value: this.bounds.minZ },
        uMaxZ: { value: this.bounds.maxZ },
        uMinY: { value: this.bounds.minY },
        uFadeStart: { value: SPACE_SKY.fadeStart },
        uFadeEnd: { value: SPACE_SKY.fadeEnd },
        uDirectionPower: { value: SPACE_SKY.directionPower },
      },
      vertexShader: SKY_VERTEX_SHADER,
      fragmentShader: SKY_FRAGMENT_SHADER,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      fog: false,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'space-sky';
    this.mesh.renderOrder = -1000;
    scene.add(this.mesh);
    this.decorEnabled = true;
  }

  setDecorEnabled(enabled) {
    this.decorEnabled = enabled !== false;
    if (!this.decorEnabled) {
      this.mesh.visible = false;
    }
  }

  update(camera) {
    this.material.uniforms.uCameraPos.value.copy(camera.position);
    this.mesh.position.copy(camera.position);

    if (!this.decorEnabled) {
      this.mesh.visible = false;
      return;
    }

    const dist = distanceToGlass(camera.position, this.bounds);
    this.mesh.visible = dist < SPACE_SKY.fadeStart;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.uniforms.uTexture.value?.dispose();
    this.material.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}
