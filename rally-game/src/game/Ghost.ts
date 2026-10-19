import * as THREE from 'three';
import { CarModel } from '../vehicle/CarModel';
import { CAR } from '../vehicle/VehicleParams';

const KEY = 'timberline-rally.ghost.v1';
const RATE = 20; // samples per second
const STRIDE = 8; // t, x, y, z, qx, qy, qz, qw

/** Records the player's run and stores the personal-best run in localStorage. */
export class GhostRecorder {
  private data: number[] = [];
  private next = 0;

  reset(): void {
    this.data = [];
    this.next = 0;
  }

  sample(t: number, pos: THREE.Vector3, q: THREE.Quaternion): void {
    if (t < this.next) return;
    this.next = t + 1 / RATE;
    this.data.push(t, pos.x, pos.y, pos.z, q.x, q.y, q.z, q.w);
  }

  /** Persist the recorded run as the ghost (call when a new PB is set). */
  save(finishTime: number): void {
    try {
      const arr = new Float32Array(this.data);
      const bytes = new Uint8Array(arr.buffer);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      localStorage.setItem(KEY, JSON.stringify({ time: finishTime, data: btoa(bin) }));
    } catch {
      /* storage full or unavailable: ghost is optional */
    }
  }
}

export function loadGhost(): { time: number; samples: Float32Array } | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { time: number; data: string };
    const bin = atob(v.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const samples = new Float32Array(bytes.buffer);
    if (samples.length < STRIDE * 10) return null;
    return { time: v.time, samples };
  } catch {
    return null;
  }
}

/** Translucent replay of the personal-best run, driven by race time. */
export class GhostPlayer {
  readonly model: CarModel;
  private samples: Float32Array | null = null;
  enabled = true;
  private readonly qa = new THREE.Quaternion();
  private readonly qb = new THREE.Quaternion();

  constructor(scene: THREE.Scene) {
    this.model = new CarModel(null);
    this.model.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = false;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        if ((mat as THREE.ShaderMaterial).isShaderMaterial) {
          m.visible = false; // drop ink outlines on the ghost
          continue;
        }
        mat.transparent = true;
        mat.opacity = 0.32;
        mat.depthWrite = false;
      }
    });
    // wheels sit at static ride height (the player car's are driven by the sim)
    const mounts = [
      [CAR.halfTrackF, CAR.frontAxleZ],
      [-CAR.halfTrackF, CAR.frontAxleZ],
      [CAR.halfTrackR, CAR.rearAxleZ],
      [-CAR.halfTrackR, CAR.rearAxleZ],
    ];
    this.model.wheels.forEach((w, k) => w.pivot.position.set(mounts[k][0], CAR.mountY - (CAR.travel - 0.09), mounts[k][1]));
    this.model.root.visible = false;
    this.model.blob.visible = false;
    scene.add(this.model.root);
  }

  load(): number | null {
    const g = loadGhost();
    this.samples = g ? g.samples : null;
    return g ? g.time : null;
  }

  update(raceTime: number, active: boolean): void {
    const s = this.samples;
    if (!s || !active || !this.enabled) {
      this.model.root.visible = false;
      return;
    }
    const n = s.length / STRIDE;
    // samples are uniform in time (RATE); index directly then clamp
    let i = Math.floor((raceTime - s[0]) * RATE);
    if (i < 0) i = 0;
    if (i >= n - 1) {
      this.model.root.visible = false;
      return;
    }
    // correct for any drift in sample spacing
    while (i < n - 2 && s[(i + 1) * STRIDE] < raceTime) i++;
    while (i > 0 && s[i * STRIDE] > raceTime) i--;
    const a = i * STRIDE;
    const b = (i + 1) * STRIDE;
    const t = Math.min(1, Math.max(0, (raceTime - s[a]) / Math.max(1e-4, s[b] - s[a])));
    const root = this.model.root;
    root.position.set(s[a + 1] + (s[b + 1] - s[a + 1]) * t, s[a + 2] + (s[b + 2] - s[a + 2]) * t, s[a + 3] + (s[b + 3] - s[a + 3]) * t);
    this.qa.set(s[a + 4], s[a + 5], s[a + 6], s[a + 7]);
    this.qb.set(s[b + 4], s[b + 5], s[b + 6], s[b + 7]);
    root.quaternion.copy(this.qa).slerp(this.qb, t);
    root.visible = true;
  }
}
