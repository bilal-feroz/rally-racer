import type { DriveInput } from '../vehicle/VehicleSim';

export type Action = 'recover' | 'camera' | 'pause' | 'mute' | 'restart' | 'confirm' | 'portrait' | 'debug' | 'ghost';

/** Keyboard + gamepad input. Produces analog drive input and discrete action events. */
export class Input {
  private keys = new Set<string>();
  private actions: Action[] = [];
  private padIndex = -1;
  private prevPadButtons: boolean[] = [];
  /** last device that produced input */
  device: 'keyboard' | 'gamepad' = 'keyboard';
  readonly drive: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
  enabled = true;

  constructor(target: Window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) {
        if (this.isGameKey(e.code)) e.preventDefault();
        return;
      }
      this.keys.add(e.code);
      this.device = 'keyboard';
      const a = this.mapAction(e.code);
      if (a) this.actions.push(a);
      if (this.isGameKey(e.code)) e.preventDefault();
    });
    target.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    target.addEventListener('blur', () => this.keys.clear());
    target.addEventListener('gamepadconnected', (e) => {
      this.padIndex = (e as GamepadEvent).gamepad.index;
    });
    target.addEventListener('gamepaddisconnected', () => {
      this.padIndex = -1;
    });
  }

  private isGameKey(code: string): boolean {
    return /^(Arrow|Space|Key[WASDRCMP]|Escape|Enter)/.test(code);
  }

  private mapAction(code: string): Action | null {
    switch (code) {
      case 'KeyR':
        return 'recover';
      case 'KeyC':
        return 'camera';
      case 'Escape':
      case 'KeyP':
        return 'pause';
      case 'KeyM':
        return 'mute';
      case 'Enter':
        return 'confirm';
      case 'KeyT':
        return 'restart';
      case 'KeyV':
        return 'portrait';
      case 'F3':
        return 'debug';
      case 'KeyG':
        return 'ghost';
    }
    return null;
  }

  pushAction(a: Action): void {
    this.actions.push(a);
  }

  consumeActions(): Action[] {
    const a = this.actions;
    this.actions = [];
    return a;
  }

  private down(...codes: string[]): boolean {
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  /** Poll devices and update `drive`. */
  update(): void {
    const k = this.drive;
    let throttle = this.down('KeyW', 'ArrowUp') ? 1 : 0;
    let brake = this.down('KeyS', 'ArrowDown') ? 1 : 0;
    let steer = (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0);
    let handbrake = this.down('Space') ? 1 : 0;

    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    if (this.padIndex >= 0) pad = pads[this.padIndex] ?? null;
    if (!pad) for (const p of pads) if (p && p.connected) pad = p;
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      const dz = 0.12;
      const sx = Math.abs(ax) < dz ? 0 : Math.sign(ax) * ((Math.abs(ax) - dz) / (1 - dz));
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      const a = pad.buttons[0]?.pressed ?? false;
      const b = pad.buttons[1]?.pressed ?? false;
      const padActive = Math.abs(sx) > 0.05 || rt > 0.05 || lt > 0.05 || a || b;
      if (padActive) this.device = 'gamepad';
      if (this.device === 'gamepad') {
        // gentle response curve for fine control
        steer = Math.sign(sx) * Math.pow(Math.abs(sx), 1.4) || steer;
        throttle = Math.max(throttle, rt);
        brake = Math.max(brake, lt);
        handbrake = Math.max(handbrake, a || (pad.buttons[5]?.pressed ?? false) ? 1 : 0);
      }
      const pressed = pad.buttons.map((bt) => bt.pressed);
      const edge = (i: number) => pressed[i] && !this.prevPadButtons[i];
      if (edge(9)) this.actions.push('pause');
      if (edge(3)) this.actions.push('recover');
      if (edge(2)) this.actions.push('camera');
      if (edge(8)) this.actions.push('restart');
      if (edge(0)) this.actions.push('confirm');
      this.prevPadButtons = pressed;
    }
    if (!this.enabled) {
      throttle = brake = steer = handbrake = 0;
    }
    k.throttle = throttle;
    k.brake = brake;
    k.steer = steer;
    k.handbrake = handbrake;
  }
}
