// Query layer and inverse problem (Phase 5): answers equal direct computation; the English front end maps
// questions to the right structured queries; suggestions gain what they claim; every search result meets its
// constraints when regenerated from its profile; searches are deterministic and stay in budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, enumerateModes, drivenResponse } from '../src/cymatic-engine.js';
import { buildInfrastructure } from '../src/infrastructure.js';
import { impact } from '../src/simulation.js';
import { dijkstra as dijkstraLocal } from '../src/infrastructure.js';
import { cityOf, query, ask, suggest, search, agentTools, METRICS, COLLECTIONS, ASK_EXAMPLES } from '../src/query.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} got ${a}, expected ${b}`);
const cache = new Map();
const city = (o) => { const k = JSON.stringify(o); if (!cache.has(k)) cache.set(k, cityOf(generateCity(o))); return cache.get(k); };
const TOWN = { plate: 'circle', preset: 'town', frequency: 300 }, CITY = { plate: 'circle', preset: 'city', frequency: 432 };

test('structured queries equal direct computation: filters, groups, aggregates, order, limit, fields', () => {
  const C = city(CITY), L = C.layout, I = C.infra;
  // filter + count
  const tall = query(C, { from: 'buildings', where: [{ field: 'floors', op: '>', value: 20 }], aggregate: { n: 'count' } });
  assert.equal(tall.rows[0].n, L.buildings.filter((b) => b.floors > 20).length);
  assert.equal(tall.total, L.buildings.length);
  // group by zone, sums from the laterals
  const byZone = query(C, { from: 'buildings', groupBy: 'zone', aggregate: { n: 'count', residents: 'sum:residents', tallest: 'max:h' } });
  const lat = new Map(I.laterals.map((l) => [l.building, l]));
  for (const r of byZone.rows) {
    const bs = L.buildings.map((b, i) => [b, i]).filter(([b]) => b.zone === r.zone);
    assert.equal(r.n, bs.length);
    close(r.residents, bs.reduce((s, [, i]) => s + (lat.get(i)?.residents ?? 0), 0), 1, `${r.zone} residents`);
    close(r.tallest, Math.max(...bs.map(([b]) => b.h)), 0.01);
  }
  close(byZone.rows.reduce((s, r) => s + r.residents, 0), I.laterals.reduce((s, l) => s + l.residents, 0), 2, 'every resident counted once');
  // in, order, limit, fields
  const q = query(C, { from: 'buildings', where: [{ field: 'zone', op: 'in', value: ['core', 'mixed'] }], orderBy: [{ field: 'h', dir: 'desc' }, { field: 'index', dir: 'asc' }], limit: 5, fields: ['index', 'h'] });
  const expect = L.buildings.map((b, i) => ({ i, h: b.h, z: b.zone })).filter((x) => x.z === 'core' || x.z === 'mixed').sort((a, b) => b.h - a.h || a.i - b.i).slice(0, 5);
  assert.deepEqual(q.rows.map((r) => r.index), expect.map((x) => x.i));
  assert.deepEqual(Object.keys(q.rows[0]), ['index', 'h']);
  assert.equal(q.count, L.buildings.filter((b) => b.zone === 'core' || b.zone === 'mixed').length);
  // districts against a manual grouping
  const D = query(C, { from: 'districts' }).rows;
  for (const d of D) {
    const bs = L.buildings.map((b, i) => [b, i]).filter(([b]) => b.district === d.district);
    assert.equal(d.buildings, bs.length);
    close(d.residents, bs.reduce((s, [, i]) => s + (lat.get(i)?.residents ?? 0), 0), 1);
  }
  // network collections are the infrastructure's own records
  assert.equal(query(C, { from: 'towers' }).rows.length, I.water.towers.length);
  assert.equal(query(C, { from: 'liftStations', aggregate: { n: 'count' } }).rows[0].n, I.sewer.liftStations.length);
  const sub = query(C, { from: 'substations', orderBy: [{ field: 'loading', dir: 'desc' }], limit: 1 }).rows[0];
  close(sub.loading, Math.max(...I.power.substations.map((s) => s.loadMVA / s.ratingMVA)), 1e-4);
  assert.equal(query(C, { from: 'pipes', where: [{ field: 'forceMain', op: '=', value: true }], aggregate: { n: 'count' } }).rows[0].n, I.sewer.pipes.filter((p) => p.forceMain).length);
  // models are computed only when a query needs them
  const fresh = cityOf(generateCity(TOWN));
  query(fresh, { from: 'buildings', where: [{ field: 'floors', op: '>', value: 1 }] });
  assert.equal(fresh.hasPeople(), false, 'plain building fields need no commute model');
  assert.equal(fresh.layout.infra ?? null, null, 'nor the networks');
});

test('queries compare at full precision, treat missing values as missing, and read access at the building\'s own street node', () => {
  const C = city(CITY), L = C.layout, I = C.infra, P = C.people;
  // thresholds that fall between a value and its rounding: the filter sees the raw value (amplitude, position, height)
  let probes = 0;
  for (const [field, get, k] of [['amp', (b) => b.amp, 4], ['x', (b) => b.pos[0], 1], ['h', (b) => b.h, 2]]) {
    const vals = L.buildings.map(get);
    for (const v of vals.filter((x) => Math.abs(x * 10 ** k - Math.round(x * 10 ** k)) > 0.2).slice(0, 5)) {
      const cut = Math.round(v * 10 ** k) / 10 ** k; // e.g. 0.38114 → 0.3811
      for (const op of ['>', '>=', '<', '<=']) {
        const n = query(C, { from: 'buildings', where: [{ field, op, value: cut }], aggregate: { n: 'count' } }).rows[0].n;
        const f = { '>': (x) => x > cut, '>=': (x) => x >= cut, '<': (x) => x < cut, '<=': (x) => x <= cut }[op];
        assert.equal(n, vals.filter(f).length, `${field} ${op} ${cut}`);
      }
      probes++;
    }
  }
  assert.ok(probes >= 10, `real boundary probes (${probes}); heights are whole floors here, amplitude and position are not`);
  // access alone (without node, residents or jobs) is the commute model's accessibility at the building's lateral node
  const lat = new Map(I.laterals.map((l) => [l.building, l]));
  const acc = query(C, { from: 'buildings', fields: ['index', 'access'] }).rows;
  let checked = 0;
  for (const r of acc) { const l = lat.get(r.index); if (!l) { assert.equal(r.access, null); continue; } close(r.access, P.access[l.node], 1e-3, `building ${r.index} access`); checked++; }
  assert.ok(checked > 0.95 * L.buildings.length);
  const hi = query(C, { from: 'buildings', where: [{ field: 'access', op: '>', value: 0.5 }], aggregate: { n: 'count' } }).rows[0].n;
  assert.equal(hi, I.laterals.filter((l) => P.access[l.node] > 0.5).length, 'filters on access see real values');
  // null: no chord, so era is null; it satisfies no ordering, equals null, and aggregates to null
  assert.equal(query(C, { from: 'buildings', where: [{ field: 'era', op: '<', value: 1 }], aggregate: { n: 'count' } }).rows[0].n, 0);
  assert.equal(query(C, { from: 'buildings', where: [{ field: 'era', op: '=', value: null }], aggregate: { n: 'count' } }).rows[0].n, L.buildings.length);
  const g = query(C, { from: 'buildings', groupBy: 'zone', aggregate: { lo: 'min:era', hi: 'max:era', mean: 'mean:era', total: 'sum:era' } }).rows;
  for (const r of g) { assert.equal(r.lo, null); assert.equal(r.hi, null); assert.equal(r.mean, null); assert.equal(r.total, 0); }
  // groups can be ordered by their count; aggregate names are not fields to filter on
  const z = query(C, { from: 'buildings', groupBy: 'zone', orderBy: [{ field: 'count', dir: 'desc' }] }).rows;
  for (let i = 1; i < z.length; i++) assert.ok(z[i].count <= z[i - 1].count);
  assert.throws(() => query(C, { from: 'buildings', aggregate: { n: 'count' }, where: [{ field: 'n', op: '>', value: 0 }] }), /no field "n"/);
  assert.throws(() => query(C, { from: 'buildings', aggregate: { m: 'max' } }), /needs a field/);
});

test('queries reject what they cannot answer, clearly', () => {
  const C = city(TOWN);
  assert.throws(() => query(C, { from: 'castles' }), /Unknown collection/);
  assert.throws(() => query(C, { from: 'buildings', where: [{ field: 'colour', op: '=', value: 1 }] }), /no field "colour"/);
  assert.throws(() => query(C, { from: 'buildings', where: [{ field: 'h', op: '~', value: 1 }] }), /Unknown operator/);
  assert.throws(() => query(C, { from: 'buildings', aggregate: { x: 'median:h' } }), /Unknown aggregate/);
  assert.throws(() => query(C, { from: 'buildings', where: [{ field: 'status', op: '=', value: 'lost' }] }), /need a `fail/);
  assert.throws(() => query(C, { from: 'towers', fail: { kind: 'tower', index: 0 } }), /applies to buildings and districts/);
  assert.deepEqual(COLLECTIONS.sort(), ['buildings', 'districts', 'liftStations', 'pipes', 'stations', 'streets', 'substations', 'towers', 'treatment'].sort());
});

test('a failure query is the impact model grouped by district', () => {
  const C = city(CITY), L = C.layout, I = C.infra;
  for (const fail of [{ kind: 'substation', index: 1 }, { kind: 'tower', index: 2 }, { kind: 'treatment', index: 0 }]) {
    const r = impact(L, I, fail), lost = new Set(r.affected), deg = new Set(r.degraded);
    const q = query(C, { from: 'districts', fail, where: [{ field: 'lost', op: '>', value: 0 }] });
    const manual = new Map();
    for (const i of lost) { const d = L.buildings[i].district; if (d >= 0) manual.set(d, (manual.get(d) ?? 0) + 1); }
    assert.deepEqual(q.rows.map((x) => [x.district, x.lost]).sort((a, b) => a[0] - b[0]), [...manual].sort((a, b) => a[0] - b[0]), `${fail.kind}: districts losing service`);
    const b = query(C, { from: 'buildings', fail, groupBy: 'status' });
    const n = Object.fromEntries(b.rows.map((x) => [x.status, x.count]));
    assert.equal(n.lost ?? 0, lost.size); assert.equal(n.degraded ?? 0, [...deg].filter((i) => !lost.has(i)).length);
    assert.equal(q.failure.summary, r.summary);
  }
});

test('the English front end maps questions to the right structured query, with the numbers people see', () => {
  const C = city(CITY), L = C.layout;
  const r1 = ask(C, 'Which districts lose power if substation 2 fails?');
  assert.deepEqual(r1.understood.fail, { kind: 'substation', index: 1 }, 'the page counts assets from 1; queries from 0');
  assert.deepEqual(r1.rows, query(C, r1.understood).rows);
  for (const [text, kind] of [['which districts lose water if tank 3 fails', 'tower'], ['which districts lose water if the water plant 1 fails', 'waterplant'], ['which districts lose sewer service if treatment plant 1 fails', 'treatment'], ['which districts lose sewer if lift station 2 fails', 'lift'], ['which districts lose power if the power plant 1 fails', 'plant'], ['which districts lose metro if metro station 1 fails', 'station']]) {
    assert.equal(ask(C, text).understood.fail.kind, kind, text);
  }
  const r2 = ask(C, 'How many buildings are over 20 floors?');
  assert.equal(r2.rows[0].count, L.buildings.filter((b) => b.floors > 20).length);
  assert.match(r2.answer, new RegExp(`^${L.buildings.filter((b) => b.floors > 20).length.toLocaleString('en-US')} of`));
  const r3 = ask(C, 'how many buildings are under 30 m tall');
  assert.equal(r3.rows[0].count, L.buildings.filter((b) => b.h < 30).length);
  const r4 = ask(C, 'What is the tallest building?');
  close(r4.rows[0].h, Math.max(...L.buildings.map((b) => b.h)), 5e-4);
  assert.equal(r4.rows[0].index, L.buildings.reduce((m, b, i) => (b.h > L.buildings[m].h ? i : m), 0));
  const r5 = ask(C, 'Which district has the most residents?');
  const D = query(C, { from: 'districts' }).rows;
  assert.equal(r5.rows[0].district, D.reduce((m, d) => (d.residents > m.residents ? d : m)).district);
  const r6 = ask(C, 'How many people live in district 4?');
  close(r6.rows[0].residents, D.find((d) => d.district === 4).residents, 1);
  assert.equal(ask(C, 'How many lift stations are there?').rows[0].count, C.infra.sewer.liftStations.length);
  // the service named in the question decides which plant or station is meant
  for (const [text, kind, index] of [
    ['which districts lose water if the water treatment plant 1 fails', 'waterplant', 0], ['which districts lose water if the plant fails', 'waterplant', 0],
    ['which districts lose power if the plant 1 fails', 'plant', 0], ['which districts lose power if the power station fails', 'plant', 0],
    ['which districts lose transit if station 3 fails', 'station', 2], ['which districts lose sewer if the sewage treatment plant fails', 'treatment', 0],
    ['which districts lose power if the 2nd substation fails', 'substation', 1], ['which districts lose power if substation two fails', 'substation', 1],
    ['Which districts lose water if tank 3 fails ?', 'tower', 2], ['which districts lose water if tank #3 fails', 'tower', 2],
  ]) assert.deepEqual(ask(C, text).understood.fail, { kind, index }, text);
  assert.throws(() => ask(C, 'which districts lose service if the plant 1 fails'), /Which plant/);
  // out-of-range assets are refused, by the page's numbering and by the query's
  const tanks = C.infra.water.towers.length, subs = C.infra.power.substations.length;
  assert.throws(() => ask(C, 'which districts lose water if tank 0 fails'), /numbered from 1/);
  assert.throws(() => ask(C, `which districts lose water if tank ${tanks + 1} fails`), new RegExp(`no tank ${tanks + 1}: this city has ${tanks}`));
  assert.throws(() => ask(C, `which districts lose power if substation ${subs + 1} fails`), /no substation/);
  for (const [kind, n] of [['tower', tanks], ['substation', subs], ['lift', C.infra.sewer.liftStations.length], ['sewer', C.infra.sewer.pipes.length], ['plant', C.infra.power.plants.length], ['power', C.infra.power.feeders.length], ['transmission', C.infra.power.transmission.length], ['treatment', C.infra.sewer.plants.length], ['station', C.infra.transit.stations.length], ['transit', C.infra.transit.tunnels.length]]) {
    assert.throws(() => query(C, { from: 'districts', fail: { kind, index: n } }), RangeError, `${kind} ${n} is out of range`);
    assert.throws(() => query(C, { from: 'districts', fail: { kind, index: -1 } }), RangeError);
    assert.throws(() => query(C, { from: 'districts', fail: { kind, index: '1' } }), RangeError, 'a string index is not a number');
    query(C, { from: 'districts', fail: { kind, index: n - 1 } }); // the last one is fine
  }
  assert.throws(() => query(C, { from: 'districts', fail: { kind: 'dragon', index: 0 } }), /Unknown asset kind/);
  assert.throws(() => query(city(TOWN), { from: 'districts', fail: { kind: 'station', index: 0 } }), /no metro stations/, 'a town without a metro says so');
  // thresholds: at least / at most; busiest = most cars, most congested = highest v/c
  assert.equal(ask(C, 'how many buildings are at least 10 floors').rows[0].count, L.buildings.filter((b) => b.floors >= 10).length);
  assert.equal(ask(C, 'how many buildings are over ten floors').rows[0].count, L.buildings.filter((b) => b.floors > 10).length);
  const T = C.people.traffic;
  const busiest = ask(C, 'What is the busiest street?').rows[0].index, worst = ask(C, 'what is the most congested road').rows[0].index;
  assert.equal(T.edgeFlow[busiest], Math.max(...T.edgeFlow)); assert.equal(T.vc[worst], Math.max(...T.vc));
  assert.match(ask(C, 'how many treatment plants are there').answer, /^1 treatment plant\.$/);
  assert.throws(() => ask(C, 'What is the meaning of the plate?'), /didn't understand/);
  assert.throws(() => ask(C, 'how many people live in district 999'), /no district 999/);
  for (const q of ASK_EXAMPLES) assert.ok(ask(C, q).answer.length > 10, q);
});

test('a suggested metro station gains what it claims, at the minimum spacing', () => {
  const C = city(CITY), I = C.infra, st = I.transit.stations;
  const s = suggest(C, 'metro-station');
  assert.ok(s.candidates.length > 0);
  const weight = new Map(); for (const l of I.laterals) weight.set(l.node, (weight.get(l.node) ?? 0) + l.residents + l.jobs);
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const isCovered = (P, extra) => [...st.map((x) => x.pos), ...extra].some((q) => d(q, P) <= 1200);
  const picked = [];
  let prev = Infinity;
  for (const c of s.candidates) {
    for (const x of st) assert.ok(d(x.pos, c.pos) >= 700 - 1e-6, 'at the minimum spacing from every station');
    let gain = 0; for (const [n, w] of weight) { const P = I.graph.nodes[n].pos; if (!isCovered(P, picked) && d(P, c.pos) <= 1200) gain += w; }
    close(c.gain, gain, 1, 'the claimed gain is the newly covered residents and jobs');
    assert.ok(c.gain <= prev + 1e-6, 'picks in decreasing gain'); prev = c.gain;
    picked.push(c.pos);
  }
  // the first pick is the best street node at the spacing, up to the 1-in-k thinning of sites (checked on all of them)
  const G = I.graph, uncovered = [...weight].filter(([n]) => !isCovered(G.nodes[n].pos, [])).map(([n, w]) => [G.nodes[n].pos, w]);
  let bestAll = 0;
  for (const nd of G.nodes) {
    if (st.some((x) => d(x.pos, nd.pos) < 700)) continue;
    let g = 0; for (const [P, w] of uncovered) if (d(P, nd.pos) <= 1200) g += w;
    bestAll = Math.max(bestAll, g);
  }
  assert.ok(s.candidates[0].gain >= 0.98 * bestAll, `first pick ${s.candidates[0].gain} vs the best of every node ${bestAll}`);
  // a later pick's tunnel runs to the nearest station or earlier pick (on this city the third pick's does: 2.2 km, not 2.5)
  let shorter = 0;
  for (let i = 0; i < s.candidates.length; i++) {
    const c = s.candidates[i], { d: dd } = dijkstraLocal(G, [...st.map((x) => x.node), ...s.candidates.slice(0, i).map((x) => x.node)]);
    close(c.tunnelM, dd[c.node], 0.5, `pick ${i + 1}: tunnel to the nearest station or earlier pick`);
    if (dd[c.node] < dijkstraLocal(G, st.map((x) => x.node)).d[c.node] - 1) shorter++;
  }
  assert.ok(shorter > 0, 'the case where an earlier pick is nearer occurs here');
  // a town without a metro: every site gains
  const T = city(TOWN), t = suggest(T);
  assert.equal(T.infra.transit.stations.length, 0);
  close(t.uncovered, t.total, 1, 'nothing is covered without a metro');
  assert.throws(() => suggest(C, 'castle'), /Nothing to suggest/);
});

test('search: every candidate meets its constraints when regenerated from its profile; misses are honest', () => {
  const constraints = [{ metric: 'radialBoulevards', op: '=', value: 12 }, { metric: 'centralPlaza', op: '=', value: true }, { metric: 'liftStations', op: '<', value: 30 }, { metric: 'buildings', op: '>=', value: 400 }];
  const s = search({ base: { plate: 'circle', preset: 'town' }, constraints, budget: 10, seed: 3 });
  assert.ok(s.evaluated <= 10, 'never builds more cities than the budget');
  assert.ok(s.candidates.length > 0, s.text);
  for (const c of s.candidates) {
    // independent re-evaluation: physics from the modes, plan and networks from a fresh generation
    const p = c.profile, modes = enumerateModes({ plate: p.plate, driveOffset: p.driveOffset }), r = drivenResponse(modes, p.frequency, p.Q);
    assert.equal(2 * r.active[0].m, 12, `${p.frequency} Hz: 12 radial boulevards`);
    const L = generateCity(p), I = buildInfrastructure(L);
    const r0 = Math.max(2 * 26, 0.03 * L.meta.world.extent);
    assert.ok(!L.buildings.some((b) => Math.hypot(b.pos[0], b.pos[2]) < r0), `${p.frequency} Hz: central plaza`);
    assert.ok(I.stats.liftStations < 30 && L.buildings.length >= 400, `${p.frequency} Hz: ${I.stats.liftStations} lift stations, ${L.buildings.length} buildings`);
    assert.equal(c.metrics.liftStations, I.stats.liftStations);
  }
  // distinct patterns come first
  const pats = s.candidates.map((c) => c.dominant); assert.equal(new Set(pats.slice(0, s.patterns)).size, Math.min(s.patterns, pats.length));
  for (const m of s.nearMisses) assert.ok(m.violation > 0 && !m.feasible);
  // impossible constraints: no candidates, misses ranked by how close they came
  const none = search({ base: { plate: 'circle', preset: 'town' }, constraints: [{ metric: 'radialBoulevards', op: '=', value: 12 }, { metric: 'buildings', op: '>', value: 1e7 }], budget: 4, seed: 1 });
  assert.equal(none.candidates.length, 0);
  assert.ok(none.nearMisses.length >= 2, 'several misses to rank');
  for (let i = 1; i < none.nearMisses.length; i++) assert.ok(none.nearMisses[i].violation >= none.nearMisses[i - 1].violation);
});

test('search: stays inside the frequency range it was given, counts every city it builds against the budget, and refuses malformed constraints', () => {
  // a loose constraint every pattern passes: the first pass alone would take the whole pool without the budget
  let built = 0;
  const s = search({ base: { plate: 'circle', preset: 'town' }, vary: { frequency: [400, 410], Q: [80, 120] }, constraints: [{ metric: 'buildings', op: '>', value: 0 }], budget: 6, seed: 6 }, () => built++);
  assert.equal(built, 6, 'exactly the budget of cities'); assert.equal(s.evaluated, 6);
  for (const c of [...s.candidates, ...s.nearMisses]) { assert.ok(c.profile.frequency >= 400 && c.profile.frequency <= 410, `${c.profile.frequency} Hz is inside 400–410`); assert.ok(c.profile.Q >= 80 && c.profile.Q <= 120); }
  let wide = 0;
  search({ base: { plate: 'circle', preset: 'town' }, constraints: [{ metric: 'buildings', op: '>', value: 0 }], budget: 3, seed: 2 }, () => wide++);
  assert.equal(wide, 3, 'a pool of many patterns is still held to the budget');
  // a base that cannot build: every attempt spends budget, and the error is reported
  let tries = 0;
  assert.throws(() => search({ base: { preset: 'nowhere' }, constraints: [{ metric: 'buildings', op: '>', value: 0 }], budget: 3 }, () => tries++), /failed to build: Unknown preset/);
  assert.equal(tries, 3);
  assert.throws(() => search({ constraints: [{ metric: 'buildings', op: 'between', value: 10 }] }), /between/);
  assert.throws(() => search({ base: { plate: 'square' }, constraints: [{ metric: 'nodalDiameters', op: '=', value: 2 }] }), /circular membrane only/);
  assert.throws(() => search({ constraints: [{ metric: 'centralPlaza', op: '>', value: true }] }), /takes = or !=/);
  assert.throws(() => search({ constraints: [{ metric: 'buildings', op: '>', value: 'many' }] }), /needs a number/);
  const yes = search({ base: { plate: 'circle', preset: 'town' }, constraints: [{ metric: 'radialBoulevards', op: '=', value: 8 }, { metric: 'centralPlaza', op: '=', value: 'yes' }], budget: 4, seed: 1 });
  for (const c of yes.candidates) assert.equal(c.metrics.centralPlaza, true);
});

test('search is deterministic for a seed, answers physics-only questions without building a city, and follows an objective', () => {
  const spec = { base: { plate: 'circle', preset: 'town' }, constraints: [{ metric: 'nodalCircles', op: '>=', value: 4 }, { metric: 'population', op: '>', value: 3000 }], objective: { metric: 'population', dir: 'max' }, budget: 6, seed: 9 };
  const a = search(spec), b = search(spec);
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'same seed, same answer');
  const c = search({ ...spec, seed: 10 });
  assert.notEqual(JSON.stringify(c.candidates.map((x) => x.profile)), JSON.stringify(a.candidates.map((x) => x.profile)), 'another seed explores differently');
  const pops = a.candidates.filter((x, i, arr) => arr.findIndex((y) => y.dominant === x.dominant) === i).map((x) => x.metrics.population);
  for (let i = 1; i < pops.length; i++) assert.ok(pops[i] <= pops[i - 1], 'best first under the objective');
  // physics only: thousands of frequencies, no cities
  const p = search({ base: { plate: 'circle' }, vary: { frequency: [100, 700] }, constraints: [{ metric: 'nodalDiameters', op: '=', value: 5 }, { metric: 'sharpness', op: '>', value: 0.9 }], scan: 2000, top: 50 });
  assert.equal(p.evaluated, 0);
  assert.ok(p.candidates.length > 0);
  for (const x of p.candidates) {
    const r = drivenResponse(enumerateModes({ plate: 'circle' }), x.profile.frequency, x.profile.Q);
    assert.equal(r.active[0].m, 5); assert.ok(r.sharpness > 0.9 - 1e-6); assert.ok(x.profile.frequency >= 100 && x.profile.frequency <= 700);
  }
  assert.throws(() => search({ constraints: [{ metric: 'happiness', op: '>', value: 1 }] }), /Unknown metric/);
  assert.throws(() => search({ constraints: [{ metric: 'buildings', op: '≈', value: 1 }] }), /Unknown constraint operator/);
  assert.ok(Object.values(METRICS).every((m) => ['physics', 'plan', 'infra', 'people'].includes(m.stage)));
});

test('agent tools: valid schemas, and a generate → query → ask → suggest → search session runs end to end', () => {
  const tools = agentTools();
  assert.deepEqual(tools.map((t) => t.name), ['generate_city', 'query_city', 'ask_city', 'suggest_metro_station', 'search_plans']);
  // a draft-07-shaped check of every schema: types are known, required names exist, enums are non-empty
  const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
  const walk = (sch, at) => {
    assert.ok(sch && typeof sch === 'object', at);
    for (const t of [].concat(sch.type ?? [])) assert.ok(TYPES.has(t), `${at}: type ${t}`);
    if (sch.enum) assert.ok(Array.isArray(sch.enum) && sch.enum.length > 0, `${at}: enum`);
    if (sch.required) for (const r of sch.required) assert.ok(sch.properties && r in sch.properties, `${at}: required ${r} is a property`);
    for (const [k, v] of Object.entries(sch.properties ?? {})) walk(v, `${at}.${k}`);
    if (sch.items) walk(sch.items, `${at}[]`);
    for (const v of sch.anyOf ?? []) walk(v, `${at}|`);
  };
  for (const t of tools) { assert.equal(t.input_schema.type, 'object'); assert.ok(t.description.length > 20); walk(t.input_schema, t.name); }
  const props = (n) => tools.find((t) => t.name === n).input_schema.properties;
  assert.deepEqual(props('query_city').from.enum, COLLECTIONS);
  assert.deepEqual(props('search_plans').constraints.items.properties.metric.enum, Object.keys(METRICS));
  const by = Object.fromEntries(tools.map((t) => [t.name, t])), state = {};
  assert.throws(() => by.query_city.run({ from: 'buildings' }, state), /Generate a city first/);
  const g = by.generate_city.run({ profile: TOWN }, state);
  assert.equal(g.meta.frequency, 300); JSON.stringify(g);
  const q = by.query_city.run({ from: 'buildings', groupBy: 'zone' }, state); JSON.stringify(q);
  assert.equal(q.rows.reduce((s, r) => s + r.count, 0), state.city.layout.buildings.length);
  const a = by.ask_city.run({ question: 'How many lift stations are there?' }, state); JSON.stringify(a);
  const s = by.suggest_metro_station.run({ top: 2 }, state); JSON.stringify(s);
  assert.ok(s.candidates.length <= 2);
  const r = by.search_plans.run({ base: { plate: 'circle', preset: 'town' }, constraints: [{ metric: 'radialBoulevards', op: '=', value: 8 }], top: 3 }, state); JSON.stringify(r);
  assert.ok(r.candidates.length > 0 && r.candidates.every((c) => c.metrics.radialBoulevards === 8));
});
