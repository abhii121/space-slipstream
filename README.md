# Space Slipstream

A zero-gravity 2D racing game built with **Angular 20 (zoneless) + PixiJS 8**.
Race three AI pilots through an asteroid field and use planetary gravity to slingshot around the bends.

## Run it

```bash
npm install
npm start          # http://localhost:4200
npm run build      # production build in dist/
```

Requires Node 20.19+ / 22.12+.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Steer | ← → / A D | Left stick |
| Thrust | ↑ / W | RT or A |
| Retro brake | ↓ / S | LT or B |
| Boost | Space / Shift | X or RB |
| Pause | Esc / P | Start |

Touch buttons appear automatically on phones and tablets.

**Tip:** fly close to a planet's glowing ring to charge boost (slingshot). Passing gates also adds a little.

## Project structure

```
src/app/
  game/
    engine.ts             PixiJS renderer + physics + AI (plain TS, no Angular)
    track.ts              Gates, planets, asteroids (edit to design new tracks)
    game-state.service.ts Signals bridge between the engine and the UI
    input.service.ts      Keyboard, gamepad (with rumble) and touch input
    audio.ts              Procedural Web Audio: engine hum, boost, beeps, impacts
  ui/
    game-canvas.component.ts  Hosts the canvas
    menu / hud / overlays     Menu, HUD, pause and results screens
  app.ts                  Switches screens based on the game phase
src/styles.css            Neon UI theme and animations
```

## Why it runs smoothly

- **The game loop runs outside Angular.** The app is zoneless, and the engine drives its own
  `requestAnimationFrame` loop. Angular only re-renders the HUD when a signal changes.
- **Fixed 60 Hz physics with render interpolation** gives identical handling on 60, 120 and 144 Hz screens.
- **Pooled particles** with additive glow sprites (no per-frame allocations).
- **Game feel:** camera look-ahead and speed zoom, screen shake, hit-stop on heavy impacts,
  engine trails, parallax star layers and nebula, pitch-shifted engine audio, and controller rumble.

## Tuning

The constants at the top of `engine.ts` (`THRUST`, `TURN_RATE`, `MAX_SPEED`, `LATERAL_GRIP`,
`MAX_GRAVITY`, and so on) control the handling. AI difficulty is the `skill` value in the `RACERS` list.

In dev mode the engine is available in the browser console as `window.__engine` for debugging.

## Ideas for next steps

- More tracks (add another `TrackDef` in `track.ts` plus a track picker in the menu)
- Ghost replay of your best lap (record `x, y, angle` each step)
- Ship upgrades or a garage screen
- Real sound effects and music with Howler.js
- Bloom and chromatic aberration via `pixi-filters`
