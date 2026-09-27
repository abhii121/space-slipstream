import { Component, computed, inject } from '@angular/core';
import { GameStateService } from '../game/game-state.service';
import { TRACK } from '../game/track';
import { TimePipe } from './time.pipe';

@Component({
  selector: 'app-menu',
  imports: [TimePipe],
  template: `
    <div class="overlay menu">
      <div class="title-block">
        <div class="kicker">A zero-gravity racing experience</div>
        <h1 class="logo">SPACE<span>SLIPSTREAM</span></h1>
      </div>

      <div class="panel menu-panel">
        <div class="row">
          <span class="label">Track</span>
          <span class="value">{{ trackName }}</span>
        </div>
        <div class="row">
          <span class="label">Laps</span>
          <div class="seg">
            @for (n of lapOptions; track n) {
              <button [class.on]="state.laps() === n" (click)="state.laps.set(n)">{{ n }}</button>
            }
          </div>
        </div>
        <div class="row">
          <span class="label">Best time</span>
          <span class="value mono">{{ best() | time }}</span>
        </div>

        <button class="btn primary big" autofocus (click)="state.startRace()">Start race</button>
        <button class="btn ghost" (click)="state.toggleMute()">Sound: {{ state.muted() ? 'off' : 'on' }}</button>
      </div>

      <div class="controls-help">
        <div><kbd>←</kbd><kbd>→</kbd> steer</div>
        <div><kbd>↑</kbd> thrust</div>
        <div><kbd>↓</kbd> retro brake</div>
        <div><kbd>Space</kbd> boost</div>
        <div><kbd>Esc</kbd> pause</div>
        <div class="tip">Skim planets to charge boost. Gamepad supported.</div>
      </div>
    </div>
  `,
})
export class MenuComponent {
  protected readonly state = inject(GameStateService);
  protected readonly lapOptions = [1, 3, 5];
  protected readonly trackName = TRACK.name;
  protected readonly best = computed(() => this.state.bestTimes()[`${TRACK.name}-${this.state.laps()}`] ?? null);
}
