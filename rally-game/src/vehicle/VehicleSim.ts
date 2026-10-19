import * as THREE from 'three';
import { clamp, DEG, lerp, smoothstep } from '../core/math';
import { SURF_GRASS, SURF_ROAD, type GroundSample, type TerrainField } from '../world/TerrainField';
import { CAR } from './VehicleParams';

export interface DriveInput {
  throttle: number;
  brake: number;
  /** -1 = full left, +1 = full right */
  steer: number;
  handbrake: number;
}

export interface Obstacle {
  x: number;
  z: number;
  r: number;
  /** base height (world y) */
  y?: number;
  /** height above base */
  h?: number;
}

/** car footprint: three circles along the body axis */
const CIRCLES = [1.35, 0, -1.35];

export interface CollisionWorld {
  /** returns obstacles near (x,z) */
  query(x: number, z: number, radius: number, out: Obstacle[]): number;
}

export class Wheel {
  readonly mount: THREE.Vector3;
  contact = false;
  compression = 0;
  prevCompression = 0;
  load = 0;
  readonly hit = new THREE.Vector3();
  readonly normal = new THREE.Vector3(0, 1, 0);
  surface = SURF_GRASS;
  roadness = 0;
  slipAngle = 0;
  /** longitudinal slip intensity (wheelspin / lock) 0.. */
  spin = 0;
  /** combined sliding intensity for VFX 0..1 */
  slide = 0;
  angVel = 0;
  spinAngle = 0;
  steer = 0;
  hint = -1;
  fx = 0;
  fy = 0;
  vx = 0;
  vy = 0;
  /** world position of wheel centre (for visuals) */
  readonly center = new THREE.Vector3();

  constructor(
    x: number,
    y: number,
    z: number,
    readonly front: boolean,
    readonly left: boolean,
  ) {
    this.mount = new THREE.Vector3(x, y, z);
  }
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _r = new THREE.Vector3();
const _f = new THREE.Vector3();
const _wf = new THREE.Vector3();
const _wr = new THREE.Vector3();
const _vp = new THREE.Vector3();
const _tq = new THREE.Vector3();
const _qInv = new THREE.Quaternion();
const _dq = new THREE.Quaternion();

function torqueAt(rpm: number): number {
  const T = CAR.torque;
  if (rpm <= T[0][0]) return T[0][1];
  for (let i = 1; i < T.length; i++) {
    if (rpm <= T[i][0]) {
      const t = (rpm - T[i - 1][0]) / (T[i][0] - T[i - 1][0]);
      return lerp(T[i - 1][1], T[i][1], t);
    }
  }
  return T[T.length - 1][1];
}

function latCurve(a: number): number {
  const ap = CAR.peakSlip;
  if (a < ap) return Math.sin((a / ap) * Math.PI * 0.5);
  const t = Math.min(1, (a - ap) / (CAR.slideSlip - ap));
  return 1 - (1 - CAR.slideFactor) * t * t * (3 - 2 * t);
}

export class VehicleSim {
  readonly P = CAR;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  readonly angVel = new THREE.Vector3();
  readonly wheels: Wheel[];

  // basis (updated each step)
  readonly fwd = new THREE.Vector3(0, 0, 1);
  readonly up = new THREE.Vector3(0, 1, 0);
  readonly right = new THREE.Vector3(-1, 0, 0);

  // drivetrain
  gear = 1;
  rpm = CAR.idleRpm;
  shiftTimer = 0;
  limiterTimer = 0;
  reverseTimer = 0;
  throttleEff = 0;
  brakeEff = 0;

  // steering
  steerInput = 0;
  steerAngle = 0;

  // telemetry
  speed = 0;
  forwardSpeed = 0;
  lateralSpeed = 0;
  bodySlip = 0;
  groundedWheels = 0;
  airTime = 0;
  lastAirTime = 0;
  landingImpact = 0;
  collisionImpact = 0;
  engineLoad = 0;
  wheelspin = 0;
  backfire = 0;
  trackHint = -1;
  readonly accel = new THREE.Vector3();
  private readonly prevVel = new THREE.Vector3();

  input: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };

  private readonly gs: GroundSample = {} as GroundSample;
  private readonly forceAcc = new THREE.Vector3();
  private readonly torqueAcc = new THREE.Vector3();
  private readonly obstacles: Obstacle[] = [];
  private readonly bodyPts: THREE.Vector3[];

  constructor(
    readonly field: TerrainField,
    readonly collision: CollisionWorld | null,
  ) {
    const P = CAR;
    this.wheels = [
      new Wheel(P.halfTrackF, P.mountY, P.frontAxleZ, true, true),
      new Wheel(-P.halfTrackF, P.mountY, P.frontAxleZ, true, false),
      new Wheel(P.halfTrackR, P.mountY, P.rearAxleZ, false, true),
      new Wheel(-P.halfTrackR, P.mountY, P.rearAxleZ, false, false),
    ];
    const B = P.body;
    this.bodyPts = [];
    for (const z of [B.front, B.rear, 0.9, -0.9]) {
      for (const x of [B.halfW, -B.halfW]) {
        const y = Math.abs(z) > 1.5 ? B.low + 0.05 : B.high;
        this.bodyPts.push(new THREE.Vector3(x * (Math.abs(z) > 1.5 ? 0.95 : 0.8), y, z));
      }
    }
    // underside middle points
    this.bodyPts.push(new THREE.Vector3(0, B.low, 0.4), new THREE.Vector3(0, B.low, -0.6));
  }

  /** Place the car at rest on the ground, facing heading (rad, 0 = +Z, increasing to the left). */
  reset(x: number, z: number, heading: number, speed = 0): void {
    const g = this.field.sample(x, z, -1, this.gs);
    this.trackHint = g.i;
    for (const w of this.wheels) {
      w.hint = g.i;
      w.compression = w.prevCompression = 0.09;
      w.contact = false;
      w.angVel = 0;
      w.spin = 0;
      w.slide = 0;
    }
    // align to ground normal with requested heading
    const n = _v1.set(g.nx, g.ny, g.nz);
    const f = _v2.set(Math.sin(heading), 0, Math.cos(heading));
    f.sub(_r.copy(n).multiplyScalar(f.dot(n))).normalize();
    const left = _r.copy(n).cross(f).normalize(); // n x f = left
    const m = new THREE.Matrix4().makeBasis(left, n, f);
    this.quat.setFromRotationMatrix(m);
    const rideH = this.P.wheelRadius + this.P.travel - 0.09 - this.P.mountY;
    this.pos.set(x, g.h + rideH, z).addScaledVector(n, 0.02);
    this.vel.copy(f).multiplyScalar(speed);
    this.angVel.set(0, 0, 0);
    this.gear = 1;
    this.rpm = this.P.idleRpm;
    this.shiftTimer = 0;
    this.steerInput = 0;
    this.steerAngle = 0;
    this.airTime = 0;
    this.prevVel.copy(this.vel);
    this.lastGoodPos.copy(this.pos);
    this.lastGoodQuat.copy(this.quat);
    this.updateBasis();
  }

  private updateBasis(): void {
    this.fwd.set(0, 0, 1).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.right.copy(this.fwd).cross(this.up);
  }

  private addForceAt(F: THREE.Vector3, point: THREE.Vector3): void {
    this.forceAcc.add(F);
    _r.copy(point).sub(this.pos);
    _tq.copy(_r).cross(F);
    this.torqueAcc.add(_tq);
  }

  maxSteerFor(v: number): number {
    const P = this.P;
    const L = P.frontAxleZ - P.rearAxleZ;
    const geom = (L * P.muRoad * P.gravity) / (v * v + 4);
    // high-speed lock is limited so a full keyboard tap at 100+ mph can't snap the car around
    const base = (8.6 + (4.2 - 8.6) * smoothstep(18, 50, v)) * DEG;
    return clamp(base + geom, base, P.maxSteerLow);
  }

  step(dt: number): void {
    const P = this.P;
    const inp = this.input;
    this.updateBasis();
    this.forceAcc.set(0, -P.mass * P.gravity, 0);
    this.torqueAcc.set(0, 0, 0);

    const vf = this.vel.dot(this.fwd);
    const vr = this.vel.dot(this.right);
    this.forwardSpeed = vf;
    this.lateralSpeed = vr;
    this.speed = this.vel.length();
    this.bodySlip = this.speed > 3 ? Math.atan2(vr, Math.abs(vf)) : 0;

    // ---------------------------------------------------------------- steering
    const target = clamp(inp.steer, -1, 1);
    const towardCentre = Math.abs(target) < Math.abs(this.steerInput) && Math.sign(target) === Math.sign(this.steerInput);
    const hiSpeed = smoothstep(15, 45, Math.abs(this.forwardSpeed));
    const rate = (towardCentre || target === 0 ? P.steerReturnRate : P.steerRate) * (1 - 0.4 * hiSpeed);
    const ds = target - this.steerInput;
    this.steerInput += clamp(ds, -rate * dt, rate * dt);
    const vAbs = Math.abs(vf);
    let steer = this.steerInput * this.maxSteerFor(vAbs);
    // countersteer assist: once the body slip exceeds normal cornering slip, the front wheels
    // are biased toward the direction of travel so slides are catchable with a keyboard
    if (vf > 4) {
      const excess = Math.max(0, Math.abs(this.bodySlip) - 6 * DEG);
      steer += Math.sign(this.bodySlip) * Math.min(excess * P.countersteerGain * 1.3, P.countersteerMax);
    }
    this.steerAngle = clamp(steer, -P.maxSteerLow, P.maxSteerLow);

    // ---------------------------------------------------------------- gear / pedals
    let thr = clamp(inp.throttle, 0, 1);
    let brk = clamp(inp.brake, 0, 1);
    if (this.gear > 0) {
      if (vf < 0.6 && brk > 0.5 && thr < 0.05) {
        this.reverseTimer += dt;
        if (this.reverseTimer > 0.35) {
          this.gear = -1;
          this.reverseTimer = 0;
        }
      } else this.reverseTimer = 0;
    } else {
      if (vf > -0.6 && thr > 0.5 && brk < 0.05) {
        this.gear = 1;
      }
    }
    if (this.gear < 0) {
      const t = thr;
      thr = brk;
      brk = t;
    }
    this.throttleEff = thr;
    this.brakeEff = brk;

    // ---------------------------------------------------------------- suspension raycasts
    let grounded = 0;
    const maxLen = P.travel + P.wheelRadius;
    for (const w of this.wheels) {
      const mw = _v1.copy(w.mount).applyQuaternion(this.quat).add(this.pos);
      w.prevCompression = w.compression;
      w.contact = false;
      if (this.up.y > 0.15) {
        let t = 0;
        let g = this.field.sample(mw.x, mw.z, w.hint, this.gs);
        t = (mw.y - g.h) / this.up.y;
        for (let it = 0; it < 2; it++) {
          const hx = mw.x - this.up.x * t;
          const hz = mw.z - this.up.z * t;
          g = this.field.sample(hx, hz, w.hint, this.gs);
          const hy = mw.y - this.up.y * t;
          t += (hy - g.h) / this.up.y;
        }
        if (g.i >= 0) w.hint = g.i;
        if (t < maxLen && t > -0.5) {
          w.contact = true;
          w.compression = Math.min(maxLen - t, P.travel + 0.12);
          w.hit.set(mw.x - this.up.x * t, mw.y - this.up.y * t, mw.z - this.up.z * t);
          w.normal.set(g.nx, g.ny, g.nz);
          w.surface = g.surface;
          w.roadness = g.roadness;
          grounded++;
        }
      }
      if (!w.contact) {
        w.compression = 0;
        w.load = 0;
      }
      // wheel centre for visuals
      const ext = P.travel - w.compression;
      w.center.copy(mw).addScaledVector(this.up, -Math.max(0, ext));
    }
    this.groundedWheels = grounded;

    // spring/damper forces
    const loads = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const w = this.wheels[k];
      if (!w.contact) continue;
      const kS = w.front ? P.springF : P.springR;
      const cv = (w.compression - w.prevCompression) / dt;
      const damp = cv > 0 ? (w.front ? P.bumpF : P.bumpR) * cv : (w.front ? P.reboundF : P.reboundR) * cv;
      let F = kS * w.compression + damp;
      const stop = w.compression - P.travel * 0.92;
      if (stop > 0) F += 260000 * stop + 9000 * Math.max(0, cv);
      loads[k] = F;
    }
    // anti-roll bars
    for (const [l, r, kArb] of [
      [0, 1, P.arbF],
      [2, 3, P.arbR],
    ] as const) {
      const wl = this.wheels[l];
      const wr = this.wheels[r];
      const diff = (wl.contact ? wl.compression : 0) - (wr.contact ? wr.compression : 0);
      const fa = kArb * diff;
      if (wl.contact) loads[l] += fa;
      if (wr.contact) loads[r] -= fa;
    }
    for (let k = 0; k < 4; k++) {
      const w = this.wheels[k];
      if (!w.contact) continue;
      const F = Math.max(0, loads[k]);
      w.load = F;
      _f.copy(this.up).multiplyScalar(F);
      this.addForceAt(_f, w.hit);
    }

    // ---------------------------------------------------------------- engine
    const gi = this.gear < 0 ? 0 : this.gear;
    const ratio = P.gears[gi] * P.finalDrive;
    const wheelOmega = vf / P.wheelRadius;
    const wheelRpm = Math.abs(wheelOmega * ratio) * (60 / (2 * Math.PI));
    let rpmTarget = wheelRpm * (1 + Math.min(0.55, this.wheelspin * 0.5));
    if (Math.abs(this.gear) === 1 && wheelRpm < 4200) {
      // slipping clutch at launch
      rpmTarget = Math.max(rpmTarget, P.idleRpm + thr * (4300 - P.idleRpm));
    }
    if (this.shiftTimer > 0) rpmTarget = Math.max(P.idleRpm, rpmTarget * 0.92);
    rpmTarget = clamp(rpmTarget, P.idleRpm, P.limiter + 80);
    this.rpm += (rpmTarget - this.rpm) * Math.min(1, dt * 22);
    this.limiterTimer = Math.max(0, this.limiterTimer - dt);
    if (this.rpm >= P.limiter) this.limiterTimer = 0.07;
    let Te = torqueAt(this.rpm) * thr;
    // soft limiter + partial torque cut while shifting (keeps the chassis settled mid-corner)
    if (this.limiterTimer > 0) Te *= 0.2;
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
      Te *= 0.3;
    }
    let driveForce = (Te * ratio * P.efficiency) / P.wheelRadius;
    // engine braking (only opposes motion)
    let engineBrakeForce = 0;
    if (thr < 0.05 && this.shiftTimer <= 0) {
      engineBrakeForce = ((P.engineBrake * (0.35 + this.rpm / P.redline)) * Math.abs(ratio) * P.efficiency) / P.wheelRadius;
    }
    this.engineLoad = thr;
    // backfire trigger when lifting at high rpm
    if (thr < 0.1 && this.rpm > 5200 && this.prevThrottle > 0.6) this.backfire = 1;
    this.prevThrottle = thr;
    this.backfire = Math.max(0, this.backfire - dt * 4);

    // auto gearbox: holds the gear while cornering hard (no mid-corner upshift unless on the limiter)
    if (this.gear > 0 && this.shiftTimer <= 0) {
      const top = P.gears.length - 1;
      const latG = Math.abs(this.accel.dot(this.right)) / P.gravity;
      const cornering = latG > 0.55 && this.rpm < P.limiter - 40;
      if (this.rpm > P.upshiftRpm && !cornering && this.gear < top && this.wheelspin < 0.35 && grounded > 0) {
        this.gear++;
        this.shiftTimer = P.shiftTime;
      } else if (this.gear > 1) {
        const lowerRatio = P.gears[this.gear - 1] * P.finalDrive;
        const rpmLower = Math.abs(wheelOmega * lowerRatio) * (60 / (2 * Math.PI));
        const wantDown = this.rpm < P.downshiftRpm || (thr > 0.85 && this.rpm < 4600 && rpmLower < 6900);
        if (wantDown && rpmLower < 7000) {
          this.gear--;
          this.shiftTimer = P.shiftTime * 0.8;
        }
      }
    }

    // ---------------------------------------------------------------- tyres
    let spinSum = 0;
    let drivenCount = 0;
    const steerC = Math.cos(this.steerAngle);
    const steerS = Math.sin(this.steerAngle);
    const mWheel = P.mass / 4;
    const Fz0 = (P.mass * P.gravity) / 4;
    for (const w of this.wheels) {
      w.steer = w.front ? this.steerAngle : 0;
      if (!w.contact) {
        w.fx = w.fy = 0;
        w.slide = 0;
        w.spin = 0;
        // free wheel decays
        w.angVel *= 0.995;
        continue;
      }
      const n = w.normal;
      if (w.front) _wf.copy(this.fwd).multiplyScalar(steerC).addScaledVector(this.right, steerS);
      else _wf.copy(this.fwd);
      _wf.addScaledVector(n, -_wf.dot(n)).normalize();
      _wr.copy(_wf).cross(n).normalize();
      _r.copy(w.hit).sub(this.pos);
      _vp.copy(this.angVel).cross(_r).add(this.vel);
      const vx = _vp.dot(_wf);
      const vy = _vp.dot(_wr);
      w.vx = vx;
      w.vy = vy;
      const Fz = w.load;
      const surfMu = w.surface === SURF_ROAD ? P.muRoad : w.surface === SURF_GRASS ? P.muGrass : P.muShoulder;
      // rear grip rises with speed: playful at low speed, planted at 100+ mph
      const rearK = P.rearGrip + (P.rearGripHigh - P.rearGrip) * smoothstep(22, 46, Math.abs(vf));
      const mu = surfMu * (1 - P.loadSensitivity * (Fz / Fz0 - 1)) * (w.front ? 1 : rearK);
      const Fmax = Math.max(0, mu * Fz);
      const stopF = (Math.abs(vx) * mWheel) / dt;

      // longitudinal demand
      const share = w.front ? P.frontTorqueShare * 0.5 : (1 - P.frontTorqueShare) * 0.5;
      let FxD = driveForce * share;
      drivenCount++;
      const eb = engineBrakeForce * share;
      const brakeF = brk * P.brakeForce * (w.front ? P.brakeBiasFront * 0.5 : (1 - P.brakeBiasFront) * 0.5);
      const roll = (w.surface === SURF_ROAD ? P.rolling.road : w.surface === SURF_GRASS ? P.rolling.grass : P.rolling.shoulder) * Fz;
      const resist = Math.min(brakeF + eb + roll, stopF);
      FxD -= Math.sign(vx) * resist;
      // parking hold at standstill
      if (thr < 0.05 && Math.abs(vx) < 0.4 && !(this.gear < 0)) FxD -= Math.sign(vx) * Math.min(stopF, Fmax);

      let fx: number;
      let fy: number;
      const hb = w.front ? 0 : clamp(inp.handbrake, 0, 1);
      // lateral
      const vxa = Math.max(Math.abs(vx), 2.2);
      const alpha = Math.atan2(vy, vxa);
      w.slipAngle = alpha;
      const FyD = -Math.sign(alpha) * Fmax * latCurve(Math.abs(alpha));
      // combine (friction ellipse with longitudinal priority)
      let spin = 0;
      fx = FxD;
      if (Math.abs(fx) > Fmax) {
        spin = Math.abs(fx) / Math.max(1, Fmax) - 1;
        fx = Math.sign(fx) * Fmax * (spin > 0.15 ? 0.9 : 1);
      }
      const used = (Math.abs(fx) / Math.max(1, Fmax)) * P.ellipseLong;
      const fyMax = Fmax * Math.sqrt(Math.max(0, 1 - used * used));
      fy = clamp(FyD, -fyMax, fyMax);
      if (spin > 0) fy /= 1 + spin * 0.7;

      if (hb > 0) {
        // locked rear wheel: kinetic friction opposite the slip velocity
        const vs = Math.hypot(vx, vy);
        const Fk = Fmax * 0.8;
        let lx: number;
        let ly: number;
        if (vs > 0.6) {
          lx = (-vx / vs) * Fk;
          ly = (-vy / vs) * Fk;
        } else {
          lx = -clamp(vx * mWheel / dt, -Fmax, Fmax);
          ly = -clamp(vy * mWheel / dt, -Fmax, Fmax);
        }
        fx = lerp(fx, lx, hb);
        fy = lerp(fy, ly, hb);
        spin = Math.max(spin, hb * 0.9);
      }
      w.fx = fx;
      w.fy = fy;
      w.spin = spin;
      spinSum += spin;
      const latSlide = Math.max(0, Math.abs(alpha) - P.peakSlip * 0.9) / 0.35;
      w.slide = clamp(Math.max(latSlide, spin * 0.8, hb * Math.min(1, Math.abs(vx) / 8)), 0, 1);

      // wheel angular velocity (visual + audio)
      const spinBoost = spin > 0 && !hb ? 1 + Math.min(1.5, spin) : 1;
      w.angVel = hb > 0.5 ? 0 : (vx / P.wheelRadius) * spinBoost;

      _f.copy(_wf).multiplyScalar(fx).addScaledVector(_wr, fy);
      // apply at contact lifted toward CoG (roll-centre tuning)
      _v2.copy(w.hit).lerp(this.pos, P.rollCentreLift);
      this.addForceAt(_f, _v2);
    }
    this.wheelspin = drivenCount > 0 ? spinSum / drivenCount : 0;
    for (const w of this.wheels) w.spinAngle += w.angVel * dt;

    // ---------------------------------------------------------------- drift stabiliser (arcade assist)
    // Beyond ~25 deg of body slip at speed, add a yaw torque that pulls the nose back toward the
    // direction of travel. Drifts stay big and playful; unintended spins become rare.
    if (grounded >= 2 && this.speed > 9 && inp.handbrake < 0.5 && vf > 0) {
      const ex = Math.abs(this.bodySlip) - P.stabiliseSlip;
      if (ex > 0) {
        const k = P.stabiliseGain * smoothstep(9, 30, this.speed);
        // beta > 0: velocity to the right of the nose -> yaw right (negative about +Y)
        this.torqueAcc.addScaledVector(this.up, -Math.sign(this.bodySlip) * k * Math.min(ex, 0.6));
      }
    }

    // ---------------------------------------------------------------- aero
    const v2 = this.speed * this.speed;
    _f.copy(this.vel).multiplyScalar(-P.dragK * this.speed);
    this.forceAcc.add(_f);
    if (grounded > 0) {
      const down = P.downforceK * vf * vf;
      _f.copy(this.up).multiplyScalar(-down * 0.45);
      _v1.copy(this.fwd).multiplyScalar(P.frontAxleZ).add(this.pos);
      this.addForceAt(_f, _v1);
      _f.copy(this.up).multiplyScalar(-down * 0.55);
      _v1.copy(this.fwd).multiplyScalar(P.rearAxleZ).add(this.pos);
      this.addForceAt(_f, _v1);
    }
    // grass drag
    let grassWheels = 0;
    for (const w of this.wheels) if (w.contact && w.surface === SURF_GRASS) grassWheels++;
    if (grassWheels > 0 && this.speed > 1) {
      _f.copy(this.vel).multiplyScalar((-P.grassDrag * grassWheels) / 4);
      this.forceAcc.add(_f);
    }
    void v2;

    // ---------------------------------------------------------------- body vs ground
    this.bodyGround(dt);

    // ---------------------------------------------------------------- integrate
    this.vel.addScaledVector(this.forceAcc, dt / P.mass);
    // arcade air stabilisation: gently damp pitch/roll rates while airborne
    if (grounded === 0) {
      this.airTime += dt;
    } else {
      if (this.airTime > 0.25) {
        this.lastAirTime = this.airTime;
        this.landingImpact = Math.max(this.landingImpact, Math.min(1, -this.prevVel.y / 8));
      }
      this.airTime = 0;
    }
    // angular: transform torque into body frame
    _qInv.copy(this.quat).invert();
    _tq.copy(this.torqueAcc).applyQuaternion(_qInv);
    const wB = _v1.copy(this.angVel).applyQuaternion(_qInv);
    const I = P.inertia;
    // gyroscopic term w x (I w)
    const Iwx = I.x * wB.x;
    const Iwy = I.y * wB.y;
    const Iwz = I.z * wB.z;
    const gx = wB.y * Iwz - wB.z * Iwy;
    const gy = wB.z * Iwx - wB.x * Iwz;
    const gz = wB.x * Iwy - wB.y * Iwx;
    wB.x += ((_tq.x - gx) / I.x) * dt;
    wB.y += ((_tq.y - gy) / I.y) * dt;
    wB.z += ((_tq.z - gz) / I.z) * dt;
    if (grounded === 0) {
      wB.x *= 1 - 0.6 * dt;
      wB.z *= 1 - 0.6 * dt;
    }
    this.angVel.copy(wB).applyQuaternion(this.quat);
    // mild angular damping
    this.angVel.multiplyScalar(1 - 0.05 * dt);

    // obstacle collisions (trees, posts)
    this.collideObstacles();

    // numerical safety nets: no physical car spins faster than this
    const wl = this.angVel.length();
    if (wl > 9) this.angVel.multiplyScalar(9 / wl);
    const vl = this.vel.length();
    if (vl > 110) this.vel.multiplyScalar(110 / vl);
    if (!Number.isFinite(vl) || !Number.isFinite(wl) || !Number.isFinite(this.pos.y)) {
      this.pos.copy(this.lastGoodPos);
      this.quat.copy(this.lastGoodQuat);
      this.vel.set(0, 0, 0);
      this.angVel.set(0, 0, 0);
      console.warn('[sim] non-finite state recovered');
    } else {
      this.lastGoodPos.copy(this.pos);
      this.lastGoodQuat.copy(this.quat);
    }

    this.accel.copy(this.vel).sub(this.prevVel).divideScalar(dt);
    this.prevVel.copy(this.vel);
    this.pos.addScaledVector(this.vel, dt);
    const wlen = this.angVel.length();
    if (wlen > 1e-6) {
      _dq.setFromAxisAngle(_v2.copy(this.angVel).divideScalar(wlen), wlen * dt);
      this.quat.premultiply(_dq).normalize();
    }
    this.landingImpact = Math.max(0, this.landingImpact - dt * 3);
    this.collisionImpact = Math.max(0, this.collisionImpact - dt * 3);
    for (const w of this.wheels) if (w.hint >= 0) this.trackHint = w.hint;
  }

  private prevThrottle = 0;
  private readonly lastGoodPos = new THREE.Vector3();
  private readonly lastGoodQuat = new THREE.Quaternion();

  private bodyGround(_dt: number): void {
    const P = this.P;
    for (const lp of this.bodyPts) {
      const wp = _v1.copy(lp).applyQuaternion(this.quat).add(this.pos);
      const g = this.field.sample(wp.x, wp.z, this.trackHint, this.gs);
      const pen = g.h - wp.y;
      if (pen <= -0.02) continue;
      const n = _v2.set(g.nx, g.ny, g.nz);
      _r.copy(wp).sub(this.pos);
      _vp.copy(this.angVel).cross(_r).add(this.vel);
      const vn = _vp.dot(n);
      let Fn = 220000 * Math.max(0, pen + 0.02) - 18000 * Math.min(0, vn);
      Fn = Math.max(0, Fn);
      _f.copy(n).multiplyScalar(Fn);
      // sliding friction
      _vp.addScaledVector(n, -vn);
      const vt = _vp.length();
      if (vt > 0.05) _f.addScaledVector(_vp, (-0.55 * Fn) / vt);
      this.addForceAt(_f, wp);
      if (vn < -3) this.collisionImpact = Math.max(this.collisionImpact, Math.min(1, -vn / 10));
    }
    void P;
  }

  private collideObstacles(): void {
    const cw = this.collision;
    if (!cw) return;
    const obs = this.obstacles;
    const count = cw.query(this.pos.x, this.pos.z, 4, obs);
    if (count === 0) return;
    // car footprint: three circles along the body axis
    const P = this.P;
    const fx = this.fwd.x;
    const fz = this.fwd.z;
    const fl = Math.hypot(fx, fz) || 1;
    const hx = fx / fl;
    const hz = fz / fl;
    const rc = 0.88;
    const carBottom = this.pos.y - 0.45;
    const carTop = this.pos.y + 0.85;
    for (let k = 0; k < count; k++) {
      const o = obs[k];
      // vertical overlap: flying over a rock or under nothing should not collide
      if (o.y !== undefined && (carBottom > o.y + (o.h ?? 3) || carTop < o.y)) continue;
      for (const off of CIRCLES) {
        const cx = this.pos.x + hx * off;
        const cz = this.pos.z + hz * off;
        const dx = cx - o.x;
        const dz = cz - o.z;
        const d = Math.hypot(dx, dz);
        const minD = rc + o.r;
        if (d >= minD || d < 1e-4) continue;
        const nx = dx / d;
        const nz = dz / d;
        const pen = minD - d;
        // contact point on the car circle surface
        const px = o.x + nx * o.r;
        const pz = o.z + nz * o.r;
        _r.set(px - this.pos.x, 0, pz - this.pos.z);
        _vp.copy(this.angVel).cross(_r).add(this.vel);
        const vn = _vp.x * nx + _vp.z * nz;
        // positional correction
        this.pos.x += nx * pen * 0.9;
        this.pos.z += nz * pen * 0.9;
        if (vn >= 0) continue;
        // impulse with restitution + friction about the yaw axis. (r x n).y = r.z*n.x - r.x*n.z
        const rxn = _r.z * nx - _r.x * nz;
        const invM = 1 / P.mass + (rxn * rxn) / P.inertia.y;
        const e = 0.2;
        const j = (-(1 + e) * vn) / invM;
        this.vel.x += (j * nx) / P.mass;
        this.vel.z += (j * nz) / P.mass;
        this.angVel.y += (j * rxn) / P.inertia.y;
        // tangential friction (also through the yaw axis)
        const tx = -nz;
        const tz = nx;
        const vt = _vp.x * tx + _vp.z * tz;
        const rxt = _r.z * tx - _r.x * tz;
        const invMt = 1 / P.mass + (rxt * rxt) / P.inertia.y;
        const jt = clamp(-vt / invMt, -0.35 * j, 0.35 * j);
        this.vel.x += (jt * tx) / P.mass;
        this.vel.z += (jt * tz) / P.mass;
        this.angVel.y += (jt * rxt) / P.inertia.y;
        this.collisionImpact = Math.max(this.collisionImpact, Math.min(1, -vn / 14));
      }
    }
  }

  /** Roll angle (rad) relative to world up, + = rolled to the right. */
  get roll(): number {
    return Math.asin(clamp(-this.right.y, -1, 1));
  }

  get pitch(): number {
    return Math.asin(clamp(this.fwd.y, -1, 1));
  }

  get heading(): number {
    return Math.atan2(this.fwd.x, this.fwd.z);
  }
}
