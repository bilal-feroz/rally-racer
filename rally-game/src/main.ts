import { Game, type GameOptions } from './game/Game';
import { installTestApi } from './testing/TestApi';
import { loadSettings } from './game/Storage';

const params = new URLSearchParams(location.search);
const test = params.get('test') === '1';
const opts: GameOptions = {
  test,
  debug: test || params.get('debug') === '1',
  seed: Number(params.get('seed') ?? 123) || 123,
  portrait: params.get('portrait') === '1',
  quality: (params.get('quality') as GameOptions['quality']) ?? loadSettings().quality ?? 'high',
  autostart: test || params.get('autostart') === '1',
  noAudio: test || params.get('audio') === '0',
};

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const frame = document.getElementById('stage-frame') as HTMLElement;
const hudRoot = document.getElementById('hud-root') as HTMLElement;
const overlayRoot = document.getElementById('overlay-root') as HTMLElement;
canvas.tabIndex = 0;

if (opts.portrait) document.body.classList.add('portrait-preview');
// deterministic captures: no CSS fades in test mode
if (opts.test) document.body.classList.add('test-mode');

// loading screen
const loading = document.createElement('div');
loading.className = 'loading';
loading.innerHTML = `<div style="font-size:34px;font-weight:800;letter-spacing:.02em">TIMBERLINE <span style="color:#ff6b1a">RALLY</span></div>
<div class="bar-outer"><div class="bar-inner"></div></div><div class="lbl" style="color:#a9b0bb;letter-spacing:.14em;font-size:12px;text-transform:uppercase">Loading</div>`;
overlayRoot.append(loading);
const bar = loading.querySelector('.bar-inner') as HTMLElement;
const lbl = loading.querySelector('.lbl') as HTMLElement;

function fail(msg: string): void {
  loading.innerHTML = `<div style="max-width:520px;text-align:center;line-height:1.5"><b>Timberline Rally could not start.</b><br>${msg}</div>`;
}

const probe = document.createElement('canvas').getContext('webgl2');
if (!probe) {
  fail('WebGL2 is required. Please use a recent Chrome, Edge or Firefox with hardware acceleration enabled.');
} else {
  const game = new Game(canvas, frame, hudRoot, overlayRoot, opts);
  (window as unknown as { game?: Game }).game = opts.debug ? game : undefined;
  game
    .init((p, label) => {
      bar.style.width = `${Math.round(p * 100)}%`;
      lbl.textContent = label;
    })
    .then(() => {
      loading.remove();
      if (opts.debug) installTestApi(game);
      canvas.focus();
    })
    .catch((e: unknown) => {
      console.error(e);
      fail(String(e instanceof Error ? e.message : e));
    });
}
