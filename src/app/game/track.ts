// Track layout: checkpoints (gates), planets (gravity wells) and asteroid field.
// Add a new track by giving buildTrack() its gate points and planets.

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

type Point = [number, number];

function buildGates(points: Point[]): Gate[] {
  const n = points.length;
  return points.map(([x, y], i) => {
    const [px, py] = points[(i - 1 + n) % n];
    const [nx, ny] = points[(i + 1) % n];
    // Average of incoming and outgoing direction gives a natural gate angle.
    const a1 = Math.atan2(y - py, x - px);
    const a2 = Math.atan2(ny - y, nx - x);
    const angle = Math.atan2(Math.sin(a1) + Math.sin(a2), Math.cos(a1) + Math.cos(a2));
    return { x, y, angle, half: 210 };
  });
}

/**
 * Scatters asteroids along each segment between gates.
 * `perSegment` is either one count for every segment or a count per segment (index = gate it starts from).
 */
function buildAsteroids(gates: Gate[], planets: Planet[], seed: number, perSegment: number | number[]): AsteroidDef[] {
  const rand = mulberry32(seed);
  const list: AsteroidDef[] = [];
  const n = gates.length;
  for (let i = 0; i < n; i++) {
    const a = gates[i];
    const b = gates[(i + 1) % n];
    const count = typeof perSegment === 'number' ? perSegment : perSegment[i];
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
      if (planets.some((p) => Math.hypot(p.x - x, p.y - y) < p.r + 160)) continue;
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

function buildTrack(name: string, points: Point[], planets: Planet[], seed: number, perSegment: number | number[]): TrackDef {
  const gates = buildGates(points);
  return { name, gates, planets, asteroids: buildAsteroids(gates, planets, seed, perSegment) };
}

/** Smooth oval around a gas giant: the beginner track. */
const ORION_LOOP = buildTrack(
  'Orion Loop',
  [
    [0, 0],
    [1500, -420],
    [3000, -260],
    [3900, 850],
    [3400, 2300],
    [1900, 2950],
    [350, 2650],
    [-750, 1450],
  ],
  [
    // Big gas giant in the middle of the loop: slingshot around it on every bend.
    { x: 1650, y: 1200, r: 300, gm: 2.3e8, influence: 2100, color: 0x6a4fd1, shade: 0x2a1a6a, ring: true },
    // Two moons sitting just off the racing line: risky shortcuts, extra boost.
    { x: 2300, y: -900, r: 120, gm: 5.5e7, influence: 900, color: 0x1fb5c9, shade: 0x0a4f5a, ring: false },
    { x: -380, y: 2750, r: 140, gm: 6.5e7, influence: 950, color: 0xe0643a, shade: 0x5a1f0a, ring: false },
  ],
  1337,
  6,
);

/** Flat-out straight, a hairpin around a small heavy planet, then a slalom back through a dense asteroid field. */
const SERPENT_RUN = buildTrack(
  'Serpent Run',
  [
    // The long straight
    [0, 0],
    [1800, -150],
    [3600, 0],
    // Hairpin around the red dwarf
    [4800, -100],
    [5500, 500],
    [4900, 1200],
    // The serpent: left-right slalom
    [3800, 1000],
    [2900, 1600],
    [1900, 1000],
    [900, 1600],
    // Back to the line
    [-100, 1250],
    [-600, 550],
  ],
  [
    // Small but heavy: pulls hard, so a well-timed slingshot makes the hairpin.
    { x: 4650, y: 500, r: 170, gm: 9e7, influence: 1000, color: 0xe2454a, shade: 0x5a0f14, ring: false },
    // A moon tucked inside the slalom for a bit of extra boost.
    { x: 1400, y: 700, r: 110, gm: 4e7, influence: 800, color: 0x1fb5c9, shade: 0x0a4f5a, ring: false },
  ],
  4242,
  // Sparse on the straight and hairpin, dense through the serpent.
  [3, 3, 4, 4, 4, 10, 10, 10, 10, 6, 4, 3],
);

export const TRACKS: TrackDef[] = [ORION_LOOP, SERPENT_RUN];
