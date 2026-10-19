import type { Game } from '../game/Game';
import { formatTime } from './Hud';

function h(tag: string, cls = '', html = ''): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `btn ${cls}`;
  b.textContent = label;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
    (document.getElementById('game-canvas') as HTMLCanvasElement | null)?.focus();
  });
  return b;
}

const CONTROLS = `
<div class="controls">
  <span><kbd>W</kbd><kbd>↑</kbd></span><span>Throttle</span>
  <span><kbd>S</kbd><kbd>↓</kbd></span><span>Brake / reverse</span>
  <span><kbd>A</kbd><kbd>D</kbd></span><span>Steer</span>
  <span><kbd>Space</kbd></span><span>Handbrake</span>
  <span><kbd>R</kbd></span><span>Recover to road</span>
  <span><kbd>C</kbd></span><span>Camera (chase / hood / TV)</span>
  <span><kbd>Esc</kbd></span><span>Pause</span>
  <span><kbd>M</kbd> <kbd>V</kbd></span><span>Mute · 9:16 preview</span>
  <span><kbd>T</kbd></span><span>Restart stage</span>
  <span><kbd>G</kbd></span><span>Ghost of your best run on/off</span>
  <span><kbd>U</kbd> <kbd>F</kbd></span><span>MPH / KM/H · fullscreen</span>
</div>`;

export class Menus {
  private title: HTMLElement;
  private pause: HTMLElement;
  private results: HTMLElement;
  private bestEl: HTMLElement;
  private qualityBtn: HTMLButtonElement | null = null;

  constructor(
    root: HTMLElement,
    private readonly game: Game,
  ) {
    // title
    this.title = h('div', 'screen title-screen hidden');
    const tc = h('div', 'card');
    tc.append(h('h1', 'title', 'TIMBERLINE<br><span>RALLY</span>'));
    tc.append(h('div', 'subtitle', 'Stage 1 · Black Pine Ridge · 20 gates · hardpack'));
    this.bestEl = h('div', 'stat-row');
    tc.append(this.bestEl);
    const tb = h('div', 'btn-row');
    tb.append(button('Start stage', '', () => game.startRace()));
    tc.append(tb);
    tc.append(h('div', 'subtitle', 'Controls · gamepad supported'));
    tc.append(h('div', '', CONTROLS));
    this.title.append(tc);
    this.title.addEventListener('click', () => game.startRace());
    tc.addEventListener('click', (e) => e.stopPropagation());

    // pause
    this.pause = h('div', 'screen hidden');
    const pc = h('div', 'card');
    pc.append(h('h1', 'title', 'PAUSED'));
    pc.append(h('div', 'subtitle', 'Black Pine Ridge'));
    const pb = h('div', 'btn-row');
    pb.append(
      button('Resume', '', () => game.resume()),
      button('Restart', 'ghost', () => game.startRace()),
      button('Camera', 'ghost', () => game.input.pushAction('camera')),
      button('Mute', 'ghost', () => game.input.pushAction('mute')),
      (() => {
        const b = button(`Quality: ${game.quality}`, 'ghost', () => {
          const order = ['high', 'medium', 'low'] as const;
          const next = order[(order.indexOf(game.quality) + 1) % order.length];
          game.applyQuality(next);
          b.textContent = `Quality: ${next}`;
        });
        this.qualityBtn = b;
        return b;
      })(),
      button('Quit to title', 'ghost', () => game.toTitle()),
    );
    pc.append(pb, h('div', '', CONTROLS));
    this.pause.append(pc);

    // results
    this.results = h('div', 'screen hidden');
    root.append(this.title, this.pause, this.results);
  }

  hideAll(): void {
    this.title.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.results.classList.add('hidden');
  }

  showTitle(): void {
    this.hideAll();
    const b = this.game.best;
    this.bestEl.innerHTML = `<span>Personal best</span><b>${b ? formatTime(b.time) : '—'}</b>`;
    this.title.classList.remove('hidden');
  }

  showPause(): void {
    this.hideAll();
    if (this.qualityBtn) this.qualityBtn.textContent = `Quality: ${this.game.quality}`;
    this.pause.classList.remove('hidden');
  }

  showResults(time: number, prevBest: number | null, isBest: boolean, splits: number[]): void {
    this.hideAll();
    const r = this.results;
    r.innerHTML = '';
    const c = h('div', 'card');
    c.append(h('div', 'subtitle', 'Stage complete · Black Pine Ridge'));
    c.append(h('div', 'big-time', formatTime(time)));
    if (isBest) c.append(h('div', 'pb', prevBest === null ? 'FIRST CLEAN RUN — PERSONAL BEST SET' : `NEW PERSONAL BEST  −${(prevBest - time).toFixed(3)}s`));
    else if (prevBest !== null) c.append(h('div', 'stat-row', `<span>Personal best</span><b>${formatTime(prevBest)}</b>`));
    c.append(h('div', 'stat-row', `<span>Recoveries</span><b>${this.game.recoveries}</b>`));
    c.append(h('div', 'stat-row', `<span>Distance</span><b>${(this.game.distance / 1609.34).toFixed(2)} mi</b>`));
    const sp = h('div', 'splits');
    splits.forEach((t, i) => sp.append(h('span', '', `G${i + 1} ${formatTime(t)}`)));
    c.append(sp);
    const b = h('div', 'btn-row');
    b.append(
      button('Race again', '', () => this.game.startRace()),
      button('Title', 'ghost', () => this.game.toTitle()),
    );
    c.append(b);
    r.append(c);
    r.classList.remove('hidden');
  }
}
