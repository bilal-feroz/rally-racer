import { clamp } from '../core/math';
import type { Track } from '../track/Track';

export function formatTime(t: number, showMinutes = true): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const ss = s.toFixed(3).padStart(6, '0');
  return showMinutes ? `${m}:${ss}` : ss;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export interface HudState {
  time: number;
  gate: number;
  gates: number;
  speedMps: number;
  rpm: number;
  redline: number;
  gear: number;
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  distanceM: number;
  s: number;
  heading: number;
  x: number;
  z: number;
}

export class Hud {
  readonly root: HTMLDivElement;
  private timeEl: HTMLDivElement;
  private gateEl: HTMLDivElement;
  private splitEl: HTMLDivElement;
  private routeCanvas: HTMLCanvasElement;
  private tachCanvas: HTMLCanvasElement;
  private gearEl: HTMLDivElement;
  private speedEl: HTMLSpanElement;
  private odoEl: HTMLDivElement;
  private barSteer: HTMLElement;
  private barThr: HTMLElement;
  private barBrk: HTMLElement;
  private hbTag: HTMLDivElement;
  private msgEl: HTMLDivElement;
  private warnEl: HTMLDivElement;
  readonly fpsEl: HTMLDivElement;
  private splitTimer = 0;
  private msgTimer = 0;
  private lastRouteDraw = -1;
  private lastTach = -1;

  constructor(
    parent: HTMLElement,
    private readonly track: Track,
  ) {
    this.root = el('div', 'hud');
    const top = el('div', 'hud-top');
    const timer = el('div', 'timer-box');
    this.timeEl = el('div', 'time', '0:00.000');
    this.gateEl = el('div', 'gate', 'GATE 0 OF 20');
    timer.append(this.timeEl, this.gateEl);
    const route = el('div', 'route-box');
    this.routeCanvas = el('canvas');
    this.routeCanvas.width = 300;
    this.routeCanvas.height = 168;
    route.append(this.routeCanvas);
    this.splitEl = el('div', 'split');
    top.append(timer, route, this.splitEl);

    const br = el('div', 'hud-br');
    const tags = el('div', 'tags');
    this.hbTag = el('div', 'tag', 'HANDBRAKE');
    tags.append(this.hbTag);
    const tach = el('div', 'tach');
    this.tachCanvas = el('canvas');
    this.tachCanvas.width = 300;
    this.tachCanvas.height = 184;
    this.gearEl = el('div', 'gear', 'N');
    tach.append(this.tachCanvas, this.gearEl);
    const sp = el('div', 'speed-box');
    this.speedEl = el('span', 'v', '0');
    sp.append(this.speedEl, el('span', 'u', 'MPH'));
    br.append(tags, tach, sp);

    const bl = el('div', 'hud-bl');
    this.odoEl = el('div', 'odo', '0.00<small>MI</small>');
    const bars = el('div', 'bars');
    const mk = (label: string, cls: string) => {
      const b = el('div', `bar ${cls}`);
      const i = el('i');
      b.append(i);
      bars.append(el('span', '', label), b);
      return i;
    };
    this.barSteer = mk('STEER', 'steer');
    this.barThr = mk('THROTTLE', 'thr');
    this.barBrk = mk('BRAKE', 'brk');
    bl.append(this.odoEl, bars);

    this.msgEl = el('div', 'center-msg');
    this.warnEl = el('div', 'warn', 'RETURN TO THE STAGE');
    this.fpsEl = el('div', 'fps');
    this.root.append(top, br, bl, this.msgEl, this.warnEl, this.fpsEl);
    parent.append(this.root);
  }

  setScale(frameHeight: number, portrait: boolean): void {
    const s = clamp(frameHeight / (portrait ? 1280 : 1080), 0.55, 1.4) * (portrait ? 1.25 : 1);
    this.root.style.setProperty('--s', s.toFixed(3));
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  showSplit(html: string): void {
    this.splitEl.innerHTML = html;
    this.splitEl.classList.add('show');
    this.splitTimer = 3.2;
  }

  message(text: string, seconds = 1.2, small = false): void {
    this.msgEl.textContent = text;
    this.msgEl.classList.toggle('small', small);
    this.msgEl.classList.add('show');
    this.msgTimer = seconds;
  }

  clearMessage(): void {
    this.msgEl.classList.remove('show');
    this.msgTimer = 0;
  }

  warn(show: boolean, text?: string): void {
    if (text) this.warnEl.textContent = text;
    this.warnEl.classList.toggle('show', show);
  }

  update(dt: number, st: HudState): void {
    this.timeEl.textContent = formatTime(st.time);
    this.gateEl.textContent = `GATE ${Math.min(st.gate + 1, st.gates)} OF ${st.gates}`;
    const mph = Math.round(Math.abs(st.speedMps) * 2.23694);
    this.speedEl.textContent = String(mph);
    this.gearEl.textContent = st.gear < 0 ? 'R' : st.gear === 0 ? 'N' : String(st.gear);
    this.odoEl.innerHTML = `${(st.distanceM / 1609.34).toFixed(2)}<small>MI</small>`;
    const steer = clamp(st.steer, -1, 1);
    this.barSteer.style.left = steer < 0 ? `${50 + steer * 50}%` : '50%';
    this.barSteer.style.width = `${Math.abs(steer) * 50}%`;
    this.barThr.style.width = `${clamp(st.throttle, 0, 1) * 100}%`;
    this.barBrk.style.width = `${clamp(st.brake, 0, 1) * 100}%`;
    this.hbTag.classList.toggle('on', st.handbrake);

    if (this.splitTimer > 0) {
      this.splitTimer -= dt;
      if (this.splitTimer <= 0) this.splitEl.classList.remove('show');
    }
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.msgEl.classList.remove('show');
    }
    const rpmQ = Math.round(st.rpm / 25);
    if (rpmQ !== this.lastTach) {
      this.lastTach = rpmQ;
      this.drawTach(st.rpm, st.redline);
    }
    const sQ = Math.round(st.s * 2);
    if (sQ !== this.lastRouteDraw) {
      this.lastRouteDraw = sQ;
      this.drawRoute(st);
    }
  }

  private drawTach(rpm: number, redline: number): void {
    const c = this.tachCanvas;
    const g = c.getContext('2d')!;
    const W = c.width;
    const H = c.height;
    g.clearRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H * 0.86;
    const R = W * 0.4;
    const a0 = Math.PI * 1.0;
    const a1 = Math.PI * 2.0;
    const maxRpm = 8500;
    g.lineCap = 'butt';
    g.lineWidth = 16;
    g.strokeStyle = 'rgba(15,18,24,0.75)';
    g.beginPath();
    g.arc(cx, cy, R, a0, a1);
    g.stroke();
    // redline zone
    g.strokeStyle = 'rgba(255,70,50,0.55)';
    g.beginPath();
    g.arc(cx, cy, R, a0 + (redline / maxRpm) * Math.PI, a1);
    g.stroke();
    // fill
    const t = clamp(rpm / maxRpm, 0, 1);
    const grd = g.createLinearGradient(cx - R, 0, cx + R, 0);
    grd.addColorStop(0, '#ff9a3c');
    grd.addColorStop(0.75, '#ff6b1a');
    grd.addColorStop(1, '#ff3b2f');
    g.strokeStyle = grd;
    g.lineWidth = 12;
    g.beginPath();
    g.arc(cx, cy, R, a0, a0 + t * Math.PI);
    g.stroke();
    // ticks
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    g.lineWidth = 2;
    for (let k = 0; k <= 8; k++) {
      const a = a0 + (k / 8.5) * Math.PI;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * (R - 14), cy + Math.sin(a) * (R - 14));
      g.lineTo(cx + Math.cos(a) * (R - 22), cy + Math.sin(a) * (R - 22));
      g.stroke();
    }
  }

  private drawRoute(st: HudState): void {
    const c = this.routeCanvas;
    const g = c.getContext('2d')!;
    const W = c.width;
    const H = c.height;
    g.clearRect(0, 0, W, H);
    const T = this.track;
    // rotate so travel direction is up
    const f = T.frameAt(st.s);
    const ang = f.heading;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const scale = 0.33;
    const ox = W / 2;
    const oy = H * 0.86;
    const toScreen = (x: number, z: number): [number, number] => {
      const dx = x - f.x;
      const dz = z - f.z;
      // local forward = (sin a, cos a), local left = (cos a, -sin a)
      const fw = dx * sa + dz * ca;
      const lf = dx * ca - dz * sa;
      return [ox - lf * scale, oy - fw * scale];
    };
    g.lineJoin = 'round';
    g.lineCap = 'round';
    const draw = (from: number, to: number, color: string, width: number) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      let first = true;
      for (let s = from; s <= to; s += 4) {
        const p = T.frameAt(s);
        const [x, y] = toScreen(p.x, p.z);
        if (first) g.moveTo(x, y);
        else g.lineTo(x, y);
        first = false;
      }
      g.stroke();
    };
    const end = Math.min(T.length, st.s + 480);
    draw(Math.max(0, st.s - 30), end, 'rgba(0,0,0,0.35)', 12);
    draw(Math.max(0, st.s - 30), end, '#f5f2ea', 6);
    // gates ahead
    for (let k = st.gate; k < T.gates.length; k++) {
      const gs = T.gates[k];
      if (gs > end) break;
      const p = T.frameAt(gs);
      const [x, y] = toScreen(p.x, p.z);
      g.fillStyle = k === T.gates.length - 1 ? '#ffffff' : '#ff6b1a';
      g.beginPath();
      g.arc(x, y, 5, 0, Math.PI * 2);
      g.fill();
    }
    // car marker
    g.fillStyle = '#ff6b1a';
    g.beginPath();
    g.moveTo(ox, oy - 11);
    g.lineTo(ox - 7, oy + 6);
    g.lineTo(ox + 7, oy + 6);
    g.closePath();
    g.fill();
  }
}
