import type { CameraMode } from '../camera/ChaseCamera';
import type { Game } from '../game/Game';
import type { DriveInput } from '../vehicle/VehicleSim';

/**
 * Debug-only automation surface (installed with ?test=1 or ?debug=1).
 * Everything drives the real game: inputs go through the same DriveInput path as the keyboard.
 */
export function installTestApi(game: Game): void {
  const api = {
    ready: true,
    get state() {
      return game.state;
    },
    telemetry: () => game.telemetry(),
    track: () => ({
      length: game.track.length,
      startS: game.track.startS,
      finishS: game.track.finishS,
      gates: game.track.gates.slice(),
      tags: game.track.tags.slice(),
    }),
    /** Stop the real-time loop from advancing the simulation (rendering continues). */
    setManual: (on: boolean) => {
      game.manual = on;
    },
    /** Deterministically advance the game by `seconds` using fixed 1/60 frames. */
    step: (seconds: number) => {
      game.stepSim(seconds);
      return game.telemetry();
    },
    /** Step until a predicate on telemetry is true or timeout (sim seconds). Returns telemetry. */
    stepUntil: (code: string, timeout = 30, chunk = 0.05) => {
      // code is a JS expression over `t` (telemetry), evaluated in-page
      const fn = new Function('t', `return (${code});`) as (t: unknown) => boolean;
      let elapsed = 0;
      while (elapsed < timeout) {
        game.stepSim(chunk);
        elapsed += chunk;
        if (fn(game.telemetry())) break;
      }
      return { ...game.telemetry(), elapsed };
    },
    render: () => {
      game.render();
    },
    start: (skipCountdown = true) => game.startRace(skipCountdown),
    restart: () => game.startRace(true),
    recover: () => game.recover(),
    setInput: (inp: Partial<DriveInput> | null) => {
      game.inputOverride = inp ? { throttle: 0, brake: 0, steer: 0, handbrake: 0, ...inp } : null;
    },
    setAutopilot: (on: boolean, aggression = 1, digital = false) => {
      game.autopilotOn = on;
      game.autopilot.opts.aggression = aggression;
      game.autopilot.opts.digital = digital;
    },
    setLateralTarget: (d: number) => {
      game.autopilot.lateralTarget = d;
    },
    teleport: (s: number, d = 0, speed = 0) => game.teleport(s, d, speed),
    setCamera: (mode: CameraMode) => game.setCamera(mode),
    setPortrait: (on: boolean) => game.setPortrait(on),
    hud: (visible: boolean) => game.hud.setVisible(visible),
    pause: () => game.pause(),
    resume: () => game.resume(),
    stats: () => ({
      fps: game.fps,
      frameMs: game.frameMsAvg,
      calls: game.renderer.info.render.calls,
      triangles: game.renderer.info.render.triangles,
      geometries: game.renderer.info.memory.geometries,
      textures: game.renderer.info.memory.textures,
      trees: game.veg.treeCount,
      tufts: game.veg.tuftCount,
    }),
    /** Measure rendering FPS over `ms` of real time (game keeps running in real time). */
    measureFps: async (ms = 3000) => {
      const t0 = performance.now();
      let frames = 0;
      await new Promise<void>((resolve) => {
        const tick = () => {
          frames++;
          if (performance.now() - t0 < ms) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      return (frames * 1000) / (performance.now() - t0);
    },
  };
  (window as unknown as { __RALLY__: typeof api }).__RALLY__ = api;
}
