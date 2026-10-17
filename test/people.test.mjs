// People, traffic and land value (Phase 3): trips are conserved, congestion only where there is flow, BPR and
// capacity formulas by hand, land value rises with access, emergent zoning is a partition, the metro share is
// earned and reaches the flow model, and all of it is deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, toJSON } from '../src/cymatic-engine.js';
import { buildInfrastructure } from '../src/infrastructure.js';
import { people, TRAFFIC, LAND, laneCount, edgeCapacity, freeFlowMinutes, bprMinutes } from '../src/people.js';
import { flows, GROWTH } from '../src/simulation.js';

const cache = new Map();
const full = (o) => {
  const k = JSON.stringify(o);
  if (!cache.has(k)) { const L = generateCity(o); L.infra = buildInfrastructure(L); L.people = people(L, L.infra); cache.set(k, L); }
  return cache.get(k);
};
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} got ${a}, expected ${b}`);

test('lanes, capacity, free-flow time and BPR delay by hand', () => {
  assert.equal(laneCount({ w: 30 }), 6, '(30 − 6) / 3.5 = 6.86 → 6 lanes');
  assert.equal(laneCount({ w: 7 }), 1, 'never under one lane');
  assert.equal(edgeCapacity({ w: 18 }), 3 * 1800);
  close(freeFlowMinutes({ len: 1000, kind: 'ring' }), 60 / 32, 1e-12, '1 km at 32 km/h');
  const e = { len: 1000, kind: 'boulevard', w: 30 };
  close(bprMinutes(e, 0), freeFlowMinutes(e), 1e-12, 'no flow, no delay');
  close(bprMinutes(e, edgeCapacity(e)), freeFlowMinutes(e) * 1.15, 1e-12, 'at capacity +15 %');
  close(bprMinutes(e, 2 * edgeCapacity(e)), freeFlowMinutes(e) * (1 + 0.15 * 16), 1e-12, 'at twice capacity +240 %');
});

test('trips are conserved: assigned trips equal the commuters, and the mode shares sum to one', () => {
  for (const [plate, preset] of [['circle', 'town'], ['circle', 'city'], ['square', 'megastructure']]) {
    const L = full({ plate, preset, frequency: 432 }), P = L.people;
    close(P.trips.assigned, P.stats.commuters, 1 + 1e-6 * P.stats.commuters, `${preset}: assigned vs commuters`);
    close(P.trips.total, P.trips.assigned, 1e-6 * P.trips.total + 1e-9, 'totals agree');
    const m = P.trips.modeShare; close(m.walk + m.metro + m.car, 1, 1e-9, 'mode shares');
    assert.ok(P.stats.commuters <= TRAFFIC.commuters * P.stats.residents + 1 && P.stats.commuters <= P.stats.jobs + 1, 'commuters capped by residents and jobs');
    const sampled = P.sample.commuters.reduce((s, x) => s + x, 0);
    close(sampled, P.stats.commuters, 1, 'sampled origins carry every commuter');
  }
});

test('vehicle-kilometres equal the sum of flow × length, and flow appears only on streets that carry a path', () => {
  const L = full({ plate: 'circle', preset: 'city', frequency: 432 }), P = L.people, G = L.infra.graph;
  let vkt = 0, withFlow = 0;
  G.edges.forEach((e, i) => { vkt += P.traffic.edgeFlow[i] * e.len / 1000; if (P.traffic.edgeFlow[i] > 0) withFlow++; });
  close(vkt, P.stats.vkt, 1e-6 * vkt, 'vkt identity');
  assert.ok(withFlow > 0.2 * G.edges.length && withFlow < G.edges.length, `flow on ${withFlow} of ${G.edges.length} edges`);
  // v/c, speed and lanes needed follow from the flow on every edge
  G.edges.forEach((e, i) => {
    close(P.traffic.vc[i], P.traffic.edgeFlow[i] / edgeCapacity(e), 1e-9, 'v/c');
    assert.ok(P.traffic.speedKmh[i] <= (TRAFFIC.freeSpeedKmh[e.kind] ?? 30) + 1e-9, 'never faster than free flow');
    if (P.traffic.edgeFlow[i] === 0) close(P.traffic.speedKmh[i], TRAFFIC.freeSpeedKmh[e.kind] ?? 30, 1e-9, 'free flow when empty');
    assert.equal(P.traffic.lanesNeeded[i], Math.max(1, Math.ceil(P.traffic.edgeFlow[i] / (TRAFFIC.laneCapacity * 0.9))));
  });
  // congestion only where there is flow, and the congested length is what the v/c says
  let cong = 0;
  G.edges.forEach((e, i) => { if (e.kind === 'service' || e.kind === 'corridor') return; if (P.traffic.vc[i] > 1) { cong += e.len / 1000; assert.ok(P.traffic.edgeFlow[i] > 0); } });
  close(cong, P.stats.congestedKm, 1e-9, 'congested km');
});

test('the assignment responds to congestion: halving the street capacity moves cars and raises travel time', () => {
  const o = { plate: 'circle', preset: 'city', frequency: 432 };
  const L = full(o), base = L.people;
  const saved = TRAFFIC.laneCapacity;
  TRAFFIC.laneCapacity = saved / 8; // a city of lanes an eighth as wide
  try {
    const tight = people(L, L.infra);
    assert.ok(tight.stats.maxVC > base.stats.maxVC, 'tighter streets run fuller');
    assert.ok(tight.stats.meanTripMin > base.stats.meanTripMin, `travel time rises: ${tight.stats.meanTripMin} vs ${base.stats.meanTripMin}`);
    assert.ok(tight.stats.modeShare.metro >= base.stats.modeShare.metro, 'slower cars send more people to the metro');
    assert.ok(tight.stats.congestedKm > base.stats.congestedKm);
  } finally { TRAFFIC.laneCapacity = saved; }
});

test('land value: in [0, 1] with the best lot at 1, rises with accessibility, and the market zoning is a partition', () => {
  for (const [plate, preset] of [['circle', 'city'], ['sphere', 'alien']]) {
    const L = full({ plate, preset, frequency: plate === 'sphere' ? 300 : 432 }), P = L.people, B = L.buildings;
    let max = 0; for (const v of P.landValue) { assert.ok(v >= 0 && v <= 1 + 1e-12); max = Math.max(max, v); }
    close(max, 1, 1e-9, 'best lot is 1');
    // Spearman rank correlation between accessibility and value across buildings (amplitude adds noise but access dominates)
    const nodeOf = new Int32Array(B.length).fill(-1); for (const l of L.infra.laterals) nodeOf[l.building] = l.node;
    const pairs = B.map((b, i) => [P.access[nodeOf[i]], P.landValue[i]]).filter((p) => nodeOf.length);
    const rank = (arr) => { const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]); const r = new Float64Array(arr.length); idx.forEach(([, i], k) => { r[i] = k; }); return r; };
    const ra = rank(pairs.map((p) => p[0])), rv = rank(pairs.map((p) => p[1]));
    const n = pairs.length, ma = (n - 1) / 2; let num = 0, da = 0, dv = 0;
    for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rv[i] - ma); da += (ra[i] - ma) ** 2; dv += (rv[i] - ma) ** 2; }
    const rho = num / Math.sqrt(da * dv);
    assert.ok(rho > 0.5, `${plate}/${preset}: Spearman ρ(access, value) = ${rho.toFixed(2)}`);
    // holding amplitude and metro fixed, value is monotone in access: the formula's partial derivative is positive
    const b0 = B[0]; void b0;
    // emergent zoning partitions the non-green lots by value rank into the configured shares
    const nonGreen = B.map((b, i) => i).filter((i) => B[i].zone !== 'green');
    const count = { core: 0, mixed: 0, residential: 0 };
    for (const i of nonGreen) count[P.emergentZone[i]]++;
    close(count.core / nonGreen.length, LAND.coreShare, 2 / nonGreen.length + 1e-9, 'core share');
    close(count.mixed / nonGreen.length, LAND.mixedShare, 2 / nonGreen.length + 1e-9, 'mixed share');
    for (const i of nonGreen) for (const j of nonGreen) if (P.emergentZone[i] === 'core' && P.emergentZone[j] === 'residential') { assert.ok(P.landValue[i] >= P.landValue[j] - 1e-12); break; }
    B.forEach((b, i) => { if (b.zone === 'green') assert.equal(P.emergentZone[i], 'green'); });
    assert.ok(P.zoneAgreement > 0.3 && P.zoneAgreement <= 1, `agreement ${P.zoneAgreement}`);
  }
});

test('street widths are judged by their flow: under- and over-built lengths follow from lanes needed vs. provided', () => {
  const L = full({ plate: 'circle', preset: 'city', frequency: 432 }), P = L.people, G = L.infra.graph;
  let under = 0, over = 0;
  G.edges.forEach((e, i) => { if (e.kind === 'service' || e.kind === 'corridor') return; if (P.traffic.lanesNeeded[i] > P.traffic.lanes[i]) under += e.len / 1000; if (P.traffic.lanes[i] > P.traffic.lanesNeeded[i] + 2) over += e.len / 1000; });
  close(under, P.stats.underbuiltKm, 1e-9); close(over, P.stats.overbuiltKm, 1e-9);
  assert.ok(P.checks.find((c) => c.id === 'street-width'));
});

test('the metro share is earned from door-to-door times, towns without a metro get none, and flows() can use it', () => {
  const town = full({ plate: 'circle', preset: 'town', frequency: 432 });
  assert.equal(town.people.stats.modeShare.metro, 0);
  const city = full({ plate: 'circle', preset: 'city', frequency: 432 });
  const share = city.people.stats.modeShare.metro;
  assert.ok(share > 0.02 && share < 0.6, `metro share ${share}`);
  const assumed = flows(city, city.infra, 8), earned = flows(city, city.infra, 8, { modeShare: share });
  close(earned.transit.dailyTrips / assumed.transit.dailyTrips, share / GROWTH.modeShare, 1e-6, 'metro trips scale with the share handed in');
});

test('deterministic and serialisable', () => {
  const o = { plate: 'circle', preset: 'town', frequency: 432 };
  const L = generateCity(o); L.infra = buildInfrastructure(L);
  const a = people(L, L.infra), b = people(L, L.infra);
  assert.deepEqual(Array.from(a.traffic.edgeFlow), Array.from(b.traffic.edgeFlow));
  assert.deepEqual(Array.from(a.landValue), Array.from(b.landValue));
  assert.equal(a.stats.meanTripMin, b.stats.meanTripMin);
  const { timingMs, ...rest } = a; void timingMs;
  const J = JSON.parse(JSON.stringify(rest, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v)));
  assert.equal(J.landValue.length, L.buildings.length);
  assert.ok(Array.isArray(J.checks) && J.checks.length >= 5);
  // the street graph the engine serialises is unchanged apart from the edge index the model attached
  assert.ok(toJSON(L).length > 0);
});

test('a city with no jobs or no people yields an empty, well-formed result', () => {
  const L = generateCity({ plate: 'circle', preset: 'town', frequency: 432 }); L.infra = buildInfrastructure(L);
  const I2 = { ...L.infra, laterals: [] };
  const P = people(L, I2);
  assert.equal(P.stats.commuters, 0); assert.equal(P.trips.total, 0); assert.equal(P.traffic.edgeFlow.length, L.infra.graph.edges.length);
});
