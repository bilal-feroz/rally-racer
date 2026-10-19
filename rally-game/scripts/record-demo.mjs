// Record demo.mp4 from REAL gameplay: the autopilot drives the full stage through the same
// physics/input path as a player; the sim is stepped exactly 1/fps per frame and each frame
// (3D canvas + HUD) is screenshotted, then encoded with ffmpeg.
// usage: node scripts/record-demo.mjs [out=demo.mp4] [width=1280] [height=720] [fps=30] [maxSecs=120]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { launchGame } from './lib/harness.mjs';

const out = process.argv[2] ?? 'demo.mp4';
const W = Number(process.argv[3] ?? 1280);
const H = Number(process.argv[4] ?? 720);
const fps = Number(process.argv[5] ?? 30);
const maxSecs = Number(process.argv[6] ?? 120);
const tmp = path.join('.cache', `frames-${path.basename(out, '.mp4')}`);
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

const { browser, page, errors } = await launchGame({ width: W, height: H });
await page.evaluate(() => {
  const R = window.__RALLY__;
  R.setManual(true);
  R.restart();
  R.setAutopilot(true);
});
const track = await page.evaluate(() => window.__RALLY__.track());
const tag = (n) => track.tags.find((t) => t.name === n);
// camera script for variety: [startS, endS, mode]
const camPlan = [
  [tag('banked').s0 - 30, tag('banked').s1 + 10, 'cinematic'],
  [tag('recovery').s0 + 60, tag('recovery').s0 + 200, 'hood'],
];
let mode = 'chase';
let frame = 0;
let finishedFrames = -1;
const t0 = Date.now();
while (frame < maxSecs * fps) {
  const tel = await page.evaluate((dt) => window.__RALLY__.step(dt), 1 / fps);
  let want = 'chase';
  for (const [a, b, m] of camPlan) if (tel.s >= a && tel.s <= b) want = m;
  if (want !== mode) {
    mode = want;
    await page.evaluate((m) => window.__RALLY__.setCamera(m), mode);
  }
  await page.screenshot({ path: path.join(tmp, `${String(frame).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 88 });
  frame++;
  if (tel.state === 'finished' && finishedFrames < 0) finishedFrames = frame;
  if (finishedFrames > 0 && frame - finishedFrames > fps * 3.5) break;
  if (frame % (fps * 10) === 0) console.log(`frame ${frame} t=${tel.time.toFixed(1)} s=${tel.s.toFixed(0)} (${((Date.now() - t0) / 1000).toFixed(0)}s wall)`);
}
await browser.close();
console.log(`captured ${frame} frames, errors: ${JSON.stringify(errors)}`);
execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(fps), '-i', path.join(tmp, '%05d.jpg'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: 'inherit' });
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`wrote ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
