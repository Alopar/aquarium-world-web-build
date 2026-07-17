import * as THREE from 'three';
import { SIGNAL_ROCKET } from '../constants.js';
import { SignalRocket } from '../entities/signal-rocket.js';

/**
 * Signal rockets: straight-shot flares with persistent red dynamic light.
 */
export class SignalRocketSystem {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.rockets = [];
    this.group = new THREE.Group();
    this.group.name = 'signal-rockets';
    scene.add(this.group);

    this._spawnDir = new THREE.Vector3();
    this._spawnPos = new THREE.Vector3();
    this._spawnVel = new THREE.Vector3();
  }

  get count() {
    return this.rockets.length;
  }

  throw(origin, direction) {
    this._spawnDir.copy(direction).normalize();
    this._spawnPos.copy(origin).addScaledVector(this._spawnDir, SIGNAL_ROCKET.spawnOffset);
    this._spawnVel.copy(this._spawnDir).multiplyScalar(SIGNAL_ROCKET.throwSpeed);

    const rocket = new SignalRocket(this._spawnPos, this._spawnVel);
    this.rockets.push(rocket);
    this.group.add(rocket.mesh);
    this._syncLight(rocket);
    return true;
  }

  update(dt) {
    const lighting = this.world.lighting;
    const grid = this.world.grid;

    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const rocket = this.rockets[i];
      rocket.update(grid, dt, lighting);

      if (!rocket.alive) {
        lighting.removeDynamicLight(rocket.lightId);
        this.removeAt(i);
        continue;
      }

      this._syncLight(rocket);
    }
  }

  _syncLight(rocket) {
    this.world.lighting.upsertDynamicLight(
      rocket.lightId,
      rocket.position.x,
      rocket.position.y,
      rocket.position.z,
      SIGNAL_ROCKET.lightLevel,
      SIGNAL_ROCKET.lightColor,
    );
  }

  removeAt(index) {
    const rocket = this.rockets[index];
    this.group.remove(rocket.mesh);
    rocket.dispose();
    this.rockets.splice(index, 1);
  }

  dispose() {
    for (const rocket of this.rockets) {
      this.world.lighting.removeDynamicLight(rocket.lightId);
      this.group.remove(rocket.mesh);
      rocket.dispose();
    }
    this.rockets = [];
    this.scene.remove(this.group);
  }
}
