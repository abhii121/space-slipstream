import { Component, inject } from '@angular/core';
import { GameStateService } from './game/game-state.service';
import { GameCanvasComponent } from './ui/game-canvas.component';
import { HudComponent } from './ui/hud.component';
import { MenuComponent } from './ui/menu.component';
import { PauseComponent, ResultsComponent } from './ui/overlays.component';

@Component({
  selector: 'app-root',
  imports: [GameCanvasComponent, HudComponent, MenuComponent, PauseComponent, ResultsComponent],
  template: `
    <app-game-canvas />
    @switch (state.phase()) {
      @case ('menu') { <app-menu /> }
      @case ('paused') { <app-hud /><app-pause /> }
      @case ('finished') { <app-results /> }
      @default { <app-hud /> }
    }
  `,
})
export class App {
  protected readonly state = inject(GameStateService);
}
