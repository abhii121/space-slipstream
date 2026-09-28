import { isDevMode } from '@angular/core';
import { Application, Container, Graphics, Sprite, Texture, TilingSprite } from 'pixi.js';
import { GameStateService } from './game-state.service';
import { Controls, InputService } from './input.service';
import { mulberry32, Planet, TrackDef, TRACKS } from './track';

// ---------- Tuning ----------
const STEP = 1 / 60; // fixed physics timestep
const SHIP_R = 16;
const TURN_RATE = 4.3; // rad/s
const THRUST = 720; // px/s²
const BRAKE = 520;
const BOOST_MULT = 1.9;
const MAX_SPEED = 1000;
const MAX_BOOST_SPEED = 1550;
const LATERAL_GRIP = 1.1; // how quickly sideways drift is damped (arcade feel)
const DRAG = 0.22;
const MAX_GRAVITY = 520;
const SLINGSHOT_ZONE = 260; // px above a planet surface that charges boost

const NO_INPUT: Controls = { turn: 0, thrust: 0, brake: false, boost: false };

interface Ship {
  name: string;
  color: number;
  isPlayer: boolean;
  x: number; y: number; vx: number; vy: number; angle: number; angVel: number;
  px: number; py: number; pa: number; // previous state (for render interpolation)
  boost: number;
  boosting: boolean;
  thrusting: boolean;
  nextGate: number;
  passed: number;
  lapStart: number;
  finished: boolean;
  finishTime: number;
  skill: number;
  aiOffset: number;
  stuck: number;
  recover: number;
  view: Container;
  body: Graphics;
  glow: Sprite;
  trail: Graphics;
  trailPts: { x: number; y: number }[];
}

interface Asteroid {
  hx: number; hy: number; x: number; y: number; vx: number; vy: number;
  r: number; drift: number; phase: number; spin: number; view: Graphics;
}

interface Particle {
  sprite: Sprite; vx: number; vy: number; life: number; max: number;
  s0: number; s1: number; a0: number; drag: number; active: boolean;
}

interface GateView { root: Container; line: Graphics; a: Sprite; b: Sprite; flash: number }

const RACERS: { name: string; color: number; skill: number }[] = [
  { name: 'YOU', color: 0x22e6ff, skill: 1 },
  { name: 'VEGA', color: 0xff2bd6, skill: 0.95 },
  { name: 'NOVA', color: 0xffc23d, skill: 0.92 },
  { name: 'ORION', color: 0x7cff6b, skill: 0.89 },
];

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

/**
 * The whole game simulation + rendering. Plain TypeScript, no Angular inside:
 * Angular never runs change detection for the 60fps loop.
 */
export class Engine {
  private readonly app = new Application();
  private readonly world = new Container();
  private readonly nebula = new Container();
  private readonly trackLayer = new Container();
  private readonly asteroidLayer = new Container();
  private readonly trailLayer = new Container();
  private readonly fxLayer = new Container();
  private readonly shipLayer = new Container();
  private readonly ui = new Graphics();
  private starsFar!: TilingSprite;
  private starsNear!: TilingSprite;
  private glowTex!: Texture;

  private ships: Ship[] = [];
  private asteroids: Asteroid[] = [];
  private particles: Particle[] = [];
  private gateViews: GateView[] = [];

  private acc = 0;
  private time = 0;
  private hitStop = 0;
  private trauma = 0;
  private raceClock = 0;
  private countdownT = 0;
  private totalLaps = 3;
  private hudTick = 0;
  private slingToastCooldown = 0;
  private cam = { x: 0, y: 0, zoom: 0.7 };
  private destroyed = false;
  private track: TrackDef = TRACKS[0];
  private bounds = this.computeBounds();

  constructor(
    private readonly state: GameStateService,
    private readonly input: InputService,
  ) {}

  // ================= Setup =================

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: host,
      background: 0x04050d,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      powerPreference: 'high-performance',
    });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    host.appendChild(this.app.canvas);

    this.glowTex = this.makeGlowTexture();
    this.starsFar = new TilingSprite({ texture: this.makeStarTexture(1024, 420, 1.1, 0.55, 1), width: 10, height: 10 });
    this.starsNear = new TilingSprite({ texture: this.makeStarTexture(1024, 110, 1.9, 0.95, 2), width: 10, height: 10 });

    this.app.stage.addChild(this.starsFar, this.nebula, this.starsNear, this.world, this.ui);
    this.world.addChild(this.trackLayer, this.asteroidLayer, this.trailLayer, this.fxLayer, this.shipLayer);

    this.buildNebula();
    this.loadTrack(this.track);

    if (isDevMode()) (window as any).__engine = this; // handy for debugging in the console
    this.app.ticker.add((t) => this.frame(Math.min(t.deltaMS / 1000, 0.1)));
  }

  destroy(): void {
    this.destroyed = true;
    this.state.audio.update(0, 0, false, false);
    try {
      this.app.destroy(true, { children: true, texture: true });
    } catch {
      /* not initialised yet */
    }
  }

  // ================= Commands from UI =================

  /** Swap the whole course (gates, planets, asteroids). Only called from the menu. */
  setTrack(track: TrackDef): void {
    if (track === this.track) return;
    this.track = track;
    if (this.ships.length) this.loadTrack(track); // before init() finishes, init() loads it
  }

  private loadTrack(track: TrackDef): void {
    this.track = track;
    for (const layer of [this.trackLayer, this.asteroidLayer]) {
      for (const child of layer.removeChildren()) child.destroy({ children: true });
    }
    this.gateViews = [];
    this.asteroids = [];
    this.bounds = this.computeBounds();
    this.buildTrack();
    this.buildAsteroids();
    this.resetShips(true);
    const lead = this.ships[0];
    this.cam.x = lead.x;
    this.cam.y = lead.y;
  }

  startRace(laps: number): void {
    this.totalLaps = laps;
    this.resetShips(false);
    this.raceClock = 0;
    this.countdownT = 3.999;
    this.trauma = 0;
    this.state.lap.set(1);
    this.state.lapTimes.set([]);
    this.state.bestLap.set(null);
    this.state.results.set([]);
    this.state.finishTime.set(null);
    this.state.newRecord.set(false);
    this.state.racers.set(this.ships.length);
    this.state.countdown.set(3);
    this.state.phase.set('countdown');
    this.state.audio.beep(440, 0.18);
  }

  toMenu(): void {
    this.resetShips(true);
    this.state.phase.set('menu');
  }

  // ================= Main loop =================

  private frame(dt: number): void {
    if (this.input.consumePause()) this.state.togglePause();
    const phase = this.state.phase();

    if (phase !== 'paused') {
      if (this.hitStop > 0) {
        this.hitStop -= dt; // freeze-frame on big impacts = feels weighty
      } else {
        this.acc += dt;
        while (this.acc >= STEP) {
          this.step(STEP);
          this.acc -= STEP;
        }
      }
    }
    const alpha = this.acc / STEP;
    this.render(dt, alpha);

    const p = this.player();
    const sp = Math.hypot(p.vx, p.vy);
    const active = phase === 'racing' || phase === 'countdown' || phase === 'finished';
    this.state.audio.update(sp / MAX_BOOST_SPEED, p.thrusting ? 1 : 0, p.boosting, active);
  }

  private step(dt: number): void {
    this.time += dt;
    const phase = this.state.phase();

    if (phase === 'countdown') {
      const before = Math.ceil(this.countdownT);
      this.countdownT -= dt;
      const now = Math.ceil(this.countdownT);
      if (now !== before && now > 0) {
        this.state.countdown.set(now);
        this.state.audio.beep(440, 0.18);
      }
      if (this.countdownT <= 0) {
        this.state.countdown.set(0);
        this.state.phase.set('racing');
        this.state.showToast('GO!');
        this.state.audio.beep(880, 0.4);
      }
    }
    if (phase === 'racing' || phase === 'finished') this.raceClock += dt;

    for (const s of this.ships) {
      s.px = s.x; s.py = s.y; s.pa = s.angle;
      let c: Controls;
      if (phase === 'countdown') c = NO_INPUT;
      else if (s.isPlayer && phase === 'racing' && !s.finished) c = this.input.read();
      else c = this.ai(s);
      this.updateShip(s, c, dt, phase === 'countdown');
    }

    this.updateAsteroids(dt);
    this.collide();
    for (const s of this.ships) this.checkGate(s, phase);
    this.updateParticles(dt);

    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.slingToastCooldown -= dt;

    if (++this.hudTick % 3 === 0) this.pushHud();
  }

  // ================= Ship physics =================

  private updateShip(s: Ship, c: Controls, dt: number, locked: boolean): void {
    s.angVel += (c.turn * TURN_RATE - s.angVel) * Math.min(1, dt * 14);
    s.angle += s.angVel * dt;
    if (locked) {
      s.vx = s.vy = 0;
      s.thrusting = s.boosting = false;
      return;
    }

    const fx = Math.cos(s.angle);
    const fy = Math.sin(s.angle);
    let ax = 0;
    let ay = 0;

    s.boosting = c.boost && s.boost > 0.01;
    if (s.boosting) s.boost = Math.max(0, s.boost - dt * 0.42);
    const thrust = s.boosting ? 1 : c.thrust;
    s.thrusting = thrust > 0.05;
    const power = THRUST * s.skill * (s.boosting ? BOOST_MULT : 1) * this.rubberBand(s);
    ax += fx * thrust * power;
    ay += fy * thrust * power;

    let speed = Math.hypot(s.vx, s.vy);
    if (c.brake && speed > 1) {
      ax -= (s.vx / speed) * BRAKE;
      ay -= (s.vy / speed) * BRAKE;
    }

    // Gravity wells + slingshot boost charging.
    for (const p of this.track.planets) {
      const dx = p.x - s.x;
      const dy = p.y - s.y;
      const d = Math.hypot(dx, dy);
      if (d > p.influence) continue;
      const fade = 1 - d / p.influence;
      const g = Math.min(MAX_GRAVITY, p.gm / (d * d)) * fade * fade * (3 - 2 * fade) * 1.4;
      ax += (dx / d) * g;
      ay += (dy / d) * g;
      if (d - p.r < SLINGSHOT_ZONE && speed > 420) {
        s.boost = Math.min(1, s.boost + dt * 0.38);
        if (Math.random() < 0.5) {
          this.emit(s.x, s.y, s.vx * 0.2 + (Math.random() - 0.5) * 60, s.vy * 0.2 + (Math.random() - 0.5) * 60,
            p.color, 0.5, 0.25, 0, 0.8);
        }
        if (s.isPlayer && this.slingToastCooldown <= 0 && this.state.phase() === 'racing') {
          this.state.showToast('SLINGSHOT  +BOOST');
          this.slingToastCooldown = 2.5;
        }
      }
    }

    s.vx += ax * dt;
    s.vy += ay * dt;

    // Arcade stabiliser: damp sideways drift so steering feels responsive.
    const rx = -fy;
    const ry = fx;
    const lat = s.vx * rx + s.vy * ry;
    const grip = LATERAL_GRIP * (c.brake ? 0.4 : 1) * dt;
    s.vx -= rx * lat * grip;
    s.vy -= ry * lat * grip;

    s.vx *= 1 - DRAG * dt;
    s.vy *= 1 - DRAG * dt;

    speed = Math.hypot(s.vx, s.vy);
    const max = s.boosting ? MAX_BOOST_SPEED : MAX_SPEED;
    if (speed > max) {
      const target = lerp(speed, max, Math.min(1, dt * 2.5));
      s.vx *= target / speed;
      s.vy *= target / speed;
    }

    s.x += s.vx * dt;
    s.y += s.vy * dt;

    // Engine exhaust particles.
    if (s.thrusting) {
      const n = s.boosting ? 3 : 1;
      for (let i = 0; i < n; i++) {
        const spread = (Math.random() - 0.5) * (s.boosting ? 120 : 70);
        const back = s.boosting ? 380 : 220;
        this.emit(
          s.x - fx * 14, s.y - fy * 14,
          s.vx * 0.5 - fx * (back + Math.random() * 120) - fy * spread,
          s.vy * 0.5 - fy * (back + Math.random() * 120) + fx * spread,
          s.boosting ? 0xaaf6ff : i % 2 ? 0xff8a3d : s.color,
          s.boosting ? 0.45 : 0.32, s.boosting ? 0.55 : 0.4, 0.05, 0.9,
        );
      }
    }
  }

  /** Keeps AI competitive: slower when far ahead, faster when behind the player. */
  private rubberBand(s: Ship): number {
    if (s.isPlayer || this.state.phase() !== 'racing') return 1;
    const diff = this.progress(this.player()) - this.progress(s);
    return clamp(1 + diff * 0.06, 0.88, 1.12);
  }

  private ai(s: Ship): Controls {
    const gates = this.track.gates;
    const g = gates[s.nextGate];
    const g2 = gates[(s.nextGate + 1) % gates.length];
    const speed = Math.hypot(s.vx, s.vy);

    // Stuck detection -> short recovery manoeuvre (back away from whatever we hit).
    s.stuck = speed < 140 ? s.stuck + STEP : 0;
    if (s.stuck > 1.2) {
      s.stuck = 0;
      s.recover = 0.7;
    }

    const fx = Math.cos(g.angle);
    const fy = Math.sin(g.angle);
    const nx = -fy;
    const ny = fx;
    let tx = g.x + nx * s.aiOffset;
    let ty = g.y + ny * s.aiOffset;
    const d = Math.hypot(tx - s.x, ty - s.y);
    // Signed distance along the gate direction: < 0 means we're still in front of the gate.
    const along = (s.x - g.x) * fx + (s.y - g.y) * fy;
    if (along > -120) {
      // Overshot / missed the gate: loop around to a point behind it and come through again.
      tx = g.x - fx * 420;
      ty = g.y - fy * 420;
    } else {
      const blend = clamp(1 - d / 650, 0, 0.45);
      tx = lerp(tx, g2.x, blend);
      ty = lerp(ty, g2.y, blend);
    }

    // Aim where we want to go *minus* our current momentum.
    const look = 0.55;
    let dx = tx - s.x - s.vx * look;
    let dy = ty - s.y - s.vy * look;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;

    // Steer around planets and asteroids that sit ahead of us.
    let avx = 0;
    let avy = 0;
    const avoid = (cx: number, cy: number, r: number) => {
      const rx = cx - s.x;
      const ry = cy - s.y;
      const dist = Math.hypot(rx, ry);
      const range = r + 120 + speed * 0.35;
      if (dist > range || dist === 0) return;
      const ahead = rx * dx + ry * dy;
      if (ahead < -r) return;
      const latx = rx - dx * ahead;
      const laty = ry - dy * ahead;
      const latl = Math.hypot(latx, laty);
      if (latl > r + SHIP_R + 40) return; // our path already clears it
      const w = (1 - dist / range) * 2.2;
      const sx = latl > 1 ? -latx / latl : -dy;
      const sy = latl > 1 ? -laty / latl : dx;
      avx += sx * w;
      avy += sy * w;
    };
    for (const p of this.track.planets) avoid(p.x, p.y, p.r);
    for (const a of this.asteroids) avoid(a.x, a.y, a.r);

    if (s.recover > 0) {
      s.recover -= STEP;
      // Point away from the nearest obstacle and punch it.
      let best = Infinity;
      let ox = 0;
      let oy = 0;
      for (const o of [...this.track.planets, ...this.asteroids]) {
        const dd = Math.hypot(o.x - s.x, o.y - s.y) - o.r;
        if (dd < best) {
          best = dd;
          ox = s.x - o.x;
          oy = s.y - o.y;
        }
      }
      const away = Math.atan2(oy + (ty - s.y) * 0.002, ox + (tx - s.x) * 0.002);
      const diffR = wrapAngle(away - s.angle);
      return { turn: clamp(diffR * 3, -1, 1), thrust: Math.abs(diffR) < 1.2 ? 1 : 0, brake: false, boost: false };
    }

    const desired = Math.atan2(dy + avy, dx + avx);
    const diff = wrapAngle(desired - s.angle);
    const absd = Math.abs(diff);
    return {
      turn: clamp(diff * 2.6, -1, 1),
      thrust: absd < 1.0 ? 1 : 0.15,
      brake: absd > 2.0 && speed > 450,
      boost: absd < 0.18 && s.boost > 0.35 && d > 800 && avx === 0 && avy === 0,
    };
  }

  // ================= World =================

  private updateAsteroids(dt: number): void {
    for (const a of this.asteroids) {
      a.phase += dt * 0.4;
      // Asteroids drift on a slow ellipse around their home position and get knocked around.
      const tx = a.hx + Math.cos(a.phase) * a.drift;
      const ty = a.hy + Math.sin(a.phase * 0.7) * a.drift;
      a.vx += (tx - a.x) * 0.8 * dt;
      a.vy += (ty - a.y) * 0.8 * dt;
      a.vx *= 1 - 0.9 * dt;
      a.vy *= 1 - 0.9 * dt;
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.view.rotation += a.spin * dt;
    }
  }

  private collide(): void {
    for (const s of this.ships) {
      for (const p of this.track.planets) this.bounce(s, p.x, p.y, p.r, null, 0.45);
      for (const a of this.asteroids) this.bounce(s, a.x, a.y, a.r * 0.9, a, 0.55);
    }
    // Ship vs ship
    for (let i = 0; i < this.ships.length; i++) {
      for (let j = i + 1; j < this.ships.length; j++) {
        const a = this.ships[i];
        const b = this.ships[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = SHIP_R * 2;
        if (d >= min || d === 0) continue;
        const nx = dx / d;
        const ny = dy / d;
        const push = (min - d) / 2;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel < 0) {
          const imp = -rel * 0.9;
          a.vx -= nx * imp; a.vy -= ny * imp;
          b.vx += nx * imp; b.vy += ny * imp;
          this.impact(a.x + nx * SHIP_R, a.y + ny * SHIP_R, -rel, a.isPlayer || b.isPlayer, 0xffffff);
        }
      }
    }
  }

  private bounce(s: Ship, cx: number, cy: number, r: number, rock: Asteroid | null, restitution: number): void {
    const dx = s.x - cx;
    const dy = s.y - cy;
    const d = Math.hypot(dx, dy);
    const min = r + SHIP_R;
    if (d >= min || d === 0) return;
    const nx = dx / d;
    const ny = dy / d;
    s.x = cx + nx * min;
    s.y = cy + ny * min;
    const vn = s.vx * nx + s.vy * ny;
    if (vn < 0) {
      s.vx -= nx * vn * (1 + restitution);
      s.vy -= ny * vn * (1 + restitution);
      s.vx *= 0.8;
      s.vy *= 0.8;
      if (rock) {
        rock.vx += nx * vn * 0.35;
        rock.vy += ny * vn * 0.35;
      }
      this.impact(cx + nx * r, cy + ny * r, -vn, s.isPlayer, rock ? 0xffb070 : 0xffffff);
    }
  }

  private impact(x: number, y: number, strength: number, player: boolean, color: number): void {
    if (strength < 60) return;
    const n = Math.min(26, Math.floor(strength / 30));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 100 + Math.random() * strength * 0.6;
      this.emit(x, y, Math.cos(a) * v, Math.sin(a) * v, i % 3 ? color : 0xffe07a, 0.35 + Math.random() * 0.35, 0.3, 0, 1, 2.5);
    }
    if (player) {
      this.trauma = Math.min(1, this.trauma + strength / 1400);
      if (strength > 550) this.hitStop = 0.06;
      this.state.audio.impact(Math.min(1, strength / 900));
      this.input.rumble(strength / 900, 160);
    }
  }

  private checkGate(s: Ship, phase: string): void {
    if (s.finished) return;
    const gates = this.track.gates;
    const g = gates[s.nextGate];
    const fx = Math.cos(g.angle);
    const fy = Math.sin(g.angle);
    const prevF = (s.px - g.x) * fx + (s.py - g.y) * fy;
    const f = (s.x - g.x) * fx + (s.y - g.y) * fy;
    const l = (s.x - g.x) * -fy + (s.y - g.y) * fx;
    if (!(prevF < 0 && f >= 0 && Math.abs(l) <= g.half)) return;

    s.passed++;
    s.nextGate = (s.nextGate + 1) % gates.length;
    s.boost = Math.min(1, s.boost + 0.06);
    const racing = phase === 'racing' || phase === 'finished';

    if (s.isPlayer && phase === 'racing') {
      this.gateViews[(s.nextGate - 1 + gates.length) % gates.length].flash = 1;
      for (let i = 0; i < 20; i++) {
        const t = (i / 19) * 2 - 1;
        this.emit(g.x - fy * g.half * t, g.y + fx * g.half * t, fx * 200 + (Math.random() - 0.5) * 80,
          fy * 200 + (Math.random() - 0.5) * 80, 0x22e6ff, 0.5, 0.4, 0, 0.9);
      }
      this.state.audio.chime();
    }

    // Lap completed? (passed === 1 is crossing the start line after the countdown)
    if (!racing || s.passed <= 1 || (s.passed - 1) % gates.length !== 0) return;
    const lapTime = this.raceClock - s.lapStart;
    s.lapStart = this.raceClock;
    const lapsDone = (s.passed - 1) / gates.length;

    if (s.isPlayer && phase === 'racing') {
      this.state.lapTimes.update((l) => [...l, lapTime]);
      const best = this.state.bestLap();
      if (best === null || lapTime < best) this.state.bestLap.set(lapTime);
      if (lapsDone === this.totalLaps - 1) this.state.showToast('FINAL LAP');
      else if (lapsDone < this.totalLaps) this.state.showToast(`LAP ${lapsDone + 1}`);
    }

    if (lapsDone >= this.totalLaps) {
      s.finished = true;
      s.finishTime = this.raceClock;
      if (s.isPlayer && phase === 'racing') {
        this.state.finishTime.set(this.raceClock);
        this.state.newRecord.set(this.state.saveBest(`${this.track.name}-${this.totalLaps}`, this.raceClock));
        this.state.phase.set('finished');
        this.state.audio.fanfare();
      }
      this.pushResults();
    }
  }

  // ================= Particles =================

  private emit(x: number, y: number, vx: number, vy: number, color: number, life: number,
    s0: number, s1: number, alpha: number, drag = 1.5): void {
    let p = this.particles.find((q) => !q.active);
    if (!p) {
      if (this.particles.length >= 900) return;
      const sprite = new Sprite(this.glowTex);
      sprite.anchor.set(0.5);
      sprite.blendMode = 'add';
      this.fxLayer.addChild(sprite);
      p = { sprite, vx: 0, vy: 0, life: 0, max: 1, s0: 1, s1: 0, a0: 1, drag: 1, active: false };
      this.particles.push(p);
    }
    p.active = true;
    p.sprite.visible = true;
    p.sprite.position.set(x, y);
    p.sprite.tint = color;
    p.vx = vx; p.vy = vy; p.life = life; p.max = life; p.s0 = s0; p.s1 = s1; p.a0 = alpha; p.drag = drag;
  }

  private updateParticles(dt: number): void {
    for (const p of this.particles) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.sprite.visible = false;
        continue;
      }
      const t = p.life / p.max;
      p.vx *= 1 - p.drag * dt;
      p.vy *= 1 - p.drag * dt;
      p.sprite.x += p.vx * dt;
      p.sprite.y += p.vy * dt;
      p.sprite.scale.set(lerp(p.s1, p.s0, t));
      p.sprite.alpha = p.a0 * t;
    }
  }

  // ================= Rendering =================

  private render(dt: number, alpha: number): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const phase = this.state.phase();
    const menu = phase === 'menu';

    // Ships (interpolated between physics steps -> buttery on 120/144Hz screens)
    for (const s of this.ships) {
      const x = lerp(s.px, s.x, alpha);
      const y = lerp(s.py, s.y, alpha);
      s.view.position.set(x, y);
      s.view.rotation = s.pa + wrapAngle(s.angle - s.pa) * alpha;
      s.glow.alpha = 0.35 + (s.thrusting ? 0.25 : 0) + (s.boosting ? 0.3 : 0) + Math.sin(this.time * 12) * 0.04;
      s.glow.scale.set(s.boosting ? 1.5 : 1.1);
      this.drawTrail(s, x, y);
    }

    // Camera: follow with look-ahead, zoom out with speed, smooth everything.
    const target = menu ? this.leader() : this.player();
    const tsp = Math.hypot(target.vx, target.vy);
    const base = clamp(Math.min(w, h) / 820, 0.55, 1.1);
    const zoomTarget = base * (menu ? 0.62 : clamp(1 - (tsp / MAX_BOOST_SPEED) * 0.38, 0.6, 1));
    const k = 1 - Math.exp(-dt * 4.5);
    this.cam.x = lerp(this.cam.x, lerp(target.px, target.x, alpha) + target.vx * 0.32, k);
    this.cam.y = lerp(this.cam.y, lerp(target.py, target.y, alpha) + target.vy * 0.32, k);
    this.cam.zoom = lerp(this.cam.zoom, zoomTarget, 1 - Math.exp(-dt * 2));

    const shake = this.trauma * this.trauma * 28;
    const sx = (Math.random() * 2 - 1) * shake;
    const sy = (Math.random() * 2 - 1) * shake;
    const z = this.cam.zoom;
    this.world.scale.set(z);
    this.world.position.set(w / 2 - this.cam.x * z + sx, h / 2 - this.cam.y * z + sy);

    // Parallax layers
    for (const [layer, f] of [[this.starsFar, 0.04], [this.starsNear, 0.12]] as const) {
      layer.width = w;
      layer.height = h;
      layer.tilePosition.set(-this.cam.x * f + sx * 0.3, -this.cam.y * f + sy * 0.3);
    }
    this.nebula.position.set(w / 2 - this.cam.x * 0.25, h / 2 - this.cam.y * 0.25);

    this.renderGates(dt);
    this.renderUi(w, h, menu);
  }

  private drawTrail(s: Ship, x: number, y: number): void {
    const pts = s.trailPts;
    pts.push({ x, y });
    if (pts.length > 26) pts.shift();
    const g = s.trail;
    g.clear();
    for (let i = 1; i < pts.length; i++) {
      const t = i / pts.length;
      g.moveTo(pts[i - 1].x, pts[i - 1].y).lineTo(pts[i].x, pts[i].y)
        .stroke({ width: 1 + t * (s.boosting ? 7 : 4), color: s.color, alpha: t * 0.55, cap: 'round' });
    }
  }

  private renderGates(dt: number): void {
    const p = this.player();
    const n = this.track.gates.length;
    const racing = this.state.phase() !== 'menu';
    this.gateViews.forEach((v, i) => {
      const isNext = racing && i === p.nextGate;
      const isAfter = racing && i === (p.nextGate + 1) % n;
      v.flash = Math.max(0, v.flash - dt * 2.5);
      const pulse = 0.75 + Math.sin(this.time * 6) * 0.25;
      const a = isNext ? pulse : isAfter ? 0.45 : 0.18;
      v.line.alpha = Math.max(a, v.flash);
      v.a.alpha = v.b.alpha = Math.max(a, v.flash);
      const sc = 1 + v.flash * 0.8 + (isNext ? 0.25 : 0);
      v.a.scale.set(sc * 0.9);
      v.b.scale.set(sc * 0.9);
    });
  }

  private renderUi(w: number, h: number, menu: boolean): void {
    const g = this.ui;
    g.clear();
    if (menu) return;

    // Minimap (top-right)
    const mw = Math.min(190, w * 0.3);
    const mh = mw * 0.8;
    const mx = w - mw - 16;
    const my = 108;
    g.roundRect(mx, my, mw, mh, 10).fill({ color: 0x0a0f25, alpha: 0.55 }).stroke({ width: 1, color: 0x22e6ff, alpha: 0.35 });
    const b = this.bounds;
    const sc = Math.min((mw - 20) / (b.maxX - b.minX), (mh - 20) / (b.maxY - b.minY));
    const ox = mx + mw / 2 - ((b.minX + b.maxX) / 2) * sc;
    const oy = my + mh / 2 - ((b.minY + b.maxY) / 2) * sc;
    const gates = this.track.gates;
    g.moveTo(gates[0].x * sc + ox, gates[0].y * sc + oy);
    for (let i = 1; i <= gates.length; i++) {
      const q = gates[i % gates.length];
      g.lineTo(q.x * sc + ox, q.y * sc + oy);
    }
    g.stroke({ width: 1.5, color: 0xffffff, alpha: 0.25 });
    for (const pl of this.track.planets) g.circle(pl.x * sc + ox, pl.y * sc + oy, Math.max(2.5, pl.r * sc)).fill({ color: pl.color, alpha: 0.8 });
    const next = gates[this.player().nextGate];
    g.circle(next.x * sc + ox, next.y * sc + oy, 4).stroke({ width: 1.5, color: 0x22e6ff });
    for (const s of this.ships) {
      g.circle(s.x * sc + ox, s.y * sc + oy, s.isPlayer ? 4 : 3).fill({ color: s.color });
    }

    // Off-screen arrow pointing at the next gate
    const z = this.cam.zoom;
    const gx = (next.x - this.cam.x) * z + w / 2;
    const gy = (next.y - this.cam.y) * z + h / 2;
    const m = 60;
    if (gx < m || gx > w - m || gy < m || gy > h - m) {
      const cx = w / 2;
      const cy = h / 2;
      const ang = Math.atan2(gy - cy, gx - cx);
      const tx = Math.cos(ang);
      const ty = Math.sin(ang);
      const t = Math.min((w / 2 - m) / Math.abs(tx || 1e-6), (h / 2 - m) / Math.abs(ty || 1e-6));
      const ax = cx + tx * t;
      const ay = cy + ty * t;
      const s = 16 + Math.sin(this.time * 8) * 2;
      g.poly([
        ax + tx * s, ay + ty * s,
        ax - tx * s * 0.6 - ty * s * 0.8, ay - ty * s * 0.6 + tx * s * 0.8,
        ax - tx * s * 0.6 + ty * s * 0.8, ay - ty * s * 0.6 - tx * s * 0.8,
      ]).fill({ color: 0x22e6ff, alpha: 0.9 });
    }
  }

  // ================= HUD sync =================

  private pushHud(): void {
    const p = this.player();
    const st = this.state;
    const phase = st.phase();
    if (phase === 'menu') return;
    st.speed.set(Math.round(Math.hypot(p.vx, p.vy) * 0.36));
    st.boost.set(p.boost);
    if (phase !== 'racing') return;
    const n = this.track.gates.length;
    st.lap.set(clamp(Math.floor(Math.max(0, p.passed - 1) / n) + 1, 1, this.totalLaps));
    st.raceTime.set(this.raceClock);
    st.lapTime.set(this.raceClock - p.lapStart);
    const mine = this.rank(p);
    st.position.set(1 + this.ships.filter((s) => s !== p && this.rank(s) > mine).length);
  }

  private pushResults(): void {
    const rows = [...this.ships]
      .sort((a, b) => this.rank(b) - this.rank(a))
      .map((s) => ({ name: s.name, color: hex(s.color), time: s.finished ? s.finishTime : null, isPlayer: s.isPlayer }));
    this.state.results.set(rows);
  }

  /** Higher = further ahead. Finished ships rank by finish time. */
  private rank(s: Ship): number {
    return s.finished ? 1e6 - s.finishTime : this.progress(s);
  }

  private progress(s: Ship): number {
    const gates = this.track.gates;
    const g = gates[s.nextGate];
    const prev = gates[(s.nextGate - 1 + gates.length) % gates.length];
    const seg = Math.hypot(g.x - prev.x, g.y - prev.y);
    const d = Math.hypot(g.x - s.x, g.y - s.y);
    return s.passed + clamp(1 - d / seg, 0, 1);
  }

  private player(): Ship {
    return this.ships[0];
  }

  private leader(): Ship {
    return this.ships.reduce((a, b) => (this.progress(b) > this.progress(a) ? b : a));
  }

  // ================= Builders =================

  private resetShips(demo: boolean): void {
    const g0 = this.track.gates[0];
    const fx = Math.cos(g0.angle);
    const fy = Math.sin(g0.angle);
    const grid = [[-120, -70], [-120, 70], [-240, -70], [-240, 70]];

    if (this.ships.length === 0) {
      RACERS.forEach((r, i) => {
        const view = new Container();
        const glow = new Sprite(this.glowTex);
        glow.anchor.set(0.5);
        glow.tint = r.color;
        glow.blendMode = 'add';
        const body = new Graphics();
        body.poly([20, 0, -12, -12, -6, 0, -12, 12]).fill({ color: r.color }).stroke({ width: 2, color: 0xffffff, alpha: 0.85 });
        body.poly([8, 0, -4, -4, -4, 4]).fill({ color: 0x0a1030, alpha: 0.85 });
        view.addChild(glow, body);
        const trail = new Graphics();
        this.trailLayer.addChild(trail);
        this.shipLayer.addChild(view);
        this.ships.push({
          name: r.name, color: r.color, isPlayer: i === 0,
          x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0, px: 0, py: 0, pa: 0,
          boost: 0.5, boosting: false, thrusting: false, nextGate: 0, passed: 0, lapStart: 0,
          finished: false, finishTime: 0, skill: r.skill, aiOffset: 0, stuck: 0, recover: 0,
          view, body, glow, trail, trailPts: [],
        });
      });
    }

    // Player goes to the back of the grid in a race, like a proper racing game.
    const order = demo ? [0, 1, 2, 3] : [3, 0, 1, 2];
    this.ships.forEach((s, i) => {
      const [back, side] = grid[order[i]];
      s.x = s.px = g0.x + fx * back - fy * side;
      s.y = s.py = g0.y + fy * back + fx * side;
      s.vx = s.vy = 0;
      s.angle = s.pa = g0.angle;
      s.angVel = 0;
      s.boost = 0.5;
      s.nextGate = 0;
      s.passed = 0;
      s.lapStart = 0;
      s.finished = false;
      s.finishTime = 0;
      s.aiOffset = (Math.random() - 0.5) * 160;
      s.stuck = 0;
      s.recover = 0;
      s.trailPts.length = 0;
      s.body.alpha = 1;
    });
  }

  private buildTrack(): void {
    const gates = this.track.gates;
    const n = gates.length;

    // Faint dotted racing line
    const line = new Graphics();
    for (let i = 0; i < n; i++) {
      const a = gates[i];
      const b = gates[(i + 1) % n];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      for (let d = 0; d < len; d += 60) {
        const t = d / len;
        line.circle(lerp(a.x, b.x, t), lerp(a.y, b.y, t), 3);
      }
    }
    line.fill({ color: 0x7fa8ff, alpha: 0.18 });
    this.trackLayer.addChild(line);

    // Planets
    for (const p of this.track.planets) this.trackLayer.addChild(this.makePlanet(p));

    // Gates
    gates.forEach((g, i) => {
      const root = new Container();
      root.position.set(g.x, g.y);
      root.rotation = g.angle;
      const color = i === 0 ? 0xff2bd6 : 0x22e6ff;
      const lineG = new Graphics();
      if (i === 0) {
        // Checkered start / finish line
        const sq = 18;
        for (let k = -g.half; k < g.half; k += sq) {
          const idx = Math.round((k + g.half) / sq);
          lineG.rect(-sq, k, sq, sq).fill({ color: idx % 2 ? 0xffffff : 0x222244, alpha: 0.7 });
          lineG.rect(0, k, sq, sq).fill({ color: idx % 2 ? 0x222244 : 0xffffff, alpha: 0.7 });
        }
      }
      lineG.moveTo(0, -g.half).lineTo(0, g.half).stroke({ width: 4, color, alpha: 0.9 });
      const a = new Sprite(this.glowTex);
      const b = new Sprite(this.glowTex);
      for (const [s, y] of [[a, -g.half], [b, g.half]] as const) {
        s.anchor.set(0.5);
        s.tint = color;
        s.blendMode = 'add';
        s.position.set(0, y);
        root.addChild(s);
      }
      const cores = new Graphics();
      cores.circle(0, -g.half, 7).circle(0, g.half, 7).fill({ color: 0xffffff });
      root.addChildAt(lineG, 0);
      root.addChild(cores);
      this.trackLayer.addChild(root);
      this.gateViews.push({ root, line: lineG, a, b, flash: 0 });
    });
  }

  private makePlanet(p: Planet): Container {
    const c = new Container();
    c.position.set(p.x, p.y);

    // Faint gravity field rings
    const field = new Graphics();
    field.circle(0, 0, p.r + SLINGSHOT_ZONE).stroke({ width: 3, color: p.color, alpha: 0.18 });
    field.circle(0, 0, p.influence * 0.6).stroke({ width: 2, color: p.color, alpha: 0.06 });
    c.addChild(field);

    const atmo = new Sprite(this.glowTex);
    atmo.anchor.set(0.5);
    atmo.tint = p.color;
    atmo.blendMode = 'add';
    atmo.alpha = 0.55;
    atmo.scale.set((p.r * 3.2) / 128);
    c.addChild(atmo);

    const body = new Graphics().circle(0, 0, p.r).fill({ color: p.color });
    const detail = new Graphics();
    const rand = mulberry32(p.r * 7);
    for (let i = 0; i < 7; i++) {
      const y = (rand() * 2 - 1) * p.r;
      detail.ellipse((rand() - 0.5) * p.r * 0.4, y, p.r * 1.1, p.r * (0.04 + rand() * 0.08))
        .fill({ color: i % 2 ? p.shade : 0xffffff, alpha: i % 2 ? 0.35 : 0.08 });
    }
    // Night-side shading
    detail.circle(p.r * 0.45, p.r * 0.35, p.r * 1.05).fill({ color: p.shade, alpha: 0.55 });
    detail.circle(-p.r * 0.35, -p.r * 0.35, p.r * 0.35).fill({ color: 0xffffff, alpha: 0.08 });
    const mask = new Graphics().circle(0, 0, p.r).fill({ color: 0xffffff });
    detail.mask = mask;
    c.addChild(body, detail, mask);

    if (p.ring) {
      const ring = new Graphics();
      ring.ellipse(0, 0, p.r * 1.9, p.r * 0.42).stroke({ width: 10, color: 0xc9b8ff, alpha: 0.45 });
      ring.ellipse(0, 0, p.r * 1.6, p.r * 0.34).stroke({ width: 4, color: 0xffffff, alpha: 0.25 });
      ring.rotation = -0.35;
      c.addChild(ring);
    }
    return c;
  }

  private buildAsteroids(): void {
    for (const d of this.track.asteroids) {
      const rand = mulberry32(d.seed);
      const g = new Graphics();
      const pts: number[] = [];
      const n = 9;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = d.r * (0.75 + rand() * 0.35);
        pts.push(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.poly(pts).fill({ color: 0x5b5068 }).stroke({ width: 2, color: 0x9a8fb0, alpha: 0.7 });
      g.circle(d.r * 0.25, -d.r * 0.2, d.r * 0.22).fill({ color: 0x3d344a });
      g.circle(-d.r * 0.3, d.r * 0.25, d.r * 0.14).fill({ color: 0x3d344a });
      g.position.set(d.x, d.y);
      this.asteroidLayer.addChild(g);
      this.asteroids.push({ hx: d.x, hy: d.y, x: d.x, y: d.y, vx: 0, vy: 0, r: d.r, drift: d.drift, phase: d.phase, spin: d.spin, view: g });
    }
  }

  private buildNebula(): void {
    const rand = mulberry32(99);
    const colors = [0x5b2bd6, 0x1b6bd6, 0xd62b9b, 0x2bd6c4];
    for (let i = 0; i < 9; i++) {
      const s = new Sprite(this.glowTex);
      s.anchor.set(0.5);
      s.blendMode = 'add';
      s.tint = colors[i % colors.length];
      s.alpha = 0.07 + rand() * 0.08;
      s.scale.set(8 + rand() * 14);
      s.position.set(-400 + rand() * 1800, -300 + rand() * 1400);
      this.nebula.addChild(s);
    }
  }

  private computeBounds() {
    const xs = [...this.track.gates.map((g) => g.x), ...this.track.planets.map((p) => p.x)];
    const ys = [...this.track.gates.map((g) => g.y), ...this.track.planets.map((p) => p.y)];
    const pad = 400;
    return { minX: Math.min(...xs) - pad, maxX: Math.max(...xs) + pad, minY: Math.min(...ys) - pad, maxY: Math.max(...ys) + pad };
  }

  // ================= Procedural textures =================

  private makeGlowTexture(): Texture {
    const size = 128;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return Texture.from(c);
  }

  private makeStarTexture(size: number, count: number, maxR: number, maxA: number, seed: number): Texture {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    const rand = mulberry32(seed);
    const tints = ['255,255,255', '180,210,255', '255,220,200', '200,180,255'];
    for (let i = 0; i < count; i++) {
      const r = 0.3 + rand() * maxR;
      ctx.fillStyle = `rgba(${tints[i % tints.length]},${0.25 + rand() * maxA})`;
      ctx.beginPath();
      ctx.arc(rand() * size, rand() * size, r, 0, Math.PI * 2);
      ctx.fill();
    }
    return Texture.from(c);
  }
}
