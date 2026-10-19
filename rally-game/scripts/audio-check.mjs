// Offline render of the real engine synth (same worklet + filter graph as the game) through a
// rev sweep, with level/brightness metrics and a WAV export for listening.
// usage: node scripts/audio-check.mjs [out=docs/audio/engine-sweep.wav]
import fs from 'node:fs';
import path from 'node:path';
import { launchGame } from './lib/harness.mjs';

const out = process.argv[2] ?? 'docs/audio/engine-sweep.wav';
const { browser, page, errors } = await launchGame({ width: 320, height: 180 });
const res = await page.evaluate(async () => {
  const mod = await import('/src/audio/AudioEngine.ts');
  const sr = 44100;
  const dur = 9;
  const ctx = new OfflineAudioContext(1, sr * dur, sr);
  const v = await mod.createEngineVoice(ctx);
  v.gain.connect(ctx.destination);
  v.gain.gain.value = 0.55;
  const rpm = v.node.parameters.get('rpm');
  const load = v.node.parameters.get('load');
  const crackle = v.node.parameters.get('crackle');
  // idle -> full-load rev -> gear change dips -> lift-off with crackle -> part-throttle cruise
  const keys = [
    [0, 950, 0, 0],
    [1, 950, 0, 0],
    [1.1, 1500, 1, 0],
    [3.0, 7400, 1, 0],
    [3.15, 5600, 0.3, 0],
    [4.6, 7400, 1, 0],
    [4.75, 5900, 0.3, 0],
    [5.6, 7000, 1, 0],
    [5.7, 6800, 0, 0.8],
    [6.6, 3600, 0, 0.1],
    [7.0, 3800, 0.45, 0],
    [9, 4400, 0.45, 0],
  ];
  for (const [t, r, l, c] of keys) {
    rpm.linearRampToValueAtTime(r, t);
    load.linearRampToValueAtTime(l, t);
    crackle.linearRampToValueAtTime(c, t);
    v.filter.frequency.linearRampToValueAtTime(900 + r * 0.42 + l * 1800, t);
  }
  const buf = await ctx.startRendering();
  const d = buf.getChannelData(0);
  const win = sr / 2;
  const windows = [];
  let nan = 0;
  let peakAll = 0;
  for (let w = 0; w + win <= d.length; w += win) {
    let ss = 0;
    let pk = 0;
    let zc = 0;
    for (let i = w; i < w + win; i++) {
      const x = d[i];
      if (!Number.isFinite(x)) nan++;
      ss += x * x;
      pk = Math.max(pk, Math.abs(x));
      if (i > w && Math.sign(x) !== Math.sign(d[i - 1])) zc++;
    }
    peakAll = Math.max(peakAll, pk);
    windows.push({ t: +(w / sr).toFixed(1), rmsDb: +(10 * Math.log10(ss / win + 1e-12)).toFixed(1), peak: +pk.toFixed(3), zcHz: Math.round(zc / 2 / 0.5) });
  }
  // 16-bit PCM WAV
  const bytes = new ArrayBuffer(44 + d.length * 2);
  const dv = new DataView(bytes);
  const str = (o, s) => [...s].forEach((ch, i) => dv.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  dv.setUint32(4, 36 + d.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  str(36, 'data');
  dv.setUint32(40, d.length * 2, true);
  for (let i = 0; i < d.length; i++) dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i])) * 32767, true);
  let bin = '';
  const u8 = new Uint8Array(bytes);
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return { worklet: !!v.node, nan, peakAll, windows, wav: btoa(bin) };
});
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from(res.wav, 'base64'));
console.log(`worklet=${res.worklet} nan=${res.nan} peak=${res.peakAll.toFixed(3)} -> ${out}`);
for (const w of res.windows) console.log(`t=${w.t}s rms=${w.rmsDb}dB peak=${w.peak} zc~${w.zcHz}Hz`);
console.log('errors', JSON.stringify(errors));
await browser.close();
