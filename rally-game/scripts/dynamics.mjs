// Vehicle dynamics test bench on a debug flat hardpack plane. Prints a handling report.
// usage: node scripts/dynamics.mjs
import { launchGame } from './lib/harness.mjs';

const { browser, page } = await launchGame({ width: 320, height: 180 });
const report = await page.evaluate(() => {
  const g = window.game;
  g.manual = true;
  const sim = g.sim;
  sim.collision = null;
  g.field.flatTest = 0;
  const DT = 1 / 240;
  const out = {};
  const latAcc = () => {
    const a = sim.accel;
    return a.x * sim.right.x + a.y * sim.right.y + a.z * sim.right.z;
  };
  const reset = (speed = 0) => {
    sim.reset(0, 0, 0, speed);
    for (let i = 0; i < 120; i++) {
      sim.input = { throttle: 0, brake: speed > 0 ? 0 : 1, steer: 0, handbrake: 0 };
      if (speed > 0) {
        // keep speed while settling
        sim.vel.set(Math.sin(sim.heading) * speed, sim.vel.y, Math.cos(sim.heading) * speed);
      }
      sim.step(DT);
    }
    if (speed > 0) {
      // set gear appropriate for speed
      for (let gi = 1; gi < 6; gi++) {
        const rpm = (speed / sim.P.wheelRadius) * sim.P.gears[gi] * sim.P.finalDrive * (60 / (2 * Math.PI));
        if (rpm < 6500) {
          sim.gear = gi;
          break;
        }
      }
    }
  };
  const run = (secs, inp, each) => {
    const n = Math.round(secs / DT);
    for (let i = 0; i < n; i++) {
      sim.input = typeof inp === 'function' ? inp(i * DT) : inp;
      sim.step(DT);
      if (each) each(i * DT);
    }
  };
  const cruise = (target, steer, extra = {}) => (t) => {
    const e = target - sim.forwardSpeed;
    return { throttle: Math.max(0, Math.min(1, 0.3 + e * 0.5)), brake: e < -2 ? 0.3 : 0, steer: typeof steer === 'function' ? steer(t) : steer, handbrake: 0, ...extra };
  };

  // 1. acceleration
  reset(0);
  let t60 = -1;
  let t100 = -1;
  let tq = -1;
  run(40, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, (t) => {
    const mph = sim.speed * 2.23694;
    if (t60 < 0 && mph >= 60) t60 = t;
    if (t100 < 0 && mph >= 100) t100 = t;
    if (tq < 0 && sim.pos.length() >= 402) tq = t;
  });
  out.accel = { t0_60: +t60.toFixed(2), t0_100: +t100.toFixed(2), quarterMile: +tq.toFixed(2), vmax40s_mph: +(sim.speed * 2.23694).toFixed(1), gear: sim.gear, rpm: Math.round(sim.rpm) };

  // 2. braking 60-0
  reset(26.8);
  const p0 = sim.pos.clone();
  let stopT = 0;
  run(6, { throttle: 0, brake: 1, steer: 0, handbrake: 0 }, (t) => {
    if (stopT === 0 && sim.speed < 0.3) stopT = t;
  });
  out.brake60 = { dist_m: +sim.pos.distanceTo(p0).toFixed(1), time: +stopT.toFixed(2), pitchDeg: 0 };

  // 3. steady-state ramp steer at several speeds
  out.ramp = [];
  for (const v of [12, 20, 30, 40, 50]) {
    reset(v);
    let maxLat = 0;
    let atMax = null;
    const rows = [];
    run(
      8,
      cruise(v, (t) => Math.min(1, t / 7)),
      (t) => {
        const la = Math.abs(latAcc());
        if (la > maxLat) {
          maxLat = la;
          atMax = { t: +t.toFixed(2), steer: +sim.steerInput.toFixed(2), slipDeg: +((sim.bodySlip * 180) / Math.PI).toFixed(1), yaw: +sim.angVel.y.toFixed(2), v: +sim.speed.toFixed(1), roll: +((sim.roll * 180) / Math.PI).toFixed(1) };
        }
        if (Math.round(t * 240) % 240 === 0) rows.push([+t.toFixed(0), +sim.steerInput.toFixed(2), +(latAcc() / 9.81).toFixed(2), +((sim.bodySlip * 180) / Math.PI).toFixed(1), +sim.speed.toFixed(1)]);
      },
    );
    out.ramp.push({ v, maxLatG: +(maxLat / 9.81).toFixed(2), atMax, rows, endSlipDeg: +((sim.bodySlip * 180) / Math.PI).toFixed(1) });
  }

  // 4. step steer at 30 m/s
  out.step = [];
  for (const s of [0.3, 0.6, 1.0]) {
    reset(30);
    const rows = [];
    let maxSlip = 0;
    run(4, cruise(30, s), (t) => {
      maxSlip = Math.max(maxSlip, Math.abs(sim.bodySlip));
      if (Math.round(t * 240) % 60 === 0) rows.push([+t.toFixed(2), +sim.angVel.y.toFixed(2), +((sim.bodySlip * 180) / Math.PI).toFixed(1), +(latAcc() / 9.81).toFixed(2)]);
    });
    out.step.push({ steer: s, maxSlipDeg: +((maxSlip * 180) / Math.PI).toFixed(1), endSpeed: +sim.speed.toFixed(1), rows });
  }

  // 5. lift-off mid-corner at 25 m/s
  reset(25);
  run(3, cruise(25, 0.75));
  const before = (sim.bodySlip * 180) / Math.PI;
  let peak = 0;
  run(2, { throttle: 0, brake: 0, steer: 0.75, handbrake: 0 }, () => (peak = Math.max(peak, Math.abs((sim.bodySlip * 180) / Math.PI))));
  out.liftOff = { slipBeforeDeg: +before.toFixed(1), peakAfterDeg: +peak.toFixed(1), endSpeed: +sim.speed.toFixed(1) };

  // 6. handbrake turn from 20 m/s
  reset(20);
  let hbPeak = 0;
  const h0 = sim.heading;
  run(0.6, { throttle: 0, brake: 0, steer: 1, handbrake: 1 }, () => (hbPeak = Math.max(hbPeak, Math.abs(sim.bodySlip))));
  run(1.5, { throttle: 0.6, brake: 0, steer: 0, handbrake: 0 }, () => (hbPeak = Math.max(hbPeak, Math.abs(sim.bodySlip))));
  let dh = sim.heading - h0;
  while (dh > Math.PI) dh -= 2 * Math.PI;
  while (dh < -Math.PI) dh += 2 * Math.PI;
  out.handbrake = { headingChangeDeg: +((dh * 180) / Math.PI).toFixed(0), peakSlipDeg: +((hbPeak * 180) / Math.PI).toFixed(1), endSpeed: +sim.speed.toFixed(1), endSlip: +((sim.bodySlip * 180) / Math.PI).toFixed(1) };

  // 7. power oversteer from 12 m/s in 2nd
  reset(12);
  sim.gear = 2;
  let poPeak = 0;
  run(3, { throttle: 1, brake: 0, steer: 0.8, handbrake: 0 }, () => (poPeak = Math.max(poPeak, Math.abs(sim.bodySlip))));
  out.powerOversteer = { peakSlipDeg: +((poPeak * 180) / Math.PI).toFixed(1), wheelspin: +sim.wheelspin.toFixed(2), speed: +sim.speed.toFixed(1) };

  // 8. straight line stability at 55 m/s with small steer pulses
  reset(55);
  let maxYaw = 0;
  run(5, cruise(55, (t) => (t > 1 && t < 1.15 ? 0.4 : 0)), () => (maxYaw = Math.max(maxYaw, Math.abs(sim.angVel.y))));
  out.highSpeed = { maxYaw: +maxYaw.toFixed(2), endSlipDeg: +((sim.bodySlip * 180) / Math.PI).toFixed(2), endSpeed: +sim.speed.toFixed(1) };
  g.field.flatTest = null;
  return out;
});
console.log(JSON.stringify(report, null, 1));
await browser.close();
