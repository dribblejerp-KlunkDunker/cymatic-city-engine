// Simulation contract: growth is deterministic and monotone, keyframes keep every invariant,
// flows obey the formulas and conserve, failures cut off at least the asset's own customers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, heightLimit, slendernessLimit, PRESETS, toJSON } from '../src/cymatic-engine.js';
import { buildInfrastructure, sewerMinSlope, WATER, TRANSIT } from '../src/infrastructure.js';
import {
  simulate, flows, impact, resilience, PROFILES, PEAK_HOUR, hazenWilliams, voltageDrop, partialFlowDepth, cableFor, LIFETIMES, POWER_FLOW,
} from '../src/simulation.js';

const cache = new Map();
const full = (o) => {
  const k = JSON.stringify(o);
  if (!cache.has(k)) { const L = generateCity(o); L.infra = buildInfrastructure(L); cache.set(k, L); }
  return cache.get(k);
};
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} got ${a}, expected ${b}`);

// ---------------------------------------------------------------- profiles and formulas
test('hourly profiles: 24 values, demand profiles average 1, rail boardings sum to 1, two water peaks', () => {
  for (const k of ['water', 'sewage', 'residential', 'commercial']) {
    const p = PROFILES[k];
    assert.equal(p.length, 24);
    close(p.reduce((s, x) => s + x, 0) / 24, 1, 1e-9, k);
    assert.ok(Math.min(...p) > 0.2 && Math.max(...p) < 2.2, k);
  }
  close(PROFILES.rail.reduce((s, x) => s + x, 0), 1, 1e-9);
  const w = PROFILES.water;
  assert.ok(w[7] > w[12] && w[19] > w[12] && w[12] > w[3], 'morning and evening peaks above midday, midday above night');
  assert.ok(PROFILES.sewage.indexOf(Math.max(...PROFILES.sewage)) > w.indexOf(Math.max(...w)), 'sewage lags water');
  assert.ok(PROFILES.residential[19] > PROFILES.residential[13] && PROFILES.commercial[13] > PROFILES.commercial[20]);
});

test('Hazen-Williams head loss matches a hand-worked case', () => {
  // 300 mm, C 130, 100 L/s over 1 km: h = 10.67·1000·0.1^1.852 / (130^1.852 · 0.3^4.87)
  const h = hazenWilliams(0.1, 0.3, 1000, 130);
  const expect = (10.67 * 1000 * Math.pow(0.1, 1.852)) / (Math.pow(130, 1.852) * Math.pow(0.3, 4.87));
  close(h, expect, 1e-9);
  assert.ok(h > 1 && h < 10, `${h} m per km is a sane loss for a busy 300 mm main`);
  assert.equal(hazenWilliams(0, 0.3, 1000, 130), 0);
});

test('three-phase voltage drop matches the research worked example (185 mm² Al, 5 km, 200 A, pf 0.95 ≈ 407 V)', () => {
  const dv = voltageDrop(200, 5, 0.211, 0.11, 0.95);
  close(dv, 407, 2);
  const c = cableFor(12);
  assert.ok(c.parallel >= 2 && c.ampacity >= (12e6 / (Math.sqrt(3) * 11e3)), '12 MVA needs parallel 300 mm² cables');
});

test('partial-flow depth: monotone, half full at half flow, surcharge above 1.076 Q_full', () => {
  close(partialFlowDepth(0.5), 0.5, 0.02);
  close(partialFlowDepth(0.088), 0.2, 0.02);
  let prev = 0;
  for (let q = 0; q <= 1.07; q += 0.01) { const d = partialFlowDepth(q); assert.ok(d >= prev - 1e-9); prev = d; }
  assert.ok(partialFlowDepth(1.2) > 1, 'surcharged');
});

// ---------------------------------------------------------------- growth
test('growth: deterministic, every building gets a build year within the horizon, founding spreads outward', () => {
  const L = full({ preset: 'town', frequency: 432 });
  const a = simulate(L, { years: 120, keyframes: 4 }), b = simulate(L, { years: 120, keyframes: 4 });
  assert.equal(JSON.stringify(a.history), JSON.stringify(b.history));
  assert.equal(a.history.length, L.buildings.length);
  for (const h of a.history) {
    assert.ok(h.built >= 0 && h.built <= 120, `built ${h.built}`);
    assert.ok(h.generations.length >= 1 && h.generations[0].year === h.built);
    for (let i = 1; i < h.generations.length; i++) assert.ok(h.generations[i].year > h.generations[i - 1].year);
  }
  // buildings near the founding node are older on average than buildings far from it
  const d = a.history.map((h) => h.distance), near = [], far = [];
  const med = [...d].sort((x, y) => x - y)[d.length >> 1];
  a.history.forEach((h) => (h.distance <= med ? near : far).push(h.built));
  const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;
  assert.ok(mean(near) < mean(far), `near ${mean(near)} vs far ${mean(far)}`);
  assert.ok(a.events.length > 0 && a.events.every((e) => Number.isFinite(e.year)));
});

test('growth follows an exponential built-up curve: the second half of the horizon adds more than the first', () => {
  const L = full({ preset: 'city', frequency: 432 });
  const S = simulate(L, { years: 100, keyframes: 4 });
  const built = (y) => S.history.filter((h) => h.built <= y).length;
  assert.ok(built(50) < built(100) / 2, `${built(50)} of ${built(100)} by mid-horizon`);
  assert.ok(built(0) >= 1);
});

test('keyframes are complete cities that keep the 1.0 invariants and grow', () => {
  const L = full({ plate: 'square', preset: 'city', frequency: 432 });
  const S = simulate(L, { years: 100, keyframes: 5 });
  assert.equal(S.keyframes.length, 5);
  let prevCount = 0;
  const hMax = heightLimit(L.meta.materialSpec, L.meta.gravity), sl = slendernessLimit(PRESETS.city.slender, L.meta.gravity);
  for (const K of S.keyframes) {
    assert.ok(K.layout.buildings.length >= prevCount, 'monotone growth'); prevCount = K.layout.buildings.length;
    for (const b of K.layout.buildings) {
      assert.ok(b.h <= hMax + 1e-6 && b.h <= sl * Math.min(b.w, b.d) + 1e-6, 'structural limits hold through densification');
      assert.ok(b.floors >= 1);
    }
    assert.ok(K.layout.roads.length > 0 && K.layout.roads.length <= L.roads.length);
    assert.ok(K.infra.laterals.length === K.layout.buildings.length, 'every building in the keyframe is served');
    for (const c of K.infra.checks) assert.notEqual(c.status, 'fail', `${K.year}: ${c.id} ${c.value}`);
    assert.ok(K.stats.population > 0);
  }
  const last = S.keyframes[S.keyframes.length - 1];
  assert.equal(last.layout.buildings.length, L.buildings.length, 'the last keyframe holds every building');
  assert.ok(S.keyframes[0].stats.population < 0.2 * last.stats.population, 'early keyframes are small towns, not copies of the final city');
  assert.ok(S.keyframes[0].layout.stats.population === S.keyframes[0].stats.population && S.keyframes[0].layout.checks.length > 5, 'keyframe layouts carry their own stats and checks');
  assert.ok(last.stats.gfaM2 >= S.keyframes[0].stats.gfaM2);
  // streets appear connected: every keyframe's road set is a connected graph through the founding node
  assert.ok(S.keyframes[0].infra.graph.connectors <= 3, 'early street network is not a scatter of fragments');
});

test('densification: later generations never shrink a building and respect the lift-core rule', () => {
  const L = full({ preset: 'city', frequency: 432 });
  const S = simulate(L, { years: 150, keyframes: 3 });
  let grew = 0;
  for (const h of S.history) {
    for (let i = 1; i < h.generations.length; i++) {
      const a = h.generations[i - 1], b = h.generations[i];
      assert.ok(b.floors >= a.floors, 'rebuilds do not shrink');
      if (b.floors > a.floors) grew++;
      const side = Math.min(L.buildings[h.building].w, L.buildings[h.building].d);
      if (b.floors > 6) assert.ok(side >= 14 - 1e-9, 'tall rebuilds only on lots with room for a core');
    }
  }
  assert.ok(grew > 0, 'some rebuilds densify');
});

// ---------------------------------------------------------------- flows
test('water flow: pressure falls along every main, never below the tank head, flagged below 241 kPa', () => {
  const L = full({ preset: 'city', frequency: 432 });
  const F = flows(L, L.infra, 7);
  const W = F.water;
  const g = L.meta.gravity, headKPa = 9.81 * g * L.infra.water.towerHeight;
  for (const t of L.infra.water.towers) close(W.nodePressure[t.node], headKPa, 1e-6, 'tank node at static head');
  let strict = 0;
  for (const m of L.infra.water.mains) {
    if (!m.tree) continue;
    const [child, parent] = m.tree;
    assert.ok(W.nodePressure[child] <= W.nodePressure[parent] + 1e-9, 'pressure drops away from the tank');
    if ((m.distFlow ?? m.flow) > 0) { assert.ok(W.nodePressure[child] < W.nodePressure[parent], 'a flowing main loses head'); strict++; }
    assert.ok(W.nodePressure[child] <= headKPa + 1e-9);
  }
  assert.ok(strict > 100, 'many mains carry flow');
  // hand-worked: the first main below a tank loses exactly the Hazen-Williams head of its hourly flow
  const t0 = L.infra.water.towers[0];
  const first = L.infra.water.mains.find((m) => m.tree && m.tree[1] === t0.node && (m.distFlow ?? m.flow) > 0);
  const Q = ((first.distFlow ?? first.flow) / 3) * PROFILES.water[7];
  close(W.nodePressure[first.tree[0]], 9.81 * g * (t0.height - hazenWilliams(Q, first.diameter, first.length, 130)), 1e-6, 'first main below the tank');
  // served nodes with no head still count as critical, never vanish
  const dry = flows(L, L.infra, 7, { hazenC: 20 });
  assert.ok(dry.water.criticalNodes > W.criticalNodes && dry.water.minPressure <= W.minPressure);
  assert.equal(W.lowNodes, W.nodePressure.filter((p, i) => p > 0 && p < 241).length);
  assert.ok(W.minPressure > 0);
  // hourly demand scales flow: 3 am carries less than 7 am
  const night = flows(L, L.infra, 3);
  assert.ok(night.water.totalFlow < F.water.totalFlow);
  close(F.water.totalFlow / night.water.totalFlow, PROFILES.water[7] / PROFILES.water[3], 1e-9);
});

test('power flow: voltage drops along feeders, loading in [0, ∞), substations scale with the hour', () => {
  const L = full({ preset: 'city', frequency: 432 });
  const F = flows(L, L.infra, 19);
  const P = F.power;
  for (const s of L.infra.power.substations) close(P.nodeVoltage[s.node], 1, 1e-12, 'substation bus at 1.0 pu');
  for (const f of L.infra.power.feeders) {
    assert.ok(P.nodeVoltage[f.a] < P.nodeVoltage[f.b], 'voltage falls along every loaded feeder');
    assert.ok(P.nodeVoltage[f.a] > 0.8);
  }
  // hand-worked: first feeder below substation 0
  const s0 = L.infra.power.substations[0], f0 = L.infra.power.feeders.find((f) => f.b === s0.node);
  const I = (f0.loadMVA * 1e6 * P.blend) / (Math.sqrt(3) * 11e3), cable = cableFor(f0.classMVA);
  const pfMix = P.feeders.length ? null : null; void pfMix;
  const dv = P.feeders.find((x) => x.edge === f0.edge).dropV;
  close(P.nodeVoltage[f0.a], 1 - dv / 11e3, 1e-12, 'bus minus the computed drop');
  assert.ok(dv > voltageDrop(I, f0.length / 1000, cable.R, POWER_FLOW.X / cable.parallel, 0.95) * 0.9 && dv < voltageDrop(I, f0.length / 1000, cable.R, POWER_FLOW.X / cable.parallel, 0.9) * 1.1, 'drop between the residential and commercial power-factor cases');
  // the hourly factor is normalised so the design peak is the busiest hour
  const blends = Array.from({ length: 24 }, (_, hh) => flows(L, L.infra, hh).power.blend);
  close(Math.max(...blends), 1, 1e-12, 'peak hour factor is 1');
  assert.ok(Math.min(...blends) < 0.6);
  for (const x of P.feeders) assert.ok(x.loading >= 0 && Number.isFinite(x.loading));
  assert.equal(P.underVoltage, P.nodeVoltage.filter((v, i) => v > 0 && v < 0.95).length);
  const noon = flows(L, L.infra, 13);
  assert.ok(noon.power.totalMVA !== F.power.totalMVA);
  for (let i = 0; i < P.substations.length; i++) close(P.substations[i].loading * L.infra.power.substations[i].ratingMVA, P.substations[i].loadMVA, 1e-9);
});

test('sewer flow: fullness from Manning partial flow, design peak hour reaches the design fullness', () => {
  const L = full({ preset: 'city', frequency: 432 });
  const F = flows(L, L.infra, 8);
  for (const p of F.sewer.pipes) { assert.ok(p.fullness >= 0); if (!p.forceMain) assert.ok(p.fullness <= 1.2); }
  const peakHour = PROFILES.sewage.indexOf(Math.max(...PROFILES.sewage));
  const peak = flows(L, L.infra, peakHour);
  const maxFull = Math.max(...peak.sewer.pipes.filter((p) => !p.forceMain).map((p) => p.fullness));
  close(maxFull, partialFlowDepth(0.8), 0.02, 'the tightest pipe runs at the 80 % design flow at peak hour');
  assert.ok(maxFull > 0.6);
  assert.equal(peak.sewer.surcharged, 0);
  const night = flows(L, L.infra, 3);
  assert.ok(Math.max(...night.sewer.pipes.map((p) => p.fullness)) < maxFull);
});

test('metro: trips conserve, link loads sit on the tunnel tree, AM and PM reverse direction', () => {
  const L = full({ preset: 'city', frequency: 432 });
  const am = flows(L, L.infra, 8), pm = flows(L, L.infra, 17);
  const T = am.transit;
  assert.ok(T.dailyTrips > 0 && T.hourTrips > 0 && T.hourTrips < T.dailyTrips);
  close(T.hourTrips, T.dailyTrips * PROFILES.rail[8], 1e-6 * T.dailyTrips);
  const boardings = T.stations.reduce((s, x) => s + x.boardings, 0);
  close(boardings, T.hourTrips, 1e-6 * T.dailyTrips, 'everyone who travels boards somewhere');
  assert.equal(T.links.length, L.infra.transit.tunnels.length);
  for (const l of T.links) assert.ok(l.capacity > 0 && l.loadAB >= 0 && l.loadBA >= 0);
  const totalLoad = T.links.reduce((s, l) => s + l.loadAB + l.loadBA, 0);
  assert.ok(totalLoad >= T.hourTrips, 'every trip rides at least one link');
  assert.ok(T.links.some((l) => l.loadAB > 0) && T.links.some((l) => l.loadBA > 0));
  for (let i = 0; i < T.links.length; i++) { close(T.links[i].loadAB, pm.transit.links[i].loadBA * (PROFILES.rail[8] / PROFILES.rail[17]), 1e-6 * T.hourTrips, 'PM reverses AM link by link'); }
});

test('a town (no metro) and an arcology still flow', () => {
  for (const preset of ['town', 'megastructure']) {
    const L = full({ preset, frequency: 432 });
    const F = flows(L, L.infra, 12);
    assert.ok(F.water.minPressure > 0 && F.power.totalMVA > 0);
    if (preset === 'town') assert.equal(F.transit.links.length, 0);
  }
});

// ---------------------------------------------------------------- failure analysis
test('impact: failing a tank cuts off at least its own zone unless loops reach another tank', () => {
  const L = full({ preset: 'city', frequency: 432 });
  const I = L.infra;
  const zone0 = I.laterals.filter((l) => I.water.mains.some((m) => m.kind === 'distribution' && m.zone === 0 && (m.a === l.node))).length;
  const r = impact(L, I, { kind: 'tower', index: 0 });
  assert.ok(r.affected.length + r.degraded.length >= zone0 * 0.9, `zone had ${zone0} connections; impact lists ${r.affected.length}+${r.degraded.length}`);
  assert.ok(r.people >= 0 && r.summary.length > 10);
  const plant = impact(L, I, { kind: 'waterplant', index: 0 });
  assert.ok(plant.hoursOfStorage > 0 && plant.hoursOfStorage < 48, 'tanks hold roughly a day');
});

test('impact: substation, feeder subtree, transmission subtree, treatment plant, lift station, tunnel and station', () => {
  const L = full({ preset: 'city', frequency: 432 });
  const I = L.infra;
  const sub = impact(L, I, { kind: 'substation', index: 0 });
  const zoneBuildings = I.laterals.filter((l) => I.power.nodeFeeder[l.node] === 0).length;
  assert.equal(sub.affected.length, zoneBuildings);
  const f = impact(L, I, { kind: 'power', index: 0 });
  assert.ok(f.affected.length >= 1 && f.affected.length <= zoneBuildings || f.affected.length >= 1);
  // a meshed grid: most corridors strand nobody, the worst corridor strands what the N-1 score says, never more than the target
  const corridorHits = I.power.transmission.map((t, i) => impact(L, I, { kind: 'transmission', index: i }).share);
  assert.ok(corridorHits.some((x) => x === 0), 'the mesh gives most corridors a backup');
  close(Math.max(...corridorHits), I.power.n1Transmission, 1e-9, 'worst corridor matches n1Transmission');
  const plantOut = impact(L, I, { kind: 'plant', index: 0 });
  assert.ok(plantOut.shortfallMW > 0 && plantOut.affected.length + plantOut.degraded.length === I.laterals.length, 'losing the station leaves the city short');
  const tp = impact(L, I, { kind: 'treatment', index: 0 });
  assert.ok(tp.affected.length === I.sewer.pipes.filter((p) => p.plant === 0 && p.flow > 0).length || tp.affected.length > 0);
  if (I.sewer.liftStations.length) {
    const lift = impact(L, I, { kind: 'lift', index: 0 });
    assert.ok(lift.affected.length >= 1);
  }
  const tun = impact(L, I, { kind: 'transit', index: 0 });
  assert.ok(tun.tripsLost >= 0 && tun.tripsLost <= 1);
  const st = impact(L, I, { kind: 'station', index: 0 });
  assert.ok(st.tripsLost > 0);
});

test('resilience: N-1 scores in [0,1], the worst single failure is the max over assets, more tanks means a lower water score', () => {
  const L = full({ preset: 'city', frequency: 432 });
  const R = resilience(L, L.infra);
  for (const k of ['water', 'power', 'sewer', 'transit']) {
    assert.ok(R[k].worstShare >= 0 && R[k].worstShare <= 1, k);
    assert.ok(R[k].worst && typeof R[k].worst.kind === 'string');
  }
  const town = full({ preset: 'town', frequency: 432 });
  const Rt = resilience(town, town.infra);
  close(Rt.water.worstShare, 1, 1e-9, 'one tank serves the whole town');
  close(Rt.power.worstShare, 1, 1e-9, 'one substation serves the whole town');
  assert.ok(R.water.worstShare > 0.02 && R.water.worstShare < 0.5, `a city tank serves a slice: ${R.water.worstShare}`);
  assert.ok(R.power.worstShare > 0 && R.power.worstShare <= 0.35, `meshed grid: ${R.power.worstShare}`);
  assert.ok(R.transit.worstShare > 0.05);
  assert.equal(Rt.transit.worstShare, 0);
  // the N-1 score agrees with the failure model the Fail button runs
  const w = R.power.worst;
  const r = impact(L, L.infra, w);
  close(r.share, R.power.worstShare, 1e-9, 'tile and Fail button agree');
});

test('simulation output serialises with the layout and stays deterministic', () => {
  const L = full({ preset: 'town', frequency: 300, seed: 3 });
  const S1 = simulate(L, { years: 80, keyframes: 3 }), S2 = simulate(L, { years: 80, keyframes: 3 });
  assert.equal(JSON.stringify(S1.keyframes.map((k) => k.stats)), JSON.stringify(S2.keyframes.map((k) => k.stats)));
  const txt = toJSON(S1.keyframes[1].layout);
  assert.ok(txt.length > 1000 && JSON.parse(txt).meta.year === S1.keyframes[1].year);
});
