import * as THREE from 'three';
import { ChaseCamera, type CameraMode } from '../camera/ChaseCamera';
import { clamp } from '../core/math';
import { Autopilot } from '../testing/Autopilot';
import { STAGE } from '../track/stageDesign';
import { SHOULDER, Track, type TrackProjection } from '../track/Track';
import { formatTime, Hud } from '../ui/Hud';
import { Menus } from '../ui/Menus';
import { CarModel } from '../vehicle/CarModel';
import { CAR } from '../vehicle/VehicleParams';
import { VehicleSim, type CollisionWorld, type DriveInput, type Obstacle } from '../vehicle/VehicleSim';
import { createLights, installAtmosphere, PALETTE, updateSunShadow } from '../world/Atmosphere';
import { Biome } from '../world/Biome';
import { Props } from '../world/Props';
import { RoadMesh } from '../world/RoadMesh';
import { createSky } from '../world/Sky';
import { TerrainField } from '../world/TerrainField';
import { TerrainMesh } from '../world/TerrainMesh';
import { Vegetation } from '../world/Vegetation';
import { Water } from '../world/Water';
import { Input } from './Input';
import { loadBest, saveBest, type BestRecord } from './Storage';
import { Effects } from '../vfx/Effects';
import { AudioEngine } from '../audio/AudioEngine';

export type GameState = 'loading' | 'title' | 'countdown' | 'racing' | 'finished' | 'paused';

export interface GameOptions {
  test: boolean;
  debug: boolean;
  seed: number;
  portrait: boolean;
  quality: 'high' | 'medium' | 'low';
  autostart: boolean;
  noAudio: boolean;
}

export const PHYS_DT = 1 / 240;

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cam: ChaseCamera;
  track!: Track;
  field!: TerrainField;
  biome!: Biome;
  terrain!: TerrainMesh;
  road!: RoadMesh;
  veg!: Vegetation;
  props!: Props;
  sim!: VehicleSim;
  car!: CarModel;
  hud!: Hud;
  menus!: Menus;
  fx!: Effects;
  audio!: AudioEngine;
  autopilot!: Autopilot;
  readonly input: Input;
  sun!: THREE.DirectionalLight;
  sky!: THREE.Mesh;
  water!: Water;

  state: GameState = 'loading';
  private stateBeforePause: GameState = 'racing';
  raceTime = 0;
  countdown = 0;
  gateIndex = 0;
  splits: number[] = [];
  finishTime = -1;
  best: BestRecord | null = null;
  progressS = 0;
  private prevProgressS = 0;
  distance = 0;
  recoveries = 0;
  private lastSafeS = 0;
  private lastSafeTimer = 0;
  private offTrackTime = 0;
  private upsideDownTime = 0;
  private stuckTime = 0;
  private wrongWayTime = 0;
  private finishCoast = 0;
  private acc = 0;
  private readonly prevPos = new THREE.Vector3();
  private readonly prevQuat = new THREE.Quaternion();
  private readonly proj: TrackProjection = {} as TrackProjection;
  private time = 0;
  manual = false;
  autopilotOn = false;
  inputOverride: DriveInput | null = null;
  private readonly heldInput: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: 1 };
  private fpsFrames = 0;
  private fpsTime = 0;
  fps = 0;
  frameMsAvg = 0;
  private lastFrame = performance.now();
  private debugVisible = false;
  portrait = false;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly frame: HTMLElement,
    readonly hudRoot: HTMLElement,
    readonly overlayRoot: HTMLElement,
    readonly opts: GameOptions,
  ) {
    installAtmosphere();
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: opts.test,
    });
    const maxPR = opts.quality === 'high' ? 1.5 : opts.quality === 'medium' ? 1.25 : 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPR));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.cam = new ChaseCamera(16 / 9);
    this.input = new Input(window);
    this.portrait = opts.portrait;
  }

  /** Yield so the loading bar can paint (setTimeout also runs in background tabs, unlike rAF). */
  private async nextFrame(): Promise<void> {
    await new Promise<void>((r) => setTimeout(r, 16));
  }

  async init(progress: (p: number, label: string) => void): Promise<void> {
    const seed = this.opts.seed;
    progress(0.05, 'Surveying the stage');
    await this.nextFrame();
    this.track = new Track(STAGE);
    this.biome = new Biome(seed);
    progress(0.15, 'Shaping the hills');
    await this.nextFrame();
    this.field = new TerrainField(this.track, seed);
    progress(0.45, 'Laying hardpack');
    await this.nextFrame();
    this.terrain = new TerrainMesh(this.field, this.biome);
    this.road = new RoadMesh(this.track);
    this.props = new Props(this.track, this.field, seed);
    progress(0.6, 'Planting the forest');
    await this.nextFrame();
    this.veg = new Vegetation(this.field, this.track, this.biome, seed, this.props.reserved);
    this.props.build(seed);
    progress(0.85, 'Fuelling the car');
    await this.nextFrame();

    const scene = this.scene;
    scene.background = PALETTE.horizon.clone();
    scene.fog = new THREE.FogExp2(PALETTE.fog.clone(), PALETTE.fogDensity);
    this.sky = createSky();
    scene.add(this.sky);
    const { sun } = createLights(scene);
    this.sun = sun;
    scene.add(this.terrain.group, this.road.group, this.veg.group, this.props.group);

    const veg = this.veg;
    const props = this.props;
    const collision: CollisionWorld = {
      query(x: number, z: number, radius: number, out: Obstacle[]) {
        const n = veg.query(x, z, radius, out);
        return props.query(x, z, radius, out, n);
      },
    };
    this.sim = new VehicleSim(this.field, collision);
    const tmpObs: Obstacle[] = [];
    this.cam.clearance = (x: number, z: number) => {
      const n = collision.query(x, z, 10, tmpObs);
      let m = 10;
      for (let i = 0; i < n; i++) m = Math.min(m, Math.hypot(tmpObs[i].x - x, tmpObs[i].z - z) - tmpObs[i].r);
      return m;
    };
    // sky reflections for the car paint and glass
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.add(createSky(true));
    const envRT = pmrem.fromScene(envScene, 0, 0.1, 3000);
    pmrem.dispose();
    this.car = new CarModel(envRT.texture);
    this.water = new Water(this.field, envRT.texture);
    if (this.water.mesh) scene.add(this.water.mesh);
    scene.add(this.car.root, this.car.blob);
    this.fx = new Effects(scene, this.field);
    this.audio = new AudioEngine(this.opts.noAudio);
    this.autopilot = new Autopilot(this.track);

    this.hud = new Hud(this.hudRoot, this.track);
    this.menus = new Menus(this.overlayRoot, this);
    this.best = loadBest();

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.resetToStart();
    progress(1, 'Ready');
    // warm up shaders
    this.renderer.compile(scene, this.cam.camera);
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) {
        for (const key of ['map', 'emissiveMap', 'normalMap'] as const) {
          const t = (mat as unknown as Record<string, THREE.Texture | null>)[key];
          if (t) this.renderer.initTexture(t);
        }
      }
    });
    this.state = 'title';
    if (this.opts.autostart) this.startRace(this.opts.test);
    else this.menus.showTitle();
    this.hud.setVisible(this.state !== 'title');
    this.renderer.setAnimationLoop(() => this.frameLoop());
  }

  // ------------------------------------------------------------------ flow
  resetToStart(): void {
    const f = this.track.frameAt(this.track.startS - 16);
    this.sim.reset(f.x, f.z, f.heading, 0);
    // settle suspension
    for (let i = 0; i < 240; i++) {
      this.sim.input = this.heldInput;
      this.sim.step(PHYS_DT);
    }
    this.raceTime = 0;
    this.gateIndex = 0;
    this.splits = [];
    this.finishTime = -1;
    this.distance = 0;
    this.recoveries = 0;
    this.progressS = this.track.startS - 16;
    this.prevProgressS = this.progressS;
    this.lastSafeS = this.progressS;
    this.offTrackTime = this.upsideDownTime = this.wrongWayTime = 0;
    this.finishCoast = 0;
    this.prevPos.copy(this.sim.pos);
    this.prevQuat.copy(this.sim.quat);
    this.acc = 0;
    this.cam.reset();
    this.fx?.reset();
  }

  startRace(skipCountdown = false): void {
    this.resetToStart();
    this.menus.hideAll();
    this.hud.setVisible(true);
    this.audio.resume();
    if (skipCountdown) {
      this.state = 'racing';
      this.hud.message('GO!', 0.6);
    } else {
      this.state = 'countdown';
      this.countdown = 3.0;
    }
  }

  pause(): void {
    if (this.state !== 'racing' && this.state !== 'countdown') return;
    this.stateBeforePause = this.state;
    this.state = 'paused';
    this.menus.showPause();
    this.audio.setPaused(true);
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = this.stateBeforePause;
    this.menus.hideAll();
    this.audio.setPaused(false);
    this.lastFrame = performance.now();
  }

  toTitle(): void {
    this.resetToStart();
    this.state = 'title';
    this.hud.setVisible(false);
    this.menus.showTitle();
    this.audio.setPaused(true);
  }

  recover(auto = false): void {
    if (this.state !== 'racing' && this.state !== 'countdown') return;
    const T = this.track;
    const s = Math.max(T.startS - 16, Math.min(this.lastSafeS - 8, T.finishS - 5));
    const f = T.frameAt(s);
    this.sim.reset(f.x, f.z, f.heading, 9);
    this.prevPos.copy(this.sim.pos);
    this.prevQuat.copy(this.sim.quat);
    this.progressS = s;
    this.prevProgressS = s;
    this.recoveries++;
    this.offTrackTime = this.upsideDownTime = 0;
    this.cam.reset();
    this.hud.message(auto ? 'RESET TO STAGE' : 'RECOVERED', 1.0, true);
    this.audio.thud(0.3);
  }

  setPortrait(on: boolean): void {
    this.portrait = on;
    document.body.classList.toggle('portrait-preview', on);
    this.resize();
  }

  setCamera(mode: CameraMode): void {
    this.cam.mode = mode;
    this.cam.reset();
  }

  resize(): void {
    const r = this.frame.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    this.renderer.setSize(w, h, false);
    this.cam.camera.aspect = w / h;
    this.cam.portrait = w / h < 0.9;
    this.cam.camera.updateProjectionMatrix();
    this.hud?.setScale(h, this.cam.portrait);
  }

  // ------------------------------------------------------------------ loop
  private frameLoop(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.fpsFrames++;
    this.fpsTime += dt;
    this.frameMsAvg = this.frameMsAvg * 0.95 + dt * 1000 * 0.05;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
      if (this.debugVisible) this.hud.fpsEl.textContent = `${this.fps.toFixed(0)} fps · ${this.renderer.info.render.calls} calls · ${(this.renderer.info.render.triangles / 1000).toFixed(0)}k tris`;
    }
    if (!this.manual) this.update(dt);
    this.render();
  }

  private handleActions(): void {
    for (const a of this.input.consumeActions()) {
      switch (a) {
        case 'pause':
          if (this.state === 'paused') this.resume();
          else this.pause();
          break;
        case 'recover':
          this.recover();
          break;
        case 'camera': {
          const m = this.cam.cycle();
          this.hud.message(m === 'chase' ? 'CHASE CAM' : m === 'hood' ? 'HOOD CAM' : 'TV CAM', 0.8, true);
          break;
        }
        case 'mute':
          this.hud.message(this.audio.toggleMute() ? 'SOUND OFF' : 'SOUND ON', 0.8, true);
          break;
        case 'restart':
          if (this.state !== 'title') this.startRace();
          break;
        case 'confirm':
          if (this.state === 'title' || this.state === 'finished') this.startRace();
          break;
        case 'portrait':
          this.setPortrait(!this.portrait);
          break;
        case 'debug':
          this.debugVisible = !this.debugVisible;
          this.hud.fpsEl.classList.toggle('show', this.debugVisible);
          break;
      }
    }
  }

  /** Advance the game by dt seconds of real time. */
  update(dt: number): void {
    this.time += dt;
    this.input.update();
    this.handleActions();
    const st = this.state;
    if (st === 'paused' || st === 'loading') return;

    if (st === 'countdown') {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown);
      if (after !== before && after > 0) {
        this.hud.message(String(after), 0.8);
        this.audio.beep(false);
      }
      if (this.countdown <= 0) {
        this.state = 'racing';
        this.hud.message('GO!', 0.7);
        this.audio.beep(true);
      }
    }

    // physics
    this.acc += dt;
    let steps = 0;
    while (this.acc >= PHYS_DT && steps < 40) {
      this.prevPos.copy(this.sim.pos);
      this.prevQuat.copy(this.sim.quat);
      this.fixedStep(PHYS_DT);
      this.acc -= PHYS_DT;
      steps++;
    }
    if (steps >= 40) this.acc = 0;
    this.updateVisuals(dt);
  }

  private chooseInput(): DriveInput {
    const st = this.state;
    if (st === 'title') return this.heldInput;
    if (st === 'countdown') {
      this.heldInput.throttle = this.input.drive.throttle;
      return this.heldInput;
    }
    if (st === 'finished') {
      this.finishInput.steer = this.autopilot.drive(this.sim, this.progressS, PHYS_DT).steer;
      return this.finishInput;
    }
    if (this.inputOverride) return this.inputOverride;
    if (this.autopilotOn) return this.autopilot.drive(this.sim, this.progressS, PHYS_DT);
    return this.input.drive;
  }

  private readonly finishInput: DriveInput = { throttle: 0, brake: 0.35, steer: 0, handbrake: 0 };

  private fixedStep(dt: number): void {
    const sim = this.sim;
    sim.input = this.chooseInput();
    sim.step(dt);
    const T = this.track;
    // progress along the stage (track-coherent local projection)
    const hint = Math.max(0, Math.round(this.progressS / T.ds));
    const p = T.projectLocal(sim.pos.x, sim.pos.z, hint, 30, this.proj);
    this.prevProgressS = this.progressS;
    // only allow continuous progress (no teleporting across hairpins)
    if (Math.abs(p.s - this.progressS) < 25) this.progressS = p.s;
    if (this.state === 'racing') {
      this.raceTime += dt;
      this.distance += sim.speed * dt;
      this.checkGates(dt);
      this.safety(dt, p);
    } else if (this.state === 'finished') {
      this.finishCoast += dt;
    }
  }

  private checkGates(dt: number): void {
    const T = this.track;
    if (this.gateIndex >= T.gates.length) return;
    const gs = T.gates[this.gateIndex];
    if (this.prevProgressS < gs && this.progressS >= gs) {
      const frac = (gs - this.prevProgressS) / Math.max(1e-6, this.progressS - this.prevProgressS);
      const t = this.raceTime - dt * (1 - frac);
      this.splits.push(t);
      const gi = this.gateIndex;
      this.gateIndex++;
      const bestSplit = this.best?.splits?.[gi];
      let deltaHtml = '';
      if (bestSplit !== undefined) {
        const d = t - bestSplit;
        deltaHtml = ` <span class="delta ${d <= 0 ? 'good' : 'bad'}">${d <= 0 ? '−' : '+'}${Math.abs(d).toFixed(2)}</span>`;
      }
      if (this.gateIndex >= T.gates.length) {
        this.finish(t);
      } else {
        this.hud.showSplit(`GATE ${gi + 1} &nbsp;${formatTime(t)}${deltaHtml}`);
        this.audio.checkpoint();
      }
    }
  }

  private finish(t: number): void {
    this.finishTime = t;
    this.raceTime = t;
    this.state = 'finished';
    this.finishCoast = 0;
    const prev = this.best;
    const isBest = !prev || t < prev.time;
    if (isBest) {
      this.best = { time: t, splits: this.splits.slice(), date: Date.now() };
      saveBest(this.best);
    }
    this.hud.message('FINISH', 1.6);
    this.audio.finish();
    setTimeout(() => {
      if (this.state === 'finished') this.menus.showResults(t, prev?.time ?? null, isBest, this.splits);
    }, this.manual ? 0 : 1600);
  }

  private safety(dt: number, p: TrackProjection): void {
    const sim = this.sim;
    const T = this.track;
    const hw = T.hwAt(p.s);
    const onRoad = Math.abs(p.d) < hw + SHOULDER * 0.5;
    const upright = sim.up.y > 0.85;
    this.lastSafeTimer -= dt;
    if (onRoad && upright && sim.groundedWheels >= 3 && this.lastSafeTimer <= 0) {
      this.lastSafeS = this.progressS;
      this.lastSafeTimer = 0.25;
    }
    // far off the stage
    if (Math.abs(p.d) > 38) this.offTrackTime += dt;
    else this.offTrackTime = Math.max(0, this.offTrackTime - dt * 2);
    this.hud.warn(Math.abs(p.d) > 28, 'RETURN TO THE STAGE');
    if (this.offTrackTime > 3) this.recover(true);
    // upside down / on side
    if (sim.up.y < 0.3 && sim.speed < 4) this.upsideDownTime += dt;
    else this.upsideDownTime = 0;
    if (this.upsideDownTime > 2.0) this.recover(true);
    // stuck (beached on a bank or nosed into a tree with the throttle pinned)
    const pushing = sim.input.throttle > 0.4 || sim.input.brake > 0.4;
    if (pushing && sim.speed < 1.0) this.stuckTime += dt;
    else this.stuckTime = Math.max(0, this.stuckTime - dt * 2);
    if (this.stuckTime > 5) {
      this.stuckTime = 0;
      this.recover(true);
    }
    // fell through the world (should never happen)
    if (sim.pos.y < this.field.heightAt(sim.pos.x, sim.pos.z) - 4) this.recover(true);
    // wrong way
    const f = T.frameAt(p.s);
    const along = sim.vel.x * f.tx + sim.vel.z * f.tz;
    if (along < -4) this.wrongWayTime += dt;
    else this.wrongWayTime = 0;
    if (this.wrongWayTime > 1.5 && Math.abs(p.d) <= 28) this.hud.warn(true, 'WRONG WAY');
  }

  private updateVisuals(dt: number): void {
    const alpha = clamp(this.acc / PHYS_DT, 0, 1);
    _pos.copy(this.prevPos).lerp(this.sim.pos, alpha);
    _quat.copy(this.prevQuat).slerp(this.sim.quat, alpha);
    const sim = this.sim;
    this.car.update(sim, _pos, _quat, Math.max(sim.brakeEff, this.state === 'countdown' ? 0.3 : 0), dt);
    // contact shadow blob: ground under the car
    const gs = this.field.sample(_pos.x, _pos.z, sim.trackHint, this.blobSample);
    this.car.placeBlob(_pos.x, gs.h, _pos.z, sim.heading, gs.nx, gs.ny, gs.nz, _pos.y - gs.h - 0.48);
    this.cam.update(dt, sim, _pos, _quat, this.field, this.track);
    this.fx.update(dt, sim, this.cam.camera, this.state === 'racing' || this.state === 'finished' || this.state === 'countdown');
    this.veg.update(dt, this.cam.camera.position, this.time);
    (this.sky.material as THREE.ShaderMaterial).uniforms.uTime.value = this.time;
    this.water.update(this.time);
    this.sky.position.copy(this.cam.camera.position);
    _pos.copy(this.cam.camera.position);
    const fwd = new THREE.Vector3();
    this.cam.camera.getWorldDirection(fwd);
    _pos.addScaledVector(fwd, 55);
    updateSunShadow(this.sun, _pos);
    this.audio.update(dt, sim, this.state);
    const drive = sim.input;
    this.hud.update(dt, {
      time: this.state === 'finished' ? this.finishTime : this.raceTime,
      gate: this.gateIndex,
      gates: this.track.gates.length,
      speedMps: sim.speed,
      rpm: sim.rpm,
      redline: CAR.redline,
      gear: sim.gear,
      throttle: drive.throttle,
      brake: drive.brake,
      steer: sim.steerInput,
      handbrake: drive.handbrake > 0.5,
      distanceM: this.distance,
      s: this.progressS,
      heading: sim.heading,
      x: sim.pos.x,
      z: sim.pos.z,
    });
  }

  private readonly blobSample = {} as import('../world/TerrainField').GroundSample;

  render(): void {
    this.renderer.render(this.scene, this.cam.camera);
  }

  // ------------------------------------------------------------------ test helpers
  stepSim(seconds: number, frameDt = 1 / 60): void {
    const n = Math.round(seconds / frameDt);
    for (let i = 0; i < n; i++) this.update(frameDt);
  }

  teleport(s: number, d = 0, speed = 0): void {
    const f = this.track.frameAt(s);
    this.sim.reset(f.x + f.lx * d, f.z + f.lz * d, f.heading, speed);
    this.prevPos.copy(this.sim.pos);
    this.prevQuat.copy(this.sim.quat);
    this.progressS = s;
    this.prevProgressS = s;
    // gates behind the teleport point count as passed (visual tests only)
    this.gateIndex = this.track.gates.findIndex((g) => g > s);
    if (this.gateIndex < 0) this.gateIndex = this.track.gates.length;
    this.cam.reset();
  }

  telemetry() {
    const sim = this.sim;
    const p = this.proj;
    return {
      state: this.state,
      time: this.raceTime,
      finishTime: this.finishTime,
      pos: { x: sim.pos.x, y: sim.pos.y, z: sim.pos.z },
      speed: sim.speed,
      mph: sim.speed * 2.23694,
      forwardSpeed: sim.forwardSpeed,
      heading: sim.heading,
      s: this.progressS,
      d: p.d,
      gate: this.gateIndex,
      gates: this.track.gates.length,
      grounded: sim.groundedWheels,
      airTime: sim.airTime,
      lastAirTime: sim.lastAirTime,
      bodySlipDeg: (sim.bodySlip * 180) / Math.PI,
      rollDeg: (sim.roll * 180) / Math.PI,
      pitchDeg: (sim.pitch * 180) / Math.PI,
      upY: sim.up.y,
      gear: sim.gear,
      rpm: sim.rpm,
      steerAngleDeg: (sim.steerAngle * 180) / Math.PI,
      surfaces: sim.wheels.map((w) => w.surface),
      compression: sim.wheels.map((w) => +w.compression.toFixed(3)),
      slide: sim.wheels.map((w) => +w.slide.toFixed(2)),
      groundY: this.field.heightAt(sim.pos.x, sim.pos.z),
      recoveries: this.recoveries,
      distance: this.distance,
      fps: this.fps,
      frameMs: this.frameMsAvg,
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
  }
}
