import { Component, ElementRef, OnDestroy, afterNextRender, inject, viewChild } from '@angular/core';
import { Engine } from '../game/engine';
import { GameStateService } from '../game/game-state.service';
import { InputService } from '../game/input.service';

/** Hosts the PixiJS canvas. The engine runs its own requestAnimationFrame loop. */
@Component({
  selector: 'app-game-canvas',
  template: `<div #host class="canvas-host"></div><div class="vignette"></div>`,
})
export class GameCanvasComponent implements OnDestroy {
  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private readonly state = inject(GameStateService);
  private readonly input = inject(InputService);
  private engine?: Engine;

  constructor() {
    afterNextRender(async () => {
      this.engine = new Engine(this.state, this.input);
      this.state.attach(this.engine);
      await this.engine.init(this.host().nativeElement);
    });
  }

  ngOnDestroy(): void {
    this.engine?.destroy();
  }
}
