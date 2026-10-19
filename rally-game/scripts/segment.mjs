// Focused segment test: teleport to s0 at speed v, autopilot for N seconds, fine telemetry.
import { launchGame, shot } from './lib/harness.mjs';
const s0 = Number(process.argv[2] ?? 1950), v = Number(process.argv[3] ?? 40), secs = Number(process.argv[4] ?? 8);
const shots = process.argv[5] ?? '';
const { browser, page } = await launchGame({ width: 1280, height: 720 });
const geo = await page.evaluate(({ s0, secs }) => {
  const T = window.game.track; const rows = [];
  for (let s = s0; s < s0 + secs * 50; s += 20) { const f = T.frameAt(s); rows.push(`s=${s} y=${f.y.toFixed(1)} slope=${(f.slope*100).toFixed(1)}% R=${f.kappa ? (1/f.kappa).toFixed(0) : 'inf'} bank=${(f.bank*57.3).toFixed(1)} hw=${f.hw.toFixed(1)}`); }
  return rows;
}, { s0, secs });
console.log(geo.join('\n'));
await page.evaluate(({ s0, v }) => { const R = window.__RALLY__; R.setManual(true); R.teleport(s0, 0, v); R.setAutopilot(true); }, { s0, v });
for (let t = 0; t < secs; t += 0.25) {
  const tel = await page.evaluate(() => window.__RALLY__.step(0.25));
  console.log(`t=${t.toFixed(2)} s=${tel.s.toFixed(0)} d=${tel.d.toFixed(2)} mph=${tel.mph.toFixed(0)} g=${tel.gear} gr=${tel.grounded} slip=${tel.bodySlipDeg.toFixed(1)} steer=${tel.steerAngleDeg.toFixed(1)} roll=${tel.rollDeg.toFixed(1)} comp=${tel.compression.join('/')} slide=${tel.slide.join('/')} surf=${tel.surfaces.join('')}`);
  if (shots && Math.abs(t % 1) < 0.01) await shot(page, `${shots}/seg_${t.toFixed(0)}.png`);
}
await browser.close();
