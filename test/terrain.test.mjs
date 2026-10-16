// Terrain contract (Phase 2): the ground follows the wave or an imported heightmap, buildings stand on it,
// basins flood and streets bridge them, sewers really fall on the heightfield, tanks sit on high ground
// and every pressure zone stays inside its limits. Flat terrain must reproduce 1.1 byte for byte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, toJSON, fieldPreview, resolveTerrain, autoRelief, TERRAIN_MODES, PRESETS } from '../src/cymatic-engine.js';
import { buildInfrastructure, sewerMinSlope, WATER, SEWER } from '../src/infrastructure.js';
import { flows, simulate } from '../src/simulation.js';

const cache = new Map();
const full = (o) => {
  const k = JSON.stringify(o);
  if (!cache.has(k)) { const L = generateCity(o); L.infra = buildInfrastructure(L); cache.set(k, L); }
  return cache.get(k);
};
const PLATES = ['circle', 'square', 'sphere'];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const elevOf = (L, P) => (L.meta.plate === 'sphere' ? len3(P) - L.meta.world.Rs : P[1]);
const terrainOf = (o) => fieldPreview(o).terrain;

test('terrain spec resolves: flat by default, modes validated, heightmaps need a grid', () => {
  assert.equal(resolveTerrain(undefined).mode, 'flat');
  assert.equal(resolveTerrain('relief').mode, 'relief');
  assert.equal(resolveTerrain({ mode: 'valleys', canals: true }).canals, true);
  assert.equal(resolveTerrain({ mode: 'nonsense' }).mode, 'flat');
  assert.deepEqual(TERRAIN_MODES, ['flat', 'relief', 'valleys', 'heightmap']);
  assert.throws(() => resolveTerrain({ mode: 'heightmap' }), /heightmap needs/);
  assert.throws(() => resolveTerrain({ mode: 'relief', relief: 'tall' }), /Relief/);
  assert.equal(resolveTerrain({ mode: 'relief', relief: 5000 }).relief, 2000, 'relief clamps');
  assert.equal(resolveTerrain({ mode: 'relief', relief: 'auto' }).relief, 'auto');
});

test('flat terrain reproduces the 1.1 layout exactly', () => {
  const a = toJSON(generateCity({ plate: 'circle', preset: 'city', frequency: 432 }));
  const b = toJSON(generateCity({ plate: 'circle', preset: 'city', frequency: 432, terrain: 'flat' }));
  const c = toJSON(generateCity({ plate: 'circle', preset: 'city', frequency: 432, terrain: { mode: 'flat', relief: 50 } }));
  assert.equal(a, b);
  assert.equal(a, c);
  const J = JSON.parse(a);
  assert.equal(J.stats.terrain.mode, 'flat');
  assert.equal(J.meta.terrain.mode, 'flat');
});

test('relief follows the wave: the ground is R·S, valleys are R·(2A−1), both within ±relief', () => {
  const o = { plate: 'circle', preset: 'city', frequency: 432 };
  const F = fieldPreview({ ...o, terrain: 'relief' });
  const V = fieldPreview({ ...o, terrain: 'valleys' });
  assert.ok(F.terrain.relief > 0 && Number.isFinite(F.terrain.relief));
  let maxAbs = 0, correlated = 0, n = 0;
  for (let i = 0; i < 400; i++) {
    const u = -0.5 + (i % 20) / 19, v = -0.5 + Math.floor(i / 20) / 19;
    if (!F.inside(u, v)) continue;
    const z = F.terrain.z(u, v), S = F.at(u, v).S;
    maxAbs = Math.max(maxAbs, Math.abs(z));
    assert.ok(Math.abs(z - F.terrain.relief * S) < 1e-9, 'relief = R·S');
    const zv = V.terrain.z(u, v), A = V.at(u, v).A;
    assert.ok(Math.abs(zv - V.terrain.relief * (2 * A - 1)) < 1e-9, 'valleys = R·(2A−1)');
    if (Math.sign(z) === Math.sign(S) || S === 0) correlated++;
    n++;
  }
  assert.ok(maxAbs <= F.terrain.relief + 1e-9);
  assert.equal(correlated, n);
  // valleys halve the automatic relief because |S| doubles the slopes
  assert.ok(Math.abs(V.terrain.relief - Math.max(3, F.terrain.relief / 2)) < 1e-9);
});

test('automatic relief keeps streets walkable: scales with nodal spacing and is capped at 5 % of the plate', () => {
  const dom = { extent: 1000 };
  assert.equal(autoRelief(dom, 100), 4, 'floor at 4 m');
  assert.equal(autoRelief(dom, 500), 20, '4 % of the nodal spacing');
  assert.equal(autoRelief(dom, 10000), 50, 'cap at 5 % of the extent');
  assert.equal(autoRelief(dom, Infinity), 10, 'no nodal lines: a quarter of the plate stands in');
});

test('an imported heightmap is bilinearly sampled over the plate and sets the ground', () => {
  // a ramp: 0 on the west edge, 1 on the east edge
  const W = 8, H = 8, data = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data[y * W + x] = x / (W - 1);
  const F = fieldPreview({ plate: 'square', preset: 'town', frequency: 300, terrain: { mode: 'heightmap', heightmap: { width: W, height: H, data }, relief: 30 } });
  const z = (u) => F.terrain.z(u, 0);
  assert.ok(Math.abs(z(F.lo) + 30) < 1e-6, 'west edge at −relief');
  assert.ok(Math.abs(z(F.hi) - 30) < 1e-6, 'east edge at +relief');
  assert.ok(Math.abs(z((F.lo + F.hi) / 2)) < 1e-6, 'middle at 0');
  assert.ok(z(F.lo + 0.1 * (F.hi - F.lo)) < z(F.lo + 0.6 * (F.hi - F.lo)), 'monotone ramp');
  const L = generateCity({ plate: 'square', preset: 'town', frequency: 300, terrain: { mode: 'heightmap', heightmap: { width: W, height: H, data }, relief: 30, waterLevel: -40 } });
  assert.equal(L.meta.terrain.mode, 'heightmap');
  assert.deepEqual(L.meta.terrain.heightmap, { width: W, height: H });
  // every building stands on the ramp: elevation grows with x
  const sorted = [...L.buildings].sort((a, b) => a.pos[0] - b.pos[0]);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].elevation >= sorted[i - 1].elevation - 1e-6, 'elevation is monotone along the ramp');
  assert.ok(L.stats.terrain.waterShare === 0 && L.stats.terrain.bridges === 0, 'water level below the ramp: nothing floods');
});

test('buildings stand on the ground, streets follow it, and nothing is built on the water or its shore', () => {
  for (const plate of PLATES) for (const [preset, mode] of [['city', 'relief'], ['town', 'valleys'], ['alien', 'relief']]) {
    const o = { plate, preset, frequency: plate === 'sphere' ? 300 : 432, terrain: { mode, canals: mode === 'valleys' } };
    const L = generateCity(o), T = terrainOf(o);
    const F = fieldPreview(o);
    // canals run along the boulevards and take the lots beside them; hills and basins take only the shore
    assert.ok(L.buildings.length > (mode === 'valleys' ? 0.5 : 0.8) * generateCity({ ...o, terrain: 'flat' }).buildings.length, `${plate}/${preset}: most lots survive the terrain`);
    for (const b of L.buildings) {
      const [u, v] = F.toNorm(b.pos);
      const z = T.z(u, v);
      assert.ok(Math.abs(elevOf(L, b.pos) - z) < 1e-6, `${plate}/${preset}: building sits on the ground (${elevOf(L, b.pos)} vs ${z})`);
      assert.ok(Math.abs(b.elevation - z) < 1e-6, 'elevation field matches the ground');
      assert.ok(z >= T.waterLevel + T.shore - 1e-9, `${plate}/${preset}: no building on the shore (z ${z}, water ${T.waterLevel}, shore ${T.shore})`);
    }
    for (const r of L.roads) {
      for (const P of [r.a, r.b]) {
        const [u, v] = F.toNorm(P), z = T.z(u, v), e = elevOf(L, P);
        if (r.bridge) assert.ok(e >= z - 1e-6 && e >= T.waterLevel + 3 - 1e-6, `${plate}/${preset}: bridge deck above ground and water`);
        else assert.ok(Math.abs(e - z) < 1e-6, `${plate}/${preset}: street on the ground`);
      }
    }
    const t = L.stats.terrain;
    assert.equal(t.mode, mode);
    assert.ok(t.waterShare >= 0 && t.waterShare < 0.5, `${plate}/${preset}: water share ${t.waterShare}`);
    assert.ok(t.maxGrade <= 0.15, `${plate}/${preset}: steepest street ${(100 * t.maxGrade).toFixed(1)} %`);
    if (t.waterShare > 0.01) assert.ok(t.bridges > 0 && t.bridgeLength > 0, `${plate}/${preset}: water is crossed by bridges`);
    const hard = L.checks.filter((c) => ['access', 'setback', 'slenderness', 'self-weight', 'terrace', 'street-grade'].includes(c.id));
    for (const c of hard) assert.notEqual(c.status, 'fail', `${plate}/${preset}: ${c.id} ${c.value}`);
  }
});

test('every bridge segment really crosses water (plan samples along it dip under the water level)', () => {
  const o = { plate: 'circle', preset: 'city', frequency: 432, terrain: 'relief' };
  const L = generateCity(o), T = terrainOf(o), F = fieldPreview(o);
  let bridges = 0;
  for (const r of L.roads) {
    let wet = false;
    for (let k = 0; k <= 8; k++) {
      const P = [0, 1, 2].map((i) => r.a[i] + ((r.b[i] - r.a[i]) * k) / 8);
      const [u, v] = F.toNorm(P);
      if (T.z(u, v) < T.waterLevel) wet = true;
    }
    if (r.bridge) { bridges++; assert.ok(wet, 'a bridge spans water'); }
    else assert.ok(!(T.z(...F.toNorm(r.a)) < T.waterLevel && T.z(...F.toNorm(r.b)) < T.waterLevel), 'a street with both ends under water is a bridge');
  }
  assert.equal(bridges, L.stats.terrain.bridges);
});

test('arcologies on terrain: terraces measured from the ground, no exposed face over the limit, basins spanned', () => {
  for (const plate of PLATES) {
    const o = { plate, preset: 'megastructure', frequency: 432, terrain: plate === 'square' ? { mode: 'valleys', canals: true } : 'relief' };
    const L = generateCity(o);
    assert.ok(L.stats.maxTerraceStep <= L.stats.terraceLimit + 1e-6, `${plate}: step ${L.stats.maxTerraceStep} > ${L.stats.terraceLimit}`);
    assert.equal(L.stats.terrain.waterLots, 0, `${plate}: an arcology spans its basins`);
    // brute force the faces between neighbouring cells on a plane: tops differ by at most the limit
    if (plate === 'plane') continue;
    if (plate === 'sphere') continue;
    const lot = PRESETS.megastructure.lot, map = new Map();
    for (const b of L.buildings) map.set(`${Math.round(b.pos[0] / lot)},${Math.round(b.pos[2] / lot)}`, b);
    let worst = 0;
    for (const b of L.buildings) {
      const i = Math.round(b.pos[0] / lot), j = Math.round(b.pos[2] / lot);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = map.get(`${i + di},${j + dj}`); if (n) worst = Math.max(worst, b.h + b.elevation - n.h - n.elevation); }
    }
    assert.ok(worst <= L.stats.terraceLimit + 1e-6, `${plate}: brute-force face ${worst}`);
  }
});

test('the street graph on terrain: nodes carry elevations, junctions still form, bridges are flagged', () => {
  const L = full({ plate: 'circle', preset: 'city', frequency: 432, terrain: 'relief' });
  const G = L.infra.graph, F = fieldPreview({ plate: 'circle', preset: 'city', frequency: 432, terrain: 'relief' });
  const flat = full({ plate: 'circle', preset: 'city', frequency: 432 }).infra.graph;
  for (const n of G.nodes) {
    assert.ok(Number.isFinite(n.elev));
    assert.ok(Math.abs(n.elev - elevOf(L, n.pos)) < 1e-6, 'node elevation is its height above the plane');
  }
  // junctions: a relief city keeps about as many degree-3+ nodes as the flat one (crossings are found in plan, not in 3D)
  const deg3 = (g) => g.nodes.filter((n) => n.deg >= 3).length;
  assert.ok(deg3(G) > 0.8 * deg3(flat), `junctions ${deg3(G)} vs flat ${deg3(flat)}`);
  const bridges = G.edges.filter((e) => e.bridge);
  assert.ok(bridges.length > 0 && bridges.length < G.edges.length / 2);
  // graph connectivity: one component
  const seen = new Uint8Array(G.nodes.length), stack = [0]; seen[0] = 1; let count = 1;
  while (stack.length) { const u = stack.pop(); for (const ei of G.adj[u]) { const e = G.edges[ei], v = e.a === u ? e.b : e.a; if (!seen[v]) { seen[v] = 1; count++; stack.push(v); } } }
  assert.equal(count, G.nodes.length, 'the street graph is connected');
});

test('sewers fall on the heightfield: every gravity run drops at least the minimum slope between true inverts', () => {
  for (const [plate, preset] of [['circle', 'city'], ['square', 'town'], ['sphere', 'alien']]) {
    const L = full({ plate, preset, frequency: plate === 'sphere' ? 300 : 432, terrain: 'relief' });
    const I = L.infra, g = L.meta.gravity, el = (i) => I.graph.nodes[i].elev;
    let gravity = 0;
    for (const p of I.sewer.pipes) {
      assert.ok(p.upDepth >= SEWER.minCover - 1e-9 && p.downDepth >= SEWER.minCover - 1e-9, 'cover kept');
      assert.ok(p.downDepth <= SEWER.maxDepth + 1e-6, `${plate}: depth ${p.downDepth}`);
      if (p.forceMain) continue;
      gravity++;
      const fall = (el(p.up) - p.upDepth) - (el(p.down) - p.downDepth);
      assert.ok(fall >= sewerMinSlope(p.diameter, g) * p.length - 1e-6, `${plate}/${preset}: invert fall ${fall} over ${p.length} m`);
      assert.ok(Math.abs(p.slope - fall / p.length) < 1e-9, 'reported slope is the invert fall');
    }
    assert.ok(gravity > 0.8 * I.sewer.pipes.length, `${plate}/${preset}: most runs flow by gravity`);
    const c = I.checks.find((x) => x.id === 'sewer-gravity');
    assert.equal(c.status, 'pass');
    // treatment plants sit low: no plant higher than the median perimeter elevation
    const perim = [...new Set(I.graph.edges.filter((e) => e.kind === 'wall').map((e) => e.a))].map(el).sort((a, b) => a - b);
    if (perim.length) for (const p of I.sewer.plants) assert.ok(el(p.node) <= perim[perim.length >> 1] + 1e-9, `${plate}: plant on low ground`);
  }
});

test('terrain costs lift stations where the ground climbs, and downhill routing keeps that cost bounded', () => {
  const flat = full({ plate: 'circle', preset: 'city', frequency: 432 }).infra.stats;
  const hill = full({ plate: 'circle', preset: 'city', frequency: 432, terrain: 'relief' }).infra.stats;
  assert.ok(hill.liftStations > flat.liftStations, 'hills need lifts');
  assert.ok(hill.liftStations < 0.08 * hill.manholes + 50, `lifts ${hill.liftStations} stay a small share of ${hill.manholes} manholes`);
});

test('water on terrain: tanks on high ground, every served node between the minimum and maximum static head, PRVs where needed', () => {
  for (const [plate, preset, mode] of [['circle', 'city', 'relief'], ['square', 'city', 'relief'], ['sphere', 'alien', 'relief'], ['square', 'town', 'valleys']]) {
    const L = full({ plate, preset, frequency: plate === 'sphere' ? 300 : 432, terrain: { mode, canals: mode === 'valleys' } });
    const I = L.infra, el = (i) => I.graph.nodes[i].elev;
    for (const t of I.water.towers) {
      assert.ok(t.height >= 10 && t.height <= I.water.towerHeight + 1e-9, `${plate}: tank height ${t.height}`);
      assert.ok(Math.abs(t.elev - el(t.node)) < 1e-9);
    }
    const served = new Set(); for (const l of I.laterals) served.add(l.node);
    for (const n of served) {
      const h = I.water.nodeHeadM[n];
      assert.ok(h >= WATER.minHeadM - 1e-6, `${plate}/${preset}: head ${h} m below minimum at node ${n}`);
      assert.ok(h <= WATER.maxHeadM + 1e-6, `${plate}/${preset}: head ${h} m above maximum at node ${n}`);
    }
    assert.equal(I.checks.find((c) => c.id === 'pressure-zones').status, 'pass', `${plate}/${preset}`);
    // tanks feed their zones by gravity: each stands above the median ground of the zone it serves
    const zoneElev = I.water.towers.map(() => []);
    for (const m of I.water.mains) if (m.tree && m.zone >= 0) zoneElev[m.zone].push(el(m.tree[0]));
    I.water.towers.forEach((t, zi) => {
      const z = zoneElev[zi].sort((a, b) => a - b);
      if (z.length < 10) return;
      assert.ok(t.elev >= z[z.length >> 1] - 1e-9, `${plate}/${preset}: tank ${zi} at ${t.elev.toFixed(1)} m below its zone's median ground ${z[z.length >> 1].toFixed(1)} m`);
    });
    // PRV inlets are over the limit and sit on a tree main
    for (const p of I.water.prvs) assert.ok(p.inletHeadM > WATER.maxHeadM);
  }
});

test('the flow model uses elevation heads: pressure falls on the hills and rises in the basins, PRVs cap it', () => {
  const L = full({ plate: 'square', preset: 'city', frequency: 432, terrain: 'relief' });
  const I = L.infra, el = (i) => I.graph.nodes[i].elev;
  const f = flows(L, I, 3); // night: little friction loss, pressure ≈ static
  let hi = [], lo = [];
  I.laterals.forEach((l) => { if (f.water.nodePressure[l.node] > 0) (el(l.node) > 10 ? hi : lo).push(f.water.nodePressure[l.node]); });
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  assert.ok(hi.length && lo.length);
  assert.ok(mean(lo) > mean(hi), `basins (${mean(lo).toFixed(0)} kPa) see more pressure than hills (${mean(hi).toFixed(0)} kPa)`);
  const maxKPa = 9.81 * L.meta.gravity * WATER.maxHeadM;
  for (const l of I.laterals) assert.ok(f.water.nodePressure[l.node] <= maxKPa + 5, `pressure ${f.water.nodePressure[l.node]} over the PRV limit`);
  assert.equal(f.water.criticalNodes, 0, 'no node below 140 kPa at night');
});

test('growth keyframes keep the terrain invariants and serialise with it', () => {
  const L = generateCity({ plate: 'circle', preset: 'town', frequency: 300, terrain: 'relief' });
  const sim = simulate(L, { years: 60, keyframes: 3 });
  for (const k of sim.keyframes) {
    assert.equal(k.layout.meta.terrain.mode, 'relief');
    for (const r of k.layout.roads) if (r.bridge) assert.ok(elevOf(k.layout, r.a) >= k.layout.meta.terrain.waterLevel + 3 - 1e-6);
    assert.equal(k.infra.checks.find((c) => c.id === 'sewer-gravity').status, 'pass', `year ${k.year}`);
    assert.equal(k.infra.checks.find((c) => c.id === 'pressure-zones').status, 'pass', `year ${k.year}`);
  }
  const J = toJSON(L), O = JSON.parse(J);
  assert.ok(O.meta.terrain.relief > 0 && typeof O.stats.terrain.waterShare === 'number');
  assert.equal(toJSON(generateCity({ plate: 'circle', preset: 'town', frequency: 300, terrain: 'relief' })), J, 'deterministic');
});
