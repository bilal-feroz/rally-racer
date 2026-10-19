import { clamp, smoothstep } from '../core/math';
import type { Track } from '../track/Track';
import type { DriveInput, VehicleSim } from '../vehicle/VehicleSim';

export interface AutopilotOptions {
  /** usable lateral acceleration (m/s^2) */
  latAcc: number;
  /** planned braking deceleration (m/s^2) */
  brakeDec: number;
  /** speed cap (m/s) */
  vMax: number;
  /** multiplier on everything (0.5 = cautious) */
  aggression: number;
}

/**
 * Test driver. Uses the same DriveInput path as a human: pure-pursuit steering toward a point
 * ahead on the centre line, and a speed plan derived from curvature + crest geometry.
 */
export class Autopilot {
  readonly profile: Float32Array;
  readonly opts: AutopilotOptions;
  lateralTarget = 0;
  private readonly out: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
  stuckTime = 0;

  constructor(
    readonly track: Track,
    opts: Partial<AutopilotOptions> = {},
  ) {
    this.opts = { latAcc: 8.8, brakeDec: 8.0, vMax: 58, aggression: 1, ...opts };
    this.profile = this.buildProfile();
  }

  private buildProfile(): Float32Array {
    const T = this.track;
    const n = T.n;
    const v = new Float32Array(n);
    const o = this.opts;
    const g = 9.81;
    for (let i = 0; i < n; i++) {
      // curvature averaged over a window for robustness
      let kmax = 0;
      for (let j = -6; j <= 6; j += 3) {
        const k = Math.abs(T.kappa[Math.min(n - 1, Math.max(0, i + j))]);
        kmax = Math.max(kmax, k);
      }
      // banking into the turn raises the limit; off-camber lowers it
      const bankInto = T.bank[i] * Math.sign(T.kappa[i] || 1);
      const lat = o.latAcc * o.aggression * (1 + 1.2 * Math.sin(bankInto));
      let vi = kmax > 1e-5 ? Math.sqrt(lat / kmax) : o.vMax;
      // crests: limit speed so jumps stay sane (vertical curvature)
      const a = Math.max(0, i - 3);
      const b = Math.min(n - 1, i + 3);
      const y2 = (T.py[b] - 2 * T.py[i] + T.py[a]) / (((b - a) / 2) * ((b - a) / 2));
      if (y2 < -0.002) vi = Math.min(vi, Math.sqrt(g / -y2) * 1.6);
      v[i] = Math.min(vi, o.vMax);
    }
    // backward pass: braking
    for (let i = n - 2; i >= 0; i--) {
      v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * o.brakeDec * T.ds));
    }
    return v;
  }

  targetSpeed(s: number): number {
    const i = clamp(Math.round(s / this.track.ds), 0, this.track.n - 1);
    return this.profile[i];
  }

  drive(sim: VehicleSim, s: number, dt: number): DriveInput {
    const T = this.track;
    const out = this.out;
    const v = Math.max(0, sim.forwardSpeed);
    // ---- steering: pure pursuit
    const L = clamp(7 + v * 0.42, 7, 26);
    const f = T.frameAt(Math.min(T.length - 1, s + L));
    const tx = f.x + f.lx * this.lateralTarget;
    const tz = f.z + f.lz * this.lateralTarget;
    const dx = tx - sim.pos.x;
    const dz = tz - sim.pos.z;
    // local frame of the car (horizontal)
    const fx = sim.fwd.x;
    const fz = sim.fwd.z;
    const fl = Math.hypot(fx, fz) || 1;
    const hx = fx / fl;
    const hz = fz / fl;
    const fwdC = dx * hx + dz * hz;
    // world left = (hz, -hx) so right = (-hz, hx)
    const rightC = dx * -hz + dz * hx;
    const ld2 = fwdC * fwdC + rightC * rightC;
    const curvature = (2 * rightC) / Math.max(ld2, 1);
    const wheelbase = 2.46;
    const delta = Math.atan(wheelbase * curvature);
    const maxSteer = sim.maxSteerFor(Math.abs(sim.forwardSpeed));
    let steer = delta / maxSteer;
    // yaw-rate damping: desired yaw rate (left positive) is -v * curvature
    const yawDesired = -v * curvature;
    steer += clamp((sim.angVel.y - yawDesired) * 0.55, -0.5, 0.5);
    // lateral error relative to the current station (positive d = left of line -> steer right)
    const here = T.frameAt(s);
    const dNow = (sim.pos.x - here.x) * here.lx + (sim.pos.z - here.z) * here.lz - this.lateralTarget;
    steer += clamp(dNow * 0.06, -0.25, 0.25);
    out.steer = clamp(steer, -1, 1);

    // ---- speed control (smooth: avoid abrupt lifts/brake stabs mid-corner)
    const look = s + clamp(v * 0.35, 2, 14);
    const vt = this.targetSpeed(look);
    const err = vt - v;
    const slip = Math.abs(sim.bodySlip);
    const cornering = Math.abs(T.kappaAt(s + 5)) > 1 / 180;
    if (err > 0) {
      out.throttle = clamp(0.5 + err * 0.3, 0, 1) * (1 - smoothstep(0.2, 0.45, slip) * 0.6);
      out.brake = 0;
    } else if (err > (cornering ? -3.5 : -1.5)) {
      out.throttle = clamp(0.35 + err * 0.1, 0.05, 0.4);
      out.brake = 0;
    } else {
      out.throttle = 0;
      out.brake = clamp(-err * 0.2, 0, cornering ? 0.45 : 1);
    }
    out.handbrake = 0;
    // reverse out if stuck facing a tree
    if (sim.speed < 1 && out.throttle > 0.3) this.stuckTime += dt;
    else this.stuckTime = Math.max(0, this.stuckTime - dt);
    return out;
  }
}
