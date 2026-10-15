// Cymatic City Engine
// frequency -> driven standing-wave field (Bessel / plate / spherical-harmonic modes)
//           -> streets on nodal lines and contour/gradient lines
//           -> districts, lots and buildings under planning and structural limits.
// Pure JavaScript, no dependencies; runs in the browser and in Node.

export const ENGINE_VERSION = '1.0.0';
const TAU = Math.PI * 2;
const G0 = 9.80665;

// ---------------------------------------------------------------- utilities
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const norm3 = (a) => { const l = len3(a); return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };

export function noteName(f) {
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const midi = 69 + 12 * Math.log2(f / 440);
  const n = Math.round(midi);
  const cents = Math.round((midi - n) * 100);
  const c = cents === 0 ? '' : ` ${cents > 0 ? '+' : '−'}${Math.abs(cents)}¢`;
  return `${names[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}${c}`;
}

// ---------------------------------------------------------------- special functions
// Bessel J_m(x) from Bessel's integral (1/π)∫0^π cos(mτ − x sin τ) dτ.
// The integrand is smooth and periodic, so the trapezoid rule converges exponentially.
export function besselJ(m, x) {
  m = Math.abs(m | 0);
  if (x < 0) return (m % 2 ? -1 : 1) * besselJ(m, -x);
  const K = Math.ceil(x + m) + 40;
  let s = 0;
  for (let k = 0; k <= K; k++) {
    const t = (Math.PI * k) / K;
    s += (k === 0 || k === K ? 0.5 : 1) * Math.cos(m * t - x * Math.sin(t));
  }
  return s / K;
}

const zeroCache = new Map();
// First `count` positive zeros of J_m (bracket by scanning, refine by bisection).
export function besselZeros(m, count) {
  const arr = zeroCache.get(m) ?? [];
  let x = arr.length ? arr[arr.length - 1] + 0.3 : (m === 0 ? 0.1 : m);
  let fx = besselJ(m, x);
  const h = 0.2;
  while (arr.length < count) {
    const x2 = x + h, f2 = besselJ(m, x2);
    if (fx * f2 < 0) {
      let a = x, b = x2, fa = fx;
      for (let i = 0; i < 100 && b - a > 1e-14 * b; i++) {
        const c = 0.5 * (a + b), fc = besselJ(m, c);
        if (fa * fc <= 0) b = c; else { a = c; fa = fc; }
      }
      arr.push(0.5 * (a + b));
    }
    x = x2; fx = f2;
  }
  zeroCache.set(m, arr);
  return arr.slice(0, count);
}

// Orthonormal associated Legendre function: Y_l^m = P̄_l^m(cos θ) e^{imφ}, ∫|Y|² dΩ = 1.
export function legendreNormalized(l, m, x) {
  m = Math.abs(m);
  if (m > l) return 0;
  const s = Math.sqrt(Math.max(0, 1 - x * x));
  let pmm = Math.sqrt(1 / (4 * Math.PI));
  for (let k = 1; k <= m; k++) pmm *= -s * Math.sqrt((2 * k + 1) / (2 * k));
  if (l === m) return pmm;
  let pm1 = x * Math.sqrt(2 * m + 3) * pmm;
  if (l === m + 1) return pm1;
  let pl = 0;
  for (let ll = m + 2; ll <= l; ll++) {
    const a = Math.sqrt((4 * ll * ll - 1) / (ll * ll - m * m));
    const b = Math.sqrt(((ll - 1) * (ll - 1) - m * m) / (4 * (ll - 1) * (ll - 1) - 1));
    pl = a * (x * pm1 - b * pmm);
    pmm = pm1; pm1 = pl;
  }
  return pl;
}

export function realSphericalHarmonic(l, m, theta, phi) {
  const p = legendreNormalized(l, Math.abs(m), Math.cos(theta));
  if (m === 0) return p;
  return Math.SQRT2 * p * (m > 0 ? Math.cos(m * phi) : Math.sin(-m * phi));
}

// ---------------------------------------------------------------- plates and modes
export const PLATES = {
  circle: { label: 'Circular membrane', defaultFundamental: 40, law: 'f = f₀₁ · j_mn / j₀₁ (membrane, f ∝ k)' },
  square: { label: 'Square Chladni plate', defaultFundamental: 5, law: 'f = f₀₁ · (m² + n²) (thin plate, f ∝ k²)' },
  sphere: { label: 'Sphere', defaultFundamental: 30, law: 'f = f₁ · √(l(l+1)/2) (scalar sphere)' },
};
const CIRCLE_MAX_M = 30, CIRCLE_MAX_N = 15, SQUARE_MAX = 20, SPHERE_MAX_L = 48;

const squareShape = (m, n, sign, x, y) =>
  Math.cos(n * Math.PI * x) * Math.cos(m * Math.PI * y) + sign * Math.cos(m * Math.PI * x) * Math.cos(n * Math.PI * y);

// Every mode the plate supports, with its frequency and how strongly the drive point couples to it.
export function enumerateModes(opts = {}) {
  const plate = opts.plate ?? 'circle';
  const F = opts.fundamentalHz ?? PLATES[plate].defaultFundamental;
  const drive = opts.driveOffset ?? (plate === 'square' ? 0 : 0.37);
  const modes = [];
  if (plate === 'circle') {
    const j01 = besselZeros(0, 1)[0];
    for (let m = 0; m <= CIRCLE_MAX_M; m++) {
      const zs = besselZeros(m, CIRCLE_MAX_N);
      for (let n = 1; n <= CIRCLE_MAX_N; n++) {
        const j = zs[n - 1];
        // drive point at radius `drive`·R on the θ = 0 axis
        modes.push({ plate, m, n, j, f: (F * j) / j01, coupling: besselJ(m, j * drive) });
      }
    }
  } else if (plate === 'square') {
    const dx = 0.5 * drive, dy = 0.31 * drive; // drive moves from the centre toward the edge
    for (let n = 1; n <= SQUARE_MAX; n++) {
      for (let m = 0; m <= n; m++) {
        for (const sign of m === n ? [1] : [1, -1]) {
          modes.push({ plate, m, n, sign, f: F * (m * m + n * n), coupling: squareShape(m, n, sign, dx, dy) });
        }
      }
    }
  } else if (plate === 'sphere') {
    // A perfect sphere's 2l+1 modes are degenerate; a real body splits them. We pick one
    // azimuthal order m per degree (symmetry-broken sphere) and drive it with unit coupling.
    const az = opts.azimuthal;
    for (let l = 1; l <= SPHERE_MAX_L; l++) {
      const m = az == null || az === 'auto' ? Math.round(l * 0.5) : clamp(az | 0, 0, l);
      modes.push({ plate, l, m, n: l - m, f: (F * Math.sqrt(l * (l + 1))) / Math.SQRT2, coupling: 1 });
    }
  } else {
    throw new Error(`Unknown plate "${plate}"`);
  }
  return modes;
}

export function modeLabel(md) {
  if (md.plate === 'circle') return `(m ${md.m}, n ${md.n})`;
  if (md.plate === 'square') return `(${md.m}, ${md.n}) ${md.sign > 0 ? '+' : '−'}`;
  return `(l ${md.l}, m ${md.m})`;
}

// Damped, driven modal superposition: a_k = c_k / (f_k² − f² + i f_k f / Q).
export function drivenResponse(modes, f, Q = 30, opts = {}) {
  const keepRatio = opts.keepRatio ?? 0.12, maxModes = opts.maxModes ?? 5;
  const scored = [];
  for (const md of modes) {
    const d = md.f * md.f - f * f, g = (md.f * f) / Q;
    const den = d * d + g * g;
    const re = (md.coupling * d) / den, im = (-md.coupling * g) / den;
    const mag = Math.hypot(re, im);
    if (mag > 0 && Number.isFinite(mag)) scored.push({ md, re, im, mag });
  }
  scored.sort((a, b) => b.mag - a.mag);
  if (!scored.length) throw new Error('No mode couples to this drive point');
  const top = scored[0];
  const psi = Math.atan2(top.im, top.re);
  const c = Math.cos(psi), s = Math.sin(psi);
  const active = [];
  for (const sc of scored) {
    if (active.length >= maxModes || sc.mag < keepRatio * top.mag) break;
    active.push({
      ...sc.md,
      weight: sc.mag / top.mag,
      cr: (sc.re * c + sc.im * s) / top.mag, // in phase with the dominant mode
      ci: (sc.im * c - sc.re * s) / top.mag, // in quadrature (fills in nodes off resonance)
      detuneHz: f - sc.md.f,
    });
  }
  return { active, psi };
}

// ---------------------------------------------------------------- field
const LUT_N = 2048;
function makeField(plate, active) {
  const terms = active.map((md) => {
    if (plate === 'circle') {
      const lut = new Float64Array(LUT_N + 1);
      for (let i = 0; i <= LUT_N; i++) lut[i] = besselJ(md.m, (md.j * i) / LUT_N);
      return { md, lut };
    }
    if (plate === 'sphere') {
      const lut = new Float64Array(LUT_N + 1);
      const k = md.m > 0 ? Math.SQRT2 : 1;
      for (let i = 0; i <= LUT_N; i++) lut[i] = k * legendreNormalized(md.l, md.m, Math.cos((Math.PI * i) / LUT_N));
      return { md, lut };
    }
    return { md };
  });
  const look = (lut, t) => {
    const x = clamp(t, 0, 1) * LUT_N, i = Math.min(LUT_N - 1, Math.floor(x)), f = x - i;
    return lut[i] + (lut[i + 1] - lut[i]) * f;
  };
  let k = 1;
  // u,v: circle → disk coords in [−1,1]; square → [−0.5,0.5]; sphere → (θ, φ)
  function raw(u, v) {
    let S = 0, Qd = 0;
    for (const t of terms) {
      const md = t.md;
      let phi;
      if (plate === 'circle') phi = look(t.lut, Math.hypot(u, v)) * Math.cos(md.m * Math.atan2(v, u));
      else if (plate === 'square') phi = squareShape(md.m, md.n, md.sign, u, v);
      else phi = look(t.lut, u / Math.PI) * Math.cos(md.m * v);
      S += md.cr * phi; Qd += md.ci * phi;
    }
    return [S, Qd];
  }
  return {
    raw,
    setScale(s) { k = s; },
    // S: signed standing-wave field (zero set = nodal lines), A: vibration amplitude, both ≤ 1
    at(u, v) { const [S, Qd] = raw(u, v); return { S: S * k, A: Math.hypot(S, Qd) * k }; },
    S(u, v) { return raw(u, v)[0] * k; },
  };
}

// ---------------------------------------------------------------- presets and materials
export const MATERIALS = {
  masonry: { label: 'Load-bearing masonry', sigma: 10e6, rho: 2000 },
  concrete: { label: 'High-strength concrete (C80)', sigma: 80e6, rho: 2500 },
  steel: { label: 'Structural steel frame', sigma: 250e6, rho: 7850 },
  biocomposite: { label: 'Grown bio-composite (speculative)', sigma: 60e6, rho: 1500, speculative: true },
};
export const SAFETY_FACTOR = 3;
// Above this many floors a building needs lifts; a lift-and-stair core plus a usable ring needs about 14 m.
export const CORE_FLOORS = 6, MIN_CORE_SIDE = 14;
// Share of an arcology's terrace volume that is usable floor; the rest is atria and light wells.
export const ARCOLOGY_USABLE = 0.25;

export const PRESETS = {
  town: {
    label: 'Town', radius: 700, lot: 26, floorH: 3.0, floors: [1, 4], coreFloors: 8, streetSpacing: 85,
    widths: { boulevard: 12, ring: 9, spoke: 7, wall: 10 }, material: 'masonry', slender: 4, gravity: 1, style: 'town',
  },
  city: {
    label: 'City', radius: 3000, lot: 40, floorH: 3.4, floors: [4, 24], coreFloors: 120, streetSpacing: 110,
    widths: { boulevard: 30, ring: 18, spoke: 14, wall: 24 }, material: 'concrete', slender: 10, gravity: 1, style: 'city',
  },
  megastructure: {
    label: 'Megastructure', radius: 1400, lot: 28, floorH: 5.0, arcology: true, designHeight: 1000, terraceFloors: 4,
    widths: { boulevard: 22, wall: 20 }, material: 'steel', gravity: 1, style: 'mega',
  },
  alien: {
    label: 'Alien city', radius: 4200, lot: 52, floorH: 5.5, floors: [2, 12], coreFloors: 420, streetSpacing: 150,
    widths: { boulevard: 36, ring: 22, spoke: 16, wall: 30 }, material: 'biocomposite', slender: 12, gravity: 0.38, style: 'alien',
  },
};

// Self-weight crushing limit of an untapered solid column, h = σ / (ρ g SF).
export function heightLimit(materialKey, gravityRel) {
  const mat = MATERIALS[materialKey];
  return mat.sigma / (mat.rho * G0 * gravityRel * SAFETY_FACTOR);
}
// Slenderness allowance grows as self-buckling eases with lower gravity (Greenhill, ∝ g^-1/3).
export function slendernessLimit(base, gravityRel) {
  return Math.min(40, base * Math.pow(1 / gravityRel, 1 / 3));
}

export function resolveParams(input = {}) {
  const plate = input.plate ?? 'circle';
  const presetKey = input.preset ?? 'city';
  const preset = PRESETS[presetKey];
  if (!PLATES[plate]) throw new Error(`Unknown plate "${plate}"`);
  if (!preset) throw new Error(`Unknown preset "${presetKey}"`);
  const frequency = Number(input.frequency ?? 432);
  if (!(frequency > 0) || !Number.isFinite(frequency)) throw new Error('Frequency must be a positive number of hertz');
  return {
    frequency, plate, presetKey, preset,
    seed: (input.seed ?? 1) >>> 0,
    Q: clamp(Number(input.Q ?? 30), 2, 1000),
    fundamentalHz: Number(input.fundamentalHz ?? PLATES[plate].defaultFundamental),
    driveOffset: input.driveOffset ?? (plate === 'square' ? 0 : 0.37),
    azimuthal: input.azimuthal ?? 'auto',
    gravity: clamp(Number(input.gravity ?? preset.gravity), 0.05, 5),
    material: input.material && MATERIALS[input.material] ? input.material : preset.material,
    inverse: !!input.inverse,
  };
}

export function frequencyRange(plate, fundamentalHz) {
  const F = fundamentalHz ?? PLATES[plate].defaultFundamental;
  if (plate === 'circle') return [F, (F * besselZeros(CIRCLE_MAX_M, 1)[0]) / besselZeros(0, 1)[0]];
  if (plate === 'square') return [F, F * SQUARE_MAX * SQUARE_MAX];
  return [F, (F * Math.sqrt(SPHERE_MAX_L * (SPHERE_MAX_L + 1))) / Math.SQRT2];
}

// ---------------------------------------------------------------- domain (plate → world)
function makeDomain(p) {
  const R = p.preset.radius;
  if (p.plate === 'circle') {
    return {
      kind: 'plane', shape: 'circle', scale: R, lo: -1, hi: 1, area: Math.PI * R * R, extent: R,
      inside: (u, v) => u * u + v * v <= 1,
      toWorld: (u, v) => [u * R, 0, v * R],
      toNorm: (P) => [P[0] / R, P[2] / R],
    };
  }
  if (p.plate === 'square') {
    const half = (R * Math.sqrt(Math.PI)) / 2; // same area as the disk
    return {
      kind: 'plane', shape: 'square', scale: 2 * half, lo: -0.5, hi: 0.5, area: 4 * half * half, extent: half,
      inside: (u, v) => Math.abs(u) <= 0.5 && Math.abs(v) <= 0.5,
      toWorld: (u, v) => [u * 2 * half, 0, v * 2 * half],
      toNorm: (P) => [P[0] / (2 * half), P[2] / (2 * half)],
    };
  }
  const Rs = R / 2; // 4πRs² = πR²
  return {
    kind: 'sphere', shape: 'sphere', scale: Rs, area: 4 * Math.PI * Rs * Rs, extent: Rs, Rs,
    inside: () => true,
    toWorld: (th, ph) => [Rs * Math.sin(th) * Math.cos(ph), Rs * Math.cos(th), Rs * Math.sin(th) * Math.sin(ph)],
    toNorm: (P) => {
      const th = Math.acos(clamp(P[1] / len3(P), -1, 1));
      let ph = Math.atan2(P[2], P[0]); if (ph < 0) ph += TAU;
      return [th, ph];
    },
  };
}

const upAt = (dom, P) => (dom.kind === 'plane' ? [0, 1, 0] : norm3(P));

// World-space gradient of the signed field at normalized coords.
function gradWorld(dom, field, u, v) {
  if (dom.kind === 'plane') {
    const h = 1e-3 * (dom.hi - dom.lo);
    const gx = (field.S(u + h, v) - field.S(u - h, v)) / (2 * h * dom.scale);
    const gz = (field.S(u, v + h) - field.S(u, v - h)) / (2 * h * dom.scale);
    return [gx, 0, gz];
  }
  const h = 1e-3, Rs = dom.Rs;
  const th = clamp(u, 2e-3, Math.PI - 2e-3);
  const dth = (field.S(th + h, v) - field.S(th - h, v)) / (2 * h * Rs);
  const dph = (field.S(th, v + h) - field.S(th, v - h)) / (2 * h * Rs * Math.sin(th));
  const eTh = [Math.cos(th) * Math.cos(v), -Math.sin(th), Math.cos(th) * Math.sin(v)];
  const ePh = [-Math.sin(v), 0, Math.cos(v)];
  return add(scale3(eTh, dth), scale3(ePh, dph));
}

// ---------------------------------------------------------------- grid + marching squares
function sampleGrid(dom, field) {
  const ni = dom.kind === 'plane' ? 220 : 120, nj = dom.kind === 'plane' ? 220 : 240;
  const W = nj + 1, n = (ni + 1) * W;
  const S = new Float64Array(n), Qd = new Float64Array(n), valid = new Uint8Array(n);
  const coord = (i, j) => (dom.kind === 'plane'
    ? [dom.lo + ((dom.hi - dom.lo) * i) / ni, dom.lo + ((dom.hi - dom.lo) * j) / nj]
    : [(Math.PI * i) / ni, (TAU * (j % nj)) / nj]);
  let maxA = 0;
  for (let i = 0; i <= ni; i++) {
    for (let j = 0; j <= nj; j++) {
      const [u, v] = coord(i, j), id = i * W + j;
      if (!dom.inside(u, v)) continue;
      const [s, q] = field.raw(u, v);
      S[id] = s; Qd[id] = q; valid[id] = 1;
      maxA = Math.max(maxA, Math.hypot(s, q));
    }
  }
  const k = maxA > 0 ? 1 / maxA : 1;
  field.setScale(k);
  for (let id = 0; id < n; id++) { S[id] *= k; Qd[id] *= k; }
  return { ni, nj, W, S, Qd, valid, coord, wrap: dom.kind === 'sphere' };
}

function marchingSquares(g, level) {
  const { ni, nj, W, S, valid } = g;
  const out = [];
  for (let i = 0; i < ni; i++) {
    for (let j = 0; j < nj; j++) {
      const i00 = i * W + j, i01 = i00 + 1, i10 = i00 + W, i11 = i10 + 1;
      if (!(valid[i00] && valid[i01] && valid[i10] && valid[i11])) continue;
      const a = S[i00] - level, b = S[i01] - level, c = S[i11] - level, d = S[i10] - level;
      const idx = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (d > 0 ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const e = [
        () => [i, j + a / (a - b)],
        () => [i + b / (b - c), j + 1],
        () => [i + 1, j + d / (d - c)],
        () => [i + a / (a - d), j],
      ];
      const seg = (p, q) => out.push([e[p](), e[q]()]);
      const center = (a + b + c + d) / 4;
      switch (idx) {
        case 1: case 14: seg(3, 0); break;
        case 2: case 13: seg(0, 1); break;
        case 4: case 11: seg(1, 2); break;
        case 8: case 7: seg(2, 3); break;
        case 3: case 12: seg(1, 3); break;
        case 6: case 9: seg(0, 2); break;
        case 5: if (center > 0) { seg(0, 1); seg(2, 3); } else { seg(3, 0); seg(1, 2); } break;
        case 10: if (center > 0) { seg(3, 0); seg(1, 2); } else { seg(0, 1); seg(2, 3); } break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- spatial hash of road segments
class SegmentHash {
  // planar=true hashes on x/z only (all plane-city geometry has y = 0)
  constructor(cell, planar) { this.cell = cell; this.planar = planar; this.map = new Map(); }
  key(ix, iy, iz) { return this.planar ? (ix + 32768) * 65536 + (iz + 32768) : ((ix + 1024) * 2048 + (iy + 1024)) * 2048 + (iz + 1024); }
  insert(seg) {
    const c = this.cell, a = seg.a, b = seg.b, r = seg.w / 2;
    if (seg.mx === undefined) {
      Object.defineProperties(seg, {
        mx: { value: (a[0] + b[0]) / 2 }, my: { value: (a[1] + b[1]) / 2 }, mz: { value: (a[2] + b[2]) / 2 },
        reach: { value: Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2) / 2 + r },
      });
    }
    const lo = [Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.min(a[2], b[2]) - r];
    const hi = [Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, Math.max(a[2], b[2]) + r];
    const y0 = this.planar ? 0 : Math.floor(lo[1] / c), y1 = this.planar ? 0 : Math.floor(hi[1] / c);
    for (let x = Math.floor(lo[0] / c); x <= Math.floor(hi[0] / c); x++)
      for (let y = y0; y <= y1; y++)
        for (let z = Math.floor(lo[2] / c); z <= Math.floor(hi[2] / c); z++) {
          const k = this.key(x, y, z);
          let arr = this.map.get(k); if (!arr) this.map.set(k, (arr = []));
          arr.push(seg);
        }
  }
  // distance from P to the nearest road edge (negative = on a road); exact up to `cell`, else returns `cell`
  clearance(P, stopBelow = -Infinity) {
    const c = this.cell, ix = Math.floor(P[0] / c), iy = this.planar ? 0 : Math.floor(P[1] / c), iz = Math.floor(P[2] / c);
    const y0 = this.planar ? 0 : iy - 1, y1 = this.planar ? 0 : iy + 1;
    let best = c;
    for (let x = ix - 1; x <= ix + 1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = iz - 1; z <= iz + 1; z++) {
          const arr = this.map.get(this.key(x, y, z));
          if (!arr) continue;
          for (const s of arr) {
            // cheap reject with the segment's bounding sphere before the exact distance
            const mx = P[0] - s.mx, my = P[1] - s.my, mz = P[2] - s.mz;
            const lb = Math.sqrt(mx * mx + my * my + mz * mz) - s.reach;
            if (lb >= best) continue;
            const dd = segDist(P, s) - s.w / 2;
            if (dd < best) { best = dd; if (best < stopBelow) return best; }
          }
        }
    return best;
  }
}
function segDist(P, s) {
  const a = s.a, b = s.b;
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const apx = P[0] - a[0], apy = P[1] - a[1], apz = P[2] - a[2];
  const L2 = abx * abx + aby * aby + abz * abz;
  let t = L2 > 0 ? (apx * abx + apy * aby + apz * abz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
export function distToSegment(P, A, B) {
  const ab = sub(B, A), ap = sub(P, A);
  const L2 = dot(ab, ab);
  const t = L2 > 0 ? clamp(dot(ap, ab) / L2, 0, 1) : 0;
  return len3(sub(ap, scale3(ab, t)));
}

// ---------------------------------------------------------------- districts (sign regions)
function labelDistricts(g) {
  const { ni, nj, W, S, valid, wrap } = g;
  const label = new Int32Array((ni + 1) * W).fill(-1);
  const sizes = [], signs = [];
  const cols = wrap ? nj : nj + 1;
  const stack = [];
  for (let i = 0; i <= ni; i++) {
    for (let j = 0; j < cols; j++) {
      const id0 = i * W + j;
      if (!valid[id0] || label[id0] >= 0) continue;
      const sgn = S[id0] > 0, L = sizes.length;
      let size = 0;
      label[id0] = L; stack.push(id0);
      while (stack.length) {
        const id = stack.pop(); size++;
        const ci = Math.floor(id / W), cj = id % W;
        const nb = [[ci - 1, cj], [ci + 1, cj], [ci, cj - 1], [ci, cj + 1]];
        for (let [a, b] of nb) {
          if (a < 0 || a > ni) continue;
          if (wrap) b = (b + nj) % nj; else if (b < 0 || b > nj) continue;
          const nid = a * W + b;
          if (valid[nid] && label[nid] < 0 && (S[nid] > 0) === sgn) { label[nid] = L; stack.push(nid); }
        }
      }
      sizes.push(size); signs.push(sgn ? 1 : -1);
    }
  }
  if (wrap) for (let i = 0; i <= ni; i++) label[i * W + nj] = label[i * W];
  return { label, sizes, signs };
}

// ---------------------------------------------------------------- roads
function buildRoads(p, dom, field, g) {
  const pr = p.preset, roads = [];
  const toWorldGrid = (gi, gj) => { const [u, v] = g.coord(gi, gj); return dom.toWorld(u, v); };
  const gridPoint = (pt) => {
    if (dom.kind === 'plane') {
      const u = dom.lo + ((dom.hi - dom.lo) * pt[0]) / g.ni, v = dom.lo + ((dom.hi - dom.lo) * pt[1]) / g.nj;
      return dom.toWorld(u, v);
    }
    return dom.toWorld((Math.PI * pt[0]) / g.ni, (TAU * pt[1]) / g.nj);
  };
  void toWorldGrid;
  const addContour = (level, kind, w) => {
    let total = 0;
    for (const [a, b] of marchingSquares(g, level)) {
      const A = gridPoint(a), B = gridPoint(b), L = len3(sub(B, A));
      if (L < 1e-6) continue;
      roads.push({ a: A, b: B, w, kind }); total += L;
    }
    return total;
  };

  // 1. nodal lines → boulevards (sand lines of the Chladni figure)
  const probe = marchingSquares(g, 0).reduce((s, [a, b]) => s + len3(sub(gridPoint(b), gridPoint(a))), 0);
  const nodalSpacing = probe > 0 ? dom.area / probe : Infinity;
  const wBoulevard = Math.max(6, Math.min(pr.widths.boulevard, nodalSpacing * 0.12));
  addContour(0, 'boulevard', wBoulevard);

  const targetLength = pr.arcology ? 0 : (dom.area * 2) / pr.streetSpacing; // UN-Habitat ≥ 18 km/km² ≈ 2/111 m
  let ringLevels = [];
  if (!pr.arcology) {
    // 2. contour rings (major hyperstreamlines along |S| levels)
    const maxK = dom.kind === 'sphere' ? 6 : 3;
    const k = clamp(Math.round(nodalSpacing / pr.streetSpacing) - 1, 0, maxK);
    for (let i = 1; i <= k; i++) {
      const v = (0.9 * i) / (k + 1);
      ringLevels.push(v);
      addContour(v, 'ring', pr.widths.ring);
      addContour(-v, 'ring', pr.widths.ring);
    }
  }

  // 3. gradient spokes (minor hyperstreamlines) from the nodal lines toward the antinodes
  let spokeSpacing = null;
  if (!pr.arcology) {
    const base = roads.slice();
    const seeds = base.filter((r) => r.kind === 'boulevard').map((r) => scale3(add(r.a, r.b), 0.5));
    let dsep = pr.streetSpacing * 2.5;
    let spokes = [];
    for (let iter = 0; iter < 5; iter++) {
      spokes = traceSpokes(dom, field, seeds, dsep, pr);
      const total = base.reduce((s, r) => s + len3(sub(r.b, r.a)), 0) + spokes.reduce((s, r) => s + len3(sub(r.b, r.a)), 0);
      spokeSpacing = dsep;
      if (total >= targetLength) break;
      dsep *= 0.7;
    }
    roads.push(...spokes);
  }

  // 4. perimeter road / wall
  if (dom.kind === 'plane') {
    const pts = [];
    if (dom.shape === 'circle') {
      const r = 0.985, steps = Math.ceil((TAU * dom.scale) / 30);
      for (let i = 0; i <= steps; i++) { const t = (TAU * i) / steps; pts.push(dom.toWorld(r * Math.cos(t), r * Math.sin(t))); }
    } else {
      const e = 0.49, n = Math.ceil(dom.scale / 30);
      const corners = [[-e, -e], [e, -e], [e, e], [-e, e], [-e, -e]];
      for (let c = 0; c < 4; c++) for (let i = 0; i < n; i++) {
        const t = i / n, [x0, y0] = corners[c], [x1, y1] = corners[c + 1];
        pts.push(dom.toWorld(lerp(x0, x1, t), lerp(y0, y1, t)));
      }
      pts.push(pts[0]);
    }
    for (let i = 1; i < pts.length; i++) roads.push({ a: pts[i - 1], b: pts[i], w: pr.widths.wall, kind: 'wall' });
  }
  return { roads, nodalSpacing, ringLevels, spokeSpacing, targetLength, wBoulevard };
}

function traceSpokes(dom, field, seeds, dsep, pr) {
  const out = [];
  const accepted = new Map(), cellA = dsep;
  const key = (P, c) => `${Math.floor(P[0] / c)},${Math.floor(P[1] / c)},${Math.floor(P[2] / c)}`;
  const near = (map, P, c, r) => {
    const ix = Math.floor(P[0] / c), iy = Math.floor(P[1] / c), iz = Math.floor(P[2] / c);
    for (let x = ix - 1; x <= ix + 1; x++) for (let y = iy - 1; y <= iy + 1; y++) for (let z = iz - 1; z <= iz + 1; z++) {
      const arr = map.get(`${x},${y},${z}`); if (!arr) continue;
      for (const q of arr) if (len3(sub(q, P)) < r) return q;
    }
    return null;
  };
  const put = (map, P, c) => { const k = key(P, c); let a = map.get(k); if (!a) map.set(k, (a = [])); a.push(P); };
  const chosen = [];
  for (const s of seeds) { if (!near(accepted, s, cellA, dsep)) { put(accepted, s, cellA); chosen.push(s); } }

  const spokePts = new Map(), cellS = dsep * 0.4;
  const ds = Math.min(pr.streetSpacing * 0.25, pr.lot * 0.6);
  const maxSteps = Math.ceil((4 * dom.extent) / ds);
  for (const seed of chosen) {
    for (const dir of [1, -1]) {
      let P = seed, [u, v] = dom.toNorm(P), prev = Math.abs(field.S(u, v));
      const path = [P];
      for (let step = 0; step < maxSteps; step++) {
        const gw = gradWorld(dom, field, u, v), gl = len3(gw);
        if (gl < 1e-12) break;
        let Pn = add(P, scale3(gw, (dir * ds) / gl));
        if (dom.kind === 'sphere') Pn = scale3(norm3(Pn), dom.Rs);
        const [un, vn] = dom.toNorm(Pn);
        if (!dom.inside(un * 1.02, vn * 1.02)) break;
        const sn = field.S(un, vn);
        if (step > 1 && dir * sn < 0) break;
        if (Math.abs(sn) < prev - 1e-4) break;   // passed the crest
        const hit = step > 2 ? near(spokePts, Pn, cellS, dsep * 0.35) : null;
        if (hit) { path.push(hit); break; } // merge into an existing spoke
        path.push(Pn);
        P = Pn; u = un; v = vn; prev = Math.abs(sn);
        if (prev > 0.9) break;                     // leave a plaza at the antinode
      }
      for (let i = 1; i < path.length; i++) {
        out.push({ a: path[i - 1], b: path[i], w: pr.widths.spoke, kind: 'spoke' });
      }
      for (const q of path) put(spokePts, q, cellS);
    }
  }
  return out;
}

// ---------------------------------------------------------------- lots
function lotCandidates(dom, spacing, rng, jitter) {
  const out = [];
  if (dom.kind === 'plane') {
    const E = dom.extent;
    for (let x = -E + spacing / 2; x < E; x += spacing) {
      for (let z = -E + spacing / 2; z < E; z += spacing) {
        const P = [x + (rng() - 0.5) * 2 * jitter * spacing, 0, z + (rng() - 0.5) * 2 * jitter * spacing];
        const [u, v] = dom.toNorm(P);
        const inset = dom.shape === 'circle' ? u * u + v * v <= 0.97 * 0.97 : Math.abs(u) <= 0.485 && Math.abs(v) <= 0.485;
        if (inset) out.push({ P, u, v });
      }
    }
    return out;
  }
  const N = Math.max(8, Math.round(dom.area / (spacing * spacing)));
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let k = 0; k < N; k++) {
    const y = 1 - (2 * (k + 0.5)) / N, r = Math.sqrt(1 - y * y), ph = k * ga;
    const P = scale3([r * Math.cos(ph), y, r * Math.sin(ph)], dom.Rs);
    const [u, v] = dom.toNorm(P);
    out.push({ P, u, v });
  }
  return out;
}

// ---------------------------------------------------------------- city
export function generateCity(input = {}) {
  const t0 = Date.now();
  const p = resolveParams(input);
  const pr = p.preset;
  const modes = enumerateModes(p);
  const resp = drivenResponse(modes, p.frequency, p.Q);
  const field = makeField(p.plate, resp.active);
  const dom = makeDomain(p);
  const grid = sampleGrid(dom, field);
  const districts = labelDistricts(grid);
  const rd = buildRoads(p, dom, field, grid);
  const maxW = Math.max(...Object.values(pr.widths));
  const access = pr.arcology ? Infinity : pr.streetSpacing * 0.8; // every building within reach of a street
  const planar = dom.kind === 'plane';
  const hash = new SegmentHash(pr.lot * 1.6 + maxW, planar);          // footprint fitting
  const reach = new SegmentHash((pr.arcology ? pr.lot : access) + maxW, planar); // walking reach
  for (const r of rd.roads) { hash.insert(r); reach.insert(r); }

  const rng = mulberry32(p.seed * 2654435761 + 17);
  const hMat = heightLimit(p.material, p.gravity);
  const slender = pr.arcology ? Infinity : slendernessLimit(pr.slender, p.gravity);
  const setback = pr.arcology ? 2 : 1.5; // metres from the road edge (sidewalks are inside road widths)

  const districtAt = (u, v) => {
    let i, j;
    if (dom.kind === 'plane') {
      i = Math.round(((u - dom.lo) / (dom.hi - dom.lo)) * grid.ni);
      j = Math.round(((v - dom.lo) / (dom.hi - dom.lo)) * grid.nj);
    } else {
      i = Math.round((u / Math.PI) * grid.ni);
      j = Math.round((v / TAU) * grid.nj) % grid.nj;
    }
    return districts.label[clamp(i, 0, grid.ni) * grid.W + clamp(j, 0, grid.nj)];
  };
  const zoneOf = (amp) => (amp >= 0.72 ? 'core' : amp >= 0.42 ? 'mixed' : amp >= 0.12 ? 'residential' : 'green');

  const buildings = [], trees = [];
  let greenLots = 0, roadLots = 0, accessLots = 0;
  const binding = { material: 0, slenderness: 0, core: 0 };

  const frame = (P, u, v) => {
    const up = upAt(dom, P);
    let fwd;
    if (pr.arcology && dom.kind === 'plane') fwd = [1, 0, 0];
    else {
      const gw = gradWorld(dom, field, u, v);
      fwd = norm3(cross(up, gw));
      if (len3(fwd) < 0.5) fwd = norm3(cross(up, Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    }
    return { up, fwd };
  };

  if (pr.arcology) {
    // One continuous terraced structure; nodal lines are open canyons, antinodes rise highest.
    // On a sphere the terraces form a shell; keep it under a quarter of the radius so it stays a crust, not spikes.
    const shellCap = dom.kind === 'sphere' ? 0.25 * dom.Rs : Infinity;
    const H = Math.min(pr.designHeight, hMat, shellCap);
    const step = pr.terraceFloors * pr.floorH;
    const lots = lotCandidates(dom, pr.lot, rng, 0);
    const foot = dom.kind === 'plane' ? pr.lot * 0.97 : pr.lot * 0.58;
    for (const { P, u, v } of lots) {
      const { S, A } = field.at(u, v);
      const amp = p.inverse ? 1 - A : A;
      const c = hash.clearance(P);
      if (c < (dom.kind === 'plane' ? foot * 0.71 : foot * 0.71) + 1) { roadLots++; continue; }
      if (amp < 0.06) { greenLots++; trees.push({ pos: P, up: upAt(dom, P), s: 1 + rng() }); continue; }
      const hTop = Math.max(step, Math.floor(H / step) * step);
      let h = clamp(Math.round((pr.designHeight * Math.pow(amp, 1.15)) / step) * step, step, hTop);
      if (h === hTop && pr.designHeight * Math.pow(amp, 1.15) > hTop + step / 2 && H === hMat) binding.material++;
      const { up, fwd } = frame(P, u, v);
      buildings.push({
        pos: P, up, fwd, w: foot, d: foot, h, floors: Math.round(h / pr.floorH), zone: zoneOf(amp),
        shape: 'terrace', polarity: S >= 0 ? 1 : -1, amp, district: districtAt(u, v), landmark: false,
      });
    }
  } else {
    // Does a w×d footprint centred at P (long side along fwd) keep `setback` from every road edge?
    // Boundary samples ≤ 4 m apart catch any road (narrowest half-width 3.5 m) that crosses the outline.
    const fits = (P, up, fwd, w, d) => {
      const right = cross(fwd, up);
      const nx = Math.max(1, Math.ceil(w / 4)), nz = Math.max(1, Math.ceil(d / 4));
      const at = (x, z) => add(add(P, scale3(fwd, x)), scale3(right, z));
      const bad = (Q) => hash.clearance(Q, setback) < setback;
      if (bad(P)) return false;
      for (let i = 0; i <= nx; i++) {
        const x = -w / 2 + (w * i) / nx;
        if (bad(at(x, d / 2)) || bad(at(x, -d / 2))) return false;
      }
      for (let k = 1; k < nz; k++) {
        const z = -d / 2 + (d * k) / nz;
        if (bad(at(w / 2, z)) || bad(at(-w / 2, z))) return false;
      }
      return true;
    };

    const placeLot = (lot, size, onlyZone, superlots) => {
      const { P, u, v } = lot;
      const { S, A } = field.at(u, v);
      const amp = p.inverse ? 1 - A : A;
      const zone = zoneOf(amp);
      if (onlyZone && zone !== onlyZone) return false;
      if (!onlyZone && zone === 'core') return false;
      if (superlots && superlots.near(P, 1.35 * pr.lot)) return false;
      const c = hash.clearance(P);
      if (c < setback + 2) { roadLots++; return true; }
      if (c >= hash.cell && reach.clearance(P) > access) { accessLots++; trees.push({ pos: P, up: upAt(dom, P), s: 1 + rng() }); return true; }
      if (zone === 'green') {
        greenLots++;
        if (rng() < 0.7) trees.push({ pos: P, up: upAt(dom, P), s: 0.8 + rng() * 0.8 });
        return true;
      }
      // the lot grid guarantees neighbours never overlap while the half-diagonal stays under hdCell
      const hdCell = (dom.kind === 'plane' ? 0.44 : 0.42) * size;
      const r1 = rng(), r2 = rng(), r3 = rng();
      let w = size * { core: 0.8, mixed: 0.74, residential: 0.66 }[zone] * (0.9 + 0.2 * r1);
      let d = zone === 'core' ? w * (0.85 + 0.15 * r2) : w * (0.62 + 0.3 * r2);
      const hd = Math.hypot(w, d) / 2;
      if (hd > hdCell) { const k = hdCell / hd; w *= k; d *= k; }
      const { up, fwd } = frame(P, u, v);
      let ok = false;
      for (let t = 0; t < 7 && w >= 0.25 * pr.lot; t++) {
        if (fits(P, up, fwd, w, d)) { ok = true; break; }
        w *= 0.85; d *= 0.85;
      }
      if (!ok) { roadLots++; return true; }
      const [f0, f1] = pr.floors;
      let floors;
      if (zone === 'residential') floors = lerp(f0, f1 * 0.5, clamp((amp - 0.12) / 0.3, 0, 1));
      else if (zone === 'mixed') floors = lerp(f1 * 0.5, f1, clamp((amp - 0.42) / 0.3, 0, 1));
      else floors = lerp(f1, pr.coreFloors, Math.pow(clamp((amp - 0.72) / 0.28, 0, 1), 1.4));
      floors = Math.max(1, Math.round(floors * (0.8 + 0.4 * r3)));
      let shape = zone === 'core' ? 'tower' : 'block';
      if (pr.style === 'alien') shape = zone === 'core' ? 'spire' : zone === 'mixed' ? (r1 < 0.5 ? 'pod' : 'dome') : 'dome';
      if (pr.style === 'town' && zone !== 'core') shape = 'house';
      buildings.push({
        pos: P, up, fwd, w, d, h: 0, floors, zone, shape, polarity: S >= 0 ? 1 : -1, amp,
        district: districtAt(u, v), landmark: false, hdCell,
      });
      return true;
    };

    // pass 1: double-size lots for the high-amplitude cores (room for real tower footprints)
    const superHash = new Map(), sc = 2 * pr.lot;
    const superlots = {
      add(P) { const k = `${Math.floor(P[0] / sc)},${Math.floor(P[1] / sc)},${Math.floor(P[2] / sc)}`; let a = superHash.get(k); if (!a) superHash.set(k, (a = [])); a.push(P); },
      near(P, r) {
        const ix = Math.floor(P[0] / sc), iy = Math.floor(P[1] / sc), iz = Math.floor(P[2] / sc);
        for (let x = ix - 1; x <= ix + 1; x++) for (let y = iy - 1; y <= iy + 1; y++) for (let z = iz - 1; z <= iz + 1; z++) {
          const a = superHash.get(`${x},${y},${z}`); if (!a) continue;
          for (const q of a) if (len3(sub(q, P)) < r) return true;
        }
        return false;
      },
    };
    for (const lot of lotCandidates(dom, 2 * pr.lot, rng, 0.06)) {
      const before = buildings.length;
      placeLot(lot, 2 * pr.lot, 'core', null);
      if (buildings.length > before) superlots.add(lot.P);
    }
    // pass 2: regular lots everywhere else
    for (const lot of lotCandidates(dom, pr.lot, rng, 0.06)) placeLot(lot, pr.lot, null, superlots);

    // landmarks: the strongest antinode of each sizeable district
    const minSize = 0.002 * districts.sizes.reduce((a, b) => a + b, 0);
    const best = new Map();
    for (const b of buildings) {
      if (b.district < 0 || districts.sizes[b.district] < minSize) continue;
      const cur = best.get(b.district);
      if (!cur || b.amp > cur.amp) best.set(b.district, b);
    }
    for (const b of best.values()) { b.landmark = true; b.floors = Math.round(b.floors * 1.3); }

    // structural limits: widen toward the slenderness rule where the lot allows, else cap the height
    for (const b of buildings) {
      let h = b.floors * pr.floorH;
      if (b.shape === 'dome') h = Math.min(h, 0.6 * Math.min(b.w, b.d));
      if (h > slender * Math.min(b.w, b.d)) {
        const need = h / slender;
        // widest square (or the current long side) that still fits the lot and clears the roads
        let side = Math.min(need, b.hdCell / Math.SQRT2);
        while (side > Math.min(b.w, b.d) && !fits(b.pos, b.up, b.fwd, Math.max(b.w, side), Math.max(b.d, side))) side *= 0.93;
        if (side > Math.min(b.w, b.d)) { b.w = Math.max(b.w, side); b.d = Math.max(b.d, side); }
        if (h > slender * Math.min(b.w, b.d)) { h = slender * Math.min(b.w, b.d); binding.slenderness++; }
      }
      // a building over six floors needs a lift-and-stair core plus usable floor around it
      if (h > CORE_FLOORS * pr.floorH && Math.min(b.w, b.d) < MIN_CORE_SIDE) {
        let side = MIN_CORE_SIDE;
        const ok = side / Math.SQRT2 <= b.hdCell && fits(b.pos, b.up, b.fwd, Math.max(b.w, side), Math.max(b.d, side));
        if (ok) { b.w = Math.max(b.w, side); b.d = Math.max(b.d, side); }
        else { h = Math.min(h, CORE_FLOORS * pr.floorH); binding.core++; }
      }
      if (h > hMat) { h = hMat; binding.material++; }
      b.floors = Math.max(1, Math.floor(h / pr.floorH + 1e-9));
      b.h = b.shape === 'dome' ? Math.max(Math.min(h, b.floors * pr.floorH), Math.min(h, pr.floorH)) : b.floors * pr.floorH;
      delete b.hdCell;
    }
  }

  // ---------------------------------------------------------------- stats and plausibility
  const roadLen = rd.roads.reduce((s, r) => s + len3(sub(r.b, r.a)), 0);
  const roadArea = rd.roads.reduce((s, r) => s + len3(sub(r.b, r.a)) * r.w, 0);
  const shapeVolume = { block: 1, house: 1, tower: 1, terrace: 1, pod: 0.785, dome: 0.5, spire: 0.33 };
  const resShare = { residential: 0.9, mixed: 0.5, core: 0.25, green: 0 };
  let gfa = 0, resGfa = 0, footprint = 0, maxH = 0;
  for (const b of buildings) {
    const area = b.w * b.d * (shapeVolume[b.shape] ?? 1);
    footprint += b.w * b.d;
    const g = area * b.floors * 0.7 * (pr.arcology ? ARCOLOGY_USABLE : 1); // 0.7 net-to-gross (circulation 30 % or more)
    gfa += g;
    resGfa += g * (pr.arcology ? 0.75 : resShare[b.zone] ?? 0.5);
    maxH = Math.max(maxH, b.h);
  }
  const population = Math.round(resGfa / 45);    // 45 m² net per resident (assumption)
  const jobs = Math.round((gfa - resGfa) / 15);   // 15 m² per worker (AFNOR 10–15 m²)
  const haArea = dom.area / 1e4, km2 = dom.area / 1e6;
  const sizable = districts.sizes.filter((s) => s >= 0.002 * districts.sizes.reduce((a, b) => a + b, 0)).length;
  const lotArea = pr.lot * pr.lot;
  const stats = {
    areaKm2: km2,
    buildings: buildings.length,
    trees: trees.length,
    roadSegments: rd.roads.length,
    roadLengthKm: roadLen / 1000,
    streetDensity: roadLen / 1000 / km2,
    roadShare: roadArea / dom.area,
    greenShare: ((greenLots + accessLots) * lotArea) / dom.area,
    coverage: footprint / dom.area,
    far: gfa / 0.7 / dom.area,
    gfaM2: gfa,
    population, jobs,
    densityPerHa: population / haArea,
    lotsOnRoads: roadLots, lotsBeyondReach: accessLots, greenLots,
    maxHeight: maxH,
    tallest: buildings.reduce((m, b) => (b.h > (m?.h ?? -1) ? b : m), null)?.floors ?? 0,
    districts: sizable,
    nodalSpacing: rd.nodalSpacing,
    heightLimit: hMat,
    slendernessLimit: slender,
    binding,
  };
  const checks = plausibilityChecks(p, stats);
  const dominant = resp.active[0];
  return {
    meta: {
      engine: ENGINE_VERSION,
      frequency: p.frequency, note: noteName(p.frequency), plate: p.plate, plateLabel: PLATES[p.plate].label,
      law: PLATES[p.plate].law, preset: p.presetKey, presetLabel: pr.label, seed: p.seed, Q: p.Q,
      fundamentalHz: p.fundamentalHz, driveOffset: p.driveOffset, gravity: p.gravity, material: p.material,
      materialLabel: MATERIALS[p.material].label, inverse: p.inverse,
      modes: resp.active.map((m) => ({ label: modeLabel(m), f: m.f, weight: m.weight, detuneHz: m.detuneHz, m: m.m, n: m.n, l: m.l })),
      dominant: modeLabel(dominant), symmetry: symmetryNote(dominant),
      world: { shape: dom.shape, extent: dom.extent, area: dom.area, Rs: dom.Rs ?? null },
      ringLevels: rd.ringLevels, spokeSpacing: rd.spokeSpacing, boulevardWidth: rd.wBoulevard,
    },
    roads: rd.roads,
    buildings,
    trees,
    stats,
    checks,
    timingMs: Date.now() - t0, // excluded from toJSON so identical inputs give identical files
    // not serializable: lets a viewer paint the plate field onto the ground
    field: { at: (u, v) => field.at(u, v), toNorm: dom.toNorm, toWorld: dom.toWorld },
  };
}

function symmetryNote(md) {
  if (md.plate === 'circle') return `${md.m} nodal diameter${md.m === 1 ? '' : 's'} and ${md.n} nodal circle${md.n === 1 ? '' : 's'} (rim included)`;
  if (md.plate === 'square') return `${md.m}×${md.n} lattice, ${md.sign > 0 ? 'centre-driven (+)' : 'off-centre (−)'} combination`;
  return `${md.l} nodal circles on the sphere: ${md.m} meridian${md.m === 1 ? '' : 's'} and ${md.l - md.m} latitude ring${md.l - md.m === 1 ? '' : 's'}`;
}

function plausibilityChecks(p, s) {
  const urban = !p.preset.arcology;
  const pct = (x) => `${(x * 100).toFixed(0)}%`;
  const out = [];
  const add = (id, label, value, status, basis) => out.push({ id, label, value, status, basis });
  if (urban) {
    add('street-share', 'Land given to streets', pct(s.roadShare),
      s.roadShare >= 0.25 && s.roadShare <= 0.4 ? 'pass' : 'warn', 'UN-Habitat: 30–35 % of urban land');
    add('street-density', 'Street density', `${s.streetDensity.toFixed(1)} km/km²`,
      s.streetDensity >= 18 ? 'pass' : 'warn', 'UN-Habitat: at least 18 km of street per km²');
    add('open-space', 'Parks and open space', pct(s.greenShare),
      s.greenShare >= 0.12 && s.greenShare <= 0.3 ? 'pass' : 'warn', 'UN-Habitat: 15–20 % open space');
    if (p.presetKey !== 'town') {
      add('density', 'Residents per hectare', `${s.densityPerHa.toFixed(0)}`,
        s.densityPerHa >= 150 ? 'pass' : 'warn', 'UN-Habitat: at least 150 people/ha');
    }
  }
  add('self-weight', 'Tallest structure vs. material limit', `${s.maxHeight.toFixed(0)} m of ${s.heightLimit.toFixed(0)} m`,
    s.maxHeight <= s.heightLimit + 1e-6 ? 'pass' : 'fail', `σ/(ρ·g·${SAFETY_FACTOR}) for the chosen material and gravity`);
  if (urban) {
    add('slenderness', 'Tower slenderness', `≤ 1:${s.slendernessLimit.toFixed(1)}`, 'pass',
      'Slender above 1:10–1:12; record about 1:24 (111 W 57th St)');
  }
  add('access', 'Buildings clear of roads, within reach of a street', 'enforced', 'pass', 'Setback from every road edge; lots beyond walking reach become green');
  return out;
}

// ---------------------------------------------------------------- export
// Wavefront OBJ of buildings (prisms) and roads (flat strips). y is up, units are metres.
export function toOBJ(layout) {
  const lines = [`# Cymatic City Engine ${ENGINE_VERSION}`,
    `# ${layout.meta.frequency} Hz (${layout.meta.note}) on ${layout.meta.plateLabel}, preset ${layout.meta.presetLabel}, seed ${layout.meta.seed}`];
  let vi = 1;
  const emit = (verts, faces, name) => {
    lines.push(`o ${name}`);
    for (const v of verts) lines.push(`v ${v[0].toFixed(3)} ${v[1].toFixed(3)} ${v[2].toFixed(3)}`);
    for (const f of faces) lines.push(`f ${f.map((i) => i + vi).join(' ')}`);
    vi += verts.length;
  };
  layout.buildings.forEach((b, idx) => {
    const { verts, faces } = buildingMesh(b);
    emit(verts, faces, `building_${idx}_${b.zone}${b.landmark ? '_landmark' : ''}`);
  });
  layout.roads.forEach((r, idx) => {
    const up = len3(r.a) > 1 && layout.meta.plate === 'sphere' ? norm3(add(r.a, r.b)) : [0, 1, 0];
    const dir = norm3(sub(r.b, r.a)), side = scale3(norm3(cross(up, dir)), r.w / 2), lift = scale3(up, 0.05);
    const verts = [add(add(r.a, side), lift), add(sub(r.a, side), lift), add(sub(r.b, side), lift), add(add(r.b, side), lift)];
    emit(verts, [[0, 1, 2, 3]], `road_${idx}_${r.kind}`);
  });
  return lines.join('\n') + '\n';
}

// Prism geometry in world space for one building (used by OBJ export).
export function buildingMesh(b) {
  const up = b.up, fwd = b.fwd, right = norm3(cross(fwd, up));
  const sides = b.shape === 'pod' || b.shape === 'dome' || b.shape === 'spire' ? 8 : 4;
  const topScale = b.shape === 'spire' ? 0.08 : b.shape === 'dome' ? 0.35 : b.shape === 'house' ? 0.6 : 1;
  const ring = (lift, s) => {
    const pts = [];
    for (let i = 0; i < sides; i++) {
      const t = sides === 4 ? [[-1, -1], [1, -1], [1, 1], [-1, 1]][i] : [Math.cos((TAU * i) / sides), Math.sin((TAU * i) / sides)];
      const x = (t[0] * b.w * s) / 2, z = (t[1] * b.d * s) / 2;
      pts.push(add(add(add(b.pos, scale3(fwd, x)), scale3(right, z)), scale3(up, lift)));
    }
    return pts;
  };
  const verts = [...ring(0, 1), ...ring(b.h, topScale)];
  const faces = [];
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    faces.push([i, j, sides + j, sides + i]);
  }
  faces.push([...Array(sides).keys()].reverse());
  faces.push([...Array(sides).keys()].map((i) => sides + i));
  return { verts, faces };
}

// Plain-data copy of a layout (drops the field functions).
export function toJSON(layout) {
  const { field, timingMs, ...rest } = layout;
  void field; void timingMs;
  return JSON.stringify(rest);
}

// Field only (no city) — for painting the plate under the city and the 2D sand figure.
export function fieldPreview(input = {}) {
  const p = resolveParams(input);
  const resp = drivenResponse(enumerateModes(p), p.frequency, p.Q);
  const field = makeField(p.plate, resp.active);
  const dom = makeDomain(p);
  sampleGrid(dom, field);
  return {
    at: field.at, toNorm: dom.toNorm, toWorld: dom.toWorld, inside: dom.inside,
    kind: dom.kind, shape: dom.shape, extent: dom.extent, Rs: dom.Rs ?? null, lo: dom.lo, hi: dom.hi,
  };
}

// ---------------------------------------------------------------- zip (store only)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
// files: [{ name, text }] → Uint8Array of a valid .zip (no compression, UTF-8 names)
export function zipStore(files) {
  const enc = new TextEncoder();
  const entries = files.map((f) => ({ name: enc.encode(f.name), data: f.bytes ?? enc.encode(f.text) }));
  const date = ((2026 - 1980) << 9) | (1 << 5) | 1, time = 0;
  let size = 22;
  for (const e of entries) size += 30 + e.name.length + e.data.length + 46 + e.name.length;
  const out = new Uint8Array(size), dv = new DataView(out.buffer);
  let o = 0;
  const u16 = (v) => { dv.setUint16(o, v, true); o += 2; }, u32 = (v) => { dv.setUint32(o, v >>> 0, true); o += 4; };
  for (const e of entries) {
    e.crc = crc32(e.data); e.offset = o;
    u32(0x04034b50); u16(20); u16(0x0800); u16(0); u16(time); u16(date);
    u32(e.crc); u32(e.data.length); u32(e.data.length); u16(e.name.length); u16(0);
    out.set(e.name, o); o += e.name.length; out.set(e.data, o); o += e.data.length;
  }
  const cd = o;
  for (const e of entries) {
    u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(0); u16(time); u16(date);
    u32(e.crc); u32(e.data.length); u32(e.data.length); u16(e.name.length); u16(0); u16(0); u16(0); u16(0); u32(0); u32(e.offset);
    out.set(e.name, o); o += e.name.length;
  }
  const cdSize = o - cd;
  u32(0x06054b50); u16(0); u16(0); u16(entries.length); u16(entries.length); u32(cdSize); u32(cd); u16(0);
  return out;
}
