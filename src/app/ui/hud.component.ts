import { Component, computed, inject } from '@angular/core';
import { GameStateService } from '../game/game-state.service';
import { InputService } from '../game/input.service';
import { TimePipe } from './time.pipe';

const ORDINAL = ['', 'st', 'nd', 'rd', 'th'];

@Component({
  selector: 'app-hud',
  imports: [TimePipe],
  template: `
    <div class="hud">
      <div class="panel hud-tl">
        <div class="pos">{{ state.position() }}<sup>{{ suffix() }}</sup><small>/{{ state.racers() }}</small></div>
        <div class="lap">LAP {{ state.lap() }}/{{ state.laps() }}</div>
      </div>

      <div class="panel hud-tr mono">
        <div class="t-main">{{ state.raceTime() | time }}</div>
        <div class="t-sub">Lap {{ state.lapTime() | time }}</div>
        <div class="t-sub best">Best {{ state.bestLap() | time }}</div>
      </div>

      <div class="panel hud-bl">
        <div class="speed">{{ state.speed() }}<small>km/s</small></div>
        <div class="bar speed-bar"><div [style.width.%]="speedPct()"></div></div>
        <div class="boost-label" [class.full]="state.boost() > 0.95">BOOST</div>
        <div class="bar boost-bar"><div [style.width.%]="state.boost() * 100"></div></div>
      </div>

      <button class="pause-btn" aria-label="Pause" (click)="state.togglePause()">II</button>

      @if (state.phase() === 'countdown') {
        @for (n of [state.countdown()]; track n) {
          <div class="countdown">{{ n }}</div>
        }
      }
      @if (state.toast(); as t) {
        @for (x of [t]; track x.id) {
          <div class="toast">{{ x.text }}</div>
        }
      }

      @if (touch) {
        <div class="touch left">
          <button (pointerdown)="set('left', true)" (pointerup)="set('left', false)" (pointerleave)="set('left', false)">◀</button>
          <button (pointerdown)="set('right', true)" (pointerup)="set('right', false)" (pointerleave)="set('right', false)">▶</button>
        </div>
        <div class="touch right">
          <button (pointerdown)="set('brake', true)" (pointerup)="set('brake', false)" (pointerleave)="set('brake', false)">▼</button>
          <button class="boost" (pointerdown)="set('boost', true)" (pointerup)="set('boost', false)" (pointerleave)="set('boost', false)">⚡</button>
          <button class="thrust" (pointerdown)="set('thrust', true)" (pointerup)="set('thrust', false)" (pointerleave)="set('thrust', false)">▲</button>
        </div>
      }
    </div>
  `,
})
export class HudComponent {
  protected readonly state = inject(GameStateService);
  private readonly input = inject(InputService);
  protected readonly touch = matchMedia('(pointer: coarse)').matches;
  protected readonly suffix = computed(() => ORDINAL[Math.min(this.state.position(), 4)]);
  protected readonly speedPct = computed(() => Math.min(100, (this.state.speed() / 560) * 100));

  protected set(key: keyof InputService['touch'], v: boolean): void {
    this.input.touch[key] = v;
  }
}
