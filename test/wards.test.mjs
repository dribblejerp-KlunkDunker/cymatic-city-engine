// Wards (Phase 7a, docs/PHASE7-SPEC.md): per-district multipliers on gravity, material strength, water pressure and
// requested height. Each test is one row of the spec's 7a proof table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, toJSON, heightLimit, slendernessLimit } from '../src/cymatic-engine.js';
import { buildInfrastructure, sewerMinSlope } from '../src/infrastructure.js';
import { impact, flows, cityAt } from '../src/simulation.js';

const CITY = { frequency: 432 }, MEGA = { frequency: 432, preset: 'megastructure' };
const cache = new Map();
const city = (o) => { const k = JSON.stringify(o); if (!cache.has(k)) { const c = generateCity(o); c.infra = buildInfrastructure(c); cache.set(k, c); } return cache.get(k); };
const plain = (x) => JSON.parse(JSON.stringify(x, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v)));
// a layout with what a ward adds taken out: building.ward, node.ward, layout.wards, stats.wards, meta.magic, the
// ward-dependence check and the "each by its ward" note on the check bases
const unwarded = (c) => {
  const j = plain({ ...c, field: undefined, timingMs: undefined, infraMs: undefined });
  delete j.wards; delete j.stats.wards; delete j.meta.magic;
  for (const b of j.buildings) delete b.ward;
  j.checks = j.checks.filter((x) => x.id !== 'ward-dependence').map((x) => ({ ...x, basis: x.basis.replace("; each building by its ward's limit", '') }));
  if (j.infra) for (const n of j.infra.graph.nodes) delete n.ward;
  return j;
};
const largestDistrict = (c) => { const n = new Map(); for (const b of c.buildings) n.set(b.district, (n.get(b.district) ?? 0) + 1); return [...n].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]; };
const slim = (b) => (b.shape === 'dome' || b.shape === 'terrace' ? 0 : b.h / Math.min(b.w, b.d));

test('neutral is nothing: wards of 1 × 1 × 1 give the bytes of the profile without them', () => {
  const base = generateCity(CITY); base.infra = buildInfrastructure(base);
  for (const magic of [{}, { wards: [] }, { wards: [{ where: 'all' }] }, { wards: [{ where: { district: 1 }, gravity: 1, strength: 1, pressure: 1, height: 1 }, { where: { polarity: -1 } }] }, { ley: false, underworld: null }]) {
    const c = generateCity({ ...CITY, magic }); c.infra = buildInfrastructure(c);
    assert.equal(c.wards, undefined); assert.equal(c.meta.magic, undefined);
    assert.ok(toJSON(c) === toJSON(base), `magic ${JSON.stringify(magic)} changed the city or its networks`);
  }
});

test('a ward over everything is that world: "all", gravity 0.5 equals world gravity 0.5 field for field', () => {
  for (const prof of [CITY, MEGA]) {
    const ward = city({ ...prof, magic: { wards: [{ where: 'all', gravity: 0.5 }] } }), world = city({ ...prof, gravity: 0.5 });
    assert.ok(ward.buildings.every((b) => b.ward === 0), 'every building is in the ward');
    assert.ok(ward.infra.graph.nodes.every((n) => n.ward === 0), 'every street node is in the ward');
    const a = unwarded(ward), b = unwarded(world);
    a.meta.gravity = b.meta.gravity; // the world keeps its own gravity; the ward brings half of it
    // the world's limits stay the world's (g = 1); the ward's are the half-gravity world's
    for (const k of ['heightLimit', 'slendernessLimit', 'terraceLimit', 'terraceRise']) { delete a.stats[k]; delete b.stats[k]; }
    assert.equal(ward.stats.heightLimit, heightLimit(ward.meta.materialSpec, 1));
    assert.equal(ward.wards[0].heightLimit, world.stats.heightLimit);
    if (!world.meta.arcology) assert.equal(ward.wards[0].slendernessLimit, world.stats.slendernessLimit);
    else assert.equal(ward.wards[0].terraceLimit, world.stats.terraceLimit);
    for (const part of ['buildings', 'roads', 'trees']) assert.deepEqual(a[part], b[part], `${prof.preset ?? 'city'}: ${part}`);
    const nets = (j) => { const { checks, stats, graph, ...rest } = j.infra; return { ...rest, nodes: graph.nodes, edges: graph.edges, stats: { ...stats, infraMs: 0 } }; };
    assert.deepEqual(nets(a), nets(b), `${prof.preset ?? 'city'}: networks`);
    const statOf = (j) => { const { maxSlenderness, ...s } = j.stats; return s; };
    assert.deepEqual(statOf(a), statOf(b), `${prof.preset ?? 'city'}: stats`);
    // every check the world passes, the ward passes; the material check judges each building by the ward's limit
    const st = (j) => Object.fromEntries(j.checks.map((x) => [x.id, x.status]));
    assert.deepEqual(st(a), st(b));
    assert.deepEqual(Object.fromEntries(ward.infra.checks.map((x) => [x.id, x.status])), Object.fromEntries(world.infra.checks.map((x) => [x.id, x.status])));
    if (!world.meta.arcology) assert.deepEqual(plain(flows(ward, ward.infra, 8)), plain(flows(world, world.infra, 8)), 'flows');
  }
});

test('local where it can be: a ward on one district leaves every building outside it identical', () => {
  const base = city(CITY), d = largestDistrict(base);
  const c = city({ ...CITY, magic: { wards: [{ where: { district: d }, gravity: 0.5, height: 3 }] } });
  assert.equal(c.buildings.length, base.buildings.length);
  let inside = 0, changed = 0;
  c.buildings.forEach((b, i) => {
    const o = base.buildings[i];
    if (b.district === d) { inside++; assert.equal(b.ward, 0); if (b.h !== o.h || b.w !== o.w) changed++; return; }
    assert.equal(b.ward, undefined);
    assert.deepEqual(b, o, `building ${i} outside the ward changed`);
  });
  assert.ok(inside > 1000 && changed > 100, `${inside} inside, ${changed} changed`);
  assert.deepEqual(c.roads, base.roads);
});

test('the measured effects: megastructure tallest 780 m, city 134 lift stations and 70 m tanks', () => {
  assert.equal(city(MEGA).stats.maxHeight, 600);
  assert.equal(city({ ...MEGA, magic: { wards: [{ where: 'all', gravity: 0.5 }] } }).stats.maxHeight, 780);
  const base = city(CITY), c = city({ ...CITY, magic: { wards: [{ where: 'all', gravity: 0.5 }] } });
  assert.equal(base.infra.stats.liftStations, 26); assert.equal(c.infra.stats.liftStations, 134);
  assert.equal(base.infra.stats.towerHeight, 35); assert.equal(c.infra.stats.towerHeight, 70);
  assert.ok(c.infra.water.towers.every((t) => t.height === 70));
});

// the world's own limits, judged without the engine's report: material height and slenderness, and for a terrace
// the face above its lowest neighbour on the lot grid (open ground counts as 0 m on a flat plate)
function breaksWorld(c) {
  const g = c.meta.gravity, hL = heightLimit(c.meta.materialSpec, g);
  const arc = c.meta.arcology;
  const sL = arc ? Infinity : slendernessLimit(c.meta.presetSpec?.slender ?? { town: 4, city: 10, alien: 12 }[c.meta.preset], g);
  let step = () => 0;
  if (arc) {
    const lot = c.buildings[0].w / 0.97, key = (x, z) => `${Math.round(x / lot)},${Math.round(z / lot)}`, at = new Map(c.buildings.map((b) => [key(b.pos[0], b.pos[2]), b]));
    step = (b) => {
      let low = Infinity;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = at.get(key(b.pos[0] + dx * lot, b.pos[2] + dz * lot)); low = Math.min(low, n ? n.h : 0); }
      return b.h - low;
    };
  }
  return (b) => b.h > hL + 1e-6 || slim(b) > sL + 1e-6 || (arc && step(b) > c.stats.terraceLimit + 1e-6);
}

test('dependence is real: exactly the warded buildings that break the world\'s limits, and impact agrees', () => {
  const cases = [
    { ...MEGA, magic: { wards: [{ where: 'all', gravity: 0.5 }] } },
    { ...CITY, magic: { wards: [{ where: { polarity: 1 }, gravity: 0.5, height: 3 }] } },
    { ...MEGA, gravity: 4, magic: { wards: [{ where: 'all', strength: 3 }] } }, // the material limit itself
  ];
  for (const prof of cases) {
    const c = city(prof), breaks = breaksWorld(c);
    const dep = new Set(c.wards.flatMap((w) => w.dependent.buildings));
    assert.ok(dep.size > 0, `${JSON.stringify(prof.magic)}: something depends on the ward`);
    c.buildings.forEach((b, i) => {
      if (b.ward == null) assert.ok(!breaks(b), `unwarded building ${i} breaks the world's limits`);
      else assert.equal(dep.has(i), breaks(b), `building ${i}: dependent ${dep.has(i)}, breaks the world ${breaks(b)}`);
    });
    c.wards.forEach((w, i) => {
      const r = impact(c, c.infra, { kind: 'ward', index: i });
      assert.deepEqual(r.affected, w.dependent.buildings);
      assert.equal(r.people, w.dependent.residents);
    });
    const chk = c.checks.find((x) => x.id === 'ward-dependence');
    assert.equal(chk.status, 'info'); assert.match(chk.value, new RegExp(`^${dep.size} of `));
    for (const x of c.checks) if (['self-weight', 'slenderness', 'terrace'].includes(x.id)) assert.equal(x.status, 'pass', `${x.id}: ${x.value}`);
  }
  // a ward that only tightens the limits holds nothing up
  for (const prof of [{ ...CITY, magic: { wards: [{ where: { polarity: -1 }, gravity: 2 }] } }, { ...MEGA, magic: { wards: [{ where: 'all', gravity: 1.5, strength: 0.8 }] } }]) {
    const c = city(prof);
    assert.equal(c.stats.wards.dependent, 0);
    assert.match(impact(c, c.infra, { kind: 'ward', index: 0 }).summary, /nothing falls/);
    for (const x of c.checks) if (['self-weight', 'slenderness', 'terrace'].includes(x.id)) assert.equal(x.status, 'pass', `${x.id}: ${x.value}`);
  }
  assert.throws(() => impact(city(CITY), city(CITY).infra, { kind: 'ward', index: 0 }), /no wards/);
});

test('height asks, the limits answer (call W)', () => {
  const base = city(CITY), d = largestDistrict(base);
  const tall = city({ ...CITY, magic: { wards: [{ where: { district: d }, height: 4 }] } });
  const light = city({ ...CITY, magic: { wards: [{ where: { district: d }, height: 4, gravity: 0.5 }] } });
  const breaks = breaksWorld(base);
  const sum = (c) => c.buildings.filter((b) => b.district === d).reduce((s, b) => s + b.h, 0);
  assert.ok(sum(tall) > 2 * sum(base), 'the ward asks for more height and gets it');
  assert.ok(tall.buildings.every((b) => !breaks(b)), 'every building still passes the world\'s limits');
  assert.equal(tall.stats.wards.dependent, 0);
  assert.equal(tall.wards[0].height, 4);
  // under half gravity some build taller than the world allows, and exactly those depend on the ward
  const dep = new Set(light.wards[0].dependent.buildings);
  assert.ok(dep.size > 100, `${dep.size} dependent`);
  light.buildings.forEach((b, i) => assert.equal(dep.has(i), b.ward === 0 && breaks(b)));
  assert.ok(light.stats.maxHeight > tall.stats.maxHeight);
  // outside the ward nothing changes
  for (const c of [tall, light]) c.buildings.forEach((b, i) => { if (b.district !== d) assert.deepEqual(b, base.buildings[i]); });
  assert.deepEqual(plain(light.meta.magic), { wards: [{ where: { district: d }, districts: [d], gravity: 0.5, strength: 1, pressure: 1, height: 4 }] });
  // terraces ask too: a megastructure ward of height 2 raises its terraces as far as the world's step allows
  const megaBase = generateCity(MEGA), megaTall = generateCity({ ...MEGA, magic: { wards: [{ where: { polarity: 1 }, height: 2 }] } });
  const hOf = (c, f) => c.buildings.filter(f).reduce((s, b) => s + b.h, 0);
  assert.ok(hOf(megaTall, (b) => b.ward === 0) > 1.2 * hOf(megaBase, (b) => b.polarity === 1), 'warded terraces rise');
  assert.equal(megaTall.stats.wards.dependent, 0);
  for (const x of megaTall.checks) if (x.id === 'self-weight' || x.id === 'terrace') assert.equal(x.status, 'pass', `${x.id}: ${x.value}`);
});

test('refusals: each names what is wrong', () => {
  const c = city(CITY), d = c.buildings.find((b) => b.polarity === 1 && b.district >= 0).district;
  const refuse = (magic, re, extra = {}) => assert.throws(() => generateCity({ ...CITY, ...extra, magic }), re);
  refuse({ wards: [{ where: { polarity: 1 }, gravity: 0.5 }, { where: { district: d }, strength: 2 }] }, new RegExp(`District ${d} is in two wards`));
  refuse({ wards: [{ where: 'all', gravity: 0.04 }] }, /gives 0\.04 g, outside the engine's 0\.05 to 5 g/);
  refuse({ wards: [{ where: 'all', gravity: 12 }] }, /gives 6 g/, { gravity: 0.5 });
  refuse({ wards: [{ where: { at: [9000, 0] }, gravity: 0.5 }] }, /\[9000, 0\] is outside the plate/);
  refuse({ wards: [{ where: { street: 3 }, gravity: 0.5 }] }, /unknown "where" \{"street":3\}/);
  refuse({ wards: [{ where: 'everywhere', gravity: 0.5 }] }, /unknown "where" "everywhere"/);
  refuse({ wards: [{ gravity: 0.5 }] }, /unknown "where" undefined/);
  refuse({ wards: [{ where: { district: 999 }, gravity: 0.5 }] }, /no district 999/);
  refuse({ wards: [{ where: 'all', gravity: 0.5 }, { where: { district: 0 }, strength: 2 }] }, /covers everything/);
  refuse({ wards: [{ where: 'all', gravity: -1 }] }, /gravity must be a multiplier above 0/);
  refuse({ wards: [{ where: 'all', gravty: 0.5 }] }, /unknown key "gravty"/);
  refuse({ ley: true }, /magic\.ley is not built/);
  refuse({ wardz: [] }, /Unknown magic key "wardz"/);
  refuse([1], /magic must be an object/);
});

test('networks read the ward at the node: majority by floor area, gravity and head per node', () => {
  const c = city({ ...CITY, magic: { wards: [{ where: { polarity: 1 }, gravity: 0.5 }] } }), base = city(CITY);
  const nodes = c.infra.graph.nodes, area = new Map();
  for (const l of c.infra.laterals) {
    const b = c.buildings[l.building], m = area.get(l.node) ?? area.set(l.node, new Map()).get(l.node), k = b.ward ?? -1;
    m.set(k, (m.get(k) ?? 0) + b.w * b.d * b.floors);
  }
  nodes.forEach((n, i) => {
    const m = area.get(i);
    if (!m) return assert.equal(n.ward, undefined, `node ${i} serves nothing`);
    const w = m.get(0) ?? 0, u = m.get(-1) ?? 0;
    assert.equal(n.ward, w > u ? 0 : undefined, `node ${i}: ${w} m² warded, ${u} m² not`);
  });
  // a pipe answers to gravity where it starts: slopes ÷ 0.5 under the ward, the world's elsewhere
  let steep = 0;
  for (const p of c.infra.sewer.pipes) {
    if (p.forceMain) continue;
    const g = nodes[p.up].ward === 0 ? 0.5 : 1;
    assert.ok(p.slope >= sewerMinSlope(p.diameter, g) - 1e-12, `pipe from node ${p.up}: slope ${p.slope}`);
    if (g === 0.5) steep++;
  }
  assert.ok(steep > 1000, `${steep} pipes start in the ward`);
  assert.ok(c.infra.stats.liftStations > base.infra.stats.liftStations);
  for (const x of c.infra.checks) assert.notEqual(x.status, 'fail', `${x.id}: ${x.value}`);
  assert.match(c.infra.checks.find((x) => x.id === 'sewer-slope').basis, /0\.5 to 1 g by ward/);
  // flows: pressure from head under each node's own gravity
  const f = flows(c, c.infra, 8);
  assert.ok(f.water.minPressure > 0);
  // a ward too light for any tank is pumped, as the world would be: the pressure check holds, the tank check warns
  const pumped = city({ ...CITY, magic: { wards: [{ where: { polarity: 1 }, gravity: 0.2 }] } });
  const st = Object.fromEntries(pumped.infra.checks.map((x) => [x.id, x.status]));
  assert.equal(st['pressure-zones'], 'pass'); assert.equal(st['water-pressure'], 'warn');
  assert.ok(pumped.infra.water.towers.some((t) => t.pumped));
  // pressure is a head rule: pressure 2 needs twice the head, lighter heads at 0.5 (tanks by the tank's ward)
  for (const k of [2, 0.5]) {
    const p = city({ ...CITY, magic: { wards: [{ where: 'all', pressure: k }] } });
    assert.ok(p.infra.water.towers.every((t) => Math.abs(t.height - Math.min(35 * k, 80)) < 1e-9), `pressure ${k}: tanks ${p.infra.water.towers[0].height}`);
    assert.deepEqual(p.buildings.map((b) => b.h), base.buildings.map((b) => b.h), 'pressure leaves the buildings alone');
  }
});

test('growth answers to the ward: a year of "all", gravity 0.5 is that year of the half-gravity world', () => {
  const ward = generateCity({ ...CITY, magic: { wards: [{ where: 'all', gravity: 0.5 }] } }), world = generateCity({ ...CITY, gravity: 0.5 });
  const a = cityAt(ward, { year: 60 }), b = cityAt(world, { year: 60 });
  const strip = (x) => x.layout.buildings.map(({ ward: _w, ...r }) => r);
  assert.deepEqual(strip(a), strip(b));
  assert.equal(a.layout.meta.magic.wards[0].gravity, 0.5);
  assert.ok(a.layout.wards[0].buildings === a.layout.buildings.length);
  // a partial ward grows its own district taller than the world lets it
  const d = largestDistrict(city(CITY));
  const tall = cityAt(generateCity({ ...CITY, magic: { wards: [{ where: { district: d }, height: 4, gravity: 0.5 }] } }), { year: 100 });
  const breaks = breaksWorld(city(CITY));
  const dep = new Set(tall.layout.wards[0].dependent.buildings);
  tall.layout.buildings.forEach((x, i) => assert.equal(dep.has(i), x.ward === 0 && breaks(x), `year-100 building ${i}`));
  assert.ok(dep.size > 0);
});
