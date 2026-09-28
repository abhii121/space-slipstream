import { Injectable, computed, signal } from '@angular/core';
import { AudioEngine } from './audio';
import type { Engine } from './engine';
import { TRACKS } from './track';

export type Phase = 'menu' | 'countdown' | 'racing' | 'paused' | 'finished';

export interface ResultRow {
  name: string;
  color: string;
  time: number | null;
  isPlayer: boolean;
}

const BEST_KEY = 'space-slipstream.best';

function loadBest(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}');
  } catch {
    return {};
  }
}

/**
 * The bridge between the game engine and the Angular UI.
 * The engine writes signals (a few times per second is plenty for the HUD);
 * Angular components read them. Commands from the UI go back through here.
 */
@Injectable({ providedIn: 'root' })
export class GameStateService {
  readonly audio = new AudioEngine();

  readonly phase = signal<Phase>('menu');
  readonly countdown = signal(3);
  readonly laps = signal(3);
  readonly trackIndex = signal(0);
  readonly track = computed(() => TRACKS[this.trackIndex()]);
  readonly muted = signal(false);

  // HUD
  readonly speed = signal(0);
  readonly lap = signal(1);
  readonly position = signal(1);
  readonly racers = signal(4);
  readonly boost = signal(0.5);
  readonly raceTime = signal(0);
  readonly lapTime = signal(0);
  readonly bestLap = signal<number | null>(null);
  readonly lapTimes = signal<number[]>([]);
  readonly toast = signal<{ id: number; text: string } | null>(null);

  // Results
  readonly results = signal<ResultRow[]>([]);
  readonly finishTime = signal<number | null>(null);
  readonly newRecord = signal(false);
  readonly bestTimes = signal<Record<string, number>>(loadBest());

  private engine?: Engine;
  private toastId = 0;
  private phaseBeforePause: Phase = 'racing';

  attach(engine: Engine): void {
    this.engine = engine;
    engine.setTrack(this.track());
  }

  /** Step through the track list (wraps around). Menu only. */
  cycleTrack(step: number): void {
    const n = TRACKS.length;
    this.trackIndex.update((i) => (i + step + n) % n);
    this.engine?.setTrack(this.track());
  }

  showToast(text: string): void {
    this.toast.set({ id: ++this.toastId, text });
  }

  startRace(): void {
    this.audio.init();
    this.audio.setMuted(this.muted());
    this.engine?.startRace(this.laps());
  }

  togglePause(): void {
    const p = this.phase();
    if (p === 'racing' || p === 'countdown') {
      this.phaseBeforePause = p;
      this.phase.set('paused');
    } else if (p === 'paused') {
      this.phase.set(this.phaseBeforePause);
    }
  }

  toMenu(): void {
    this.engine?.toMenu();
  }

  toggleMute(): void {
    this.muted.update((m) => !m);
    this.audio.setMuted(this.muted());
  }

  saveBest(key: string, time: number): boolean {
    const best = { ...this.bestTimes() };
    if (best[key] !== undefined && best[key] <= time) return false;
    best[key] = time;
    this.bestTimes.set(best);
    try {
      localStorage.setItem(BEST_KEY, JSON.stringify(best));
    } catch {
      /* storage unavailable: keep in memory only */
    }
    return true;
  }
}
