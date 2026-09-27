import { Injectable } from '@angular/core';

export interface Controls {
  /** -1 = left, 1 = right */
  turn: number;
  /** 0..1 */
  thrust: number;
  brake: boolean;
  boost: boolean;
}

const GAME_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ShiftLeft', 'ShiftRight',
]);

/** Keyboard + gamepad + touch input, read by the game loop every physics step. */
@Injectable({ providedIn: 'root' })
export class InputService {
  private readonly keys = new Set<string>();
  private pauseQueued = false;

  /** Set by the on-screen touch buttons. */
  readonly touch = { left: false, right: false, thrust: false, brake: false, boost: false };

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) this.pauseQueued = true;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Returns true once per Esc / P / Start press. */
  consumePause(): boolean {
    const pad = this.pad();
    const padStart = !!pad?.buttons[9]?.pressed;
    const fire = this.pauseQueued || (padStart && !this.padStartHeld);
    this.padStartHeld = padStart;
    this.pauseQueued = false;
    return fire;
  }
  private padStartHeld = false;

  read(): Controls {
    const k = this.keys;
    const t = this.touch;
    let turn = 0;
    if (k.has('ArrowLeft') || k.has('KeyA') || t.left) turn -= 1;
    if (k.has('ArrowRight') || k.has('KeyD') || t.right) turn += 1;
    let thrust = k.has('ArrowUp') || k.has('KeyW') || t.thrust ? 1 : 0;
    let brake = k.has('ArrowDown') || k.has('KeyS') || t.brake;
    let boost = k.has('Space') || k.has('ShiftLeft') || k.has('ShiftRight') || t.boost;

    const pad = this.pad();
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      if (Math.abs(ax) > 0.15) turn = ax;
      thrust = Math.max(thrust, pad.buttons[7]?.value ?? 0, pad.buttons[0]?.pressed ? 1 : 0);
      brake = brake || (pad.buttons[6]?.value ?? 0) > 0.3 || !!pad.buttons[1]?.pressed;
      boost = boost || !!pad.buttons[2]?.pressed || !!pad.buttons[5]?.pressed;
    }
    return { turn: Math.max(-1, Math.min(1, turn)), thrust, brake, boost };
  }

  /** Short controller rumble on impacts (Chrome / Edge). */
  rumble(strength: number, ms: number): void {
    const pad = this.pad() as (Gamepad & { vibrationActuator?: any }) | null;
    pad?.vibrationActuator?.playEffect?.('dual-rumble', {
      duration: ms,
      strongMagnitude: Math.min(1, strength),
      weakMagnitude: Math.min(1, strength * 0.6),
    }).catch?.(() => {});
  }

  private pad(): Gamepad | null {
    if (!navigator.getGamepads) return null;
    for (const p of navigator.getGamepads()) if (p && p.connected) return p;
    return null;
  }
}
