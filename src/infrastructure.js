// Underground infrastructure for a generated city: a street graph, service connections for every
// building, gravity sewers with lift stations, looped water mains fed from elevated tanks, a power
// plant with substations and feeders, metro tunnels under the foundations, and utility tunnels for
// arcologies. Pure data in, pure data out; the viewer draws it and the tests check it.
import { mulberry32 } from './cymatic-engine.js';

const G0 = 9.80665;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const norm3 = (a) => { const l = len3(a); return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0]; };
const dist = (a, b) => len3(sub(a, b));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ---------------------------------------------------------------- design constants (see utility_networks.md)
export const SEWER = {
  minCover: 1.5,          // m to pipe crown at the start of a run (Illinois 0.9 m cover + pipe)
  maxDepth: 8,            // m, beyond which a lift station is cheaper than digging (unsourced, common practice)
  manningN: 0.013,        // concrete
  fullness: 0.8,          // design pipes to run 80 % full at peak
  perCapitaLpd: 300,      // wastewater incl. infiltration (Utah 380, Saanich 360; towns lower)
  perJobLpd: 60,
  manholeSpacing: 120,    // m (Utah, pipes ≤ 375 mm)
  plantPopulation: 300000,
  diameters: [0.2, 0.25, 0.3, 0.375, 0.45, 0.6, 0.75, 0.9, 1.05, 1.2, 1.5, 1.8, 2.1, 2.4, 3.0],
};
// Ten-State minimum slopes (m/m) by diameter, Earth gravity
const SLOPE_TABLE = [[0.2, 0.004], [0.25, 0.0028], [0.3, 0.0022], [0.375, 0.0015], [0.45, 0.0012], [0.6, 0.0008], [0.75, 0.00058], [0.9, 0.00046]];
export function sewerMinSlope(diameter, gravityRel) {
  let s = SLOPE_TABLE[0][1];
  for (const [d, sl] of SLOPE_TABLE) if (diameter >= d - 1e-9) s = sl;
  if (diameter > 0.9) s = 0.00046 * Math.pow(0.9 / diameter, 1.2);
  return s / gravityRel; // self-cleansing velocity criterion: v = √(8 g R S / f) → S ∝ 1/g
}
// Manning full-flow capacity, with n rescaled by √(g₀/g) so the velocity criterion carries over
function sewerCapacity(D, slope, gravityRel) {
  const A = Math.PI * D * D / 4, R = D / 4;
  return SEWER.fullness * A * (1 / SEWER.manningN) * Math.pow(R, 2 / 3) * Math.sqrt(slope) * Math.sqrt(gravityRel);
}
// Harmon peaking factor (P in thousands)
const harmon = (pop) => 1 + 14 / (4 + Math.sqrt(Math.max(pop, 1) / 1000));

export const WATER = {
  perCapitaLpd: 300, perJobLpd: 60, peakHour: 3.0, maxDay: 1.8,
  minMain: 0.15, designVelocity: 1.5, maxVelocity: 2.5, cover: 1.5,
  headM: 35,              // ≈ 3.4 bar static at the tap on Earth
  maxTowerHeight: 80,     // taller than this and the zone is pumped instead
  minHeadM: 20,           // ≈ 2.0 bar static: below this a node needs its own (higher) tank
  maxHeadM: 56,           // ≈ 5.5 bar (AWWA 552 kPa): above this a pressure-reducing valve is fitted
  tankSearch: 300,        // m: a tank moves to the highest ground within this distance of its site
  zonePopulation: 25000,
  diameters: [0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 1.2, 1.5],
};
export const POWER = {
  kWPerResident: 0.7, kWPerJob: 1.0, peakFactor: 1.6, powerFactor: 0.9,   // ≈1.2 kW per resident all-in at peak
  substationMVA: { town: 30, city: 60, megastructure: 120, alien: 90 },
  loadingLimit: 0.75,     // initial substation count assumes 75 % loading; zones split only when a rating is exceeded
  cableDepth: 0.9, transmissionDepth: 1.5,
  feederClassesMVA: [2, 4, 8, 12, 20, 30, 40, 60, 90, 120, 180],
  transmissionKV: 110, distributionKV: 11,
};
export const TRANSIT = {
  minDepth: 20, diameter: 6.3, clearance: 4.5, minSpacing: 700, maxStations: 24,
  stationLength: 120, stationWidth: 20, corridor: 12,
};
export const UTILIDOR = { width: 3, height: 3, depth: 6 };

// Piles roughly a tenth of the height plus a basement; capped near the deepest built piles.
export function foundationDepth(b) {
  return Math.min(60, 2 + 0.1 * b.h);
}

// ---------------------------------------------------------------- helpers
class Heap {
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
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}
class PointHash {
  constructor(cell) { this.cell = cell; this.map = new Map(); }
  key(P) { const c = this.cell; return `${Math.floor(P[0] / c)},${Math.floor(P[1] / c)},${Math.floor(P[2] / c)}`; }
  add(P, val) { const k = this.key(P); (this.map.get(k) ?? this.map.set(k, []).get(k)).push([P, val]); }
  // all values within r (r ≤ cell · rings)
  near(P, r, rings = 1) {
    const c = this.cell, x0 = Math.floor(P[0] / c), y0 = Math.floor(P[1] / c), z0 = Math.floor(P[2] / c), out = [];
    for (let x = x0 - rings; x <= x0 + rings; x++) for (let y = y0 - rings; y <= y0 + rings; y++) for (let z = z0 - rings; z <= z0 + rings; z++) {
      const arr = this.map.get(`${x},${y},${z}`); if (!arr) continue;
      for (const [Q, v] of arr) { const d = dist(P, Q); if (d <= r) out.push([v, d]); }
    }
    return out;
  }
  nearest(P, maxRings = 6) {
    for (let rings = 1; rings <= maxRings; rings++) {
      const got = this.near(P, this.cell * rings, rings);
      if (got.length) { got.sort((a, b) => a[1] - b[1]); return got[0]; }
    }
    return null;
  }
}
// Dijkstra from several sources; returns distance, parent node (toward the source), parent edge and source id.
export function dijkstra(graph, sources, weight = (e) => e.len) {
  const n = graph.nodes.length;
  const d = new Float64Array(n).fill(Infinity), parent = new Int32Array(n).fill(-1), pedge = new Int32Array(n).fill(-1), src = new Int32Array(n).fill(-1);
  const heap = new Heap(), order = [];
  sources.forEach((s, i) => { d[s] = 0; src[s] = i; heap.push(0, s); });
  while (heap.size) {
    const [dd, u] = heap.pop();
    if (dd > d[u]) continue;
    order.push(u); // settled in order of distance: parents always precede their children
    for (const ei of graph.adj[u]) {
      const e = graph.edges[ei], v = e.a === u ? e.b : e.a, w = weight(e, u, v);
      if (dd + w < d[v] - 1e-12) { d[v] = dd + w; parent[v] = u; pedge[v] = ei; src[v] = src[u]; heap.push(d[v], v); }
    }
  }
  return { d, parent, pedge, src, order };
}
// Nodes ordered leaves-first (decreasing distance) so loads can be accumulated toward the sources.
const leavesFirst = (d) => Array.from(d.keys()).filter((i) => Number.isFinite(d[i])).sort((a, b) => d[b] - d[a] || a - b);
// Farthest-point sampling over a candidate node list
function farthestPoints(graph, candidates, k, start) {
  const picked = [start];
  const best = new Float64Array(graph.nodes.length).fill(Infinity);
  while (picked.length < k) {
    const P = graph.nodes[picked[picked.length - 1]].pos;
    let far = -1, farD = -1;
    for (const c of candidates) {
      best[c] = Math.min(best[c], dist(graph.nodes[c].pos, P));
      if (best[c] > farD) { farD = best[c]; far = c; }
    }
    if (far < 0 || farD < 1) break;
    picked.push(far);
  }
  return picked;
}
const pickDiameter = (list, need) => list.find((d) => d >= need - 1e-12) ?? list[list.length - 1];

// ---------------------------------------------------------------- street graph
export function buildStreetGraph(layout) {
  const roads = layout.roads;
  const sphere0 = layout.meta.plate === 'sphere', Rs0 = layout.meta.world.Rs;
  // on terrain, streets meet in plan: positions carry an elevation, the graph is built on their plan projection
  const terrainOn = !!(layout.meta.terrain && layout.meta.terrain.mode !== 'flat');
  const plan = !terrainOn ? (P) => P : sphere0 ? (P) => scale3(norm3(P), Rs0) : (P) => [P[0], 0, P[2]];
  const elevOf = !terrainOn ? () => 0 : sphere0 ? (P) => len3(P) - Rs0 : (P) => P[1];
  const placed = sphere0 ? (M, el) => scale3(norm3(M), Rs0 + el) : (M, el) => [M[0], el, M[2]];
  const nodes = [], index = new Map();
  const key = (P) => { const Q = plan(P); return `${Math.round(Q[0] * 4)},${Math.round(Q[1] * 4)},${Math.round(Q[2] * 4)}`; };
  const nodeOf = (P) => {
    const k = key(P); let id = index.get(k);
    if (id === undefined) { id = nodes.length; index.set(k, id); nodes.push({ pos: P, deg: 0, elev: elevOf(P) }); }
    return id;
  };
  const raw = roads.map((r) => ({ a: nodeOf(r.a), b: nodeOf(r.b), kind: r.kind, w: r.w, bridge: !!r.bridge })).filter((e) => e.a !== e.b);
  // split any segment that another node sits on (spoke starts at segment midpoints)
  const hash = new PointHash(40);
  nodes.forEach((n, i) => hash.add(plan(n.pos), i));
  const edges = [];
  const seen = new Set();
  const pushEdge = (a, b, kind, w, bridge = false) => {
    if (a === b) return;
    const k = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(k)) return;
    seen.add(k);
    const e = { a, b, kind, w, len: dist(nodes[a].pos, nodes[b].pos) };
    if (bridge) e.bridge = true;
    edges.push(e);
  };
  for (const e of raw) {
    const A = plan(nodes[e.a].pos), B = plan(nodes[e.b].pos), ab = sub(B, A), L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
    const mid = scale3(add(A, B), 0.5), splits = [];
    for (const [ni] of hash.near(mid, Math.sqrt(L2) / 2 + 0.5, 1)) {
      if (ni === e.a || ni === e.b) continue;
      const ap = sub(plan(nodes[ni].pos), A), t = (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L2;
      if (t <= 0.02 || t >= 0.98) continue;
      const perp = len3(sub(ap, scale3(ab, t)));
      if (perp < 0.5) splits.push([t, ni]);
    }
    splits.sort((x, y) => x[0] - y[0]);
    let prev = e.a;
    for (const [, ni] of splits) { pushEdge(prev, ni, e.kind, e.w, e.bridge); prev = ni; }
    pushEdge(prev, e.b, e.kind, e.w, e.bridge);
  }
  // junctions where streets cross without sharing a node (spokes across rings, spokes across spokes)
  {
    const sphere = sphere0, Rs = Rs0;
    const cell = 40, ehash = new Map();
    const ekey = (x, z, y) => `${x},${y},${z}`;
    const cellsOf = (e) => {
      const A = plan(nodes[e.a].pos), B = plan(nodes[e.b].pos), out = [];
      const x0 = Math.floor(Math.min(A[0], B[0]) / cell), x1 = Math.floor(Math.max(A[0], B[0]) / cell);
      const z0 = Math.floor(Math.min(A[2], B[2]) / cell), z1 = Math.floor(Math.max(A[2], B[2]) / cell);
      const y0 = sphere ? Math.floor(Math.min(A[1], B[1]) / cell) : 0, y1 = sphere ? Math.floor(Math.max(A[1], B[1]) / cell) : 0;
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) out.push(ekey(x, z, y));
      return out;
    };
    edges.forEach((e, i) => { for (const k of cellsOf(e)) (ehash.get(k) ?? ehash.set(k, []).get(k)).push(i); });
    const splits = edges.map(() => []);
    const tested = new Set();
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      for (const k of cellsOf(e)) for (const j of ehash.get(k)) {
        if (j <= i) continue;
        const pk = i * edges.length + j; if (tested.has(pk)) continue; tested.add(pk);
        const f = edges[j];
        if (e.a === f.a || e.a === f.b || e.b === f.a || e.b === f.b) continue;
        // closest approach of the two segments; a crossing has interior parameters and near-zero gap
        const P = plan(nodes[e.a].pos), Q = plan(nodes[f.a].pos), u = sub(plan(nodes[e.b].pos), P), v = sub(plan(nodes[f.b].pos), Q), w = sub(P, Q);
        const a = u[0] * u[0] + u[1] * u[1] + u[2] * u[2], b = u[0] * v[0] + u[1] * v[1] + u[2] * v[2], c = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
        const d = u[0] * w[0] + u[1] * w[1] + u[2] * w[2], g2 = v[0] * w[0] + v[1] * w[1] + v[2] * w[2], den = a * c - b * b;
        if (den < 1e-9) continue;
        const t = (b * g2 - c * d) / den, r = (a * g2 - b * d) / den;
        if (t <= 0.03 || t >= 0.97 || r <= 0.03 || r >= 0.97) continue;
        const X = add(P, scale3(u, t)), Y = add(Q, scale3(v, r));
        if (dist(X, Y) > 1.0) continue;
        let M = scale3(add(X, Y), 0.5);
        if (sphere) M = scale3(norm3(M), Rs);
        let el = 0;
        if (terrainOn) {
          // the junction sits on the ground: elevation interpolated along both streets
          const ea = nodes[e.a].elev + t * (nodes[e.b].elev - nodes[e.a].elev), fb = nodes[f.a].elev + r * (nodes[f.b].elev - nodes[f.a].elev);
          el = 0.5 * (ea + fb); M = placed(M, el);
        }
        const id = nodes.length; nodes.push({ pos: M, deg: 0, elev: el });
        splits[i].push([t, id]); splits[j].push([r, id]);
      }
    }
    if (splits.some((x) => x.length)) {
      const old = edges.splice(0, edges.length); seen.clear();
      old.forEach((e, i) => {
        const sp = splits[i].sort((x, y) => x[0] - y[0]);
        let prev = e.a;
        for (const [, id] of sp) { pushEdge(prev, id, e.kind, e.w, e.bridge); prev = id; }
        pushEdge(prev, e.b, e.kind, e.w, e.bridge);
      });
    }
  }
  // connect stray components to the main one with short service roads
  const comp = new Int32Array(nodes.length).fill(-1); let nc = 0;
  const adj = nodes.map(() => []);
  edges.forEach((e, i) => { adj[e.a].push(i); adj[e.b].push(i); });
  for (let s = 0; s < nodes.length; s++) {
    if (comp[s] >= 0) continue;
    const stack = [s]; comp[s] = nc;
    while (stack.length) { const u = stack.pop(); for (const ei of adj[u]) { const e = edges[ei], v = e.a === u ? e.b : e.a; if (comp[v] < 0) { comp[v] = nc; stack.push(v); } } }
    nc++;
  }
  const sizes = new Array(nc).fill(0); for (const c of comp) sizes[c]++;
  const main = sizes.indexOf(Math.max(...sizes));
  const spacing = Math.sqrt(layout.meta.world.area / Math.max(1, nodes.length));
  const mainHash = new PointHash(Math.max(100, 4 * spacing));
  const mainNodes = [];
  nodes.forEach((n, i) => { if (comp[i] === main) { mainHash.add(n.pos, i); mainNodes.push(i); } });
  let connectors = 0;
  const members = Array.from({ length: nc }, () => []);
  nodes.forEach((_, i) => members[comp[i]].push(i));
  for (let c = 0; c < nc; c++) {
    if (c === main) continue;
    let bestPair = null;
    for (const i of members[c]) {
      const got = mainHash.nearest(nodes[i].pos, 3);
      if (got && (!bestPair || got[1] < bestPair[2])) bestPair = [i, got[0], got[1]];
    }
    if (!bestPair) {
      // far from everything: brute force from the component's centroid
      const cen = members[c].reduce((a, i) => add(a, nodes[i].pos), [0, 0, 0]).map((x) => x / members[c].length);
      const j = mainNodes.reduce((m, i) => (dist(nodes[i].pos, cen) < dist(nodes[m].pos, cen) ? i : m), mainNodes[0]);
      const i = members[c].reduce((m, k) => (dist(nodes[k].pos, nodes[j].pos) < dist(nodes[m].pos, nodes[j].pos) ? k : m), members[c][0]);
      bestPair = [i, j, dist(nodes[i].pos, nodes[j].pos)];
    }
    pushEdge(bestPair[0], bestPair[1], (layout.meta.arcology ?? layout.meta.preset === 'megastructure') ? 'corridor' : 'service', 4); connectors++;
  }
  const adj2 = nodes.map(() => []);
  edges.forEach((e, i) => { adj2[e.a].push(i); adj2[e.b].push(i); nodes[e.a].deg++; nodes[e.b].deg++; });
  return { nodes, edges, adj: adj2, connectors };
}

// ---------------------------------------------------------------- main entry
export function buildInfrastructure(layout) {
  const t0 = Date.now();
  const meta = layout.meta, pr = layout.presetParams ?? null;
  const base = meta.base ?? meta.preset;
  const g = meta.gravity, arcology = meta.arcology ?? base === 'megastructure', town = base === 'town';
  const sphere = meta.plate === 'sphere';
  const upAt = (P) => (sphere ? norm3(P) : [0, 1, 0]);
  const graph = buildStreetGraph(layout);
  const N = graph.nodes.length;
  const rng = mulberry32((meta.seed ^ 0x5bd1e995) >>> 0);

  // ---- service connections and loads
  // cell size follows node density so the nearest-node search stays a few cells wide
  const nodeHash = new PointHash(Math.max(40, 2.5 * Math.sqrt(meta.world.area / Math.max(1, N))));
  graph.nodes.forEach((n, i) => nodeHash.add(n.pos, i));
  const laterals = [];
  const resAt = new Float64Array(N), jobsAt = new Float64Array(N), bAt = new Int32Array(N);
  const shapeVolume = { block: 1, house: 1, tower: 1, terrace: 1, pod: 0.785, dome: 0.5, spire: 0.33 };
  const resShare = { residential: 0.9, mixed: 0.5, core: 0.25, green: 0 };
  layout.buildings.forEach((b, bi) => {
    const hit = nodeHash.nearest(b.pos, 12);
    if (!hit) return;
    const area = b.w * b.d * (shapeVolume[b.shape] ?? 1) * b.floors * 0.7 * (arcology ? 0.25 : 1);
    const share = arcology ? 0.75 : resShare[b.zone] ?? 0.5;
    const res = (area * share) / 45, jobs = (area * (1 - share)) / 15;
    resAt[hit[0]] += res; jobsAt[hit[0]] += jobs; bAt[hit[0]]++;
    laterals.push({ building: bi, node: hit[0], length: hit[1], residents: res, jobs });
  });
  const population = resAt.reduce((s, x) => s + x, 0), jobs = jobsAt.reduce((s, x) => s + x, 0);
  const loadNodes = []; for (let i = 0; i < N; i++) if (bAt[i]) loadNodes.push(i);
  const centre = sphere ? [0, meta.world.Rs, 0] : [0, 0, 0];
  const perimeter = []; for (const e of graph.edges) if (e.kind === 'wall') { perimeter.push(e.a); }
  const siteCandidates = perimeter.length ? [...new Set(perimeter)] : graph.nodes.map((_, i) => i).filter((i) => !bAt[i] || sphere);
  const nearestNode = (P) => nodeHash.nearest(P, 40)[0];
  const cornerStart = siteCandidates.reduce((m, i) => (graph.nodes[i].pos[0] + graph.nodes[i].pos[2] - graph.nodes[i].pos[1] < graph.nodes[m].pos[0] + graph.nodes[m].pos[2] - graph.nodes[m].pos[1] ? i : m), siteCandidates[0]);

  const terrainOn = !!(meta.terrain && meta.terrain.mode !== 'flat');
  const elev = Float64Array.from(graph.nodes, (n) => n.elev ?? 0);
  // pressure limits are pressures: the heads that give them scale as 1/g, like the tank height
  const minHeadM = WATER.minHeadM / g, maxHeadM = WATER.maxHeadM / g;
  // bridges carry no trench: utilities avoid them where a ground route exists
  const trenchWeight = (e) => (e.bridge ? 4 * e.len : e.len);

  // ---- sewer: multi-source shortest-path forest toward treatment plants, then size and deepen leaves-first
  // on terrain the pipes follow true inverts: ground elevation minus depth, falling at least the self-cleansing slope
  const sewer = (() => {
    const k = Math.max(1, Math.ceil(population / SEWER.plantPopulation));
    let sites = siteCandidates, start = cornerStart;
    if (terrainOn) {
      // treatment plants sit on the lowest ground available at the perimeter
      const byElev = [...siteCandidates].sort((a, b) => elev[a] - elev[b]);
      sites = byElev.slice(0, Math.max(k * 3, Math.ceil(byElev.length * 0.3)));
      start = byElev[0];
    }
    const plantNodes = farthestPoints(graph, sites, k, start);
    // routing prefers runs that fall toward the plant: climbing costs lift stations, so uphill length is weighted
    const sewerWeight = terrainOn
      ? (e, from, to) => trenchWeight(e) * (1 + 25 * Math.max(0, (elev[from] - elev[to]) / e.len))
      : trenchWeight;
    const { d, parent, pedge, src } = dijkstra(graph, plantNodes, sewerWeight);
    const order = leavesFirst(d);
    const avgFlow = new Float64Array(N), popUp = new Float64Array(N), nodeDepth = new Float64Array(N);
    const pipes = [], liftStations = [], byUp = new Int32Array(N).fill(-1);
    const maxUpD = new Float64Array(N);
    for (const u of order) {
      avgFlow[u] += (resAt[u] * SEWER.perCapitaLpd + jobsAt[u] * SEWER.perJobLpd) / 86400 / 1000; // m³/s
      popUp[u] += resAt[u] + jobsAt[u] * 0.3;
      if (parent[u] < 0) continue; // plant
      if (avgFlow[u] <= 0) continue; // nothing upstream: no sewer here
      const p = parent[u], e = graph.edges[pedge[u]];
      const peak = avgFlow[u] * harmon(popUp[u]);
      let D = maxUpD[u] || SEWER.diameters[0];
      for (const cand of SEWER.diameters) { if (cand < D) continue; D = cand; if (sewerCapacity(cand, sewerMinSlope(cand, g), g) >= peak) break; }
      const slope = sewerMinSlope(D, g);
      const rise = elev[p] - elev[u]; // ground rises (+) or falls (−) toward the plant
      let upDepth = Math.max(SEWER.minCover, nodeDepth[u]);
      let lift = false, forceMain = false, pipeSlope = slope;
      // depth at the downstream end for a gravity run at the minimum slope, never shallower than the cover
      const downFor = (ud) => Math.max(SEWER.minCover, ud + slope * e.len + rise);
      if (downFor(upDepth) > SEWER.maxDepth) {
        lift = true; liftStations.push({ node: u, pos: graph.nodes[u].pos, fromDepth: upDepth, flow: peak });
        upDepth = SEWER.minCover;
        // a run too long (or too uphill) to stay above the limit even from minimum cover is pumped: a force main at constant cover
        if (downFor(upDepth) > SEWER.maxDepth) { forceMain = true; pipeSlope = 0; }
      }
      let downDepth;
      if (forceMain) { downDepth = SEWER.minCover; }
      else {
        downDepth = downFor(upDepth);
        // the actual fall of the invert, steeper than the minimum where the ground drops
        const fall = ((elev[u] - upDepth) - (elev[p] - downDepth)) / e.len;
        pipeSlope = Math.abs(fall - slope) < 1e-9 ? slope : fall;
      }
      nodeDepth[u] = upDepth;
      nodeDepth[p] = Math.max(nodeDepth[p], downDepth);
      avgFlow[p] += avgFlow[u]; popUp[p] += popUp[u];
      maxUpD[p] = Math.max(maxUpD[p], D);
      byUp[u] = pipes.length;
      const pipe = { up: u, down: p, edge: pedge[u], length: e.len, diameter: D, slope: pipeSlope, upDepth, downDepth, flow: peak, avgFlow: avgFlow[u], lift, forceMain, plant: src[u] };
      if (e.bridge) pipe.bridge = true;
      pipes.push(pipe);
    }
    const plants = plantNodes.map((n, i) => ({ node: n, pos: graph.nodes[n].pos, flowM3Day: avgFlow[n] * 86400, depth: nodeDepth[n], served: Math.round(popUp[n]) }));
    // manholes at junctions and ends of runs
    const inDeg = new Int32Array(N); for (const p of pipes) inDeg[p.down]++;
    const manholes = [];
    for (const p of pipes) if (inDeg[p.up] !== 1 || graph.nodes[p.up].deg !== 2) manholes.push({ node: p.up, pos: graph.nodes[p.up].pos, depth: p.upDepth });
    return { plants, pipes, liftStations, manholes, nodeDepth, byUp };
  })();

  // ---- water: elevated tanks per pressure zone, treatment plant at the perimeter, looped mains
  const water = (() => {
    const towerHeightRaw = WATER.headM / g;
    const pumped = towerHeightRaw > WATER.maxTowerHeight;
    const towerHeight = Math.min(towerHeightRaw, WATER.maxTowerHeight);
    const k = Math.max(1, Math.ceil(population / WATER.zonePopulation));
    const start = loadNodes.length ? loadNodes.reduce((m, i) => (dist(graph.nodes[i].pos, centre) < dist(graph.nodes[m].pos, centre) ? i : m), loadNodes[0]) : 0;
    // on terrain a tank moves to the highest ground near its site, so the zone below it is fed by gravity
    const highGround = (n, taken = null) => {
      if (!terrainOn) return n;
      let best = -1;
      for (const [i] of nodeHash.near(graph.nodes[n].pos, WATER.tankSearch, Math.ceil(WATER.tankSearch / nodeHash.cell) + 1)) {
        if (taken && taken.includes(i)) continue;
        if (best < 0 || elev[i] > elev[best]) best = i;
      }
      return best < 0 ? n : best;
    };
    let towerNodes = farthestPoints(graph, loadNodes.length ? loadNodes : [start], k, start).map((n) => highGround(n));
    towerNodes = [...new Set(towerNodes)];
    let { d, parent, pedge, src } = dijkstra(graph, towerNodes, trenchWeight);
    // static pressure head (m) at a node from its zone's tank; the tank's elevation counts, and a tank on a hill is
    // built only as tall as its zone needs (the median customer still gets the design head)
    let tankHeight = [];
    const sizeTanks = () => {
      tankHeight = towerNodes.map(() => towerHeight);
      if (!terrainOn) return;
      const zoneElevs = towerNodes.map(() => []);
      for (const i of loadNodes) if (src[i] >= 0) zoneElevs[src[i]].push(elev[i]);
      towerNodes.forEach((t, zi) => {
        const z = zoneElevs[zi].sort((a, b) => a - b); if (!z.length) return;
        const median = z[z.length >> 1], top = z[z.length - 1];
        // the median customer gets the design head, and the highest customer still gets the minimum; a tank that would
        // have to stand taller than the design height to manage that is pumped (up to the tall-tank limit)
        tankHeight[zi] = clamp(Math.max(towerHeight - (elev[t] - median), minHeadM + top - elev[t]), 10, Math.max(towerHeight, WATER.maxTowerHeight));
      });
    };
    sizeTanks();
    const staticHead = (i) => (src[i] < 0 ? 0 : elev[towerNodes[src[i]]] + tankHeight[src[i]] - elev[i]);
    // static head at every node with pressure-reducing valves placed along the forest: where a run has dropped so far
    // below its tank that the head passes the limit, a valve resets the hydraulic grade line to the design head and
    // the nodes below it see that instead; a branch that climbs again out of a basin can still run short, which the
    // zone loop fixes with a tank of its own
    const outletHead = Math.min(towerHeight, maxHeadM);
    const prvHeads = () => {
      const heads = new Float64Array(N), prvList = [];
      for (let i = 0; i < N; i++) heads[i] = src[i] >= 0 ? staticHead(i) : towerHeight;
      if (!terrainOn) return { heads, prvs: prvList };
      const kids = new Map();
      for (let i = 0; i < N; i++) if (parent[i] >= 0) (kids.get(parent[i]) ?? kids.set(parent[i], []).get(parent[i])).push(i);
      // highest customer ground downstream of each node, so a valve's set point can be chosen to keep it served
      const subTop = new Float64Array(N).fill(-Infinity);
      for (const u of leavesFirst(d)) { subTop[u] = Math.max(subTop[u], bAt[u] ? elev[u] : -Infinity); if (parent[u] >= 0) subTop[parent[u]] = Math.max(subTop[parent[u]], subTop[u]); }
      for (const t of towerNodes) {
        const stack = [[t, Infinity]]; // [node, hydraulic grade line (absolute) after the last valve upstream]
        while (stack.length) {
          const [u, hgl] = stack.pop();
          let h = hgl;
          if (h !== Infinity) heads[u] = Math.min(heads[u], h - elev[u]);
          if (heads[u] > maxHeadM + 1e-9) {
            // set point: the design head, raised as far as the limit allows when the run climbs again below the valve
            const need = Number.isFinite(subTop[u]) ? minHeadM + subTop[u] - elev[u] + 0.01 : 0;
            const out = clamp(Math.max(outletHead, need), outletHead, maxHeadM);
            prvList.push({ node: u, pos: graph.nodes[u].pos, inletHeadM: heads[u], outletHeadM: out }); heads[u] = out; h = elev[u] + out;
          }
          for (const v of kids.get(u) ?? []) stack.push([v, h]);
        }
      }
      return { heads, prvs: prvList };
    };
    for (let iter = 0; iter < 48; iter++) {
      if (terrainOn) {
        // each tank climbs to the highest customer of the zone it ended up serving (a hill in the zone beats the rim)
        let moved = false;
        const top = new Int32Array(towerNodes.length).fill(-1);
        for (const i of loadNodes) { const z = src[i]; if (z >= 0 && (top[z] < 0 || elev[i] > elev[top[z]])) top[z] = i; }
        towerNodes = towerNodes.map((t, z) => (top[z] >= 0 && elev[top[z]] > elev[t] + 1 && !towerNodes.includes(top[z]) ? (moved = true, top[z]) : t));
        if (moved) { ({ d, parent, pedge, src } = dijkstra(graph, towerNodes, trenchWeight)); sizeTanks(); }
      }
      const zp = new Float64Array(towerNodes.length);
      for (const i of loadNodes) if (src[i] >= 0) zp[src[i]] += resAt[i];
      const far = new Int32Array(towerNodes.length).fill(-1), farD = new Float64Array(towerNodes.length).fill(-1);
      for (const i of loadNodes) { const z = src[i]; if (z >= 0 && d[i] > farD[z]) { farD[z] = d[i]; far[z] = i; } }
      const extra = [];
      for (let z = 0; z < towerNodes.length; z++) if (zp[z] > 2 * WATER.zonePopulation && farD[z] > 300) extra.push(highGround(far[z], towerNodes));
      if (terrainOn) {
        // ground too high for its tank: a new tank on the highest starved node serves the high zone
        let hi = -1;
        const { heads } = prvHeads();
        for (const i of loadNodes) if (heads[i] < minHeadM - 1e-6 && (hi < 0 || elev[i] > elev[hi])) hi = i;
        if (hi >= 0) extra.push(hi); // a tank of its own at the highest starved customer: nothing else is sure to reach it
      }
      const fresh = [...new Set(extra)].filter((n) => !towerNodes.includes(n));
      if (!fresh.length) break;
      towerNodes = [...towerNodes, ...fresh];
      ({ d, parent, pedge, src } = dijkstra(graph, towerNodes, trenchWeight));
      sizeTanks();
    }
    const order = leavesFirst(d);
    const demand = new Float64Array(N); // m³/s average
    const mains = new Map(); // edge index → main
    const zoneDemand = new Float64Array(towerNodes.length), zonePop = new Float64Array(towerNodes.length);
    for (const u of order) {
      demand[u] += (resAt[u] * WATER.perCapitaLpd + jobsAt[u] * WATER.perJobLpd) / 86400 / 1000;
      if (parent[u] < 0) { zoneDemand[src[u]] = demand[u]; zonePop[src[u]] += resAt[u]; continue; }
      zonePop[src[u]] += resAt[u];
      const peak = demand[u] * WATER.peakHour, e = graph.edges[pedge[u]];
      const need = Math.sqrt((4 * peak) / (Math.PI * WATER.designVelocity));
      const D = Math.max(WATER.minMain, pickDiameter(WATER.diameters, need));
      mains.set(pedge[u], { edge: pedge[u], a: u, b: parent[u], tree: [u, parent[u]], length: e.len, diameter: D, flow: peak, distFlow: peak, velocity: peak / (Math.PI * D * D / 4), depth: WATER.cover, kind: 'distribution', zone: src[u] });
      demand[parent[u]] += demand[u];
    }
    // loop mains: every remaining street gets a 150 mm main so no zone dead-ends
    graph.edges.forEach((e, i) => { if (!mains.has(i) && e.kind !== 'service') mains.set(i, { edge: i, a: e.a, b: e.b, length: e.len, diameter: WATER.minMain, flow: 0, velocity: 0, depth: WATER.cover, kind: 'loop', zone: -1 }); });
    // treatment plant: perimeter site farthest from the sewer plants, trunk mains to every tower
    const plantNode = siteCandidates.reduce((m, i) => {
      const dm = Math.min(...sewer.plants.map((p) => dist(graph.nodes[i].pos, p.pos))), db = Math.min(...sewer.plants.map((p) => dist(graph.nodes[m].pos, p.pos)));
      return dm > db ? i : m;
    }, siteCandidates[0]);
    const trunk = dijkstra(graph, [plantNode]);
    const trunkFlow = new Map();
    towerNodes.forEach((t, zi) => {
      for (let u = t; trunk.parent[u] >= 0; u = trunk.parent[u]) trunkFlow.set(trunk.pedge[u], (trunkFlow.get(trunk.pedge[u]) ?? 0) + zoneDemand[zi] * WATER.maxDay);
    });
    const trunkMains = [];
    for (const [ei, flow] of trunkFlow) {
      const e = graph.edges[ei], cur = mains.get(ei);
      const need = Math.sqrt((4 * flow) / (Math.PI * 2.0));
      // more than the largest pipe can carry at 2 m/s runs as parallel barrels in the same trench
      const Dmax = WATER.diameters[WATER.diameters.length - 1];
      const barrels = Math.max(1, Math.ceil((need * need) / (Dmax * Dmax)));
      const D = Math.max(0.3, pickDiameter(WATER.diameters, need / Math.sqrt(barrels)), cur?.diameter ?? 0);
      const a = trunk.parent[e.a] === e.b ? e.b : e.a, b = a === e.a ? e.b : e.a; // flow runs away from the plant
      const m = { edge: ei, a, b, tree: cur?.tree ?? null, distFlow: cur?.distFlow ?? 0, length: e.len, diameter: D, barrels, flow: Math.max(flow, cur?.flow ?? 0), velocity: 0, depth: WATER.cover, kind: 'trunk', zone: cur?.zone ?? -1 };
      m.velocity = m.flow / (barrels * Math.PI * m.diameter * m.diameter / 4);
      mains.set(ei, m); trunkMains.push(m);
    }
    const towers = towerNodes.map((n, zi) => ({ node: n, pos: graph.nodes[n].pos, elev: elev[n], height: tankHeight[zi], pumped: pumped || tankHeight[zi] > towerHeight + 1e-9, storageM3: zoneDemand[zi] * 86400, served: Math.round(zonePop[zi]), demandM3Day: zoneDemand[zi] * 86400 }));
    // static head per node (m of water) with the pressure-reducing valves in place
    const { heads: nodeHeadM, prvs } = prvHeads();
    const nodeHead = new Float64Array(N);
    for (const m of mains.values()) { nodeHead[m.a] = (1000 * G0 * g * nodeHeadM[m.a]) / 1e5; nodeHead[m.b] = (1000 * G0 * g * nodeHeadM[m.b]) / 1e5; } // bar, static
    const plant = { node: plantNode, pos: graph.nodes[plantNode].pos, capacityM3Day: zoneDemand.reduce((s, x) => s + x, 0) * 86400 * WATER.maxDay };
    return { towers, plant, mains: [...mains.values()], nodeHead, nodeHeadM, prvs, towerHeight, pumped };
  })();

  // ---- power: plant, substations sized to their zones, feeders, transmission
  const power = (() => {
    const rating = POWER.substationMVA[base] ?? 60;
    const loadAt = new Float64Array(N);
    for (let i = 0; i < N; i++) loadAt[i] = ((resAt[i] * POWER.kWPerResident + jobsAt[i] * POWER.kWPerJob) * POWER.peakFactor) / 1000 / POWER.powerFactor; // MVA
    const peakMVA = loadAt.reduce((s, x) => s + x, 0);
    const start = loadNodes.length ? loadNodes.reduce((m, i) => (loadAt[i] > loadAt[m] ? i : m), loadNodes[0]) : 0;
    let subs = farthestPoints(graph, loadNodes.length ? loadNodes : [start], Math.max(1, Math.ceil(peakMVA / (rating * POWER.loadingLimit))), start);
    let forest, zoneLoad;
    for (let iter = 0; iter < 64; iter++) {
      forest = dijkstra(graph, subs);
      zoneLoad = new Float64Array(subs.length);
      for (let i = 0; i < N; i++) if (forest.src[i] >= 0) zoneLoad[forest.src[i]] += loadAt[i];
      // split every overloaded zone at its farthest loaded node (a zone of one node gets transformer banks instead)
      const far = new Int32Array(subs.length).fill(-1), farD = new Float64Array(subs.length).fill(-1), count = new Int32Array(subs.length);
      for (const i of loadNodes) { const z = forest.src[i]; if (z < 0) continue; count[z]++; if (forest.d[i] > farD[z]) { farD[z] = forest.d[i]; far[z] = i; } }
      const splits = [];
      for (let z = 0; z < subs.length; z++) if (zoneLoad[z] > rating && count[z] >= 2 && farD[z] > 0) splits.push(far[z]);
      if (!splits.length) break;
      subs = [...subs, ...splits];
    }
    const order = leavesFirst(forest.d);
    const edgeLoad = new Float64Array(N);
    const feeders = [];
    for (const u of order) {
      edgeLoad[u] += loadAt[u];
      if (forest.parent[u] < 0 || edgeLoad[u] <= 0) continue;
      const e = graph.edges[forest.pedge[u]];
      feeders.push({ edge: forest.pedge[u], a: u, b: forest.parent[u], length: e.len, loadMVA: edgeLoad[u], classMVA: pickDiameter(POWER.feederClassesMVA, edgeLoad[u]), depth: POWER.cableDepth, kV: POWER.distributionKV, substation: forest.src[u] });
      edgeLoad[forest.parent[u]] += edgeLoad[u];
    }
    const substations = subs.map((n, i) => {
      const banks = Math.max(1, Math.ceil(zoneLoad[i] / rating)); // a dense core node may need several transformers on one site
      return { node: n, pos: graph.nodes[n].pos, ratingMVA: rating * banks, banks, loadMVA: zoneLoad[i], kV: `${POWER.transmissionKV}/${POWER.distributionKV}` };
    });
    // plant: central core for arcologies and alien cities, perimeter otherwise
    const plantNode = arcology || base === 'alien'
      ? nearestNode(centre)
      : siteCandidates.reduce((m, i) => {
        const score = (n) => Math.min(dist(graph.nodes[n].pos, water.plant.pos), ...sewer.plants.map((p) => dist(graph.nodes[n].pos, p.pos)));
        return score(i) > score(m) ? i : m;
      }, siteCandidates[0]);
    const peakMW = peakMVA * POWER.powerFactor;
    const plants = [{ node: plantNode, pos: graph.nodes[plantNode].pos, capacityMW: Math.ceil((peakMW * 1.25) / 50) * 50, kind: arcology || base === 'alien' ? 'core reactor' : 'power station' }];
    // a second injection point (grid intertie) on the far side, so one trench never isolates the whole city
    if (substations.length >= 2 && siteCandidates.length > 1) {
      const far = siteCandidates.reduce((m, i) => (dist(graph.nodes[i].pos, graph.nodes[plantNode].pos) > dist(graph.nodes[m].pos, graph.nodes[plantNode].pos) ? i : m), siteCandidates[0]);
      if (far !== plantNode) plants.push({ node: far, pos: graph.nodes[far].pos, capacityMW: Math.ceil((peakMW * 0.6) / 50) * 50, kind: 'grid intertie' });
    }
    const sources = plants.map((p) => p.node);
    // transmission: logical lines between the plant and substations, each realised along street edges.
    // Start from the shortest-path tree (lines share corridors toward the plant), then add backup lines
    // until no single line strands more than N1_TARGET of the people, as a meshed 110 kV grid would.
    const subIndexOf = new Map(subs.map((n, i) => [n, i]));
    const zonePeople = new Float64Array(subs.length);
    for (let i = 0; i < N; i++) if (forest.src[i] >= 0) zonePeople[forest.src[i]] += resAt[i];
    const totalPeople = Math.max(1, zonePeople.reduce((a, b) => a + b, 0));
    const lines = []; // { from, to, edges[], length }  from/to are graph nodes (plant or substation)
    const tx = dijkstra(graph, sources);
    const pathEdges = (res, fromNode) => { const out = []; for (let u = fromNode; res.parent[u] >= 0; u = res.parent[u]) out.push(res.pedge[u]); return out; };
    const addLine = (from, to, edges) => { if (from === to || !edges.length) return; lines.push({ from, to, edges, length: edges.reduce((s, ei) => s + graph.edges[ei].len, 0) }); };
    // tree lines: each substation to the nearest plant/substation up its tree path
    for (const sst of substations) {
      const edges = [];
      let u = sst.node;
      while (tx.parent[u] >= 0) { edges.push(tx.pedge[u]); u = tx.parent[u]; if (subIndexOf.has(u) && u !== sst.node) break; }
      addLine(u, sst.node, edges);
    }
    const N1_TARGET = 0.2;
    const strandedBy = (skipSet) => {
      const adjL = new Map(); const link = (x, y) => (adjL.get(x) ?? adjL.set(x, []).get(x)).push(y);
      lines.forEach((l, i) => { if (skipSet.has(i)) return; link(l.from, l.to); link(l.to, l.from); });
      const seen = new Set(sources), st = [...sources];
      while (st.length) { const u = st.pop(); for (const v of adjL.get(u) ?? []) if (!seen.has(v)) { seen.add(v); st.push(v); } }
      return seen;
    };
    for (let iter = 0; iter < 24 && lines.length; iter++) {
      // worst corridor: the set of lines sharing one street edge
      const edgeLines = new Map();
      lines.forEach((l, i) => { for (const ei of l.edges) (edgeLines.get(ei) ?? edgeLines.set(ei, new Set()).get(ei)).add(i); });
      let worstSet = null, worstShare = 0;
      const seenKey = new Set();
      for (const set of edgeLines.values()) {
        const key = [...set].sort((x, y) => x - y).join(','); if (seenKey.has(key)) continue; seenKey.add(key);
        const seen = strandedBy(set); let lost = 0; subs.forEach((n, i) => { if (!seen.has(n)) lost += zonePeople[i]; });
        const sh = lost / totalPeople; if (sh > worstShare) { worstShare = sh; worstSet = set; }
      }
      if (worstShare <= N1_TARGET || !worstSet) break;
      const seen = strandedBy(worstSet);
      // tie the island to a substation that still has a path (substation-to-substation meshing); a source only as a last resort,
      // because every line out of a source shares that source's own trench
      const island = subs.filter((n) => !seen.has(n)), reachedSubs = subs.filter((n) => seen.has(n));
      const mainland = reachedSubs.length ? reachedSubs : [...sources];
      // candidate pairs nearest first; skip pairs already linked, and skip paths that cannot avoid the worst corridor
      const linked = new Set(lines.map((l) => `${Math.min(l.from, l.to)}-${Math.max(l.from, l.to)}`));
      const pairs = [];
      for (const a of island) for (const b of mainland) if (!linked.has(`${Math.min(a, b)}-${Math.max(a, b)}`)) pairs.push([a, b, dist(graph.nodes[a].pos, graph.nodes[b].pos)]);
      pairs.sort((x, y) => x[2] - y[2]);
      const corridorEdges = new Set(); edgeLines.forEach((set, ei) => { if ([...set].sort((x, y) => x - y).join(',') === [...worstSet].sort((x, y) => x - y).join(',')) corridorEdges.add(graph.edges[ei]); });
      const busy = new Set(); for (const l of lines) for (const ei of l.edges) busy.add(graph.edges[ei]);
      let added = false;
      for (const [a, b] of pairs.slice(0, 6)) {
        const res = dijkstra(graph, [b], (e) => (corridorEdges.has(e) ? Infinity : busy.has(e) ? e.len * 8 : e.len));
        if (!Number.isFinite(res.d[a])) continue;
        addLine(b, a, pathEdges(res, a)); added = true; break;
      }
      if (!added) break; // no backup can avoid the worst trench: the score will say so
    }
    const transmission = [];
    const seenEdge = new Map();
    lines.forEach((l, li) => {
      for (const ei of l.edges) {
        if (seenEdge.has(ei)) { transmission[seenEdge.get(ei)].lines.push(li); continue; }
        const e = graph.edges[ei];
        // orient from the end nearer the line's source
        const a = dist(graph.nodes[e.a].pos, graph.nodes[l.from].pos) <= dist(graph.nodes[e.b].pos, graph.nodes[l.from].pos) ? e.a : e.b, b = a === e.a ? e.b : e.a;
        seenEdge.set(ei, transmission.length);
        transmission.push({ edge: ei, a, b, length: e.len, kV: POWER.transmissionKV, depth: POWER.transmissionDepth, line: li, lines: [li] });
      }
    });
    // N-1 is scored per corridor: one dig cuts every line sharing that trench
    const strandedSet = (skipSet) => {
      const adjL = new Map(); const link = (x, y) => (adjL.get(x) ?? adjL.set(x, []).get(x)).push(y);
      lines.forEach((l, i) => { if (skipSet.has(i)) return; link(l.from, l.to); link(l.to, l.from); });
      const seen = new Set(sources), st = [...sources];
      while (st.length) { const u = st.pop(); for (const v of adjL.get(u) ?? []) if (!seen.has(v)) { seen.add(v); st.push(v); } }
      let lost = 0; subs.forEach((n, i) => { if (!seen.has(n)) lost += zonePeople[i]; });
      return lost / totalPeople;
    };
    const corridorCache = new Map();
    for (const t of transmission) {
      const key = t.lines.slice().sort((x, y) => x - y).join(',');
      if (!corridorCache.has(key)) corridorCache.set(key, strandedSet(new Set(t.lines)));
      t.n1 = corridorCache.get(key);
    }
    const n1 = transmission.length ? Math.max(...transmission.map((t) => t.n1)) : 0;
    const nodeFeeder = new Int32Array(N).fill(-1);
    for (let i = 0; i < N; i++) if (forest.src[i] >= 0) nodeFeeder[i] = forest.src[i];
    return { plants, sources, substations, feeders, transmission, lines, n1Transmission: n1, nodeFeeder, peakMW, peakMVA };
  })();

  // ---- transit: stations at the strongest building of each district, tunnels along an MST of street paths
  const transit = (() => {
    if (town) return { stations: [], tunnels: [], depth: null };
    const byDistrict = new Map();
    for (const b of layout.buildings) { const cur = byDistrict.get(b.district); if (!cur || b.amp > cur.amp) byDistrict.set(b.district, b); }
    const counts = new Map(); for (const b of layout.buildings) counts.set(b.district, (counts.get(b.district) ?? 0) + 1);
    const cands = [...byDistrict.values()].filter((b) => (counts.get(b.district) ?? 0) >= 0.01 * layout.buildings.length).sort((x, y) => y.amp - x.amp);
    const stations = [];
    for (const b of cands) {
      if (stations.length >= TRANSIT.maxStations) break;
      const node = nearestNode(b.pos);
      if (stations.some((s) => dist(s.pos, graph.nodes[node].pos) < TRANSIT.minSpacing)) continue;
      stations.push({ node, pos: graph.nodes[node].pos, district: b.district, name: `District ${b.district} station` });
    }
    // a city with only a few districts still needs a line: add stops by farthest-point sampling of the busiest streets
    if (stations.length < Math.min(4, Math.ceil(meta.world.extent / 700)) && loadNodes.length) {
      const busy = loadNodes.slice().sort((x, y) => (resAt[y] + jobsAt[y]) - (resAt[x] + jobsAt[x])).slice(0, Math.max(50, loadNodes.length >> 3));
      const startNode = stations.length ? stations[0].node : busy[0];
      for (const n of farthestPoints(graph, busy, 12, startNode)) {
        if (stations.some((s) => dist(s.pos, graph.nodes[n].pos) < TRANSIT.minSpacing * 1.4)) continue;
        if (dist(graph.nodes[n].pos, centre) > meta.world.extent * 0.92) continue;
        stations.push({ node: n, pos: graph.nodes[n].pos, district: -1, name: `Station ${stations.length + 1}` });
        if (stations.length >= TRANSIT.maxStations) break;
      }
    }
    if (stations.length < 2) return { stations: [], tunnels: [], depth: null };
    // pairwise street-path lengths (service corridors cost five times their length), MST, union of paths
    const corridorCost = (e) => (e.kind === 'corridor' || e.kind === 'service' ? e.len * 5 : e.len);
    const paths = stations.map((s) => dijkstra(graph, [s.node], corridorCost));
    const inTree = new Set([0]), edgesUsed = new Map();
    while (inTree.size < stations.length) {
      let best = null;
      for (const i of inTree) for (let j = 0; j < stations.length; j++) {
        if (inTree.has(j)) continue;
        const L = paths[i].d[stations[j].node];
        if (Number.isFinite(L) && (!best || L < best[2])) best = [i, j, L];
      }
      if (!best) break;
      inTree.add(best[1]);
      for (let u = stations[best[1]].node; paths[best[0]].parent[u] >= 0; u = paths[best[0]].parent[u]) {
        const ei = paths[best[0]].pedge[u];
        if (!edgesUsed.has(ei)) edgesUsed.set(ei, { a: paths[best[0]].parent[u], b: u, line: `${best[0]}-${best[1]}` });
      }
    }
    // depth: below every foundation whose footprint reaches the corridor, searched along the whole segment
    const bCell = 80, bHash = new PointHash(bCell);
    let maxHalfDiag = 0;
    layout.buildings.forEach((b, i) => { bHash.add(b.pos, i); maxHalfDiag = Math.max(maxHalfDiag, Math.hypot(b.w, b.d) / 2); });
    const reach = TRANSIT.corridor + maxHalfDiag;
    const rings = Math.ceil(reach / bCell) + 1;
    let depth = TRANSIT.minDepth;
    const tunnels = [];
    for (const [ei, t] of edgesUsed) {
      const e = graph.edges[ei], A = graph.nodes[t.a].pos, B = graph.nodes[t.b].pos;
      const ab = sub(B, A), L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
      const seenB = new Set(), near = [];
      const steps = Math.max(1, Math.ceil(e.len / bCell));
      for (let k = 0; k <= steps; k++) {
        const S = add(A, scale3(ab, k / steps));
        for (const [bi] of bHash.near(S, bCell + reach, rings)) {
          if (seenB.has(bi)) continue; seenB.add(bi);
          const b = layout.buildings[bi], ap = sub(b.pos, A), tt = clamp((ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L2, 0, 1);
          if (len3(sub(ap, scale3(ab, tt))) <= TRANSIT.corridor + Math.hypot(b.w, b.d) / 2) near.push(bi);
        }
      }
      let need = TRANSIT.minDepth;
      for (const bi of near) need = Math.max(need, foundationDepth(layout.buildings[bi]) + TRANSIT.clearance + TRANSIT.diameter / 2);
      depth = Math.max(depth, need);
      tunnels.push({ edge: ei, a: t.a, b: t.b, length: e.len, line: t.line, depth: need, diameter: TRANSIT.diameter, nearBuildings: near });
    }
    // one line depth per network keeps the profile continuous
    for (const t of tunnels) t.depth = depth;
    for (const s of stations) s.depth = depth;
    return { stations, tunnels, depth };
  })();

  // ---- utility tunnels under every boulevard of an arcology
  const utilidors = arcology
    ? graph.edges.map((e, i) => ({ e, i })).filter(({ e }) => e.kind === 'boulevard' || e.kind === 'corridor').map(({ e, i }) => ({ edge: i, a: e.a, b: e.b, length: e.len, width: UTILIDOR.width, height: UTILIDOR.height, depth: UTILIDOR.depth, carries: ['water', 'power', 'sewer', 'data', 'heat'] }))
    : [];

  // ---- stats and checks
  const km = (arr, f = (x) => x.length) => arr.reduce((s, x) => s + f(x), 0) / 1000;
  const waterDemandM3Day = water.towers.reduce((s, t) => s + t.demandM3Day, 0);
  const maxSewerDepth = sewer.pipes.reduce((m, p) => Math.max(m, p.downDepth), 0);
  const minSlopeRatio = sewer.pipes.filter((p) => !p.forceMain).reduce((m, p) => Math.min(m, p.slope / sewerMinSlope(p.diameter, g)), Infinity);
  const maxVel = water.mains.reduce((m, x) => Math.max(m, x.velocity), 0);
  let minHead = Infinity, maxHead = -Infinity;
  for (const i of loadNodes) { minHead = Math.min(minHead, water.nodeHeadM[i]); maxHead = Math.max(maxHead, water.nodeHeadM[i]); }
  if (!Number.isFinite(minHead)) { minHead = maxHead = water.towerHeight; }
  const maxSubLoad = power.substations.reduce((m, s) => Math.max(m, s.loadMVA / s.ratingMVA), 0);
  let minTunnelClear = Infinity;
  for (const t of transit.tunnels) for (const bi of t.nearBuildings) minTunnelClear = Math.min(minTunnelClear, t.depth - TRANSIT.diameter / 2 - foundationDepth(layout.buildings[bi]));
  const trench = sewer.pipes.reduce((s, p) => s + p.length * (p.diameter + 0.6) * (p.upDepth + p.downDepth) / 2, 0)
    + water.mains.reduce((s, m) => s + m.length * ((m.barrels ?? 1) * m.diameter + 0.6) * m.depth, 0)
    + power.feeders.reduce((s, f) => s + f.length * 0.6 * f.depth, 0)
    + transit.tunnels.reduce((s, t) => s + t.length * Math.PI * (t.diameter / 2) ** 2, 0)
    + utilidors.reduce((s, u) => s + u.length * u.width * u.height, 0);
  const stats = {
    nodes: N, edges: graph.edges.length, connectors: graph.connectors,
    served: laterals.length, buildings: layout.buildings.length,
    population: Math.round(population), jobs: Math.round(jobs),
    sewerKm: km(sewer.pipes), liftStations: sewer.liftStations.length, treatmentPlants: sewer.plants.length, manholes: sewer.manholes.length,
    forceMains: sewer.pipes.filter((p) => p.forceMain).length,
    maxSewerDepth, sewerFlowM3Day: sewer.plants.reduce((s, p) => s + p.flowM3Day, 0),
    waterKm: km(water.mains), towers: water.towers.length, towerHeight: water.towerHeight, pumped: water.pumped, waterDemandM3Day, maxVelocity: maxVel,
    prvs: water.prvs.length, minStaticHeadM: minHead, maxStaticHeadM: maxHead, bridgeUtilities: sewer.pipes.filter((p) => p.bridge).length,
    powerKm: km(power.feeders) + km(power.transmission), transmissionKm: km(power.transmission), substations: power.substations.length, peakMW: power.peakMW, maxSubstationLoad: maxSubLoad,
    transitKm: km(transit.tunnels), stations: transit.stations.length, tunnelDepth: transit.depth, minTunnelClearance: Number.isFinite(minTunnelClear) ? minTunnelClear : null,
    utilidorKm: km(utilidors), excavationM3: trench,
  };
  layout.infraMs = Date.now() - t0;
  const checks = [];
  const check = (id, label, value, status, basis) => checks.push({ id, label, value, status, basis });
  check('service', 'Buildings with water, sewer and power', `${laterals.length} of ${layout.buildings.length}`, laterals.length === layout.buildings.length ? 'pass' : 'fail', 'Each building connects to the nearest street node');
  check('sewer-slope', 'Sewer slope vs. self-cleansing minimum', `${(minSlopeRatio * 100).toFixed(0)}% of minimum or more`, minSlopeRatio >= 1 - 1e-9 ? 'pass' : 'fail', `Ten-State slopes ÷ g (${g} g): 0.40 % at 200 mm on Earth`);
  check('sewer-depth', 'Deepest sewer', `${maxSewerDepth.toFixed(1)} m, ${sewer.liftStations.length} lift station${sewer.liftStations.length === 1 ? '' : 's'}${stats.forceMains ? `, ${stats.forceMains} force main${stats.forceMains === 1 ? '' : 's'}` : ''}`, maxSewerDepth <= SEWER.maxDepth + 1e-6 ? 'pass' : 'fail', `Runs deeper than ${SEWER.maxDepth} m get a lift station; runs too long for gravity are pumped`);
  check('water-velocity', 'Fastest water main', `${maxVel.toFixed(2)} m/s`, maxVel <= WATER.maxVelocity ? 'pass' : 'fail', 'Sized for 1.5 m/s at peak hour; 2.5 m/s limit');
  check('water-pressure', 'Tank height for 3.4 bar', `${water.towerHeight.toFixed(0)} m${water.pumped ? ' + pumps' : ''}`, water.pumped ? 'warn' : 'pass', 'h = P/(ρ g): the same pressure needs taller tanks at low gravity');
  if (terrainOn) {
    const kPa = (h) => (G0 * g * h).toFixed(0);
    check('pressure-zones', 'Static pressure across the terrain', `${kPa(minHead)}–${kPa(maxHead)} kPa, ${water.towers.length} zone${water.towers.length === 1 ? '' : 's'}, ${water.prvs.length} PRV${water.prvs.length === 1 ? '' : 's'}`,
      minHead >= minHeadM - 1e-6 && maxHead <= maxHeadM + 1e-6 ? 'pass' : 'fail', `Tanks on the high ground; a zone splits below ${kPa(minHeadM)} kPa, a valve drops anything above ${kPa(maxHeadM)} kPa`);
    const gravityPipes = sewer.pipes.filter((p) => !p.forceMain);
    const falling = gravityPipes.filter((p) => (elev[p.up] - p.upDepth) - (elev[p.down] - p.downDepth) >= sewerMinSlope(p.diameter, g) * p.length - 1e-6).length;
    check('sewer-gravity', 'Sewers falling on the heightfield', `${falling} of ${gravityPipes.length} gravity runs`, falling === gravityPipes.length ? 'pass' : 'fail', 'Invert out = invert in − slope × length, checked against ground elevation at both manholes');
  }
  check('grid-n1', 'Worst transmission corridor', `${(power.n1Transmission * 100).toFixed(0)} % of people stranded`,
    power.n1Transmission <= 0.2 + 1e-9 ? 'pass' : power.substations.length < 3 ? 'info' : 'warn', 'Backup lines added until one trench strands no more than 20 %; arcologies with few corridors may not get there');
  check('substation-load', 'Most loaded substation', `${(maxSubLoad * 100).toFixed(0)}% of rating`, maxSubLoad <= 1 ? 'pass' : 'fail', `Zones split until every substation is under its ${POWER.substationMVA[base] ?? 60} MVA rating`);
  if (transit.tunnels.length) {
    check('tunnel-clearance', 'Tunnel clearance under foundations', `${minTunnelClear.toFixed(1)} m`, minTunnelClear >= TRANSIT.clearance - 1e-6 ? 'pass' : 'fail', `Piles ≈ 2 m + 10 % of height; ${TRANSIT.clearance} m clearance (Singapore case histories 4.5–9 m)`);
    check('station-spacing', 'Metro stations', `${transit.stations.length} at ≥ ${TRANSIT.minSpacing} m`, 'pass', 'Urban heavy-rail spacing is about 1 km');
  } else {
    check('tunnel-clearance', 'Metro', town ? 'none (town)' : 'none', 'info', 'Towns do not get a metro');
  }
  layout.infraToOBJ = infraToOBJ;
  return { graph, laterals, sewer, water, power, transit, utilidors, stats, checks };
}

// ---------------------------------------------------------------- export helpers
// Underground position of a node at a given depth (toward the centre on a sphere).
export function underground(layout, P, depth) {
  const up = layout.meta.plate === 'sphere' ? norm3(P) : [0, 1, 0];
  return sub(P, scale3(up, depth));
}

// OBJ line elements for the networks (appended by the engine's toOBJ when layout.infra exists)
export function infraToOBJ(layout, startIndex) {
  const I = layout.infra, lines = [];
  let vi = startIndex;
  const nodes = I.graph.nodes;
  const emit = (name, segs) => {
    if (!segs.length) return;
    lines.push(`o ${name}`);
    for (const [A, B] of segs) {
      lines.push(`v ${A.map((x) => x.toFixed(3)).join(' ')}`, `v ${B.map((x) => x.toFixed(3)).join(' ')}`, `l ${vi} ${vi + 1}`);
      vi += 2;
    }
  };
  emit('sewer_pipes', I.sewer.pipes.map((p) => [underground(layout, nodes[p.up].pos, p.upDepth), underground(layout, nodes[p.down].pos, p.downDepth)]));
  emit('water_mains', I.water.mains.map((m) => [underground(layout, nodes[m.a].pos, m.depth), underground(layout, nodes[m.b].pos, m.depth)]));
  emit('power_feeders', I.power.feeders.map((f) => [underground(layout, nodes[f.a].pos, f.depth), underground(layout, nodes[f.b].pos, f.depth)]));
  emit('power_transmission', I.power.transmission.map((f) => [underground(layout, nodes[f.a].pos, f.depth), underground(layout, nodes[f.b].pos, f.depth)]));
  emit('transit_tunnels', I.transit.tunnels.map((t) => [underground(layout, nodes[t.a].pos, t.depth), underground(layout, nodes[t.b].pos, t.depth)]));
  emit('utility_tunnels', I.utilidors.map((u) => [underground(layout, nodes[u.a].pos, u.depth), underground(layout, nodes[u.b].pos, u.depth)]));
  return { text: lines.join('\n'), nextIndex: vi };
}
