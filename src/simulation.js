// Simulation layer: a time axis (growth, ageing, densification, keyframes), an hourly flow model
// (water pressure, feeder voltage, sewer fullness, metro loads) and failure analysis (what breaks
// when an asset fails; N-1 resilience). Constants and formulas are in docs/research-notes/simulation_standards.md.
import { mulberry32, CORE_FLOORS, MIN_CORE_SIDE, checksFor } from './cymatic-engine.js';
import { buildInfrastructure, SEWER, TRANSIT } from './infrastructure.js';

const G0 = 9.80665;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ---------------------------------------------------------------- hourly profiles
// Gaussian-mixture generators fitted to the sourced shape facts (two water peaks, evening residential
// peak, daytime commercial plateau, AM/PM rail peaks). Demand arrays average 1.0; rail sums to 1.0.
function mixture(base, peaks, normalise) {
  const h24 = (h, mu) => { let d = Math.abs(h - mu); return Math.min(d, 24 - d); };
  const f = Array.from({ length: 24 }, (_, h) => {
    const t = h + 0.5;
    return base + peaks.reduce((s, [a, mu, sg]) => s + a * Math.exp(-(h24(t, mu) ** 2) / (2 * sg * sg)), 0);
  });
  const k = normalise === 'sum' ? f.reduce((s, x) => s + x, 0) : f.reduce((s, x) => s + x, 0) / 24;
  return f.map((x) => x / k);
}
export const PROFILES = {
  water: mixture(0.35, [[1.0, 7.5, 1.4], [0.75, 19.5, 2.0], [0.35, 12.5, 2.0]], 'mean'),
  sewage: mixture(0.4, [[0.9, 9.0, 1.8], [0.7, 21.0, 2.4], [0.35, 14.0, 2.4]], 'mean'),   // lags water by ~1.5 h, smoother
  residential: mixture(0.5, [[0.9, 19.0, 2.5], [0.4, 7.5, 1.5]], 'mean'),
  commercial: mixture(0.3, [[1.0, 13.0, 3.5]], 'mean'),
  rail: mixture(0.15, [[1.0, 8.0, 1.0], [0.9, 17.5, 1.2]], 'sum'),
};
export const PEAK_HOUR = Object.fromEntries(Object.entries(PROFILES).map(([k, p]) => [k, p.indexOf(Math.max(...p))]));

// ---------------------------------------------------------------- formulas
// Hazen-Williams head loss (m): Q m³/s, D m, L m. SI constant 10.67.
export function hazenWilliams(Q, D, L, C = 130) {
  if (Q <= 0) return 0;
  return (10.67 * L * Math.pow(Q, 1.852)) / (Math.pow(C, 1.852) * Math.pow(D, 4.87));
}
// Three-phase line-to-line drop (V): I A, L km, R and X Ω/km.
export function voltageDrop(I, Lkm, R, X, pf = 0.95) {
  const sin = Math.sqrt(1 - pf * pf);
  return Math.sqrt(3) * I * Lkm * (R * pf + X * sin);
}
// 11 kV Al XLPE conductors (R at 90 °C, ampacity in ground) and how many run in parallel per feeder class.
const CONDUCTORS = [{ mm2: 95, R: 0.411, amp: 245 }, { mm2: 185, R: 0.211, amp: 355 }, { mm2: 300, R: 0.130, amp: 455 }];
export const POWER_FLOW = { kV: 11, X: 0.11, pfResidential: 0.95, pfCommercial: 0.9, minPu: 0.95 };
export function cableFor(classMVA) {
  const I = (classMVA * 1e6) / (Math.sqrt(3) * POWER_FLOW.kV * 1e3);
  for (const c of CONDUCTORS) if (c.amp >= I) return { ...c, parallel: 1, ampacity: c.amp };
  const big = CONDUCTORS[2], n = Math.ceil(I / big.amp);
  return { mm2: big.mm2, R: big.R / n, parallel: n, ampacity: big.amp * n };
}
// Manning partial flow: depth ratio d/D for a flow ratio Q/Q_full (circular pipe, constant n).
const HYDRAULIC_ELEMENTS = (() => {
  const pts = [];
  for (let i = 0; i <= 200; i++) {
    const y = i / 200, th = 2 * Math.acos(1 - 2 * y);
    const A = (th - Math.sin(th)) / 8, P = th / 2, R = P > 0 ? A / P : 0;
    const q = A * Math.pow(R, 2 / 3) / (Math.PI / 4 * Math.pow(0.25, 2 / 3));
    pts.push([y, q]);
  }
  return pts;
})();
export function partialFlowDepth(qRatio) {
  if (qRatio <= 0) return 0;
  // the curve peaks at d/D ≈ 0.94 (Q/Q_full ≈ 1.076); past that the pipe is full and pressurised
  let best = 0;
  for (const [y, q] of HYDRAULIC_ELEMENTS) { if (q >= qRatio) return y; best = Math.max(best, q); }
  return 1 + (qRatio - best); // surcharge margin
}
// Weibull lifetimes by building type (years): shape 1.5, scale by type. Western stock; the China figure is far shorter.
export const LIFETIMES = { house: 80, block: 70, tower: 90, pod: 75, dome: 75, spire: 90, terrace: 120, shape: 1.5 };
export const GROWTH = { rate: 0.037 /* built-up area growth per year */, modeShare: 0.35, catchment: 1200, lineCapacity: 30000 };
const weibull = (u, scale, k = LIFETIMES.shape) => scale * Math.pow(-Math.log(1 - Math.min(u, 0.999999)), 1 / k);

// ---------------------------------------------------------------- shared helpers
const nodeKey = (P) => `${Math.round(P[0] * 4)},${Math.round(P[1] * 4)},${Math.round(P[2] * 4)}`;
function dijkstraFrom(graph, source) {
  const n = graph.nodes.length, d = new Float64Array(n).fill(Infinity), parent = new Int32Array(n).fill(-1), pedge = new Int32Array(n).fill(-1);
  const heapK = [], heapV = [];
  const push = (k, v) => { let i = heapK.length; heapK.push(k); heapV.push(v); while (i > 0) { const p = (i - 1) >> 1; if (heapK[p] <= k) break; heapK[i] = heapK[p]; heapV[i] = heapV[p]; i = p; } heapK[i] = k; heapV[i] = v; };
  const pop = () => { const top = [heapK[0], heapV[0]], lk = heapK.pop(), lv = heapV.pop(); if (heapK.length) { let i = 0; const n2 = heapK.length; for (;;) { let c = 2 * i + 1; if (c >= n2) break; if (c + 1 < n2 && heapK[c + 1] < heapK[c]) c++; if (heapK[c] >= lk) break; heapK[i] = heapK[c]; heapV[i] = heapV[c]; i = c; } heapK[i] = lk; heapV[i] = lv; } return top; };
  d[source] = 0; push(0, source);
  while (heapK.length) {
    const [dd, u] = pop(); if (dd > d[u]) continue;
    for (const ei of graph.adj[u]) { const e = graph.edges[ei], v = e.a === u ? e.b : e.a; if (dd + e.len < d[v]) { d[v] = dd + e.len; parent[v] = u; pedge[v] = ei; push(d[v], v); } }
  }
  return { d, parent, pedge };
}
function drivePointWorld(meta) {
  const d = meta.driveOffset ?? 0.37, E = meta.world.extent;
  if (meta.plate === 'circle') return [d * E, 0, 0];
  if (meta.plate === 'square') return [d * E, 0, 0.62 * d * E];
  const th = Math.PI * (0.15 + 0.7 * d), Rs = meta.world.Rs;
  return [Rs * Math.sin(th), Rs * Math.cos(th), 0];
}
const shapeVolume = { block: 1, house: 1, tower: 1, terrace: 1, pod: 0.785, dome: 0.5, spire: 0.33 };
const resShare = { residential: 0.9, mixed: 0.5, core: 0.25, green: 0 };
export function cityStats(layout) {
  const arc = !!layout.meta.arcology;
  let gfa = 0, res = 0, maxH = 0, foot = 0;
  for (const b of layout.buildings) {
    const g = b.w * b.d * (shapeVolume[b.shape] ?? 1) * b.floors * 0.7 * (arc ? 0.25 : 1);
    gfa += g; res += g * (arc ? 0.75 : resShare[b.zone] ?? 0.5); maxH = Math.max(maxH, b.h); foot += b.w * b.d;
  }
  return { buildings: layout.buildings.length, gfaM2: gfa, population: Math.round(res / 45), jobs: Math.round((gfa - res) / 15), maxHeight: maxH, far: gfa / 0.7 / layout.meta.world.area, coverage: foot / layout.meta.world.area };
}

// ---------------------------------------------------------------- growth
export function simulate(layout, opts = {}) {
  const years = Math.max(5, Number(opts.years ?? 100));
  const K = Math.max(2, Math.min(24, Number(opts.keyframes ?? 8)));
  const infra = layout.infra ?? buildInfrastructure(layout);
  const meta = layout.meta, graph = infra.graph;
  const rng = mulberry32((meta.seed * 7919 + 101) >>> 0);
  const enforce = meta.enforce !== false;
  const hMat = enforce ? layout.stats.heightLimit : Infinity, slender = enforce ? layout.stats.slendernessLimit : Infinity;
  const floorH = meta.presetSpec?.floorH ?? { town: 3.0, city: 3.4, megastructure: 5.0, alien: 5.5 }[meta.base ?? meta.preset] ?? 3.4;

  // founding nucleus: the strongest antinode nearest the drive point
  const dp = drivePointWorld(meta), E = meta.world.extent;
  let fb = 0, fs = -Infinity;
  layout.buildings.forEach((b, i) => { const s = b.amp - dist(b.pos, dp) / E + (b.landmark ? 0.3 : 0); if (s > fs) { fs = s; fb = i; } });
  const nodeOf = new Int32Array(layout.buildings.length).fill(-1);
  for (const l of infra.laterals) nodeOf[l.building] = l.node;
  const founding = nodeOf[fb] >= 0 ? nodeOf[fb] : infra.laterals[0]?.node ?? 0;
  const { d: dist0, parent } = dijkstraFrom(graph, founding);

  // settlement order: street distance from the nucleus, pulled earlier by amplitude, with a little noise
  const score = layout.buildings.map((b, i) => {
    const dd = Number.isFinite(dist0[nodeOf[i]]) ? dist0[nodeOf[i]] : 4 * E;
    return { i, s: (dd + 15) * (1.3 - 0.6 * b.amp) * (1 + 0.25 * (rng() - 0.5)), distance: dd };
  }).sort((x, y) => x.s - y.s || x.i - y.i);
  const r = GROWTH.rate, denom = Math.exp(r * years) - 1;
  const history = new Array(layout.buildings.length);
  score.forEach((sc, rank) => {
    const q = score.length > 1 ? rank / (score.length - 1) : 0; // first building at year 0, last at the horizon
    const built = Math.round(10 * Math.log(1 + q * denom) / r) / 10;
    const b = layout.buildings[sc.i], side = Math.min(b.w, b.d), F = b.floors;
    const amp = b.amp, arc = b.shape === 'terrace';
    const cap = (floors) => {
      let f = Math.max(1, Math.round(floors));
      if (enforce) {
        if (f > CORE_FLOORS && side < MIN_CORE_SIDE) f = CORE_FLOORS;
        f = Math.min(f, Math.floor((Math.min(hMat, slender * side) + 1e-9) / floorH));
      }
      return Math.max(1, f); // never below one floor; the caps above keep it within structure
    };
    const gens = [];
    let factor = arc ? 1 : Math.min(1, 0.55 + 0.45 * Math.sqrt(built / years));
    let floors = cap(F * factor), year = built;
    gens.push({ year, floors, h: floors * floorH });
    for (;;) {
      const life = weibull(rng(), LIFETIMES[b.shape] ?? 75);
      year = Math.round(10 * (year + life)) / 10;
      if (year > years) break;
      factor = arc ? 1 : Math.min(1 + 0.4 * amp, factor + 0.25 + 0.1 * rng());
      floors = Math.max(floors, cap(F * factor));
      gens.push({ year, floors, h: floors * floorH });
    }
    history[sc.i] = { building: sc.i, built, distance: sc.distance, generations: gens };
  });

  // street activation: a building activates its node and the street path back to the nucleus
  const nodeYear = new Float64Array(graph.nodes.length).fill(Infinity);
  const byYear = history.map((h) => h).sort((x, y) => x.built - y.built || x.building - y.building);
  for (const h of byYear) {
    let u = nodeOf[h.building];
    while (u >= 0 && nodeYear[u] > h.built) { nodeYear[u] = h.built; u = parent[u]; }
  }
  const keyIndex = new Map(graph.nodes.map((n, i) => [nodeKey(n.pos), i]));
  const roadYear = layout.roads.map((rd) => {
    const a = keyIndex.get(nodeKey(rd.a)), b = keyIndex.get(nodeKey(rd.b));
    return Math.min(a != null ? nodeYear[a] : Infinity, b != null ? nodeYear[b] : Infinity);
  });

  // keyframes: complete cities at K years, networks rebuilt for what exists
  const keyframes = [];
  const events = [];
  let prevStats = null;
  for (let k = 0; k < K; k++) {
    // keyframes at even steps of time: the early frames are the small town the city grew from
    const year = k === K - 1 ? years : Math.round(10 * (years * (k + 1)) / K) / 10;
    const buildings = [];
    for (const h of history) {
      if (h.built > year) continue;
      let g = h.generations[0];
      for (const gg of h.generations) if (gg.year <= year) g = gg;
      const b = layout.buildings[h.building];
      buildings.push({ ...b, floors: g.floors, h: b.shape === 'dome' ? Math.min(g.h, 0.6 * Math.min(b.w, b.d)) : g.h, built: h.built, rebuilt: g.year, source: h.building });
    }
    const roads = layout.roads.filter((_, i) => roadYear[i] <= year);
    const trees = layout.trees;
    const sub = { meta: { ...meta, year }, roads, buildings, trees, stats: { ...layout.stats }, checks: [] };
    const inf = buildInfrastructure(sub);
    sub.infra = inf;
    const roadLen = roads.reduce((a, rd) => a + dist(rd.a, rd.b), 0), roadArea = roads.reduce((a, rd) => a + dist(rd.a, rd.b) * rd.w, 0);
    const cs = cityStats(sub);
    sub.stats = { ...layout.stats, ...cs, roadSegments: roads.length, roadLengthKm: roadLen / 1000, streetDensity: roadLen / 1000 / (meta.world.area / 1e6), roadShare: roadArea / meta.world.area,
      densityPerHa: cs.population / (meta.world.area / 1e4), tallest: buildings.reduce((m, b) => Math.max(m, b.floors), 0),
      maxSlenderness: buildings.reduce((m, b) => (b.shape === 'dome' || b.shape === 'terrace' ? m : Math.max(m, b.h / Math.min(b.w, b.d))), 0) };
    sub.checks = checksFor(sub.meta, sub.stats);
    const stats = { year, ...cs, roadSegments: roads.length };
    keyframes.push({ year, layout: sub, infra: inf, stats });
    opts.onKeyframe?.(k, { year, stats }, keyframes[k]);
    const replaced = history.filter((h) => h.generations.some((g, i) => i > 0 && g.year <= year && g.year > (keyframes[k - 1]?.year ?? -1))).length;
    const built = history.filter((h) => h.built <= year && h.built > (keyframes[k - 1]?.year ?? -1)).length;
    events.push({ year, built, replaced, population: stats.population,
      liftStations: inf.stats.liftStations, substations: inf.stats.substations, tanks: inf.stats.towers, stations: inf.stats.stations,
      note: describeKeyframe(k, built, replaced, inf.stats, prevStats) });
    prevStats = inf.stats;
  }
  return { years, founding: { building: fb, node: founding }, history, keyframes, events };
}
function describeKeyframe(k, built, replaced, s, prev) {
  const bits = [`${built} built`];
  if (replaced) bits.push(`${replaced} rebuilt`);
  if (prev) {
    if (s.liftStations > prev.liftStations) bits.push(`+${s.liftStations - prev.liftStations} lift station${s.liftStations - prev.liftStations === 1 ? '' : 's'}`);
    if (s.substations > prev.substations) bits.push(`+${s.substations - prev.substations} substation${s.substations - prev.substations === 1 ? '' : 's'}`);
    if (s.towers > prev.towers) bits.push(`+${s.towers - prev.towers} tank${s.towers - prev.towers === 1 ? '' : 's'}`);
    if (s.stations > prev.stations) bits.push(`+${s.stations - prev.stations} metro station${s.stations - prev.stations === 1 ? '' : 's'}`);
  } else if (k === 0) bits.push('founding');
  return bits.join(', ');
}

// ---------------------------------------------------------------- flows
export function flows(layout, infra, hour = 8, opts = {}) {
  const h = ((Math.round(hour) % 24) + 24) % 24;
  const g = layout.meta.gravity ?? 1, N = infra.graph.nodes.length, nodes = infra.graph.nodes;
  const C = opts.hazenC ?? 130;

  // ---- water: Hazen-Williams along the distribution forest from each tank
  const fw = PROFILES.water[h];
  const children = new Map();
  for (const m of infra.water.mains) if (m.tree) (children.get(m.tree[1]) ?? children.set(m.tree[1], []).get(m.tree[1])).push(m);
  // head[] is the pressure head (m of water) at each node: hydraulic grade line minus ground elevation; on terrain the
  // tank's own elevation counts, and a pressure-reducing valve resets the grade line to the limit below it
  const elev = (i) => nodes[i].elev ?? 0;
  const prvAt = new Set((infra.water.prvs ?? []).map((p) => p.node));
  const maxHeadM = 56;
  const head = new Float64Array(N), nodePressure = new Float64Array(N);
  const mainsOut = new Map();
  let totalFlow = 0;
  for (const t of infra.water.towers) {
    head[t.node] = t.height;
    const stack = [t.node];
    while (stack.length) {
      const u = stack.pop();
      for (const m of children.get(u) ?? []) {
        const child = m.tree[0];
        const Q = ((m.distFlow ?? m.flow) / 3.0) * fw; // distribution peak-hour (3×) design flow
        const hf = hazenWilliams(Q, m.diameter, m.length, C) / (m.barrels ?? 1) ** 1.852;
        head[child] = head[u] + elev(u) - elev(child) - hf;
        if (prvAt.has(child)) head[child] = Math.min(head[child], maxHeadM);
        mainsOut.set(m.edge, { edge: m.edge, flow: Q, velocity: Q / ((m.barrels ?? 1) * Math.PI * m.diameter * m.diameter / 4), headLoss: hf });
        stack.push(child);
      }
    }
  }
  const served = new Uint8Array(N);
  for (const t of infra.water.towers) served[t.node] = 1;
  for (const m of infra.water.mains) if (m.tree) served[m.tree[0]] = 1;
  for (let i = 0; i < N; i++) nodePressure[i] = served[i] ? Math.max(0, 9.81 * g * head[i]) : 0;
  totalFlow = infra.laterals.reduce((s, l) => s + ((l.residents * 300 + l.jobs * 60) / 86400 / 1000) * fw, 0);
  let minPressure = Infinity, lowNodes = 0, criticalNodes = 0;
  for (let i = 0; i < N; i++) if (served[i]) { minPressure = Math.min(minPressure, nodePressure[i]); if (nodePressure[i] < 241) lowNodes++; if (nodePressure[i] < 140) criticalNodes++; }
  const water = { nodePressure, minPressure: Number.isFinite(minPressure) ? minPressure : 0, lowNodes, criticalNodes, totalFlow, mains: [...mainsOut.values()], staticKPa: 9.81 * g * infra.water.towerHeight };

  // ---- power: voltage drop along feeders from each substation bus
  let resLoad = 0, jobLoad = 0;
  for (const l of infra.laterals) { resLoad += l.residents * 0.7; jobLoad += l.jobs * 1.0; }
  // the feeders were sized for the peak hour, so the hourly factor is the blended profile relative to its own peak
  const blendAt = (hh) => (resLoad + jobLoad > 0 ? (resLoad * PROFILES.residential[hh] + jobLoad * PROFILES.commercial[hh]) / (resLoad + jobLoad) : 1);
  const blendPeak = Math.max(...Array.from({ length: 24 }, (_, hh) => blendAt(hh)));
  const blend = blendAt(h) / blendPeak;
  const pf = resLoad + jobLoad > 0 ? (resLoad * POWER_FLOW.pfResidential + jobLoad * POWER_FLOW.pfCommercial) / (resLoad + jobLoad) : 0.95;
  const fchildren = new Map();
  for (const f of infra.power.feeders) (fchildren.get(f.b) ?? fchildren.set(f.b, []).get(f.b)).push(f);
  const volt = new Float64Array(N), nodeVoltage = new Float64Array(N);
  const feedersOut = [];
  const Vn = POWER_FLOW.kV * 1e3;
  for (const s of infra.power.substations) {
    volt[s.node] = Vn;
    const stack = [s.node];
    while (stack.length) {
      const u = stack.pop();
      for (const f of fchildren.get(u) ?? []) {
        const S = f.loadMVA * 1e6 * blend, I = S / (Math.sqrt(3) * Vn), cable = cableFor(f.classMVA);
        const dv = voltageDrop(I, f.length / 1000, cable.R, POWER_FLOW.X / cable.parallel, pf);
        volt[f.a] = volt[u] - dv;
        feedersOut.push({ edge: f.edge, amps: I, loading: I / cable.ampacity, dropV: dv, cable: `${cable.parallel}×${cable.mm2} mm²` });
        stack.push(f.a);
      }
    }
  }
  for (let i = 0; i < N; i++) nodeVoltage[i] = volt[i] > 0 ? volt[i] / Vn : 0;
  let underVoltage = 0, minPu = 1;
  for (let i = 0; i < N; i++) if (nodeVoltage[i] > 0) { minPu = Math.min(minPu, nodeVoltage[i]); if (nodeVoltage[i] < POWER_FLOW.minPu) underVoltage++; }
  const substations = infra.power.substations.map((s) => ({ node: s.node, loadMVA: s.loadMVA * blend, loading: (s.loadMVA * blend) / s.ratingMVA }));
  const power = { nodeVoltage, minPu, underVoltage, feeders: feedersOut, substations, totalMVA: infra.power.peakMVA * blend, blend, maxFeederLoading: Math.max(0, ...feedersOut.map((f) => f.loading)), maxSubstationLoading: Math.max(0, ...substations.map((s) => s.loading)) };

  // ---- sewers: Manning partial flow per pipe; design peak hour equals the Harmon peak the pipe was sized for
  const fs = PROFILES.sewage[h] / PROFILES.sewage[PEAK_HOUR.sewage];
  const pipesOut = [];
  let surcharged = 0, maxFullness = 0;
  for (const p of infra.sewer.pipes) {
    const Q = p.flow * fs;
    let fullness;
    if (p.forceMain) fullness = 1;
    else {
      const A = Math.PI * p.diameter * p.diameter / 4, R = p.diameter / 4;
      const Qfull = A * (1 / SEWER.manningN) * Math.pow(R, 2 / 3) * Math.sqrt(p.slope) * Math.sqrt(g);
      fullness = partialFlowDepth(Qfull > 0 ? Q / Qfull : 0);
    }
    if (!p.forceMain && fullness > 1) surcharged++;
    if (!p.forceMain) maxFullness = Math.max(maxFullness, fullness);
    pipesOut.push({ edge: p.edge, flow: Q, fullness, forceMain: p.forceMain, surcharged: !p.forceMain && fullness > 1 });
  }
  const sewer = { pipes: pipesOut, surcharged, maxFullness, totalFlow: infra.sewer.plants.reduce((s, p) => s + p.flowM3Day, 0) / 86400 * PROFILES.sewage[h] };

  // ---- metro: gravity-model commuting between station catchments, assigned to the tunnel tree
  const transit = metroFlows(layout, infra, h);

  const flags = [];
  if (water.criticalNodes) flags.push(`${water.criticalNodes} nodes below 140 kPa`); else if (water.lowNodes) flags.push(`${water.lowNodes} nodes below 241 kPa`);
  if (power.underVoltage) flags.push(`${power.underVoltage} nodes under 0.95 pu`);
  if (power.maxSubstationLoading > 1) flags.push('a substation over rating');
  if (sewer.surcharged) flags.push(`${sewer.surcharged} sewers surcharged`);
  if (transit.maxLoadFactor > 1) flags.push('a metro link over capacity');
  return { hour: h, water, power, sewer, transit, flags };
}

function metroCatchments(layout, infra) {
  const st = infra.transit.stations;
  if (st.length < 2) return null;
  const P = new Float64Array(st.length), A = new Float64Array(st.length), of = new Int32Array(layout.buildings.length).fill(-1);
  for (const l of infra.laterals) {
    const b = layout.buildings[l.building];
    let best = -1, bd = GROWTH.catchment;
    st.forEach((s, i) => { const dd = dist(s.pos, b.pos); if (dd < bd) { bd = dd; best = i; } });
    if (best < 0) continue;
    of[l.building] = best; P[best] += l.residents; A[best] += l.jobs;
  }
  // tunnel tree with parent pointers from station 0
  const adj = new Map(), link = (a, b, i) => (adj.get(a) ?? adj.set(a, []).get(a)).push([b, i]);
  infra.transit.tunnels.forEach((t, i) => { link(t.a, t.b, i); link(t.b, t.a, i); });
  const nodeStation = new Map(st.map((s, i) => [s.node, i]));
  const parentNode = new Map([[st[0].node, -1]]), parentLink = new Map(), depth = new Map([[st[0].node, 0]]);
  const stack = [st[0].node];
  while (stack.length) { const u = stack.pop(); for (const [v, i] of adj.get(u) ?? []) if (!parentNode.has(v)) { parentNode.set(v, u); parentLink.set(v, i); depth.set(v, depth.get(u) + 1); stack.push(v); } }
  const pathLinks = (i, j) => {
    let a = st[i].node, b = st[j].node; const out = [];
    if (!depth.has(a) || !depth.has(b)) return out;
    while (depth.get(a) > depth.get(b)) { out.push([parentLink.get(a), a, parentNode.get(a)]); a = parentNode.get(a); }
    const tail = [];
    while (depth.get(b) > depth.get(a)) { tail.push([parentLink.get(b), parentNode.get(b), b]); b = parentNode.get(b); }
    while (a !== b) { out.push([parentLink.get(a), a, parentNode.get(a)]); a = parentNode.get(a); tail.push([parentLink.get(b), parentNode.get(b), b]); b = parentNode.get(b); }
    return out.concat(tail.reverse());
  };
  // daily trips: gravity model, scaled to commuters × mode share
  const n = st.length, T = Array.from({ length: n }, () => new Float64Array(n));
  let raw = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j || P[i] <= 0 || A[j] <= 0) continue;
    const dkm = Math.max(0.4, dist(st[i].pos, st[j].pos) / 1000);
    T[i][j] = (P[i] * A[j]) / dkm; raw += T[i][j];
  }
  const totalP = P.reduce((s, x) => s + x, 0), totalA = A.reduce((s, x) => s + x, 0);
  const daily = Math.min(totalP, totalA) * GROWTH.modeShare;
  const k = raw > 0 ? daily / raw : 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) T[i][j] *= k;
  // daily link usage (both directions) for impact analysis
  const linkDaily = new Float64Array(infra.transit.tunnels.length);
  const stationDaily = new Float64Array(n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (T[i][j] > 0) { for (const [li] of pathLinks(i, j)) linkDaily[li] += 2 * T[i][j]; stationDaily[i] += T[i][j]; stationDaily[j] += T[i][j]; }
  return { P, A, of, T, daily, pathLinks, linkDaily, stationDaily, nodeStation };
}
function metroFlows(layout, infra, h) {
  const cm = metroCatchments(layout, infra);
  const tunnels = infra.transit.tunnels;
  if (!cm) return { links: [], stations: [], dailyTrips: 0, hourTrips: 0, maxLoadFactor: 0 };
  const share = PROFILES.rail[h], hourTrips = cm.daily * share, am = h < 13;
  const n = infra.transit.stations.length;
  const loadAB = new Float64Array(tunnels.length), loadBA = new Float64Array(tunnels.length), boardings = new Float64Array(n), alightings = new Float64Array(n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const t = cm.T[i][j] * share; if (t <= 0) continue;
    const from = am ? i : j, to = am ? j : i; // morning home→job, afternoon job→home
    boardings[from] += t; alightings[to] += t;
    for (const [li, u] of cm.pathLinks(from, to)) { if (tunnels[li].a === u) loadAB[li] += t; else loadBA[li] += t; }
  }
  const cap = GROWTH.lineCapacity;
  const links = tunnels.map((t, i) => ({ edge: t.edge, loadAB: loadAB[i], loadBA: loadBA[i], capacity: cap, loadFactor: Math.max(loadAB[i], loadBA[i]) / cap }));
  return { links, stations: infra.transit.stations.map((s, i) => ({ node: s.node, boardings: boardings[i], alightings: alightings[i], catchmentResidents: Math.round(cm.P[i]), catchmentJobs: Math.round(cm.A[i]) })),
    dailyTrips: cm.daily, hourTrips, maxLoadFactor: Math.max(0, ...links.map((l) => l.loadFactor)), direction: am ? 'inbound' : 'outbound' };
}

// ---------------------------------------------------------------- failure analysis
export function impact(layout, infra, asset) {
  const { kind, index } = asset;
  const N = infra.graph.nodes.length;
  const nodeBuildings = new Map();
  for (const l of infra.laterals) (nodeBuildings.get(l.node) ?? nodeBuildings.set(l.node, []).get(l.node)).push(l);
  const people = (lats) => lats.reduce((s, l) => s + l.residents, 0), jobsOf = (lats) => lats.reduce((s, l) => s + l.jobs, 0);
  const totalPeople = people(infra.laterals) || 1;
  const collect = (nodeSet) => { const out = []; for (const n of nodeSet) for (const l of nodeBuildings.get(n) ?? []) out.push(l); return out; };
  const done = (affectedLats, degradedLats, extra, summary) => ({
    kind, index, affected: affectedLats.map((l) => l.building), degraded: degradedLats.map((l) => l.building),
    people: Math.round(people(affectedLats)), degradedPeople: Math.round(people(degradedLats)), jobs: Math.round(jobsOf(affectedLats)),
    share: people(affectedLats) / totalPeople, ...extra, summary,
  });
  const pct = (x) => `${(100 * x).toFixed(x < 0.01 ? 2 : 0)} %`;

  // ---- water
  const waterReachable = (excludeTower, excludeEdge) => {
    const adj = new Map(); const link = (a, b) => (adj.get(a) ?? adj.set(a, []).get(a)).push(b);
    for (const m of infra.water.mains) { if (m.edge === excludeEdge) continue; link(m.a, m.b); link(m.b, m.a); }
    const seen = new Set();
    for (const [i, t] of infra.water.towers.entries()) { if (i === excludeTower) continue; if (seen.has(t.node)) continue; const st = [t.node]; seen.add(t.node); while (st.length) { const u = st.pop(); for (const v of adj.get(u) ?? []) if (!seen.has(v)) { seen.add(v); st.push(v); } } }
    return seen;
  };
  const zoneNodes = (z) => { const s = new Set(); for (const m of infra.water.mains) if (m.tree && m.zone === z) s.add(m.tree[0]); s.add(infra.water.towers[z].node); return s; };
  if (kind === 'tower') {
    const zone = zoneNodes(index), reach = waterReachable(index, null);
    const cut = new Set(), deg = new Set();
    for (const n of zone) (reach.has(n) ? deg : cut).add(n);
    const a = collect(cut), d = collect(deg);
    return done(a, d, {}, `Tank ${index + 1} out: ${a.length} buildings (${Math.round(people(a)).toLocaleString('en-US')} people) lose water; ${d.length} more keep a trickle through loop mains from other tanks.`);
  }
  if (kind === 'waterplant') {
    const storage = infra.water.towers.reduce((s, t) => s + t.storageM3, 0), demand = infra.water.towers.reduce((s, t) => s + t.demandM3Day, 0) / 24;
    const hours = demand > 0 ? storage / demand : 0;
    return done([], infra.laterals, { hoursOfStorage: hours }, `Treatment plant out: no refill. The tanks hold about ${hours.toFixed(0)} hours of average demand before the city runs dry.`);
  }
  if (kind === 'water') {
    const m = infra.water.mains[index];
    if (!m || !m.tree) return done([], [], {}, 'A loop main out: distribution continues through the other paths.');
    // subtree below this main loses its tree supply
    const kids = new Map(); for (const x of infra.water.mains) if (x.tree) (kids.get(x.tree[1]) ?? kids.set(x.tree[1], []).get(x.tree[1])).push(x.tree[0]);
    const sub = new Set([m.tree[0]]), st = [m.tree[0]]; while (st.length) { const u = st.pop(); for (const v of kids.get(u) ?? []) if (!sub.has(v)) { sub.add(v); st.push(v); } }
    const reach = waterReachable(-1, m.edge), cut = new Set(), deg = new Set();
    for (const n of sub) (reach.has(n) ? deg : cut).add(n);
    const a = collect(cut), d = collect(deg);
    return done(a, d, {}, `Main broken: ${a.length} buildings cut off, ${d.length} supplied the long way round.`);
  }
  // ---- sewer
  const chainPasses = (startNode, target) => { let u = startNode, guard = 0; while (u >= 0 && guard++ < 100000) { if (u === target) return true; const pi = infra.sewer.byUp[u]; if (pi < 0) return false; u = infra.sewer.pipes[pi].down; } return false; };
  if (kind === 'treatment') {
    const a = infra.laterals.filter((l) => { const pi = infra.sewer.byUp[l.node]; return pi >= 0 ? infra.sewer.pipes[pi].plant === index : infra.sewer.plants[index].node === l.node; });
    return done(a, [], {}, `Treatment plant ${index + 1} out: sewage from ${a.length} buildings (${Math.round(people(a)).toLocaleString('en-US')} people) has nowhere to go and overflows at the inlet.`);
  }
  if (kind === 'lift') {
    const node = infra.sewer.liftStations[index].node;
    const a = infra.laterals.filter((l) => chainPasses(l.node, node));
    return done(a, [], {}, `Lift station out: ${a.length} upstream buildings back up within hours.`);
  }
  if (kind === 'sewer') {
    const p = infra.sewer.pipes[index];
    const a = infra.laterals.filter((l) => chainPasses(l.node, p.up));
    return done(a, [], {}, `Sewer collapsed: ${a.length} upstream buildings back up.`);
  }
  // ---- power
  if (kind === 'plant') {
    const pl = infra.power.plants[index];
    const lost = strandedSubstations(infra, new Set(), new Set([pl.node]));
    const a = infra.laterals.filter((l) => lost.has(infra.power.nodeFeeder[l.node]));
    const remaining = infra.power.plants.filter((_, i) => i !== index).reduce((s, p) => s + p.capacityMW, 0);
    const short = Math.max(0, infra.power.peakMW - remaining);
    return done(a, short > 0 ? infra.laterals.filter((l) => !lost.has(infra.power.nodeFeeder[l.node])) : [], { shortfallMW: short },
      infra.power.plants.length > 1
        ? `${pl.kind[0].toUpperCase()}${pl.kind.slice(1)} out: ${lost.size} substation${lost.size === 1 ? '' : 's'} lose their only source${short > 0 ? `; the rest run ${short.toFixed(0)} MW short at peak (rolling cuts)` : ''}.`
        : `Power station out: the whole city goes dark (${Math.round(people(a)).toLocaleString('en-US')} people).`);
  }
  if (kind === 'substation') {
    const a = infra.laterals.filter((l) => infra.power.nodeFeeder[l.node] === index);
    return done(a, [], {}, `Substation ${index + 1} out: ${a.length} buildings (${Math.round(people(a)).toLocaleString('en-US')} people) lose power until the zone is back-fed.`);
  }
  if (kind === 'power') {
    const f = infra.power.feeders[index];
    const byA = new Map(infra.power.feeders.map((x) => [x.a, x]));
    const passes = (n) => { let u = n, guard = 0; while (guard++ < 100000) { if (u === f.a) return true; const nx = byA.get(u); if (!nx) return false; u = nx.b; } return false; };
    const a = infra.laterals.filter((l) => passes(l.node));
    return done(a, [], {}, `Feeder cut: ${a.length} buildings downstream lose power.`);
  }
  if (kind === 'transmission') {
    const t = infra.power.transmission[index];
    // every logical line through this corridor fails; substations left without a path to the plant go dark
    const lost = strandedSubstations(infra, new Set(t.lines ?? [t.line]));
    const a = infra.laterals.filter((l) => lost.has(infra.power.nodeFeeder[l.node]));
    return done(a, [], { substations: [...lost] }, lost.size
      ? `Transmission corridor cut: ${lost.size} substation${lost.size === 1 ? '' : 's'} and ${a.length} buildings lose supply.`
      : 'Transmission corridor cut: the meshed grid keeps every substation connected.');
  }
  // ---- transit
  if (kind === 'transit' || kind === 'station') {
    const cm = metroCatchments(layout, infra);
    if (!cm) return done([], [], { tripsLost: 0 }, 'No metro here.');
    let lost = 0;
    if (kind === 'transit') lost = cm.linkDaily[index] / 2 / (cm.daily || 1);
    else lost = cm.stationDaily[index] / (cm.daily || 1);
    const riders = Math.round(lost * cm.daily);
    const lats = kind === 'station' ? infra.laterals.filter((l) => cm.of[l.building] === index) : [];
    return done([], lats, { tripsLost: Math.min(1, lost) }, kind === 'transit'
      ? `Tunnel closed: ${pct(lost)} of daily trips (${riders.toLocaleString('en-US')}) lose their route.`
      : `Station closed: ${pct(lost)} of daily trips (${riders.toLocaleString('en-US')}) start or end here.`);
  }
  return done([], [], {}, 'No failure model for this asset.');
}

// substations (by index) that lose every path to the plant when the given logical lines fail
function strandedSubstations(infra, failedLines, failedSources = new Set()) {
  const sources = (infra.power.sources ?? infra.power.plants.map((p) => p.node)).filter((n) => !failedSources.has(n));
  const adjL = new Map(); const link = (x, y) => (adjL.get(x) ?? adjL.set(x, []).get(x)).push(y);
  (infra.power.lines ?? []).forEach((l, i) => { if (failedLines.has(i)) return; link(l.from, l.to); link(l.to, l.from); });
  const seen = new Set(sources), st = [...sources];
  while (st.length) { const u = st.pop(); for (const v of adjL.get(u) ?? []) if (!seen.has(v)) { seen.add(v); st.push(v); } }
  const lost = new Set(); infra.power.substations.forEach((s, i) => { if (!seen.has(s.node)) lost.add(i); });
  return lost;
}

// N-1: the worst single failure per network, as a share of people (or trips) lost.
export function resilience(layout, infra) {
  const worstOf = (cands) => cands.reduce((m, c) => (c.share > m.share ? c : m), { share: 0, kind: 'none', index: -1 });
  // water: people who lose their designed source (loop mains from other tanks only keep a trickle)
  const water = worstOf(infra.water.towers.map((_, i) => { const r = impact(layout, infra, { kind: 'tower', index: i }); return { share: r.share + r.degradedPeople / Math.max(1, infra.laterals.reduce((s, l) => s + l.residents, 0)), kind: 'tower', index: i }; }));
  const totalPeople = Math.max(1, infra.laterals.reduce((s, l) => s + l.residents, 0));
  const zonePeople = new Float64Array(infra.power.substations.length);
  for (const l of infra.laterals) { const z = infra.power.nodeFeeder[l.node]; if (z >= 0) zonePeople[z] += l.residents; }
  // transmission: one dig cuts every line in a corridor; score each distinct corridor once
  const corridors = new Map();
  infra.power.transmission.forEach((t, ti) => { const key = (t.lines ?? [t.line]).slice().sort((x, y) => x - y).join(','); if (!corridors.has(key)) corridors.set(key, { lines: t.lines ?? [t.line], index: ti }); });
  const corridorShare = [...corridors.values()].map((c) => { let p = 0; for (const z of strandedSubstations(infra, new Set(c.lines))) p += zonePeople[z]; return { share: p / totalPeople, kind: 'transmission', index: c.index }; });
  const power = worstOf([
    ...infra.power.substations.map((_, i) => ({ share: zonePeople[i] / totalPeople, kind: 'substation', index: i })),
    ...corridorShare,
  ]);
  const totalAvg = infra.sewer.plants.reduce((s, p) => s + p.flowM3Day, 0) / 86400;
  const sewer = worstOf([
    ...infra.sewer.plants.map((_, i) => ({ share: impact(layout, infra, { kind: 'treatment', index: i }).share, kind: 'treatment', index: i })),
    // a lift station's exposure is the share of the city's flow passing through it (the sewer tree already aggregated it)
    ...infra.sewer.liftStations.map((ls, i) => { const pi = infra.sewer.byUp[ls.node]; return { share: pi >= 0 ? infra.sewer.pipes[pi].avgFlow / Math.max(1e-12, totalAvg) : 0, kind: 'lift', index: i }; }),
  ]);
  const cm = metroCatchments(layout, infra);
  const transit = cm ? worstOf(infra.transit.tunnels.map((_, i) => ({ share: Math.min(1, cm.linkDaily[i] / 2 / (cm.daily || 1)), kind: 'transit', index: i }))) : { share: 0, kind: 'none', index: -1 };
  const wrap = (w) => ({ worstShare: w.share, worst: { kind: w.kind, index: w.index }, score: 1 - w.share });
  return { water: wrap(water), power: wrap(power), sewer: wrap(sewer), transit: wrap(transit) };
}
