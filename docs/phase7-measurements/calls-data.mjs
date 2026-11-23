import { writeFileSync } from 'node:fs';
import { generateCity, fieldPreview, slendernessLimit } from '../../src/cymatic-engine.js';
import { buildInfrastructure, dijkstra, TRANSIT } from '../../src/infrastructure.js';
const out = process.argv[2], R = Math.round;
const P = { frequency: 432 }, L = generateCity(P), I = buildInfrastructure(L), E = L.meta.world.extent, G = I.graph;
const data = { extent: E, engine: L.meta.engine, profile: P };
// streets by kind, whole metres
data.edges = G.edges.flatMap((e) => [R(G.nodes[e.a].pos[0]), R(G.nodes[e.a].pos[2]), R(G.nodes[e.b].pos[0]), R(G.nodes[e.b].pos[2])]);
const KINDS = ['boulevard', 'ring', 'wall', 'spoke'];
data.edgeKind = G.edges.map((e) => Math.max(0, KINDS.indexOf(e.kind))).join('');
data.streetKm = Object.fromEntries(KINDS.map((k) => [k, R(G.edges.filter((e) => e.kind === k).reduce((s2, e) => s2 + e.len, 0) / 1000)]));
// buildings: position, polarity, district (for the ward maps)
data.buildings = L.buildings.map((b) => [R(b.pos[0]), R(b.pos[2]), b.polarity > 0 ? 1 : 0, b.district]);
data.landmarks = L.buildings.filter((b) => b.landmark).map((b) => [R(b.pos[0]), R(b.pos[2])]);
// the field on a grid: nexuses, their cells, Gabriel lines, loads
const field = (p, N) => { const F = fieldPreview(p), W = N + 1, step = 2 * E / N, S = new Float64Array(W * W), ins = new Uint8Array(W * W); let smax = 0;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const [u, v] = F.toNorm([-E + i * step, 0, -E + j * step]); if (!F.inside(u, v)) continue; const s = F.at(u, v).S; S[j * W + i] = s; ins[j * W + i] = 1; smax = Math.max(smax, Math.abs(s)); }
  return { S, ins, W, N, step, smax }; };
const FLUX = 600, g = field(P, 240), nx = [];
for (let j = 2; j < g.N - 1; j++) for (let i = 2; i < g.N - 1; i++) { const k = j * g.W + i; if (!g.ins[k]) continue; const w = Math.abs(g.S[k]); if (w < 0.5 * g.smax) continue; let top = true; for (let dj = -2; dj <= 2 && top; dj++) for (let di = -2; di <= 2; di++) { const q = k + dj * g.W + di; if (q !== k && g.ins[q] && (Math.abs(g.S[q]) > w || (Math.abs(g.S[q]) === w && q < k))) { top = false; break; } } if (top) nx.push({ x: -E + i * g.step, z: -E + j * g.step, w: w / g.smax, sign: Math.sign(g.S[k]), out: 0, dem: 0 }); }
const nearest = (x, z) => { let b = 0, bd = Infinity; nx.forEach((q, n) => { const dd = (q.x - x) ** 2 + (q.z - z) ** 2; if (dd < bd) { bd = dd; b = n; } }); return b; };
for (let j = 0; j <= g.N; j++) for (let i = 0; i <= g.N; i++) { const k = j * g.W + i; if (g.ins[k]) nx[nearest(-E + i * g.step, -E + j * g.step)].out += g.S[k] * g.S[k] * g.step * g.step * FLUX / 1e6; }
const floor = L.buildings.reduce((s, b) => s + b.w * b.d * b.floors, 0);
for (const b of L.buildings) nx[nearest(b.pos[0], b.pos[2])].dem += I.power.peakMW * (b.w * b.d * b.floors) / floor;
const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z), n = nx.length, adj = nx.map(() => []), lines = [];
for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) { const m = { x: (nx[a].x + nx[b].x) / 2, z: (nx[a].z + nx[b].z) / 2 }, r = d2(nx[a], nx[b]) / 2; let ok = true; for (let c = 0; c < n && ok; c++) if (c !== a && c !== b && d2(nx[c], m) < r - 1e-9) ok = false; if (ok) { adj[a].push([b, lines.length]); adj[b].push([a, lines.length]); lines.push({ a, b, len: 2 * r, load: 0 }); } }
const supply = nx.reduce((s, q) => s + q.out, 0), demand = I.power.peakMW, bal = nx.map((q) => q.out * Math.min(1, demand / supply) - q.dem * Math.min(1, supply / demand));
for (const t of nx.map((_, i) => i).filter((i) => bal[i] < -1e-9).sort((x, y) => bal[x] - bal[y])) {
  const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), pl = new Int32Array(n).fill(-1), done = new Uint8Array(n); dist[t] = 0;
  for (;;) { let u = -1; for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i; if (u < 0 || dist[u] === Infinity) break; done[u] = 1; for (const [v, li] of adj[u]) if (dist[u] + lines[li].len < dist[v]) { dist[v] = dist[u] + lines[li].len; prev[v] = u; pl[v] = li; } }
  for (const s of nx.map((_, i) => i).filter((i) => bal[i] > 1e-9 && dist[i] < Infinity).sort((x, y) => dist[x] - dist[y])) { if (bal[t] > -1e-9) break; const amt = Math.min(bal[s], -bal[t]); bal[s] -= amt; bal[t] += amt; for (let u = s; u !== t; u = prev[u]) lines[pl[u]].load += amt; }
}
data.nexuses = nx.map((q) => [R(q.x), R(q.z), +q.w.toFixed(2), +q.out.toFixed(1), +q.dem.toFixed(1)]);
data.leyLines = lines.map((l) => [l.a, l.b, +l.load.toFixed(1), +(2 * Math.min(nx[l.a].out, nx[l.b].out)).toFixed(1)]);
data.ley = { flux: FLUX, supplyMW: R(supply), demandMW: R(demand), overloaded: data.leyLines.filter((l) => l[2] > l[3]).length };
// the octave below: zero contour of the 216 Hz field by marching squares
{ const h = field({ frequency: P.frequency / 2 }, 320), segs = []; let km = 0;
  const lerp = (xa, za, sa, xb, zb, sb) => { const t = sa / (sa - sb); return [xa + t * (xb - xa), za + t * (zb - za)]; };
  for (let j = 0; j < h.N; j++) for (let i = 0; i < h.N; i++) { const k = j * h.W + i, ids = [k, k + 1, k + h.W + 1, k + h.W]; if (!ids.every((q) => h.ins[q])) continue;
    const x0 = -E + i * h.step, z0 = -E + j * h.step, pts = [[x0, z0], [x0 + h.step, z0], [x0 + h.step, z0 + h.step], [x0, z0 + h.step]], s = ids.map((q) => h.S[q]), cross = [];
    for (let e = 0; e < 4; e++) { const a = e, b = (e + 1) % 4; if (s[a] * s[b] < 0) cross.push(lerp(...pts[a], s[a], ...pts[b], s[b])); }
    for (let c = 0; c + 1 < cross.length; c += 2) { segs.push(R(cross[c][0]), R(cross[c][1]), R(cross[c + 1][0]), R(cross[c + 1][1])); km += Math.hypot(cross[c + 1][0] - cross[c][0], cross[c + 1][1] - cross[c][1]) / 1000; } }
  data.deeps = { hz: P.frequency / 2, segs, km: R(km) }; }
// the metro, for context
data.metro = I.transit.tunnels.map((t) => t.edge);
data.metroKm = R(I.transit.tunnels.reduce((s, t) => s + t.length, 0) / 1000);
data.stations = I.transit.stations.map((s) => [R(s.pos[0]), R(s.pos[2])]);
// catacombs: streets within 400 m, along streets, of a seed
const nodeNear = (x, z) => { let b = 0, bd = Infinity; G.nodes.forEach((q, i) => { const dd = (q.pos[0] - x) ** 2 + (q.pos[2] - z) ** 2; if (dd < bd) { bd = dd; b = i; } }); return b; };
const tunnelEdges = new Set(I.transit.tunnels.map((t) => t.edge));
const reach = (seeds, limit) => { const res = dijkstra(G, seeds.map(([x, z]) => nodeNear(x, z))), edges = []; let km = 0, underMetro = 0;
  G.edges.forEach((e, ei) => { if (res.d[e.a] <= limit && res.d[e.b] <= limit) { edges.push(ei); km += e.len / 1000; if (tunnelEdges.has(ei)) underMetro += e.len / 1000; } });
  return { edges, km: +km.toFixed(1), sharedWithMetroKm: +underMetro.toFixed(1), seeds: seeds.length, reach: limit }; };
const seedSets = { nexus: nx.map((q) => [q.x, q.z]), landmark: data.landmarks };
data.catacombs = {}; data.catacombKm = {};
for (const [name, seeds] of Object.entries(seedSets)) { data.catacombKm[name] = {}; for (const limit of [100, 150, 200, 250, 400]) { const r = reach(seeds, limit); data.catacombKm[name][limit] = r.km; if (limit === 400 || limit === 150) data.catacombs[`${name}${limit}`] = r; } }
// depth section of this city (m below the street)
const sewerBottom = Math.max(...I.sewer.pipes.map((q) => Math.max(q.upDepth, q.downDepth) + q.diameter)), tunnel = I.transit.tunnels[0].depth, deepestFoundation = Math.max(...L.buildings.map((b) => Math.min(60, 2 + 0.1 * b.h)));
data.section = { cable: 0.9, transmission: 1.5, water: 1.5, sewerTop: 1.5, sewerBottom: +sewerBottom.toFixed(1), catacombCrown: +(sewerBottom + 1).toFixed(1), catacombFloor: +(sewerBottom + 3.4).toFixed(1), metroCrown: +(tunnel - TRANSIT.diameter / 2).toFixed(1), metroFloor: +(tunnel + TRANSIT.diameter / 2).toFixed(1), deepestFoundation: +deepestFoundation.toFixed(1), deeps: +(Math.max(tunnel + TRANSIT.diameter / 2, deepestFoundation) + 6).toFixed(1) };
// wards: what gravity alone does (real engine runs, whole plan as a stand-in for a ward)
const profileOf = (hs, m = 160) => { const s = [...hs].sort((a, b) => b - a); return Array.from({ length: m }, (_, i) => +s[Math.min(s.length - 1, Math.floor(i * s.length / m))].toFixed(1)); };
data.wards = {};
for (const [name, base] of [['megastructure', { frequency: 432, preset: 'megastructure' }], ['city', P]]) {
  const a = generateCity(base), b = generateCity({ ...base, gravity: 0.5 }), ia = name === 'city' ? I : buildInfrastructure(a), ib = buildInfrastructure(b);
  data.wards[name] = { normal: profileOf(a.buildings.map((x) => x.h)), half: profileOf(b.buildings.map((x) => x.h)), tallest: [a.stats.maxHeight, b.stats.maxHeight], population: [a.stats.population, b.stats.population], lifts: [ia.stats.liftStations, ib.stats.liftStations], tank: [R(Math.max(...ia.water.towers.map((t) => t.height))), R(Math.max(...ib.water.towers.map((t) => t.height)))] };
}
// the height option, sketched on the city's largest district: requested heights times four, then the slenderness rule and the lift-core rule
{ const dist = 1, k = 4, pr = (await import('../../src/cymatic-engine.js')), preset = pr.PRESETS.city, mine = L.buildings.filter((b) => b.district === dist);
  const world = slendernessLimit(preset.slender, 1), eased = slendernessLimit(preset.slender, 0.5), coreCap = pr.CORE_FLOORS * preset.floorH;
  const rule = (b, lim) => { let h = Math.min(k * b.h, lim * Math.min(b.w, b.d)); if (Math.min(b.w, b.d) < pr.MIN_CORE_SIDE) h = Math.min(h, Math.max(b.h, coreCap)); return h; };
  const plain = mine.map((b) => b.h), tall = mine.map((b) => rule(b, world)), warded = mine.map((b) => rule(b, eased));
  data.height = { district: dist, factor: k, buildings: mine.length, worldLimit: +world.toFixed(1), easedLimit: +eased.toFixed(1), plain: profileOf(plain), doubled: profileOf(tall), warded: profileOf(warded),
    tallest: [Math.max(...plain), Math.max(...tall), Math.max(...warded)].map((v) => Math.round(v)), wantMore: mine.filter((b) => k * b.h > world * Math.min(b.w, b.d)).length, dependent: mine.filter((b) => rule(b, eased) > world * Math.min(b.w, b.d) + 1e-9).length }; }
writeFileSync(out, JSON.stringify(data));
const sz = (o) => JSON.stringify(o).length;
console.log('bytes', sz(data), 'edges', sz(data.edges), 'buildings', sz(data.buildings), 'deeps', sz(data.deeps), 'catacombs', sz(data.catacombs));
console.log(JSON.stringify({ streetKm: data.streetKm, ley: data.ley, nexuses: data.nexuses.length, lines: data.leyLines.length, deeps: { km: data.deeps.km, segs: data.deeps.segs.length / 4 }, metroKm: data.metroKm, stations: data.stations.length, catacombKm: data.catacombKm, shared: Object.fromEntries(Object.entries(data.catacombs).map(([k2, v]) => [k2, v.sharedWithMetroKm])), section: data.section, wards: Object.fromEntries(Object.entries(data.wards).map(([k, v]) => [k, { ...v, normal: 0, half: 0 }])), height: { ...data.height, plain: 0, doubled: 0, warded: 0 } }, null, 1));
