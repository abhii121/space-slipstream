import { Component, computed, inject } from '@angular/core';
import { GameStateService } from '../game/game-state.service';
import { TimePipe } from './time.pipe';

@Component({
  selector: 'app-pause',
  template: `
    <div class="overlay dim">
      <div class="panel modal">
        <h2>Paused</h2>
        <button class="btn primary" autofocus (click)="state.togglePause()">Resume</button>
        <button class="btn" (click)="state.startRace()">Restart</button>
        <button class="btn ghost" (click)="state.toggleMute()">Sound: {{ state.muted() ? 'off' : 'on' }}</button>
        <button class="btn ghost" (click)="state.toMenu()">Quit to menu</button>
      </div>
    </div>
  `,
})
export class PauseComponent {
  protected readonly state = inject(GameStateService);
}

@Component({
  selector: 'app-results',
  imports: [TimePipe],
  template: `
    <div class="overlay dim">
      <div class="panel modal results">
        <div class="kicker">Race complete</div>
        <div class="place">{{ place() }}</div>
        <div class="mono final">{{ state.finishTime() | time }}</div>
        @if (state.newRecord()) {
          <div class="record">New best time!</div>
        }

        <table>
          @for (r of state.results(); track r.name; let i = $index) {
            <tr [class.me]="r.isPlayer">
              <td>{{ i + 1 }}</td>
              <td><span class="dot" [style.background]="r.color"></span>{{ r.name }}</td>
              <td class="mono">{{ r.time === null ? 'racing…' : (r.time | time) }}</td>
            </tr>
          }
        </table>

        <div class="laps mono">
          @for (l of state.lapTimes(); track $index) {
            <span [class.best]="l === state.bestLap()">L{{ $index + 1 }} {{ l | time }}</span>
          }
        </div>

        <button class="btn primary" autofocus (click)="state.startRace()">Race again</button>
        <button class="btn ghost" (click)="state.toMenu()">Main menu</button>
      </div>
    </div>
  `,
})
export class ResultsComponent {
  protected readonly state = inject(GameStateService);
  protected readonly place = computed(() => {
    const i = this.state.results().findIndex((r) => r.isPlayer) + 1;
    return ['', '1st', '2nd', '3rd', '4th'][i] ?? `${i}th`;
  });
}
