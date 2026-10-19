import * as THREE from 'three';
import { Noise2D, smoothstep } from '../core/math';

/** Shared ground palette + vegetation density functions (used by terrain colouring and tree placement). */
export const GROUND = {
  grassA: new THREE.Color('#7a9e48'),
  grassB: new THREE.Color('#5f8a40'),
  grassDry: new THREE.Color('#9ea257'),
  forestFloor: new THREE.Color('#5b7134'),
  forestDark: new THREE.Color('#47602d'),
  sand: new THREE.Color('#d9bf95'),
  sandDark: new THREE.Color('#c4a47a'),
  dirtBank: new THREE.Color('#c49a6c'),
  rock: new THREE.Color('#8f8a7e'),
  farForest: new THREE.Color('#3f6236'),
  farMeadow: new THREE.Color('#7c9a4c'),
};

export class Biome {
  private n: Noise2D;
  private m: Noise2D;

  constructor(seed: number) {
    this.n = new Noise2D(seed + 101);
    this.m = new Noise2D(seed + 202);
  }

  /** 0 = open meadow, 1 = dense forest. */
  forest(x: number, z: number): number {
    const a = this.n.fbm(x / 210, z / 210, 3);
    const b = this.n.noise(x / 60 + 3.3, z / 60 - 9.1) * 0.25;
    return smoothstep(-0.42, 0.12, a + b);
  }

  /** 0 = broadleaf dominated, 1 = conifer dominated. */
  conifer(x: number, z: number): number {
    return smoothstep(-0.3, 0.35, this.m.fbm(x / 260 + 40, z / 260 - 17, 2));
  }

  /** Low-frequency grass tint variation in [-1,1]. */
  tint(x: number, z: number): number {
    return this.m.fbm(x / 85, z / 85, 3);
  }

  speckle(x: number, z: number): number {
    return this.n.noise(x / 9, z / 9);
  }
}
