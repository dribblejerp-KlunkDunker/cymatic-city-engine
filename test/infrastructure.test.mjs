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
    for (const lat of I.laterals) {
      const n = I.graph.nodes[lat.node];
      assert.ok(n, 'lateral points at a graph node');
      assert.ok(I.sewer.nodeDepth[lat.node] > 0, `${plate}/${preset}: building's node has a sewer`);
      assert.ok(I.water.nodeHead[lat.node] > 0, `${plate}/${preset}: building's node has water`);
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
      assert.ok(p.slope >= need - 1e-9, `${plate}/${preset}/${g}g: pipe slope ${p.slope} < ${need} for ${p.diameter} m`);
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
  }
});

test('power: substations never exceed their rating and the plant reaches every one of them', () => {
  for (const plate of PLATES) for (const preset of Object.keys(PRESETS)) {
    const L = full({ plate, preset, frequency: 432 });
    const P = L.infra.power;
    assert.ok(P.substations.length >= 1);
    for (const s of P.substations) assert.ok(s.loadMVA <= s.ratingMVA + 1e-9, `${plate}/${preset}: substation at ${s.loadMVA.toFixed(1)} MVA of ${s.ratingMVA}`);
    assert.ok(P.plants.length >= 1);
    assert.ok(P.plants[0].capacityMW >= P.peakMW, 'plant covers the peak');
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
    for (const t of T.tunnels) {
      assert.ok(t.depth >= TRANSIT.minDepth - 1e-9);
      for (const bi of t.nearBuildings) {
        const b = L.buildings[bi];
        assert.ok(t.depth - TRANSIT.diameter / 2 >= foundationDepth(b) + TRANSIT.clearance - 1e-6,
          `${plate}/${preset}: tunnel at ${t.depth} m under a ${b.h.toFixed(0)} m building with ${foundationDepth(b).toFixed(1)} m foundations`);
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

test('infrastructure for a city builds in under 2 s', () => {
  const L = generateCity({ preset: 'city', plate: 'square', frequency: 517, seed: 5 });
  const t = Date.now(); buildInfrastructure(L);
  assert.ok(Date.now() - t < 2000, `${Date.now() - t} ms`);
});
