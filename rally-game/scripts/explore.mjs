// Exploration run: autopilot the stage, log telemetry, take periodic screenshots.
// usage: node scripts/explore.mjs [seconds=30] [shotEvery=5] [outDir=.cache/explore]
import { launchGame, shot } from './lib/harness.mjs';

const seconds = Number(process.argv[2] ?? 30);
const every = Number(process.argv[3] ?? 5);
const out = process.argv[4] ?? '.cache/explore';
const { browser, page, errors } = await launchGame({ width: 1280, height: 720 });
await page.evaluate(() => {
  window.__RALLY__.setManual(true);
  window.__RALLY__.setAutopilot(true);
});
await shot(page, `${out}/t000.png`);
let t = 0;
while (t < seconds) {
  const step = Math.min(1, seconds - t);
  const tel = await page.evaluate((s) => window.__RALLY__.step(s), step);
  t += step;
  console.log(
    `t=${tel.time.toFixed(1)} s=${tel.s.toFixed(0)} d=${tel.d.toFixed(2)} mph=${tel.mph.toFixed(0)} g=${tel.gear} rpm=${tel.rpm.toFixed(0)} ` +
      `gr=${tel.grounded} slip=${tel.bodySlipDeg.toFixed(1)} roll=${tel.rollDeg.toFixed(1)} pitch=${tel.pitchDeg.toFixed(1)} gate=${tel.gate} rec=${tel.recoveries} st=${tel.state} air=${tel.lastAirTime.toFixed(2)}`,
  );
  if (Math.round(t) % every === 0) await shot(page, `${out}/t${String(Math.round(t)).padStart(3, '0')}.png`);
  if (tel.state === 'finished') break;
}
const stats = await page.evaluate(() => window.__RALLY__.stats());
console.log('stats', JSON.stringify(stats));
console.log('errors', JSON.stringify(errors));
await browser.close();
