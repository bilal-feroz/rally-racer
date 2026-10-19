import * as THREE from 'three';
import { clamp, damp, smoothstep, wrapAngle } from '../core/math';
import type { Track } from '../track/Track';
import type { VehicleSim } from '../vehicle/VehicleSim';
import type { TerrainField } from '../world/TerrainField';

export type CameraMode = 'chase' | 'hood' | 'cinematic';

const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();

/**
 * Spring chase camera. Yaw follows a blend of velocity and heading so drifts show the car's
 * flank like the reference; offset (not absolute position) is smoothed to keep the car steady.
 */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'chase';
  portrait = false;
  private yaw = 0;
  private readonly offset = new THREE.Vector3();
  private heightOff = 2.2;
  private pitchLook = 0;
  private turnLook = 0;
  private followY = 0;
  private init = false;
  private shakeAmp = 0;
  private shakeT = 0;
  private fov = 60;
  private readonly cine = new THREE.Vector3();
  private cineS = -1;
  private readonly look = new THREE.Vector3();
  /** returns distance to the nearest obstacle (set by the game) */
  clearance: ((x: number, z: number) => number) | null = null;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.25, 9000);
  }

  reset(): void {
    this.init = false;
    this.cineS = -1;
  }

  addShake(a: number): void {
    this.shakeAmp = Math.min(1, this.shakeAmp + a);
  }

  cycle(): CameraMode {
    this.mode = this.mode === 'chase' ? 'hood' : this.mode === 'hood' ? 'cinematic' : 'chase';
    this.init = false;
    this.cineS = -1;
    return this.mode;
  }

  update(dt: number, sim: VehicleSim, carPos: THREE.Vector3, carQuat: THREE.Quaternion, field: TerrainField, track: Track): void {
    const cam = this.camera;
    _fwd.set(0, 0, 1).applyQuaternion(carQuat);
    _up.set(0, 1, 0).applyQuaternion(carQuat);
    const vh = Math.hypot(sim.vel.x, sim.vel.z);
    const heading = Math.atan2(_fwd.x, _fwd.z);
    this.shakeT += dt;
    this.shakeAmp = Math.max(0, this.shakeAmp - dt * 2.2);
    const impact = Math.max(sim.landingImpact * 0.5, sim.collisionImpact);
    if (impact > 0.15) this.addShake(impact * dt * 6);

    if (this.mode === 'hood') {
      // bonnet cam: just ahead of the windscreen, above the hood (outside the cabin shell)
      cam.position.copy(carPos).addScaledVector(_up, 0.56).addScaledVector(_fwd, 1.3);
      this.look.copy(cam.position).addScaledVector(_fwd, 20).addScaledVector(_up, -0.35);
      cam.up.copy(_up).lerp(_v.set(0, 1, 0), 0.6).normalize();
      cam.lookAt(this.look);
      this.applyFov(dt, 72 + 8 * smoothstep(15, 55, vh));
      this.init = false;
      return;
    }
    cam.up.set(0, 1, 0);

    if (this.mode === 'cinematic') {
      const s = sim.trackHint >= 0 ? sim.trackHint * track.ds : 0;
      if (this.cineS < 0 || s > this.cineS + 35 || s < this.cineS - 220) {
        // trackside spot with a clear view: on the outside of the upcoming curve, away from trunks
        let best = -1;
        let bx = 0;
        let bz = 0;
        for (let k = 0; k < 24; k++) {
          const cs = Math.min(track.length - 5, s + 90 + k * 6);
          const f = track.frameAt(cs);
          const side = f.kappa === 0 ? (k % 2 ? 1 : -1) : -Math.sign(f.kappa);
          const off = f.hw + 5 + (k % 3);
          const x = f.x + f.lx * off * side;
          const z = f.z + f.lz * off * side;
          const clear = this.clearance ? this.clearance(x, z) : 10;
          const score = Math.min(clear, 8) + Math.abs(f.kappa) * 400;
          if (score > best) {
            best = score;
            bx = x;
            bz = z;
            this.cineS = cs;
          }
        }
        this.cine.set(bx, field.heightAt(bx, bz) + 1.8 + Math.random() * 1.5, bz);
      }
      cam.position.copy(this.cine);
      this.look.copy(carPos).addScaledVector(_up, 0.4);
      cam.lookAt(this.look);
      const dist = cam.position.distanceTo(carPos);
      this.applyFov(dt, clamp(2 * Math.atan(5.5 / Math.max(dist, 1)) * (180 / Math.PI), 12, 60));
      return;
    }

    // ---------------------------------------------------------------- chase
    let target = heading;
    if (vh > 2.5 && sim.forwardSpeed > -1) {
      const velYaw = Math.atan2(sim.vel.x, sim.vel.z);
      const w = 0.62 * smoothstep(3, 14, vh);
      target = heading + wrapAngle(velYaw - heading) * w;
    }
    if (!this.init) {
      this.yaw = target;
    }
    const yawRate = 4.2 + 2.0 * smoothstep(20, 50, vh);
    this.yaw += wrapAngle(target - this.yaw) * (1 - Math.exp(-yawRate * dt));
    this.yaw = wrapAngle(this.yaw);

    const dist = (this.portrait ? 7.0 : 5.7) + vh * 0.014;
    const height = this.portrait ? 2.2 : 2.3;
    const dx = -Math.sin(this.yaw) * dist;
    const dz = -Math.cos(this.yaw) * dist;
    if (!this.init) {
      this.offset.set(dx, 0, dz);
      this.heightOff = height;
    }
    this.offset.x = damp(this.offset.x, dx, 14, dt);
    this.offset.z = damp(this.offset.z, dz, 14, dt);
    // vertical: soft spring so crests and jumps breathe
    this.heightOff = damp(this.heightOff, height - clamp(sim.vel.y * 0.05, -0.5, 0.5), sim.groundedWheels === 0 ? 2.2 : 4, dt);
    // vertical follow lags while airborne so jumps visibly lift the car in frame
    if (!this.init) this.followY = carPos.y;
    // stay low on take-off so the car visibly climbs in frame; catch up quickly after landing
    this.followY = damp(this.followY, carPos.y, sim.groundedWheels === 0 ? 0.7 : sim.airTime === 0 && sim.lastAirTime > 0.3 ? 5 : 9, dt);
    cam.position.set(carPos.x + this.offset.x, this.followY + this.heightOff, carPos.z + this.offset.z);
    const g = field.heightAt(cam.position.x, cam.position.z);
    if (cam.position.y < g + 0.9) cam.position.y = g + 0.9;

    // look slightly ahead into the corner
    // portrait framing (reference): nearly level camera aimed far down the road
    const la = (this.portrait ? 7.5 : 1.2) + vh * 0.05;
    const ly = Math.sin(this.yaw);
    const lz = Math.cos(this.yaw);
    this.pitchLook = damp(this.pitchLook, clamp(sim.vel.y * 0.04, -0.4, 0.4), 4, dt);
    // glance into the corner: shift the aim toward the inside of the turn (yaw rate, left +)
    this.turnLook = damp(this.turnLook, clamp(sim.angVel.y * 1.1, -1.6, 1.6) * smoothstep(5, 20, vh), 3, dt);
    const lx = Math.cos(this.yaw);
    const lzLeft = -Math.sin(this.yaw);
    this.look.set(
      carPos.x + ly * la + lx * this.turnLook,
      this.followY + (this.portrait ? 1.05 : 0.62) + this.pitchLook,
      carPos.z + lz * la + lzLeft * this.turnLook,
    );
    if (this.shakeAmp > 0.001) {
      const a = this.shakeAmp * this.shakeAmp * 0.12;
      const t = this.shakeT * 37;
      cam.position.x += Math.sin(t * 1.3) * a;
      cam.position.y += Math.sin(t * 1.9 + 1.1) * a;
      this.look.y += Math.sin(t * 2.3 + 0.5) * a * 0.5;
    }
    cam.lookAt(this.look);
    const fovBase = this.portrait ? 74 : 56;
    this.applyFov(dt, fovBase + 10 * smoothstep(12, 58, vh));
    this.init = true;
  }

  private applyFov(dt: number, target: number): void {
    this.fov = damp(this.fov, target, 3, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
