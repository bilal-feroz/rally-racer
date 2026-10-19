// Capture named in-game screenshots of real driving scenarios (deterministic, seed 123).
// usage: node scripts/capture.mjs [outDir=screenshots] [width=1920] [height=1080]
// Requires the dev server (npm run dev) or RALLY_URL pointing at a served build.
import { launchGame, shot } from './lib/harness.mjs';

const out = process.argv[2] ?? 'screenshots';
const W = Number(process.argv[3] ?? 1920);
const H = Number(process.argv[4] ?? 1080);
const log = [];

async function session(fn, opts = {}) {
  const g = await launchGame({ width: opts.w ?? W, height: opts.h ?? H, query: opts.query ?? '' });
  await g.page.evaluate(() => window.__RALLY__.setManual(true));
  try {
    await fn(g.page);
  } finally {
    if (g.errors.length) log.push(`console errors: ${g.errors.join(' | ')}`);
    await g.browser.close();
  }
}

const api = (page, code, arg) => page.evaluate(code, arg);
const tag = async (page, name) => (await api(page, () => window.__RALLY__.track())).tags.find((t) => t.name === name);

async function driveTo(page, s, maxSecs = 120) {
  return api(
    page,
    ({ s, maxSecs }) => window.__RALLY__.stepUntil(`t.s >= ${s} || t.state === 'finished'`, maxSecs, 0.05),
    { s, maxSecs },
  );
}

async function save(page, name, t) {
  await shot(page, `${out}/${name}.png`);
  const tl = t ?? (await api(page, () => window.__RALLY__.telemetry()));
  log.push(`${name}: s=${tl.s.toFixed(0)} mph=${tl.mph.toFixed(0)} gear=${tl.gear} slip=${tl.bodySlipDeg.toFixed(1)} roll=${tl.rollDeg.toFixed(1)} air=${tl.airTime.toFixed(2)} gate=${tl.gate}`);
}

// --------------------------------------------------------------- main run (autopilot)
await session(async (page) => {
  await save(page, 'spawn');
  await api(page, () => window.__RALLY__.setAutopilot(true));
  await driveTo(page, 250);
  await save(page, 'fast-straight');
  const sw = await tag(page, 'sweeper');
  await driveTo(page, (sw.s0 + sw.s1) / 2);
  await save(page, 'forest-bend');
  // jump: step until airborne
  const j = await tag(page, 'jump1');
  await driveTo(page, j.s0 - 15);
  const tj = await api(page, () => window.__RALLY__.stepUntil('t.airTime > 0.38', 4, 1 / 60));
  await save(page, 'jump', tj);
  const v = await tag(page, 'vista');
  await driveTo(page, v.s0 + 40);
  await save(page, 'downhill');
  const b = await tag(page, 'banked');
  await driveTo(page, b.s0 + 70);
  await save(page, 'banked-turn');
  const r = await tag(page, 'recovery');
  await driveTo(page, r.s0 + 120);
  await save(page, 'uphill-shadows');
  const f = await tag(page, 'finish');
  await driveTo(page, f.s1 - 6);
  await save(page, 'finish-line');
  await api(page, () => window.__RALLY__.stepUntil("t.state === 'finished'", 10, 0.05));
  await api(page, () => window.__RALLY__.step(1));
  await save(page, 'finish');
});

// --------------------------------------------------------------- drift (scripted handbrake entry)
await session(async (page) => {
  const c = await tag(page, 'medium');
  await api(page, ({ s }) => {
    const R = window.__RALLY__;
    R.teleport(s - 90, 0, 24);
    R.setAutopilot(true);
  }, { s: c.s0 });
  await driveTo(page, c.s0 - 6);
  // left-hander: flick with handbrake + full lock, then hold power
  await api(page, () => {
    const R = window.__RALLY__;
    R.setInput({ steer: -1, handbrake: 1, throttle: 0.2 });
    R.step(0.3);
    R.setInput({ steer: -0.2, throttle: 0.85 });
  });
  const td = await api(page, () => window.__RALLY__.stepUntil('Math.abs(t.bodySlipDeg) > 22', 1.5, 1 / 60));
  await save(page, 'drift', td);
  await api(page, () => window.__RALLY__.step(0.25));
  await save(page, 'drift-2');
});

// --------------------------------------------------------------- off-road excursion
await session(async (page) => {
  const vl = await tag(page, 'valley');
  await api(page, ({ s }) => {
    const R = window.__RALLY__;
    R.teleport(s, 0, 24);
    R.setInput({ throttle: 0.5, steer: -0.5 });
    R.step(0.75);
    R.setInput({ throttle: 0.7, steer: 0.25 });
    R.step(0.6);
  }, { s: vl.s0 + 30 });
  await save(page, 'offroad');
});

// --------------------------------------------------------------- alternate cameras
await session(async (page) => {
  await api(page, () => window.__RALLY__.setAutopilot(true));
  const sw = await tag(page, 'vista');
  await driveTo(page, sw.s0 + 120);
  await api(page, () => window.__RALLY__.setCamera('hood'));
  await api(page, () => window.__RALLY__.step(0.1));
  await save(page, 'cam-hood');
  await api(page, () => window.__RALLY__.setCamera('cinematic'));
  await api(page, () => window.__RALLY__.step(1.2));
  await save(page, 'cam-tv');
});

// --------------------------------------------------------------- car model close-ups (static, HUD hidden)
await session(async (page) => {
  await api(page, () => {
    const R = window.__RALLY__;
    R.teleport(400, 0, 0);
    R.step(1.0);
    R.hud(false);
  });
  const views = [
    ['car-rear34', -4.2, 1.7, -5.2],
    ['car-side', -6.5, 1.2, 0.3],
    ['car-front34', 4.5, 1.6, 5.4],
  ];
  for (const [name, x, y, z] of views) {
    await api(page, ({ x, y, z }) => {
      const g = window.game;
      const p = g.sim.pos;
      const q = g.sim.quat;
      const off = new p.constructor(x, y, z).applyQuaternion(q);
      const cam = g.cam.camera;
      cam.position.copy(p).add(off);
      cam.fov = 40;
      cam.updateProjectionMatrix();
      cam.lookAt(p.x, p.y + 0.2, p.z);
    }, { x, y, z });
    await save(page, name);
  }
});

// --------------------------------------------------------------- 9:16 portrait preview
await session(
  async (page) => {
    await api(page, () => window.__RALLY__.setAutopilot(true));
    const r = await tag(page, 'recovery');
    await driveTo(page, r.s0 + 90);
    await save(page, 'portrait-preview');
    const b = await tag(page, 'banked');
    await api(page, ({ s }) => {
      const R = window.__RALLY__;
      R.teleport(s - 40, 0, 24);
    }, { s: b.s0 });
    await driveTo(page, b.s0 + 60);
    await save(page, 'portrait-banked');
  },
  { w: 720, h: 1280 },
);

console.log(log.join('\n'));
