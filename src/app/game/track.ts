// Track layout: checkpoints (gates), planets (gravity wells) and asteroid field.
// Tweak these numbers to design new tracks.

export interface Gate {
  x: number;
  y: number;
  /** Direction the racer should travel through the gate (radians). */
  angle: number;
  /** Half of the gate opening width. */
  half: number;
}

export interface Planet {
  x: number;
  y: number;
  r: number;
  /** Gravity strength (G * M). */
  gm: number;
  /** Distance at which gravity fades to zero. */
  influence: number;
  color: number;
  shade: number;
  ring: boolean;
}

export interface AsteroidDef {
  x: number;
  y: number;
  r: number;
  drift: number;
  phase: number;
  spin: number;
  seed: number;
}

export interface TrackDef {
  name: string;
  gates: Gate[];
  planets: Planet[];
  asteroids: AsteroidDef[];
}

/** Small deterministic PRNG so the asteroid field is the same every race. */
export function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POINTS: [number, number][] = [
  [0, 0],
  [1500, -420],
  [3000, -260],
  [3900, 850],
  [3400, 2300],
  [1900, 2950],
  [350, 2650],
  [-750, 1450],
];

function buildGates(): Gate[] {
  const n = POINTS.length;
  return POINTS.map(([x, y], i) => {
    const [px, py] = POINTS[(i - 1 + n) % n];
    const [nx, ny] = POINTS[(i + 1) % n];
    // Average of incoming and outgoing direction gives a natural gate angle.
    const a1 = Math.atan2(y - py, x - px);
    const a2 = Math.atan2(ny - y, nx - x);
    const angle = Math.atan2(Math.sin(a1) + Math.sin(a2), Math.cos(a1) + Math.cos(a2));
    return { x, y, angle, half: 210 };
  });
}

const PLANETS: Planet[] = [
  // Big gas giant in the middle of the loop: slingshot around it on every bend.
  { x: 1650, y: 1200, r: 300, gm: 2.3e8, influence: 2100, color: 0x6a4fd1, shade: 0x2a1a6a, ring: true },
  // Two moons sitting just off the racing line: risky shortcuts, extra boost.
  { x: 2300, y: -900, r: 120, gm: 5.5e7, influence: 900, color: 0x1fb5c9, shade: 0x0a4f5a, ring: false },
  { x: -380, y: 2750, r: 140, gm: 6.5e7, influence: 950, color: 0xe0643a, shade: 0x5a1f0a, ring: false },
];

function buildAsteroids(gates: Gate[]): AsteroidDef[] {
  const rand = mulberry32(1337);
  const list: AsteroidDef[] = [];
  const n = gates.length;
  for (let i = 0; i < n; i++) {
    const a = gates[i];
    const b = gates[(i + 1) % n];
    const count = 6;
    for (let k = 0; k < count; k++) {
      const t = 0.18 + rand() * 0.64;
      const nxl = -(b.y - a.y);
      const nyl = b.x - a.x;
      const len = Math.hypot(nxl, nyl);
      // Keep a clear racing lane down the middle; the rocks line the sides (and a few sit inside the lane edge).
      const side = rand() < 0.5 ? -1 : 1;
      const off = side * (150 + rand() * 450);
      const x = a.x + (b.x - a.x) * t + (nxl / len) * off;
      const y = a.y + (b.y - a.y) * t + (nyl / len) * off;
      // Keep asteroids away from planets.
      if (PLANETS.some((p) => Math.hypot(p.x - x, p.y - y) < p.r + 160)) continue;
      list.push({
        x,
        y,
        r: 22 + rand() * 38,
        drift: 30 + rand() * 60,
        phase: rand() * Math.PI * 2,
        spin: (rand() - 0.5) * 1.2,
        seed: Math.floor(rand() * 1e9),
      });
    }
  }
  return list;
}

const GATES = buildGates();

export const TRACK: TrackDef = {
  name: 'Orion Loop',
  gates: GATES,
  planets: PLANETS,
  asteroids: buildAsteroids(GATES),
};
