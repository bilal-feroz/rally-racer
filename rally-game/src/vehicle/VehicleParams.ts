import { DEG } from '../core/math';

/** Tunable vehicle parameters. Units: SI (m, kg, s, N, rad). Car frame: +Z forward, +Y up, +X left. */
export const CAR = {
  mass: 1180,
  /** body-frame inertia: pitch (x), yaw (y), roll (z) */
  inertia: { x: 1650, y: 2000, z: 520 },
  gravity: 9.81,

  // geometry (relative to centre of gravity)
  frontAxleZ: 1.22,
  rearAxleZ: -1.24,
  halfTrackF: 0.82,
  halfTrackR: 0.82,
  mountY: 0.06,
  wheelRadius: 0.33,
  /** suspension travel (m) */
  travel: 0.3,

  springF: 34000,
  springR: 31000,
  bumpF: 2600,
  bumpR: 2400,
  reboundF: 4200,
  reboundR: 3900,
  arbF: 14000,
  arbR: 11000,
  /** lateral forces act this fraction of the way from contact patch up to CoG height (reduces roll) */
  rollCentreLift: 0.45,

  // tyres
  muRoad: 1.18,
  muShoulder: 1.0,
  muGrass: 0.78,
  /** peak slip angle (rad) */
  peakSlip: 7.5 * DEG,
  /** slip angle where the curve reaches its sliding plateau */
  slideSlip: 38 * DEG,
  /** sliding plateau as fraction of peak */
  slideFactor: 0.8,
  /** rear tyres slide a bit earlier for a drifty balance */
  rearGrip: 0.97,
  /** rear grip factor at high speed */
  rearGripHigh: 1.09,
  /** longitudinal share in friction ellipse */
  ellipseLong: 0.82,
  loadSensitivity: 0.09,
  rolling: { road: 0.013, shoulder: 0.022, grass: 0.05 },
  /** extra drag on grass (N per m/s) */
  grassDrag: 55,

  // engine / drivetrain
  idleRpm: 950,
  redline: 7600,
  limiter: 7750,
  /** torque curve samples (rpm, Nm) */
  torque: [
    [800, 150],
    [1500, 205],
    [2500, 250],
    [3500, 292],
    [4500, 318],
    [5500, 330],
    [6500, 318],
    [7200, 292],
    [7800, 250],
  ] as [number, number][],
  gears: [-3.1, 2.84, 1.98, 1.5, 1.19, 1.0],
  finalDrive: 3.95,
  efficiency: 0.88,
  frontTorqueShare: 0.36,
  upshiftRpm: 7300,
  downshiftRpm: 3700,
  shiftTime: 0.12,
  engineBrake: 70,

  // brakes
  brakeForce: 15500,
  brakeBiasFront: 0.64,
  handbrakeForce: 7000,

  // aero
  dragK: 0.42,
  downforceK: 0.32,

  // steering
  maxSteerLow: 33 * DEG,
  maxSteerHigh: 6.5 * DEG,
  steerFadeSpeed: 46,
  steerRate: 4.2,
  steerReturnRate: 6.5,
  countersteerGain: 0.5,
  countersteerMax: 16 * DEG,
  /** body slip beyond which the drift stabiliser engages (rad) */
  stabiliseSlip: 20 * DEG,
  /** stabiliser yaw torque per rad of excess slip (N m / rad) */
  stabiliseGain: 30000,
  /** arcade yaw torque when handbrake + steer are combined (N m) */
  handbrakeYaw: 4200,

  // body collision box (for ground penalty contacts)
  body: { halfW: 0.84, front: 2.02, rear: -2.0, low: -0.22, high: 0.78 },
};

export type CarParams = typeof CAR;
