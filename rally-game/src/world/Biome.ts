import * as THREE from 'three';
import { Noise2D, smoothstep } from '../core/math';

/** Shared ground palette + vegetation density functions (used by terrain colouring and tree placement). */
export const GROUND = {
  grassA: new THREE.Color('#8a9f55'),
  grassB: new THREE.Color('#6e8a4c'),
  grassDry: new THREE.Color('#a8a463'),
  forestFloor: new THREE.Color('#64713f'),
  forestDark: new THREE.Color('#536039'),
  sand: new THREE.Color('#dfc8a6'),
  sandDark: new THREE.Color('#cbb08c'),
  dirtBank: new THREE.Color('#c49a6c'),
  rock: new THREE.Color('#8f8a7e'),
  shore: new THREE.Color('#b9a57f'),
  farForest: new THREE.Color('#4c6442'),
  farMeadow: new THREE.Color('#869a59'),
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
