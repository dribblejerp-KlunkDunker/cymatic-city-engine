// Cymatic City Engine
// frequency -> driven standing-wave field (Bessel / plate / spherical-harmonic modes)
//           -> streets on nodal lines and contour/gradient lines
//           -> districts, lots and buildings under planning and structural limits.
// Pure JavaScript, no dependencies; runs in the browser and in Node.

export const ENGINE_VERSION = '1.5.0';
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
const CIRCLE_MAX_M = 40, CIRCLE_MAX_N = 20, SQUARE_MAX = 20, SPHERE_MAX_L = 48;

// Square Chladni plate, corner coordinates x, y ∈ [0, 1]: zero edge slope for every (m, n).
const squareShape = (m, n, sign, x, y) =>
  Math.cos(n * Math.PI * x) * Math.cos(m * Math.PI * y) + sign * Math.cos(m * Math.PI * x) * Math.cos(n * Math.PI * y);

// Where the driver touches each plate, from a 0 (centre / near pole) – 1 (edge / equator side) offset.
export function drivePoint(plate, d) {
  if (plate === 'circle') return { r: d, theta: 0 };
  if (plate === 'square') return { x: 0.5 + 0.5 * d, y: 0.5 + 0.31 * d };
  return { theta: Math.PI * (0.15 + 0.7 * d), phi: 0 };
}

// Every mode the plate supports: frequency, mode-shape norm ∫φ² dA, and the shape's value at the drive point.
export function enumerateModes(opts = {}) {
  const plate = opts.plate ?? 'circle';
  const F = opts.fundamentalHz ?? PLATES[plate].defaultFundamental;
  const dp = drivePoint(plate, opts.driveOffset ?? (plate === 'square' ? 0 : 0.37));
  const modes = [];
  if (plate === 'circle') {
    const j01 = besselZeros(0, 1)[0];
    for (let m = 0; m <= CIRCLE_MAX_M; m++) {
      const zs = besselZeros(m, CIRCLE_MAX_N);
      for (let n = 1; n <= CIRCLE_MAX_N; n++) {
        const j = zs[n - 1];
        // ∫₀¹ J_m(j r)² r dr = J_{m+1}(j)²/2 at a zero of J_m; ∫cos²(mθ) = π (2π for m = 0)
        const norm = (m === 0 ? 2 * Math.PI : Math.PI) * 0.5 * besselJ(m + 1, j) ** 2;
        modes.push({ plate, m, n, j, f: (F * j) / j01, norm, coupling: besselJ(m, j * dp.r) * Math.cos(m * dp.theta) });
      }
    }
  } else if (plate === 'square') {
    const c = (k) => (k === 0 ? 1 : 0.5); // ∫₀¹ cos²(kπx) dx
    for (let n = 1; n <= SQUARE_MAX; n++) {
      for (let m = 0; m <= n; m++) {
        for (const sign of m === n ? [1] : [1, -1]) {
          const norm = m === n ? 4 * c(n) * c(n) : 2 * c(m) * c(n);
          modes.push({ plate, m, n, sign, f: F * (m * m + n * n), norm, coupling: squareShape(m, n, sign, dp.x, dp.y) });
        }
      }
    }
  } else if (plate === 'sphere') {
    // A perfect sphere's 2l+1 modes per degree are degenerate; a real body splits them. We keep one
    // azimuthal order m per degree (a symmetry-broken sphere) and couple it at the drive point.
    const az = opts.azimuthal;
    for (let l = 1; l <= SPHERE_MAX_L; l++) {
      const m = az == null || az === 'auto' ? Math.round(l * 0.5) : clamp(az | 0, 0, l);
      modes.push({ plate, l, m, n: l - m, f: (F * Math.sqrt(l * (l + 1))) / Math.SQRT2, norm: 1, coupling: realSphericalHarmonic(l, m, dp.theta, dp.phi) });
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

// Damped, driven modal superposition. In the orthonormal basis φ̂ = φ/√N each mode's amplitude is
// α_k = φ̂_k(drive) / (f_k² − f² + i f_k f / Q). The pattern is shown at the phase ψ that holds the
// most motion (ψ = ½ arg Σα²); what is left over is the quadrature part that blurs the nodal lines.
export function drivenResponse(modes, f, Q = 100, opts = {}) {
  const keepRatio = opts.keepRatio ?? 0.12, maxModes = opts.maxModes ?? 5;
  const scored = [];
  for (const md of modes) {
    const d = md.f * md.f - f * f, g = (md.f * f) / Q;
    const den = d * d + g * g;
    const c = md.coupling / Math.sqrt(md.norm);
    const re = (c * d) / den, im = (-c * g) / den;
    const mag = Math.hypot(re, im);
    if (mag > 1e-12 * Math.abs(1 / den) && Number.isFinite(mag)) scored.push({ md, re, im, mag });
  }
  scored.sort((a, b) => b.mag - a.mag);
  if (!scored.length) throw new Error('The drive point sits on a node of every mode; move the drive point');
  const top = scored[0];
  const kept = [];
  for (const sc of scored) {
    if (kept.length >= maxModes || sc.mag < keepRatio * top.mag) break;
    kept.push(sc);
  }
  let sr = 0, si = 0;
  for (const k of kept) { sr += (k.re * k.re - k.im * k.im) / (top.mag * top.mag); si += (2 * k.re * k.im) / (top.mag * top.mag); }
  const psi = 0.5 * Math.atan2(si, sr);
  const cs = Math.cos(psi), sn = Math.sin(psi);
  let inPhase = 0, total = 0;
  const active = kept.map((sc) => {
    const ar = (sc.re * cs + sc.im * sn) / top.mag, ai = (sc.im * cs - sc.re * sn) / top.mag;
    inPhase += ar * ar; total += ar * ar + ai * ai;
    const k = 1 / Math.sqrt(sc.md.norm); // back to the un-normalized shapes the field evaluates
    return { ...sc.md, weight: sc.mag / top.mag, cr: ar * k, ci: ai * k, detuneHz: f - sc.md.f };
  });
  return { active, psi, sharpness: total > 0 ? inPhase / total : 1 };
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
      else if (plate === 'square') phi = squareShape(md.m, md.n, md.sign, u + 0.5, v + 0.5);
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

// A chord's field. Each voice is driven on its own and normalised to its own peak (sampleGrid sets the scale).
// The amplitude is the time-averaged motion √Σ (w·A_v)², which is what sand on a plate driven by two incommensurate
// tones responds to; the signed field keeps the sign of the in-phase superposition Σ w·S_v (the plate's shape when
// the voices align), clipped to that envelope where the snapshot would exceed it. Q is chosen so that hypot(S, Q)
// is the amplitude, so the grid sampler needs no special case.
function makeChordField(voices) {
  let k = 1;
  function raw(u, v) {
    let S = 0, E = 0;
    for (const { field, weight } of voices) { const { S: sv, A: av } = field.at(u, v); S += weight * sv; E += weight * weight * av * av; }
    const env = Math.sqrt(E);
    if (Math.abs(S) > env) S = Math.sign(S) * env;
    return [S, Math.sqrt(Math.max(0, E - S * S))];
  }
  return {
    raw,
    setScale(s) { k = s; },
    at(u, v) { const [S, Qd] = raw(u, v); return { S: S * k, A: Math.hypot(S, Qd) * k }; },
    S(u, v) { return raw(u, v)[0] * k; },
    voices,
  };
}
// Resolve the field(s) for a parameter set: one voice or a chord.
function resolveFields(p) {
  const modes = enumerateModes(p);
  if (!p.chord) {
    const resp = drivenResponse(modes, p.frequency, p.Q);
    return { field: makeField(p.plate, resp.active), resp, voices: null };
  }
  const dom = makeDomain(p);
  const voices = p.chord.map(({ hz, weight }) => {
    const resp = drivenResponse(modes, hz, p.Q);
    const field = makeField(p.plate, resp.active);
    const grid = sampleGrid(dom, field); // normalises the voice to its own peak
    // envelope radius: half the voice's own nodal spacing (area / length of its sand lines)
    let nodal = 0;
    for (const [a, b] of marchingSquares(grid, 0)) nodal += len3(sub(gridPt(dom, grid, b), gridPt(dom, grid, a)));
    const spacing = nodal > 0 ? dom.area / nodal : dom.extent;
    return { hz, weight, resp, field, grid, env: makeEnvelope(dom, grid, 0.5 * spacing) };
  });
  const field = makeChordField(voices);
  // the chord's sharpness is the weighted mean of its voices'
  const wsum = voices.reduce((s, v) => s + v.weight, 0);
  const resp = { active: voices[0].resp.active, psi: voices[0].resp.psi, sharpness: voices.reduce((s, v) => s + v.weight * v.resp.sharpness, 0) / wsum };
  return { field, resp, voices };
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
// A material is a key into MATERIALS or a custom { label, sigma (Pa), rho (kg/m³) }.
export function resolveMaterial(m, fallback) {
  if (m && typeof m === 'object') {
    const sigma = Number(m.sigma), rho = Number(m.rho);
    if (!(sigma > 0) || !(rho > 0)) throw new Error('A custom material needs a positive compressive strength (sigma, Pa) and density (rho, kg/m³)');
    return { key: 'custom', label: String(m.label ?? 'Custom material'), sigma, rho, speculative: true };
  }
  const key = m && MATERIALS[m] ? m : fallback;
  return { key, ...MATERIALS[key] };
}
export function heightLimit(material, gravityRel) {
  const mat = typeof material === 'string' ? MATERIALS[material] : resolveMaterial(material, 'concrete');
  return mat.sigma / (mat.rho * G0 * gravityRel * SAFETY_FACTOR);
}
// Slenderness allowance grows as self-buckling eases with lower gravity (Greenhill, ∝ g^-1/3).
export function slendernessLimit(base, gravityRel) {
  return Math.min(40, base * Math.pow(1 / gravityRel, 1 / 3));
}

// Fields a custom preset may override, with their allowed ranges.
export const CUSTOM_FIELDS = {
  radius: { label: 'World radius (m)', min: 150, max: 20000 },
  lot: { label: 'Lot size (m)', min: 10, max: 120 },
  floorH: { label: 'Floor height (m)', min: 2.2, max: 12 },
  floorsMin: { label: 'Fewest floors', min: 1, max: 50 },
  floorsMax: { label: 'Most floors (outside the core)', min: 1, max: 200 },
  coreFloors: { label: 'Core tower floors', min: 1, max: 1000 },
  streetSpacing: { label: 'Street spacing (m)', min: 30, max: 400 },
  slender: { label: 'Slenderness limit (1:n)', min: 1, max: 40 },
  designHeight: { label: 'Arcology design height (m)', min: 20, max: 5000 },
  terraceFloors: { label: 'Floors per terrace step', min: 1, max: 20 },
};
// Build a preset from a base preset plus overrides: { base: 'city', radius: 5000, floorsMax: 30, ... }
export function customPreset(spec = {}) {
  const base = PRESETS[spec.base ?? 'city'];
  if (!base) throw new Error(`Unknown base preset "${spec.base}"`);
  const pr = { ...base, widths: { ...base.widths }, floors: base.floors ? [...base.floors] : undefined, label: String(spec.label ?? `Custom ${base.label.toLowerCase()}`), custom: true, base: spec.base ?? 'city' };
  for (const [k, f] of Object.entries(CUSTOM_FIELDS)) {
    if (spec[k] == null || spec[k] === '') continue;
    const v = Number(spec[k]);
    if (!Number.isFinite(v)) throw new Error(`${f.label} must be a number`);
    const c = clamp(v, f.min, f.max);
    if (k === 'floorsMin') pr.floors = [c, pr.floors?.[1] ?? c]; else if (k === 'floorsMax') pr.floors = [pr.floors?.[0] ?? 1, c]; else pr[k] = c;
  }
  if (pr.floors) pr.floors = [Math.min(pr.floors[0], pr.floors[1]), Math.max(pr.floors[0], pr.floors[1])];
  if (spec.arcology != null) pr.arcology = !!spec.arcology;
  if (spec.style && PRESET_STYLES.includes(spec.style)) pr.style = spec.style;
  if (spec.gravity != null) pr.gravity = clamp(Number(spec.gravity), 0.05, 5);
  if (spec.material) pr.material = spec.material;
  // street widths scale with the street spacing of the base preset
  const k = pr.streetSpacing && base.streetSpacing ? clamp(pr.streetSpacing / base.streetSpacing, 0.5, 2) : 1;
  for (const w of Object.keys(pr.widths)) pr.widths[w] = base.widths[w] * k;
  return pr;
}
export const PRESET_STYLES = ['town', 'city', 'mega', 'alien'];

export function resolveParams(input = {}) {
  const plate = input.plate ?? 'circle';
  let presetKey = input.preset ?? 'city', preset;
  if (presetKey && typeof presetKey === 'object') { preset = customPreset(presetKey); presetKey = 'custom'; }
  else if (presetKey === 'custom') { preset = customPreset(input.custom ?? {}); }
  else preset = PRESETS[presetKey];
  if (!PLATES[plate]) throw new Error(`Unknown plate "${plate}"`);
  if (!preset) throw new Error(`Unknown preset "${presetKey}"`);
  const num = (v, name) => { const x = Number(v); if (!Number.isFinite(x)) throw new Error(`${name} must be a number`); return x; };
  const fundamentalHz = num(input.fundamentalHz ?? PLATES[plate].defaultFundamental, 'Lowest-mode frequency');
  if (fundamentalHz <= 0) throw new Error('Lowest-mode frequency must be above 0 Hz');
  const [lo, hi] = frequencyRange(plate, fundamentalHz);
  const checkHz = (f, name) => {
    if (!(f > 0)) throw new Error(`${name} must be a positive number of hertz`);
    if (f < lo - 0.01 || f > hi + 0.01) throw new Error(`${f} Hz is outside this plate's modelled range (${lo.toFixed(1)}–${hi.toFixed(1)} Hz). Change the lowest-mode frequency to move the range.`);
    return clamp(f, lo, hi);
  };
  // a chord: two or three drive frequencies sounding together; the first voice is the frequency the city is named for
  let chord = null;
  if (input.chord != null) {
    if (!Array.isArray(input.chord) || input.chord.length < 1 || input.chord.length > MAX_VOICES) throw new Error(`A chord is a list of 1 to ${MAX_VOICES} frequencies`);
    chord = input.chord.map((v, i) => {
      const hz = num(typeof v === 'object' && v !== null ? v.hz : v, `Voice ${i + 1}`);
      const weight = typeof v === 'object' && v !== null && v.weight != null ? num(v.weight, `Voice ${i + 1} weight`) : 1;
      if (!(weight >= 0.01) || weight > 1) throw new Error(`Voice ${i + 1} weight must be between 0.01 and 1`);
      return { hz: checkHz(hz, `Voice ${i + 1}`), weight };
    });
    // two voices within 1 % of each other drive the same modes: they would lay the same streets twice
    for (let i = 0; i < chord.length; i++) for (let j = 0; j < i; j++) {
      if (Math.abs(chord[i].hz - chord[j].hz) < 0.01 * Math.min(chord[i].hz, chord[j].hz)) throw new Error(`Voices ${j + 1} and ${i + 1} (${chord[j].hz} and ${chord[i].hz} Hz) are within 1 % of each other; a chord needs distinct voices`);
    }
  }
  let frequency;
  if (chord && chord.length === 1) { frequency = chord[0].hz; chord = null; } // a chord of one is the plain frequency
  else frequency = chord ? chord[0].hz : checkHz(num(input.frequency ?? 432, 'Frequency'), 'Frequency');
  const driveOffset = num(input.driveOffset ?? (plate === 'square' ? 0 : 0.37), 'Drive point');
  if (driveOffset < 0 || driveOffset > 0.95) throw new Error('Drive point must be between 0 (centre) and 0.95 (near the edge)');
  const az = input.azimuthal ?? 'auto';
  if (az !== 'auto' && !(Number.isInteger(az) && az >= 0)) throw new Error('Sphere meridian count must be "auto" or a whole number ≥ 0');
  const material = resolveMaterial(input.material ?? preset.material, preset.custom ? 'concrete' : preset.material);
  return {
    frequency, plate, presetKey, preset, fundamentalHz, driveOffset, azimuthal: az,
    seed: (input.seed ?? 1) >>> 0,
    Q: clamp(num(input.Q ?? 100, 'Q'), 2, 1000),
    gravity: clamp(num(input.gravity ?? preset.gravity, 'Gravity'), 0.05, 5),
    material: material.key, materialSpec: material,
    // enforce: physical limits cap the buildings (realism); false reports them as checks only (fantasy)
    enforce: input.enforce !== false,
    inverse: !!input.inverse,
    terrain: resolveTerrain(input.terrain),
    chord,
  };
}
export const MAX_VOICES = 3;
// A voice lays streets where it moves the plate at least this close to the strongest voice there (w·A within 15 %):
// its own territory plus a narrow band where the voices overlap, so their street networks cross and join.
export const VOICE_BAND = 0.15;
// Which voice shapes a point: the lot's own era is the voice that moves the plate most right under it.
function voiceStrengths(voices, u, v) { return voices.map((vc) => vc.weight * vc.field.at(u, v).A); }
function dominantVoice(voices, u, v) { const w = voiceStrengths(voices, u, v); let best = 0; for (let i = 1; i < w.length; i++) if (w[i] > w[best]) best = i; return best; }
// Streets are judged by each voice's envelope instead: how strongly it vibrates in the neighbourhood (the local
// maximum of its amplitude within half its nodal spacing). Its own sand lines, where its amplitude is zero, still
// belong to it wherever the lobes on either side are its.
function voiceEnvelopes(voices, u, v) { return voices.map((vc) => vc.weight * vc.env(u, v)); }
function dominantEnvelope(voices, u, v) { const w = voiceEnvelopes(voices, u, v); let best = 0; for (let i = 1; i < w.length; i++) if (w[i] > w[best]) best = i; return best; }
function inTerritory(voices, i, u, v) { const w = voiceEnvelopes(voices, u, v); return w[i] >= (1 - VOICE_BAND) * Math.max(...w); }
// Max-filter a voice's amplitude grid over a radius in metres; returns a lookup env(u, v).
function makeEnvelope(dom, g, radius) {
  const { ni, nj, W, S, Qd } = g, n = (ni + 1) * W;
  const A = new Float64Array(n); for (let id = 0; id < n; id++) A[id] = Math.hypot(S[id], Qd[id]);
  const tmp = new Float64Array(n), out = new Float64Array(n);
  const sphere = dom.kind === 'sphere';
  const cellI = sphere ? (Math.PI * dom.Rs) / ni : (dom.scale * (dom.hi - dom.lo)) / ni;
  const Ri = Math.max(1, Math.round(radius / cellI));
  // along j (rows): on the sphere the cell narrows with sin θ, and longitude wraps
  for (let i = 0; i <= ni; i++) {
    let Rj;
    if (sphere) { const sinT = Math.max(0.05, Math.sin((Math.PI * i) / ni)); Rj = Math.min(nj >> 1, Math.max(1, Math.round(radius / ((TAU * dom.Rs * sinT) / nj)))); }
    else Rj = Math.max(1, Math.round(radius / ((dom.scale * (dom.hi - dom.lo)) / nj)));
    for (let j = 0; j <= nj; j++) {
      let m = 0;
      for (let k = -Rj; k <= Rj; k++) {
        let jj = j + k;
        if (sphere) jj = ((jj % nj) + nj) % nj; else if (jj < 0 || jj > nj) continue;
        m = Math.max(m, A[i * W + jj]);
      }
      tmp[i * W + j] = m;
    }
  }
  for (let i = 0; i <= ni; i++) for (let j = 0; j <= nj; j++) {
    let m = 0;
    for (let k = Math.max(0, i - Ri); k <= Math.min(ni, i + Ri); k++) m = Math.max(m, tmp[k * W + j]);
    out[i * W + j] = m;
  }
  return (u, v) => {
    let i, j;
    if (sphere) { i = Math.round((clamp(u, 0, Math.PI) / Math.PI) * ni); j = ((Math.round((v / TAU) * nj) % nj) + nj) % nj; }
    else { i = clamp(Math.round(((u - dom.lo) / (dom.hi - dom.lo)) * ni), 0, ni); j = clamp(Math.round(((v - dom.lo) / (dom.hi - dom.lo)) * nj), 0, nj); }
    return out[i * W + j];
  };
}

// Terrain: flat (default), relief (lobes rise and sink with the wave: hills and basins, basins may flood),
// valleys (every lobe is a hill, the nodal lines are valleys; optional canals), or an imported heightmap.
export const TERRAIN_MODES = ['flat', 'relief', 'valleys', 'heightmap'];
export function resolveTerrain(t) {
  if (!t || t === 'flat') return { mode: 'flat', relief: 0, waterLevel: -Infinity, canals: false, heightmap: null };
  const spec = typeof t === 'string' ? { mode: t } : t;
  const mode = TERRAIN_MODES.includes(spec.mode) ? spec.mode : 'flat';
  if (mode === 'flat') return { mode, relief: 0, waterLevel: -Infinity, canals: false, heightmap: null };
  let heightmap = null;
  if (mode === 'heightmap') {
    const h = spec.heightmap;
    if (!h || !(h.width > 1) || !(h.height > 1) || !h.data || h.data.length < h.width * h.height) throw new Error('A heightmap needs width, height and data (row-major values in 0..1)');
    const n = (h.width | 0) * (h.height | 0), data = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = Number(h.data[i]); if (!Number.isFinite(x)) throw new Error(`Heightmap value ${i} is not a number`); data[i] = clamp(x, 0, 1); }
    heightmap = { width: h.width | 0, height: h.height | 0, data };
  }
  const relief = spec.relief == null || spec.relief === 'auto' ? 'auto' : clamp(Number(spec.relief), 0, 2000);
  if (relief !== 'auto' && !Number.isFinite(relief)) throw new Error('Relief must be a number of metres or "auto"');
  const waterLevel = spec.waterLevel == null || spec.waterLevel === 'auto' ? 'auto' : Number(spec.waterLevel);
  if (waterLevel !== 'auto' && !Number.isFinite(waterLevel)) throw new Error('Water level must be a number of metres or "auto"');
  return { mode, relief, waterLevel, canals: !!spec.canals, heightmap };
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
function buildRoads(p, dom, field, g, opts = {}) {
  const pr = p.preset, roads = [], share = opts.share ?? 1, era = opts.era ?? null, withWall = opts.wall !== false;
  // a voice keeps only the segments in its territory (judged at the midpoint); a single frequency keeps everything
  const keep = opts.keep ?? null;
  const kept = (A, B) => { if (!keep) return true; const [u, v] = dom.toNorm(scale3(add(A, B), 0.5)); return keep(u, v); };
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
      if (L < 1e-6 || !kept(A, B)) continue;
      const r = { a: A, b: B, w, kind }; if (era != null) r.era = era;
      roads.push(r); total += L;
    }
    return total;
  };

  // 1. nodal lines → boulevards (sand lines of the Chladni figure)
  const probe = marchingSquares(g, 0).reduce((s, [a, b]) => s + len3(sub(gridPoint(b), gridPoint(a))), 0);
  const nodalSpacing = probe > 0 ? dom.area / probe : Infinity;
  const wBoulevard = Math.max(6, Math.min(pr.widths.boulevard, nodalSpacing * 0.12));
  addContour(0, 'boulevard', wBoulevard);

  const targetLength = pr.arcology ? 0 : ((dom.area * 2) / pr.streetSpacing) * share; // UN-Habitat ≥ 18 km/km² ≈ 2/111 m
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

  // 3. perimeter road / wall
  if (dom.kind === 'plane' && withWall) {
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
    for (let i = 1; i < pts.length; i++) {
      // in a chord each stretch of the perimeter belongs to the voice that shapes it there (no overlap band: one wall)
      if (opts.ownWall && !opts.ownWall(scale3(add(pts[i - 1], pts[i]), 0.5))) continue;
      const r = { a: pts[i - 1], b: pts[i], w: pr.widths.wall, kind: 'wall' }; if (era != null) r.era = era; roads.push(r);
    }
  }
  // 4. gradient spokes (minor hyperstreamlines) toward the antinodes, seeded on the nodal lines first,
  //    then on the rings and the wall, so low modes with no interior nodal line still get connected streets
  let spokeSpacing = null;
  if (!pr.arcology) {
    const base = roads.slice();
    const order = { boulevard: 0, ring: 1, wall: 2 };
    const seeds = base.slice().sort((x, y) => order[x.kind] - order[y.kind]).map((r) => scale3(add(r.a, r.b), 0.5));
    let dsep = pr.streetSpacing * 2.5;
    let spokes = [];
    for (let iter = 0; iter < 5; iter++) {
      spokes = traceSpokes(dom, field, seeds, dsep, pr, keep);
      if (keep) spokes = spokes.filter((r) => kept(r.a, r.b));
      if (era != null) for (const r of spokes) r.era = era;
      const total = base.reduce((s, r) => s + len3(sub(r.b, r.a)), 0) + spokes.reduce((s, r) => s + len3(sub(r.b, r.a)), 0);
      spokeSpacing = dsep;
      if (total >= targetLength) break;
      dsep *= 0.7;
    }
    roads.push(...spokes);
  }

  return { roads, nodalSpacing, ringLevels, spokeSpacing, targetLength, wBoulevard };
}

function traceSpokes(dom, field, seeds, dsep, pr, keep = null) {
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
        if (keep && !keep(un, vn)) break; // a chord voice's spoke ends where its territory does
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

// ---------------------------------------------------------------- arcology helpers
class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = [k[0], v[0]], lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0; const n = k.length;
      for (;;) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}
// Neighbouring lot indices (4-neighbours on the plane grid, nearest ring on the sphere lattice).
// `missing` marks cells at the plate edge, whose outside neighbour does not exist.
function neighbourLists(dom, lots, L) {
  const out = lots.map(() => []);
  if (dom.kind === 'plane') {
    const key = (P) => `${Math.round((P[0] + dom.extent) / L)},${Math.round((P[2] + dom.extent) / L)}`;
    const idx = new Map(lots.map((l, i) => [key(l.P), i]));
    lots.forEach((l, i) => {
      const [a, b] = key(l.P).split(',').map(Number);
      let missing = false;
      for (const [x, z] of [[a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]]) {
        const j = idx.get(`${x},${z}`);
        if (j === undefined) missing = true; else out[i].push(j);
      }
      out[i].missing = missing;
    });
    return out;
  }
  const c = 1.5 * L, grid = new Map();
  const k3 = (P) => `${Math.floor(P[0] / c)},${Math.floor(P[1] / c)},${Math.floor(P[2] / c)}`;
  lots.forEach((l, i) => { const k = k3(l.P); (grid.get(k) ?? grid.set(k, []).get(k)).push(i); });
  lots.forEach((l, i) => {
    const [x0, y0, z0] = l.P.map((v) => Math.floor(v / c));
    for (let x = x0 - 1; x <= x0 + 1; x++) for (let y = y0 - 1; y <= y0 + 1; y++) for (let z = z0 - 1; z <= z0 + 1; z++)
      for (const j of grid.get(`${x},${y},${z}`) ?? []) if (j !== i && len3(sub(lots[j].P, l.P)) < c) out[i].push(j);
    out[i].missing = false;
  });
  return out;
}

// Smallest distance from a footprint's outline (sampled every `step` m) to any road edge.
function footprintClearance(hash, b, step) {
  const right = cross(b.fwd, b.up);
  const at = (x, z) => add(add(b.pos, scale3(b.fwd, x)), scale3(right, z));
  let best = hash.clearance(b.pos);
  const nx = Math.max(1, Math.ceil(b.w / step)), nz = Math.max(1, Math.ceil(b.d / step));
  for (let i = 0; i <= nx; i++) { const x = -b.w / 2 + (b.w * i) / nx; best = Math.min(best, hash.clearance(at(x, b.d / 2)), hash.clearance(at(x, -b.d / 2))); }
  for (let k = 1; k < nz; k++) { const z = -b.d / 2 + (b.d * k) / nz; best = Math.min(best, hash.clearance(at(b.w / 2, z)), hash.clearance(at(-b.w / 2, z))); }
  return best;
}

// Largest height difference between a terrace cell and any neighbour (open cells and the plate edge count as 0 m).
function maxTerraceStep(dom, buildings, L, terrain = null) {
  if (!buildings.length) return 0;
  // ground level of the lowest open cell beside a terrace (recorded when the terraces were cut)
  const openGround = (b) => (!terrain || terrain.mode === 'flat' ? 0 : b.openGround ?? b.elevation ?? 0);
  // neighbours are found in plan; on terrain the exposed face includes the ground step between the two lots
  const planOf = dom.kind === 'plane' ? (P) => [P[0], 0, P[2]] : (P) => scale3(norm3(P), dom.Rs);
  const lots = buildings.map((b) => ({ P: planOf(b.pos) }));
  const nb = neighbourLists(dom, lots, L);
  const top = (b) => b.h + (b.elevation ?? 0);
  let worst = 0;
  buildings.forEach((b, i) => {
    let low = nb[i].missing ? openGround(b) : Infinity;
    const expected = dom.kind === 'plane' ? 4 : 0;
    if (dom.kind === 'plane' && nb[i].length < expected) low = openGround(b);
    for (const j of nb[i]) low = Math.min(low, top(buildings[j]));
    if (dom.kind === 'sphere' && nb[i].length < 4) low = openGround(b);
    if (low === Infinity) low = openGround(b);
    worst = Math.max(worst, top(b) - low);
  });
  return worst;
}

// ---------------------------------------------------------------- terrain
// A relief that keeps streets walkable: a fraction of the nodal spacing, never more than 5 % of the plate.
export function autoRelief(dom, nodalSpacing) {
  return clamp(0.04 * (Number.isFinite(nodalSpacing) ? nodalSpacing : dom.extent / 4), 4, 0.05 * dom.extent);
}
// place a plan point at an explicit elevation
function liftTo(dom, P, zv) {
  if (dom.kind === 'plane') return [P[0], zv, P[2]];
  const k = (dom.Rs + zv) / len3(P); return [P[0] * k, P[1] * k, P[2] * k];
}
// Steepest slope (per metre) of a normalised height function over the plate, from every second grid point.
export function maxFieldSlope(dom, zNorm, grid) {
  let m = 0;
  const h = 1e-3;
  for (let i = 0; i <= grid.ni; i += 2) for (let j = 0; j <= grid.nj; j += 2) {
    if (!grid.valid[i * grid.W + j]) continue;
    const [u, v] = grid.coord(i, j);
    let gu, gv;
    if (dom.kind === 'sphere') {
      if (u < 0.05 || u > Math.PI - 0.05) continue;
      gu = (zNorm(u + h, v) - zNorm(u - h, v)) / (2 * h * dom.Rs);
      gv = (zNorm(u, v + h) - zNorm(u, v - h)) / (2 * h * dom.Rs * Math.sin(u));
    } else {
      const mPerUnit = dom.scale; // toWorld maps one unit of u to dom.scale metres on both plane shapes
      if (!dom.inside(u + h, v) || !dom.inside(u - h, v) || !dom.inside(u, v + h) || !dom.inside(u, v - h)) continue;
      gu = (zNorm(u + h, v) - zNorm(u - h, v)) / (2 * h * mPerUnit);
      gv = (zNorm(u, v + h) - zNorm(u, v - h)) / (2 * h * mPerUnit);
    }
    m = Math.max(m, Math.hypot(gu, gv));
  }
  return m;
}
export const MAX_AUTO_GRADE = 0.09; // the automatic relief keeps the steepest ground under this (local streets ≤ 10 %)
// Amplitude below which the valleys flood into canals: the lowest `share` of the plate by amplitude, so canals stay
// a network of channels on every mode rather than swallowing a low mode's wide flat bands.
export function canalAmplitude(field, grid, share = 0.08) {
  if (!grid) return 0.05;
  const vals = [];
  for (let i = 0; i <= grid.ni; i += 2) for (let j = 0; j <= grid.nj; j += 2) { const id = i * grid.W + j; if (!grid.valid[id]) continue; const [u, v] = grid.coord(i, j); vals.push(field.at(u, v).A); }
  vals.sort((a, b) => a - b);
  return clamp(vals[Math.floor(share * (vals.length - 1))] ?? 0.05, 0.005, 0.15);
}
export function makeTerrain(p, field, dom, nodalSpacing, grid = null) {
  const t = p.terrain;
  if (t.mode === 'flat') return { mode: 'flat', relief: 0, waterLevel: -Infinity, shore: 0, z: () => 0, lift: (P) => P, elevOf: () => 0, waterAt: () => false };
  let zNorm; // −1..1 over the plate
  if (t.mode === 'relief') zNorm = (u, v) => field.S(u, v);
  else if (t.mode === 'valleys') zNorm = (u, v) => 2 * field.at(u, v).A - 1;
  else {
    const { width: W, height: H, data } = t.heightmap;
    const wrap = dom.kind === 'sphere'; // longitude wraps: the last column blends into the first
    zNorm = (u, v) => {
      // plate coordinates → unit square (sphere: θ/π, φ/2π)
      const x = wrap ? ((v / TAU) % 1 + 1) % 1 : (u - dom.lo) / (dom.hi - dom.lo);
      const y = wrap ? u / Math.PI : (v - dom.lo) / (dom.hi - dom.lo);
      const fx = wrap ? x * W : clamp(x, 0, 1) * (W - 1), fy = clamp(y, 0, 1) * (H - 1);
      const x0 = Math.min(W - 1, Math.floor(fx)), y0 = Math.floor(fy), x1 = wrap ? (x0 + 1) % W : Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
      const a = data[y0 * W + x0], b = data[y0 * W + x1], c = data[y1 * W + x0], d = data[y1 * W + x1];
      return 2 * ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty) - 1;
    };
  }
  let relief = t.relief;
  if (relief === 'auto') {
    // a fraction of the nodal spacing, then held down so the ground itself never exceeds the street grade limit;
    // valleys fold the wave (|S|), which doubles the slopes, so they start from half (never under 2 m)
    relief = t.mode === 'valleys' ? Math.max(2, 0.5 * autoRelief(dom, nodalSpacing)) : autoRelief(dom, nodalSpacing);
    if (grid) {
      const slope = maxFieldSlope(dom, zNorm, grid);
      if (slope > 0) relief = Math.max(1.5, Math.min(relief, MAX_AUTO_GRADE / slope));
    }
  }
  const z = (u, v) => relief * zNorm(u, v);
  const waterLevel = t.waterLevel !== 'auto' ? t.waterLevel
    : t.mode === 'relief' ? -0.5 * relief : t.mode === 'valleys' ? (t.canals ? relief * (2 * canalAmplitude(field, grid) - 1) : -Infinity) : -0.6 * relief;
  // freeboard: shore streets are embanked to this height above the water and bridges deck at it;
  // no building stands below it either (half a metre on a gentle relief, up to three metres; a near-flat relief
  // keeps the freeboard a fraction of itself so the shore band cannot swallow the whole plate)
  const shore = clamp(0.15 * relief, Math.min(0.5, 0.25 * relief), 3);
  const lift = dom.kind === 'plane'
    ? (P) => { const [u, v] = dom.toNorm(P); return [P[0], z(u, v), P[2]]; }
    : (P) => { const [u, v] = dom.toNorm(P); const k = (dom.Rs + z(u, v)) / len3(P); return [P[0] * k, P[1] * k, P[2] * k]; }; // exactly Rs + z from the centre
  const elevOf = dom.kind === 'plane' ? (P) => P[1] : (P) => len3(P) - dom.Rs;
  return { mode: t.mode, relief, waterLevel, shore, z, lift, elevOf, waterAt: (u, v) => z(u, v) < waterLevel };
}

// ---------------------------------------------------------------- city
export function generateCity(input = {}) {
  const t0 = Date.now();
  const p = resolveParams(input);
  const pr = p.preset;
  const { field, resp, voices } = resolveFields(p);
  const dom = makeDomain(p);
  const grid = sampleGrid(dom, field);
  const districts = labelDistricts(grid);
  let rd;
  if (!voices) rd = buildRoads(p, dom, field, grid);
  else {
    // each voice lays its own streets (nodal boulevards, rings, spokes) as one era of the city, but only where it
    // shapes the plate (its territory, plus a narrow overlap band so the networks cross and join); its street
    // budget is its share of the plate, so a faint voice lays little and a chord tends to its loudest voice
    const territory = voiceTerritories(voices, grid);
    const parts = voices.map((v, i) => buildRoads(p, dom, v.field, v.grid, { share: territory[i], era: i, wall: true, ownWall: (P) => { const [u, vv] = dom.toNorm(P); return dominantEnvelope(voices, u, vv) === i; }, keep: (u, vv) => inTerritory(voices, i, u, vv) }));
    rd = { ...parts[0], roads: dropFragments(parts.flatMap((x) => x.roads), FRAGMENT_MIN), targetLength: parts.reduce((s, x) => s + x.targetLength, 0) };
    rd.nodalSpacing = Math.min(...parts.map((x) => x.nodalSpacing));
  }
  // which voice built a lot: the one that moves the plate most there
  const eraAt = voices ? (u, v) => dominantVoice(voices, u, v) : null;
  const maxW = Math.max(...Object.values(pr.widths));
  const access = pr.arcology ? Infinity : pr.streetSpacing * 0.8; // every building within reach of a street
  const planar = dom.kind === 'plane';
  const hash = new SegmentHash(pr.lot * 1.6 + maxW, planar);          // footprint fitting
  const reach = new SegmentHash((pr.arcology ? pr.lot : access) + maxW, planar); // walking reach
  for (const r of rd.roads) { hash.insert(r); reach.insert(r); }

  const rng = mulberry32(p.seed * 2654435761 + 17);
  const hLimit = heightLimit(p.materialSpec, p.gravity);
  const sLimit = pr.arcology ? Infinity : slendernessLimit(pr.slender, p.gravity);
  // with enforcement off the limits are only reported, never applied
  const hMat = p.enforce ? hLimit : Infinity, slender = p.enforce ? sLimit : Infinity;
  const coreFloorsCap = p.enforce ? CORE_FLOORS : Infinity;
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
  let terraceRise = null;
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

  // terrain is decided before the lots: an arcology's terraces are measured from the ground under them
  const terrain = makeTerrain(p, field, dom, rd.nodalSpacing, grid);
  if (pr.arcology) {
    // One continuous terraced structure; nodal lines are open canyons, antinodes rise highest.
    // On a sphere the terraces form a shell; keep it under a quarter of the radius so it stays a crust, not spikes.
    const shellCap = dom.kind === 'sphere' ? 0.25 * dom.Rs : Infinity;
    const H = Math.min(pr.designHeight, hMat, shellCap);
    const step = pr.terraceFloors * pr.floorH;
    const lots = lotCandidates(dom, pr.lot, rng, 0);
    const foot = dom.kind === 'plane' ? pr.lot * 0.97 : pr.lot * 0.58;
    const hTop = Math.max(step, Math.floor(H / step) * step);
    const cellOf = []; // building index per candidate, −1 when the cell stays open (canyon, plaza, edge)
    for (const { P, u, v } of lots) {
      const { S, A } = field.at(u, v);
      const amp = p.inverse ? 1 - A : A;
      const c = hash.clearance(P);
      if (c < foot * 0.71 + 1) { roadLots++; cellOf.push(-1); continue; }
      if (amp < 0.06) { greenLots++; trees.push({ pos: P, up: upAt(dom, P), s: 1 + rng() }); cellOf.push(-1); continue; }
      const want = pr.designHeight * Math.pow(amp * (0.94 + 0.12 * rng()), 1.15);
      const h = clamp(Math.round(want / step) * step, step, hTop);
      if (h === hTop && want > hTop + step / 2 && H === hMat) binding.material++;
      const { up, fwd } = frame(P, u, v);
      cellOf.push(buildings.length);
      buildings.push({
        pos: P, up, fwd, w: foot, d: foot, h, floors: Math.round(h / pr.floorH), zone: zoneOf(amp),
        shape: 'terrace', polarity: S >= 0 ? 1 : -1, amp, district: districtAt(u, v), landmark: false,
        ...(eraAt ? { era: eraAt(u, v) } : {}),
      });
    }
    // Terracing: no cell may rise more than `rise` above any neighbour (an open cell counts as 0 m),
    // so every exposed face keeps the slenderness of a real tower. Dijkstra from the low cells.
    terraceRise = p.enforce ? Math.max(step, Math.floor((slendernessLimit(8, p.gravity) * foot) / step) * step) : Infinity;
    const nbrs = neighbourLists(dom, lots, pr.lot);
    // the faces are measured between terrace tops, so on terrain the ground step under each cell counts
    const zc = lots.map(({ u, v }) => terrain.z(u, v));
    // a cell at the edge of the lot grid faces open ground one lot further out: the lowest ground around it
    const edgeGround = (i) => {
      if (terrain.mode === 'flat') return 0;
      const { P, u, v } = lots[i], { fwd, up } = frame(P, u, v), right = cross(fwd, up);
      let low = zc[i];
      for (const d of [fwd, scale3(fwd, -1), right, scale3(right, -1)]) { const [uu, vv] = dom.toNorm(add(P, scale3(d, pr.lot))); low = Math.min(low, terrain.z(uu, vv)); }
      return low;
    };
    const edgeZ = cellOf.map((bi, i) => (bi >= 0 && nbrs[i].missing ? edgeGround(i) : null));
    // open cells are the ground; cells on the plate edge may rise only `terraceRise` above the open ground beside them
    const hv = cellOf.map((bi, i) => (bi < 0 ? zc[i] : nbrs[i].missing ? Math.min(zc[i] + buildings[bi].h, edgeZ[i] + terraceRise) : zc[i] + buildings[bi].h));
    const done = new Uint8Array(hv.length), heap = new MinHeap();
    hv.forEach((h, i) => heap.push(h, i));
    while (heap.size) {
      const [h, i] = heap.pop();
      if (done[i] || h !== hv[i]) continue;
      done[i] = 1;
      for (const j of nbrs[i]) if (!done[j] && hv[j] > h + terraceRise) { hv[j] = h + terraceRise; heap.push(hv[j], j); }
    }
    cellOf.forEach((bi, i) => {
      if (bi < 0) return;
      const b = buildings[bi], h = Math.max(step, hv[i] - zc[i]);
      if (h < b.h) binding.slenderness++;
      b.h = h; b.floors = Math.round(h / pr.floorH);
      if (terrain.mode !== 'flat') {
        let open = nbrs[i].missing ? edgeZ[i] : Infinity;
        for (const j of nbrs[i]) if (cellOf[j] < 0) open = Math.min(open, zc[j]);
        if (open !== Infinity) b.openGround = open;
      }
    });
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
      if (reach.clearance(P, -Infinity) > access) { accessLots++; trees.push({ pos: P, up: upAt(dom, P), s: 1 + rng() }); return true; }
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
        district: districtAt(u, v), landmark: false, hdCell, ...(eraAt ? { era: eraAt(u, v) } : {}),
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

    // a wider footprint must stay inside the lot's no-overlap radius and clear every road
    const canWiden = (b, W, D) => Math.hypot(W, D) / 2 <= b.hdCell + 1e-9 && fits(b.pos, b.up, b.fwd, W, D);
    // structural limits: widen toward the slenderness rule where the lot allows, else cap the height
    for (const b of buildings) {
      let h = b.floors * pr.floorH;
      if (b.shape === 'dome') h = Math.min(h, 0.6 * Math.min(b.w, b.d));
      if (h > slender * Math.min(b.w, b.d)) {
        const need = h / slender;
        // widest square (or the current long side) that still fits the lot and clears the roads
        let side = Math.min(need, b.hdCell / Math.SQRT2);
        while (side > Math.min(b.w, b.d) && !canWiden(b, Math.max(b.w, side), Math.max(b.d, side))) side *= 0.93;
        if (side > Math.min(b.w, b.d)) { b.w = Math.max(b.w, side); b.d = Math.max(b.d, side); }
        if (h > slender * Math.min(b.w, b.d)) { h = slender * Math.min(b.w, b.d); binding.slenderness++; }
      }
      // a building over six floors needs a lift-and-stair core plus usable floor around it
      if (h > coreFloorsCap * pr.floorH && Math.min(b.w, b.d) < MIN_CORE_SIDE) {
        let side = MIN_CORE_SIDE;
        const ok = canWiden(b, Math.max(b.w, side), Math.max(b.d, side));
        if (ok) { b.w = Math.max(b.w, side); b.d = Math.max(b.d, side); }
        else { h = Math.min(h, CORE_FLOORS * pr.floorH); binding.core++; }
      }
      if (h > hMat) { h = hMat; binding.material++; }
      b.floors = Math.max(1, Math.floor(h / pr.floorH + 1e-9));
      b.h = b.shape === 'dome' ? Math.max(Math.min(h, b.floors * pr.floorH), Math.min(h, pr.floorH)) : b.floors * pr.floorH;
      delete b.hdCell;
    }
  }

  // ---------------------------------------------------------------- terrain: lift everything onto the ground, flood the basins
  // measured clearances are taken on the flat plan, before the lift (the street hashes hold the plan roads, which the
  // lift moves); the walking reach is kept per building so the shore removal below can drop its lots from the figure
  const minRoadClearance = buildings.reduce((m, b) => Math.min(m, footprintClearance(hash, b, 2)), Infinity);
  const reachOf = pr.arcology ? null : new Map(buildings.map((b) => [b, reach.clearance(b.pos)]));
  let waterLots = 0, bridges = 0, bridgeLength = 0, maxGrade = 0, waterShare = 0;
  if (terrain.mode !== 'flat') {
    const deck = terrain.waterLevel + terrain.shore;
    // every street point takes one elevation from its own plan position: the ground, or the embankment level
    // where the ground is within the freeboard of the water, so streets meeting at a point agree on its height
    const streetZ = (P) => { const [u, v] = dom.toNorm(P); return Math.max(terrain.z(u, v), deck); };
    for (const r of rd.roads) {
      const za = streetZ(r.a), zb = streetZ(r.b);
      let wet = false;
      for (let k = 0; k <= 8 && !wet; k++) { const [u, v] = dom.toNorm(add(r.a, scale3(sub(r.b, r.a), k / 8))); if (terrain.z(u, v) < terrain.waterLevel) wet = true; }
      const planLen = len3(sub(r.b, r.a));
      r.a = liftTo(dom, r.a, za); r.b = liftTo(dom, r.b, zb);
      if (wet) { r.bridge = true; bridges++; bridgeLength += planLen; }
      if (planLen > 0) maxGrade = Math.max(maxGrade, Math.abs(zb - za) / planLen);
    }
    const keep = [];
    for (const b of buildings) {
      const [u, v] = dom.toNorm(b.pos);
      // shoreline: no building within the shore margin of the water (an arcology spans its basins on piers instead)
      if (!pr.arcology && terrain.z(u, v) < terrain.waterLevel + terrain.shore) { waterLots++; continue; }
      b.pos = terrain.lift(b.pos); b.elevation = terrain.z(u, v);
      if (dom.kind === 'sphere') b.up = norm3(b.pos);
      keep.push(b);
    }
    buildings.length = 0; buildings.push(...keep);
    // landmarks that drowned are re-picked below, trees that drowned go
    const keepT = [];
    for (const t of trees) { const [u, v] = dom.toNorm(t.pos); if (terrain.z(u, v) < terrain.waterLevel) continue; t.pos = terrain.lift(t.pos); if (dom.kind === 'sphere') t.up = norm3(t.pos); keepT.push(t); }
    trees.length = 0; trees.push(...keepT);
    // share of the plate under water, from the field grid
    let wet = 0, cells = 0;
    for (let i = 0; i <= grid.ni; i += 2) for (let j = 0; j <= grid.nj; j += 2) { const id = i * grid.W + j; if (!grid.valid[id]) continue; cells++; const [u, v] = grid.coord(i, j); if (terrain.waterAt(u, v)) wet++; }
    waterShare = cells ? wet / cells : 0;
    // landmarks lost to water: re-pick per district
    const best = new Map();
    for (const b of buildings) { if (b.landmark) best.set(b.district, b); }
    const sizesTotal = districts.sizes.reduce((a, b) => a + b, 0);
    for (const b of buildings) { if (b.district >= 0 && districts.sizes[b.district] >= 0.002 * sizesTotal && !best.has(b.district)) { const cur = [...buildings].filter((x) => x.district === b.district).reduce((m, x) => (x.amp > m.amp ? x : m)); cur.landmark = true; best.set(b.district, cur); } }
  }

  // ---------------------------------------------------------------- stats and plausibility
  const maxStreetDistance = pr.arcology ? null : buildings.reduce((m, b) => Math.max(m, reachOf.get(b)), 0);
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
    heightLimit: hLimit,
    slendernessLimit: sLimit,
    terraceLimit: pr.arcology ? Math.max(pr.terraceFloors * pr.floorH, Math.floor((slendernessLimit(8, p.gravity) * (dom.kind === 'plane' ? pr.lot * 0.97 : pr.lot * 0.58)) / (pr.terraceFloors * pr.floorH)) * pr.terraceFloors * pr.floorH) : null,
    enforce: p.enforce,
    binding,
    // measured, not assumed
    maxSlenderness: buildings.reduce((m, b) => (b.shape === 'dome' || b.shape === 'terrace' ? m : Math.max(m, b.h / Math.min(b.w, b.d))), 0),
    maxStreetDistance, minRoadClearance,
    terrain: { mode: terrain.mode, relief: terrain.relief, waterLevel: Number.isFinite(terrain.waterLevel) ? terrain.waterLevel : null, shore: terrain.shore, waterShare, bridges, bridgeLength, waterLots, maxGrade },
    terraceRise,
    maxTerraceStep: pr.arcology ? maxTerraceStep(dom, buildings, pr.lot, terrain) : null,
    accessLimit: pr.arcology ? null : access,
    patternSharpness: resp.sharpness,
    eras: voices ? voices.map((_, i) => buildings.filter((b) => b.era === i).length) : null,
  };
  const checks = plausibilityChecks(p, stats);
  const dominant = resp.active[0];
  return {
    meta: {
      engine: ENGINE_VERSION,
      frequency: p.frequency, note: noteName(p.frequency), plate: p.plate, plateLabel: PLATES[p.plate].label,
      law: PLATES[p.plate].law, preset: p.presetKey, base: pr.base ?? p.presetKey, arcology: !!pr.arcology, presetLabel: pr.label, seed: p.seed, Q: p.Q,
      fundamentalHz: p.fundamentalHz, driveOffset: p.driveOffset, gravity: p.gravity, material: p.material,
      materialLabel: p.materialSpec.label, materialSpec: p.materialSpec, inverse: p.inverse, enforce: p.enforce,
      presetSpec: pr.custom ? { ...pr } : null,
      modes: resp.active.map((m) => ({ label: modeLabel(m), f: m.f, weight: m.weight, detuneHz: m.detuneHz, m: m.m, n: m.n, l: m.l })),
      dominant: modeLabel(dominant), symmetry: symmetryNote(dominant),
      world: { shape: dom.shape, extent: dom.extent, area: dom.area, Rs: dom.Rs ?? null },
      ringLevels: rd.ringLevels, spokeSpacing: rd.spokeSpacing, boulevardWidth: rd.wBoulevard,
      azimuthal: p.azimuthal, sharpness: resp.sharpness,
      chord: voices ? voices.map((v) => ({ hz: v.hz, weight: v.weight, note: noteName(v.hz), dominant: modeLabel(v.resp.active[0]), sharpness: v.resp.sharpness, modes: v.resp.active.map((m) => ({ label: modeLabel(m), f: m.f, weight: m.weight, detuneHz: m.detuneHz })) })) : null,
      terrain: { mode: terrain.mode, relief: terrain.relief, waterLevel: Number.isFinite(terrain.waterLevel) ? terrain.waterLevel : null, freeboard: terrain.shore, canals: p.terrain.canals, heightmap: p.terrain.heightmap ? { width: p.terrain.heightmap.width, height: p.terrain.heightmap.height } : null },
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

// Recompute the plausibility checks for a layout whose buildings changed (a simulation keyframe).
export function checksFor(meta, stats) {
  return plausibilityChecks({ presetKey: meta.preset, preset: { arcology: !!meta.arcology }, enforce: meta.enforce !== false }, stats);
}
function plausibilityChecks(p, s) {
  const urban = !p.preset.arcology;
  const pct = (x) => `${(x * 100).toFixed(0)}%`;
  const out = [];
  const add = (id, label, value, status, basis) => out.push({ id, label, value, status, basis });
  if (urban) {
    const town = p.presetKey === 'town';
    add('street-share', 'Land given to streets', pct(s.roadShare),
      town ? 'info' : s.roadShare >= 0.25 && s.roadShare <= 0.4 ? 'pass' : 'warn',
      town ? 'UN-Habitat targets 30–35 % for cities; small towns usually run lower' : 'UN-Habitat: 30–35 % of urban land');
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
    add('slenderness', 'Most slender building', `1:${s.maxSlenderness.toFixed(1)} (limit 1:${s.slendernessLimit.toFixed(1)})`,
      s.maxSlenderness <= s.slendernessLimit + 1e-6 ? 'pass' : 'fail', 'Slender above 1:10–1:12; record about 1:24 (111 W 57th St)');
    add('access', 'Farthest building from a street', `${s.maxStreetDistance.toFixed(0)} m (limit ${s.accessLimit.toFixed(0)} m)`,
      s.maxStreetDistance <= s.accessLimit + 1e-6 ? 'pass' : 'fail', 'Lots beyond walking reach become green space');
  } else {
    add('terrace', 'Largest terrace step', `${s.maxTerraceStep.toFixed(0)} m (limit ${s.terraceLimit.toFixed(0)} m)`,
      s.maxTerraceStep <= s.terraceLimit + 1e-6 ? 'pass' : 'fail', 'Each exposed face kept within 1:8 slenderness; open canyons count as 0 m');
  }
  if (s.terrain && s.terrain.mode !== 'flat') {
    add('street-grade', 'Steepest street', `${(100 * s.terrain.maxGrade).toFixed(1)} %`,
      s.terrain.maxGrade <= 0.10 ? 'pass' : s.terrain.maxGrade <= 0.15 ? 'warn' : 'fail', 'Arterials up to 6–8 %, local streets to 10 %; above 15 % streets become stairs');
    add('water', 'Water', `${(100 * s.terrain.waterShare).toFixed(0)} % of the plate, ${(s.terrain.bridgeLength / 1000).toFixed(1)} km of bridges`, 'info', `Relief ${s.terrain.relief.toFixed(0)} m; ${s.terrain.waterLots} lots left to the shore`);
  }
  if (!p.enforce) add('enforce', 'Physical limits', 'reported, not enforced', 'warn', 'Fantasy mode: buildings keep their generated heights; the checks above say what real materials would allow');
  add('setback', 'Closest building to a road edge', `${s.minRoadClearance.toFixed(1)} m`,
    s.minRoadClearance >= 0 ? 'pass' : 'fail', 'Footprints clear every road; overlap between lots is ruled out by lot spacing');
  add('sharpness', 'Pattern sharpness', `${(s.patternSharpness * 100).toFixed(0)}%`,
    s.patternSharpness >= 0.8 ? 'pass' : 'warn', 'Share of plate motion in the standing pattern; between modes the nodal lines blur');
  return out;
}

// ---------------------------------------------------------------- export
// Wavefront OBJ of buildings (prisms) and roads (flat strips). y is up, units are metres.
export function toOBJ(layout) {
  const lines = [`# Cymatic City Engine ${ENGINE_VERSION}`,
    `# ${layout.meta.chord ? `chord ${layout.meta.chord.map((v) => `${v.hz} Hz × ${v.weight}`).join(' + ')}` : `${layout.meta.frequency} Hz (${layout.meta.note})`} on ${layout.meta.plateLabel}, preset ${layout.meta.presetLabel}, seed ${layout.meta.seed}`];
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
    const up = layout.meta.plate === 'sphere' ? norm3(add(r.a, r.b)) : [0, 1, 0];
    const dir = norm3(sub(r.b, r.a)), side = scale3(norm3(cross(up, dir)), r.w / 2), lift = scale3(up, 0.05);
    const verts = [add(add(r.a, side), lift), add(sub(r.a, side), lift), add(sub(r.b, side), lift), add(add(r.b, side), lift)];
    emit(verts, [[0, 1, 2, 3]], `road_${idx}_${r.kind}`);
  });
  if (layout.infra && typeof layout.infraToOBJ === 'function') {
    const extra = layout.infraToOBJ(layout, vi);
    if (extra.text) lines.push(extra.text);
  }
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
    faces.push([sides + i, sides + j, j, i]);
  }
  faces.push([...Array(sides).keys()]);                          // floor, facing down
  faces.push([...Array(sides).keys()].map((i) => sides + i).reverse()); // roof, facing up
  return { verts, faces };
}

// Plain-data copy of a layout (drops the field functions).
export function toJSON(layout) {
  const { field, timingMs, infraToOBJ, infraMs, ...rest } = layout;
  void field; void timingMs; void infraToOBJ; void infraMs;
  if (rest.infra) {
    const { graph, ...infra } = rest.infra;
    rest.infra = { ...infra, graph: { nodes: graph.nodes, edges: graph.edges, connectors: graph.connectors } };
  }
  return JSON.stringify(rest, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v));
}

// Clipping each voice's streets to its territory can leave short pieces of its sand lines touching no other street;
// a chord drops disconnected street fragments shorter than this (streets join within 1 m, as in the street graph).
export const FRAGMENT_MIN = 100;
function dropFragments(roads, minLen) {
  const cell = 40, hash = new Map(), key = (x, y, z) => `${x},${y},${z}`, cellOf = (P) => P.map((v) => Math.floor(v / cell));
  const segDist = (P, A, B) => { const ab = sub(B, A), t = clamp(dot(sub(P, A), ab) / (dot(ab, ab) || 1), 0, 1); return len3(sub(P, add(A, scale3(ab, t)))); };
  roads.forEach((r, i) => { for (const P of [r.a, r.b, scale3(add(r.a, r.b), 0.5)]) { const k = key(...cellOf(P)); (hash.get(k) ?? hash.set(k, []).get(k)).push(i); } });
  const comp = new Int32Array(roads.length).fill(-1), compLen = [];
  for (let s0 = 0; s0 < roads.length; s0++) {
    if (comp[s0] >= 0) continue;
    const c = compLen.length; comp[s0] = c; let L = 0; const stack = [s0];
    while (stack.length) {
      const i = stack.pop(), r = roads[i]; L += len3(sub(r.b, r.a));
      for (const P of [r.a, r.b]) {
        const [x, y, z] = cellOf(P);
        for (let a = x - 1; a <= x + 1; a++) for (let b = y - 1; b <= y + 1; b++) for (let d = z - 1; d <= z + 1; d++) for (const j of hash.get(key(a, b, d)) ?? []) {
          if (comp[j] >= 0) continue; const o = roads[j];
          if (Math.min(segDist(r.a, o.a, o.b), segDist(r.b, o.a, o.b), segDist(o.a, r.a, r.b), segDist(o.b, r.a, r.b)) <= 1) { comp[j] = c; stack.push(j); }
        }
      }
    }
    compLen.push(L);
  }
  return roads.filter((r, i) => compLen[comp[i]] >= minLen || r.kind === 'wall');
}

// Share of the plate each voice shapes (dominant w·A), from the valid cells of the composite grid.
function voiceTerritories(voices, grid) {
  const n = new Float64Array(voices.length); let cells = 0;
  for (let i = 0; i <= grid.ni; i += 2) for (let j = 0; j <= grid.nj; j += 2) {
    if (!grid.valid[i * grid.W + j]) continue;
    const [u, v] = grid.coord(i, j); n[dominantEnvelope(voices, u, v)]++; cells++;
  }
  return Array.from(n, (x) => (cells ? x / cells : 0));
}

// Field only (no city) — for painting the plate under the city and the 2D sand figure.
export function fieldPreview(input = {}) {
  const p = resolveParams(input);
  const { field, voices } = resolveFields(p);
  const dom = makeDomain(p);
  const grid = sampleGrid(dom, field);
  // the nodal spacing the city would have (for the automatic relief), from the zero contour length; a chord's city
  // takes the smallest spacing of its voices, so the preview does too
  const spacingOf = (g) => { let nodal = 0; for (const [a, b] of marchingSquares(g, 0)) { const A = gridPt(dom, g, a), B = gridPt(dom, g, b); nodal += len3(sub(B, A)); } return nodal > 0 ? dom.area / nodal : Infinity; };
  const nodalSpacing = voices ? Math.min(...voices.map((v) => spacingOf(v.grid))) : spacingOf(grid);
  const terrain = makeTerrain(p, field, dom, nodalSpacing, grid);
  return {
    at: field.at, toNorm: dom.toNorm, toWorld: dom.toWorld, inside: dom.inside,
    kind: dom.kind, shape: dom.shape, extent: dom.extent, Rs: dom.Rs ?? null, lo: dom.lo, hi: dom.hi,
    terrain: { mode: terrain.mode, relief: terrain.relief, waterLevel: terrain.waterLevel, shore: terrain.shore, z: terrain.z, lift: terrain.lift, waterAt: terrain.waterAt },
    voices: voices ? voices.map((v) => ({ hz: v.hz, weight: v.weight, at: v.field.at, S: v.field.S, env: v.env })) : null,
  };
}
function gridPt(dom, g, pt) {
  if (dom.kind === 'plane') return dom.toWorld(dom.lo + ((dom.hi - dom.lo) * pt[0]) / g.ni, dom.lo + ((dom.hi - dom.lo) * pt[1]) / g.nj);
  return dom.toWorld((Math.PI * pt[0]) / g.ni, (TAU * pt[1]) / g.nj);
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
