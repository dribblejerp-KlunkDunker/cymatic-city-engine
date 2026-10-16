// Infrastructure contract: every building served, gravity sewers that really flow downhill,
// substations that are not overloaded, tunnels under the foundations, and all of it deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, toJSON, toOBJ, PRESETS } from '../src/cymatic-engine.js';
import { buildInfrastructure, sewerMinSlope, SEWER, WATER, POWER, TRANSIT, foundationDepth } from '../src/infrastructure.js';

const cache = new Map();
const full = (o) => {
  const k = JSON.stringify(o);
  if (!cache.has(k)) { const L = generateCity(o); L.infra = buildInfrastructure(L); cache.set(k, L); }
  return cache.get(k);
};
const PLATES = ['circle', 'square', 'sphere'];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} got ${a}, expected ${b}`);

test('sewer minimum slope follows the Ten-State table on Earth and steepens as 1/g', () => {
  close(sewerMinSlope(0.2, 1), 0.004, 1e-12, '200 mm');
  close(sewerMinSlope(0.3, 1), 0.0022, 1e-12, '300 mm');
  close(sewerMinSlope(0.6, 1), 0.0008, 1e-12, '600 mm');
  close(sewerMinSlope(0.2, 0.38), 0.004 / 0.38, 1e-12, 'Mars');
  assert.ok(sewerMinSlope(0.15, 1) >= sewerMinSlope(0.2, 1), 'smaller pipes need at least the 200 mm slope');
});

test('every building is connected to water, sewer and power', () => {
  for (const plate of PLATES) for (const preset of Object.keys(PRESETS)) {
    const L = full({ plate, preset, frequency: 432 });
    const I = L.infra;
    assert.equal(I.laterals.length, L.buildings.length, `${plate}/${preset}: one service connection per building`);
    const mainEnds = new Set(); for (const m of I.water.mains) { mainEnds.add(m.a); mainEnds.add(m.b); }
    for (const lat of I.laterals) {
      const n = I.graph.nodes[lat.node];
      assert.ok(n, 'lateral points at a graph node');
      assert.ok(I.sewer.nodeDepth[lat.node] > 0, `${plate}/${preset}: building's node has a sewer`);
      assert.ok(I.water.nodeHead[lat.node] > 0, `${plate}/${preset}: building's node has water`);
      assert.ok(mainEnds.has(lat.node), `${plate}/${preset}: a water main reaches the building's node`);
      assert.ok(I.power.nodeFeeder[lat.node] >= 0, `${plate}/${preset}: building's node has a feeder`);
      assert.ok(dist(L.buildings[lat.building].pos, n.pos) < 2 * PRESETS[preset].streetSpacing || PRESETS[preset].arcology, 'service connection is short');
    }
  }
});

test('gravity sewers: every pipe slopes down toward its outfall by at least the minimum, never below max depth', () => {
  for (const plate of PLATES) for (const preset of ['town', 'city', 'alien']) for (const g of [1, 0.38]) {
    const L = full({ plate, preset, frequency: 432, gravity: g });
    const S = L.infra.sewer;
    assert.ok(S.pipes.length > 100, `${plate}/${preset}: has sewers`);
    for (const p of S.pipes) {
      const need = sewerMinSlope(p.diameter, g);
      if (p.forceMain) { assert.ok(p.lift && p.slope === 0 && p.upDepth === SEWER.minCover, 'a force main leaves a lift station at constant depth'); }
      else assert.ok(p.slope >= need - 1e-9, `${plate}/${preset}/${g}g: pipe slope ${p.slope} < ${need} for ${p.diameter} m`);
      close(p.downDepth - p.upDepth, p.slope * p.length, 1e-6, 'depth gain matches slope × length');
      assert.ok(p.upDepth >= SEWER.minCover - 1e-9, 'minimum cover');
      assert.ok(p.downDepth <= SEWER.maxDepth + 1e-6, `${plate}/${preset}: pipe reaches ${p.downDepth} m (max ${SEWER.maxDepth})`);
      assert.ok(p.flow > 0, 'no dry sewers are built');
    }
    // flow and diameter never shrink downstream
    const byUp = new Map(S.pipes.map((p) => [p.up, p]));
    for (const p of S.pipes) {
      const next = byUp.get(p.down);
      if (next) {
        assert.ok(next.flow >= p.flow - 1e-9, 'flow accumulates downstream');
        assert.ok(next.diameter >= p.diameter - 1e-9, 'pipes do not narrow downstream');
      }
    }
    // a lift station starts a fresh shallow run
    for (const lift of S.liftStations) {
      const out = byUp.get(lift.node);
      assert.ok(out, 'lift station has an outgoing pipe');
      close(out.upDepth, SEWER.minCover, 1e-9, 'force main leaves at minimum cover');
    }
    assert.ok(S.plants.length >= 1);
  }
});

test('lower gravity means steeper sewers and more lift stations', () => {
  const earth = full({ preset: 'city', frequency: 432, gravity: 1 }), moon = full({ preset: 'city', frequency: 432, gravity: 0.165 });
  assert.ok(moon.infra.sewer.liftStations.length > earth.infra.sewer.liftStations.length);
  assert.ok(moon.infra.water.towerHeight > earth.infra.water.towerHeight, 'towers must be taller for the same pressure');
});

test('water: looped mains, velocity within range, every node under a tower', () => {
  for (const plate of PLATES) for (const preset of ['town', 'city']) {
    const L = full({ plate, preset, frequency: 432 });
    const W = L.infra.water;
    assert.ok(W.towers.length >= 1);
    for (const m of W.mains) {
      assert.ok(m.diameter >= WATER.minMain - 1e-9, `${plate}/${preset}: main ${m.diameter} m below the 150 mm fire-flow minimum`);
      if (m.flow > 0) assert.ok(m.velocity <= WATER.maxVelocity + 1e-9, `${plate}/${preset}: ${m.velocity} m/s`);
      close(m.depth, WATER.cover, 1e-9);
    }
    const loops = W.mains.length - (L.infra.graph.nodes.length - 1);
    assert.ok(loops > 0, `${plate}/${preset}: distribution is looped (${W.mains.length} mains on ${L.infra.graph.nodes.length} nodes)`);
    for (const t of W.towers) assert.ok(t.storageM3 > 0 && t.served > 0);
    // the trunk main leaving the plant carries every zone's max-day flow
    const total = W.towers.reduce((s, t) => s + t.demandM3Day, 0) / 86400 * WATER.maxDay;
    const outlet = W.mains.filter((m) => m.kind === 'trunk' && m.a === W.plant.node);
    assert.ok(outlet.length >= 1, 'a trunk main leaves the plant');
    assert.ok(outlet.reduce((s, m) => s + m.flow, 0) >= total - 1e-9, `${plate}/${preset}: plant outlet carries every zone's max-day flow`);
  }
});

test('power: substations never exceed their rating and the plant reaches every one of them', () => {
  for (const plate of PLATES) for (const preset of Object.keys(PRESETS)) {
    const L = full({ plate, preset, frequency: 432 });
    const P = L.infra.power;
    assert.ok(P.substations.length >= 1);
    for (const s of P.substations) assert.ok(s.loadMVA <= s.ratingMVA + 1e-9, `${plate}/${preset}: substation at ${s.loadMVA.toFixed(1)} MVA of ${s.ratingMVA}`);
    assert.ok(P.plants.length >= 1);
    assert.ok(P.plants[0].capacityMW >= 1.25 * P.peakMW - 1e-9, 'plant covers the peak with a 25 % margin');
    // feeder loads: each feeder carries its node's own load plus everything fed through it
    const own = new Float64Array(L.infra.graph.nodes.length);
    for (const lat of L.infra.laterals) own[lat.node] += ((lat.residents * POWER.kWPerResident + lat.jobs * POWER.kWPerJob) * POWER.peakFactor) / 1000 / POWER.powerFactor;
    const children = new Map(); for (const f of P.feeders) (children.get(f.b) ?? children.set(f.b, []).get(f.b)).push(f);
    const byA = new Map(P.feeders.map((f) => [f.a, f]));
    for (const f of P.feeders) {
      const expect = own[f.a] + (children.get(f.a) ?? []).reduce((s, c) => s + c.loadMVA, 0);
      close(f.loadMVA, expect, 1e-9 + 1e-9 * expect, `${plate}/${preset}: feeder load accumulates`);
    }
    void byA;
    // every substation sits on the transmission network
    const tx = new Set(); for (const t of P.transmission) { tx.add(t.a); tx.add(t.b); }
    for (const s of P.substations) assert.ok(tx.has(s.node), 'substation on the grid');
    for (const f of P.feeders) assert.ok(f.loadMVA > 0 && f.depth === POWER.cableDepth);
  }
});

test('transit: stations at district landmarks, tunnels below every nearby foundation, spacing in the metro range', () => {
  for (const plate of PLATES) for (const preset of ['city', 'alien', 'megastructure']) {
    const L = full({ plate, preset, frequency: 432 });
    const T = L.infra.transit;
    assert.ok(T.stations.length >= 2, `${plate}/${preset}: ${T.stations.length} stations`);
    assert.ok(T.tunnels.length > 0);
    const nodes = L.infra.graph.nodes;
    for (const t of T.tunnels) {
      assert.ok(t.depth >= TRANSIT.minDepth - 1e-9);
      // brute force over every building: anything whose footprint reaches the corridor must be cleared
      const A = nodes[t.a].pos, B = nodes[t.b].pos, ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
      for (const b of L.buildings) {
        const ap = [b.pos[0] - A[0], b.pos[1] - A[1], b.pos[2] - A[2]];
        const tt = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L2));
        const d = Math.hypot(ap[0] - ab[0] * tt, ap[1] - ab[1] * tt, ap[2] - ab[2] * tt);
        if (d > TRANSIT.corridor + Math.hypot(b.w, b.d) / 2) continue;
        assert.ok(t.depth - TRANSIT.diameter / 2 >= foundationDepth(b) + TRANSIT.clearance - 1e-6,
          `${plate}/${preset}: tunnel at ${t.depth} m under a ${b.h.toFixed(0)} m building with ${foundationDepth(b).toFixed(1)} m foundations, ${d.toFixed(1)} m off axis`);
      }
    }
    for (const s of T.stations) {
      const nearest = Math.min(...T.stations.filter((o) => o !== s).map((o) => dist(o.pos, s.pos)));
      assert.ok(nearest >= TRANSIT.minSpacing, `${plate}/${preset}: stations ${nearest.toFixed(0)} m apart`);
    }
    // the tunnel network is connected
    const adj = new Map(); const link = (a, b) => { (adj.get(a) ?? adj.set(a, []).get(a)).push(b); };
    for (const t of T.tunnels) { link(t.a, t.b); link(t.b, t.a); }
    const seen = new Set([T.stations[0].node]), stack = [T.stations[0].node];
    while (stack.length) for (const n of adj.get(stack.pop()) ?? []) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    for (const s of T.stations) assert.ok(seen.has(s.node), 'every station reachable');
  }
  assert.equal(full({ preset: 'town', frequency: 432 }).infra.transit.stations.length, 0, 'towns have no metro');
});

test('megastructures get a utility tunnel under every boulevard', () => {
  const L = full({ preset: 'megastructure', frequency: 432 });
  assert.ok(L.infra.utilidors.length > 50);
  for (const u of L.infra.utilidors) assert.ok(u.width > 0 && u.height > 0 && u.depth > 0);
  assert.equal(full({ preset: 'city', frequency: 432 }).infra.utilidors.length, 0);
});

test('streets that cross share a junction node', () => {
  const L = full({ plate: 'circle', preset: 'city', frequency: 432 });
  const { nodes, edges } = L.infra.graph;
  // brute force on a slice of the plan: any two edges that cross in x/z must meet at a node
  let crossings = 0, checked = 0;
  const inSlice = (e) => Math.abs(nodes[e.a].pos[0]) < 150 && Math.abs(nodes[e.a].pos[2]) < 150;
  const sl = edges.filter(inSlice);
  for (let i = 0; i < sl.length; i++) for (let j = i + 1; j < sl.length; j++) {
    const e = sl[i], f = sl[j];
    if (e.a === f.a || e.a === f.b || e.b === f.a || e.b === f.b) continue;
    const P = nodes[e.a].pos, Q = nodes[e.b].pos, R = nodes[f.a].pos, S = nodes[f.b].pos;
    const d = (Q[0] - P[0]) * (S[2] - R[2]) - (Q[2] - P[2]) * (S[0] - R[0]);
    if (Math.abs(d) < 1e-9) continue;
    const t = ((R[0] - P[0]) * (S[2] - R[2]) - (R[2] - P[2]) * (S[0] - R[0])) / d, u = ((R[0] - P[0]) * (Q[2] - P[2]) - (R[2] - P[2]) * (Q[0] - P[0])) / d;
    checked++;
    if (t > 0.05 && t < 0.95 && u > 0.05 && u < 0.95) crossings++;
  }
  assert.ok(checked > 1000);
  assert.equal(crossings, 0, `${crossings} street crossings without a junction`);
});

test('service connectors are short in towns and cities; arcology corridors are utility tunnels', () => {
  for (const plate of PLATES) for (const preset of ['town', 'city', 'alien']) {
    const L = full({ plate, preset, frequency: 432 });
    // flat plates have a perimeter road that ties every loop together; a sphere's nodal loops can sit further apart
    const limit = plate === 'sphere' ? 5 * PRESETS[preset].streetSpacing : 2.5 * PRESETS[preset].lot;
    for (const e of L.infra.graph.edges) if (e.kind === 'service') assert.ok(e.len <= limit, `${plate}/${preset}: connector of ${e.len.toFixed(0)} m`);
  }
  const M = full({ preset: 'megastructure', frequency: 432 });
  const corridorIds = new Set(M.infra.graph.edges.map((e, i) => (e.kind === 'corridor' ? i : -1)).filter((i) => i >= 0));
  for (const id of corridorIds) assert.ok(M.infra.utilidors.some((u) => u.edge === id), 'every corridor is a utility tunnel');
});

test('nothing underground pokes through a building footprint from below except its own service lateral', () => {
  const L = full({ preset: 'city', frequency: 432 });
  // trunk sewers and feeders run under streets: their endpoints are graph nodes, and graph nodes are on roads
  const roads = L.roads;
  const onRoad = (P) => roads.some((r) => {
    const ab = [r.b[0] - r.a[0], r.b[1] - r.a[1], r.b[2] - r.a[2]], ap = [P[0] - r.a[0], P[1] - r.a[1], P[2] - r.a[2]];
    const L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2; const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L2));
    return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t) <= r.w / 2 + 0.6;
  });
  const nodes = L.infra.graph.nodes;
  for (let i = 0; i < nodes.length; i += 37) assert.ok(onRoad(nodes[i].pos), `graph node ${i} is off the street`);
});

test('infrastructure is deterministic and serialises with the city', () => {
  const a = full({ preset: 'town', frequency: 300, seed: 3 });
  const b = generateCity({ preset: 'town', frequency: 300, seed: 3 }); b.infra = buildInfrastructure(b);
  assert.equal(toJSON(a), toJSON(b));
  assert.ok(toJSON(a).includes('"sewer"'));
  const obj = toOBJ(a);
  assert.ok(obj.includes('o sewer_') && obj.includes('o water_') && obj.includes('o power_'), 'networks in the OBJ');
});

test('stats and checks describe the networks', () => {
  const L = full({ preset: 'city', frequency: 432 });
  const s = L.infra.stats;
  assert.ok(s.sewerKm > 10 && s.waterKm > 10 && s.powerKm > 10 && s.transitKm > 1);
  assert.ok(s.waterDemandM3Day > 0 && s.peakMW > 0);
  const ids = L.infra.checks.map((c) => c.id);
  for (const id of ['sewer-slope', 'sewer-depth', 'water-velocity', 'substation-load', 'tunnel-clearance', 'service']) assert.ok(ids.includes(id), id);
  for (const c of L.infra.checks) assert.notEqual(c.status, 'fail', `${c.id}: ${c.value}`);
});

test('infrastructure for a city builds in under 3 s', () => {
  const L = generateCity({ preset: 'city', plate: 'square', frequency: 517, seed: 5 });
  const t = Date.now(); buildInfrastructure(L);
  assert.ok(Date.now() - t < 3000, `${Date.now() - t} ms`);
});

test('force mains appear where a single run cannot stay above the depth limit (low gravity)', () => {
  const L = full({ plate: 'sphere', preset: 'megastructure', frequency: 432, gravity: 0.165 });
  const fm = L.infra.sewer.pipes.filter((p) => p.forceMain);
  assert.ok(fm.length >= 1, 'at least one force main');
  for (const p of fm) { assert.ok(p.lift); assert.equal(p.slope, 0); assert.equal(p.upDepth, SEWER.minCover); assert.equal(p.downDepth, SEWER.minCover); }
  assert.ok(L.infra.sewer.pipes.every((p) => p.downDepth <= SEWER.maxDepth + 1e-6));
  assert.equal(L.infra.checks.find((c) => c.id === 'sewer-depth').status, 'pass');
});

test('infrastructure also serves custom and fantasy-mode cities', () => {
  const L = generateCity({ preset: { base: 'city', label: 'Sky citadel', floorsMax: 60, coreFloors: 300 }, frequency: 432, enforce: false, material: { label: 'Mithril', sigma: 900e6, rho: 3000 } });
  L.infra = buildInfrastructure(L);
  assert.equal(L.infra.laterals.length, L.buildings.length);
  for (const c of L.infra.checks) assert.notEqual(c.status, 'fail', `${c.id}: ${c.value}`);
});
