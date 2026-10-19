// Full-run digital driver; fine trace in a time window.
import { launchGame } from './lib/harness.mjs';
const t0 = Number(process.argv[2] ?? 19), t1 = Number(process.argv[3] ?? 24);
const { browser, page } = await launchGame({ width: 320, height: 180 });
const rows = await page.evaluate(({ t0, t1 }) => {
  const R = window.__RALLY__; const g = window.game; R.setManual(true); R.setAutopilot(true, 1, true);
  R.step(t0); const out = [];
  for (let t = t0; t < t1; t += 0.1) {
    R.step(0.1); const s = g.sim; const tl = R.telemetry();
    out.push(`t=${tl.time.toFixed(1)} s=${tl.s.toFixed(0)} d=${tl.d.toFixed(2)} mph=${tl.mph.toFixed(0)} in.steer=${s.input.steer} steerIn=${s.steerInput.toFixed(2)} ang=${(s.steerAngle*57.3).toFixed(1)} yaw=${s.angVel.y.toFixed(2)} slip=${tl.bodySlipDeg.toFixed(1)} thr=${s.input.throttle} brk=${s.input.brake} gr=${tl.grounded} surf=${tl.surfaces.join('')} kappaR=${(1/(g.track.kappaAt(tl.s)||1e-9)).toFixed(0)}`);
  }
  return out;
}, { t0, t1 });
console.log(rows.join('\n'));
await browser.close();
