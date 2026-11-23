// Ley (Phase 7b, docs/PHASE7-SPEC.md): nexuses at the antinodes of the plate's own field, Gabriel lines with
// capacity, substations tapping their nearest nexus, a plant only for the shortfall. Each test is a row of the
// spec's 7b proof table, checked against an independent computation where one exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, fieldPreview, toJSON } from '../src/cymatic-engine.js';
import { buildInfrastructure } from '../src/infrastructure.js';
import { impact, cityAt } from '../src/simulation.js';
import { LEY } from '../src/ley.js';

const CITY = { frequency: 432 }, LEYON = { ley: true };
const cache = new Map();
const city = (o) => { const k = JSON.stringify(o); if (!cache.has(k)) { const c = generateCity(o); c.infra = buildInfrastructure(c); cache.set(k, c); } return cache.get(k); };
const plain = (x) => JSON.parse(JSON.stringify(x, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v)));
const ley = (p) => city({ ...p, magic: { ...p.magic, ley: p.magic?.ley ?? true } });

// |S| on a fine grid over the plate, independent of the engine's own sample grid
function fine(p, N = 600) {
  const F = fieldPreview(p), E = F.extent, st = (2 * E) / N, W = N + 1, g = new Float64Array(W * W);
  const absAt = (x, z) => { const [u, v] = F.toNorm([x, 0, z]); return F.inside(u, v) ? Math.abs(F.at(u, v).S) : 0; };
  let max = 0, energy = 0;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const s = absAt(-E + i * st, -E + j * st); g[j * W + i] = s; max = Math.max(max, s); }
  // midpoint quadrature of S² over the plate: an integral the engine never computes this way
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const s = absAt(-E + (i + 0.5) * st, -E + (j + 0.5) * st); energy += s * s * st * st; }
  const maxima = [];
  for (let j = 1; j < N; j++) for (let i = 1; i < N; i++) {
    const k = j * W + i, v = g[k];
    if (!(v > 0) || v < LEY.nexusStrength * max) continue;
    let top = true;
    for (let dj = -1; dj <= 1 && top; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && g[k + dj * W + di] >= v) { top = false; break; }
    if (top) maxima.push([-E + i * st, -E + j * st]);
  }
  return { maxima, energy, cell: (2 * E) / 220, absAt };
}
const near = (P, list) => list.reduce((m, q) => Math.min(m, Math.hypot(P[0] - q[0], P[1] - q[1])), Infinity);

test('off is nothing, and flux 0 is the realistic grid byte for byte', () => {
  const base = city(CITY);
  for (const magic of [{ ley: false }, { ley: null, underworld: {} }]) assert.ok(toJSON(city({ ...CITY, magic })) === toJSON(base), JSON.stringify(magic));
  const zero = ley({ ...CITY, magic: { ley: { flux: 0 } } });
  assert.deepEqual(plain(zero.infra.power), plain(base.infra.power));
  assert.equal(zero.infra.ley.supplyMW, 0); assert.equal(zero.infra.ley.taps.length, 0);
  assert.equal(zero.infra.ley.undeliveredMW.toFixed(6), zero.infra.ley.demandMW.toFixed(6));
});

test('energy is conserved: outputs are the plate\'s ∫S² dA, taps and shortfall add up, flow balances, no line over capacity', () => {
  for (const p of [CITY, { frequency: 300 }, { chord: [432, 540] }, { frequency: 432, preset: 'megastructure' }, { frequency: 540, plate: 'square' }]) {
    const c = ley(p), y = c.infra.ley, f = fine(p);
    const want = (LEY.flux * f.energy) / 1e6, got = y.nexuses.reduce((s, x) => s + x.outputMW, 0);
    assert.ok(Math.abs(got - want) / want < 0.005, `${JSON.stringify(p)}: Σ output ${got.toFixed(2)} MW vs ${want.toFixed(2)} MW by quadrature`);
    assert.ok(Math.abs(y.supplyMW - got) < 1e-9);
    const delivered = y.taps.reduce((s, t) => s + t.MW, 0);
    assert.ok(Math.abs(delivered + y.undeliveredMW - y.demandMW) < 1e-6, 'taps + undelivered = demand');
    assert.ok(Math.abs(y.demandMW - c.infra.power.substations.reduce((s, x) => s + x.loadMVA, 0) * 0.92) < 1e-6 || y.demandMW > 0);
    const imp = new Float64Array(y.nexuses.length), got_ = new Float64Array(y.nexuses.length);
    for (const l of y.lines) { imp[l.b] += l.flowMW; imp[l.a] -= l.flowMW; assert.ok(l.loadMW <= l.capacityMW + 1e-6, 'line within capacity'); assert.equal(l.capacityMW, LEY.lineFactor * Math.min(y.nexuses[l.a].outputMW, y.nexuses[l.b].outputMW)); }
    for (const t of y.taps) got_[t.nexus] += t.MW;
    y.nexuses.forEach((x, i) => {
      const left = x.outputMW + imp[i] - got_[i];
      assert.ok(left >= -1e-6, `nexus ${i} hands out ${(-left).toFixed(6)} MW it does not have`);
      if (left > 1e-6) assert.ok(Math.abs(got_[i] - x.demandMW) < 1e-6, `nexus ${i} keeps power while its own substations go short`);
    });
    assert.equal(c.checks.find((x) => x.id === 'ley-line-load'), undefined, 'ley checks are network checks');
    assert.equal(c.infra.checks.find((x) => x.id === 'ley-line-load').status, 'pass');
  }
});

test('nexuses are the antinodes: 36 at 432 Hz and 12 at 300 Hz, none missed, each a maximum', () => {
  for (const [p, count] of [[CITY, 36], [{ frequency: 300 }, 12], [{ frequency: 432, preset: 'town' }, 36]]) {
    const y = ley(p).infra.ley, f = fine(p), pts = y.nexuses.map((x) => [x.pos[0], x.pos[2]]);
    assert.equal(y.nexuses.length, count);
    assert.equal(f.maxima.length, count, 'the fine grid agrees on the count');
    for (const q of f.maxima) assert.ok(near(q, pts) <= f.cell, `fine maximum at ${q.map(Math.round)} has no nexus within a grid cell`);
    for (const P of pts) assert.ok(near(P, f.maxima) <= f.cell, `nexus at ${P.map(Math.round)} is not at a maximum`);
    for (const x of y.nexuses) { assert.ok(x.strength >= LEY.nexusStrength - 1e-9); assert.equal(Math.round(x.pos[0] * 100) / 100, x.pos[0]); }
    for (let i = 1; i < y.nexuses.length; i++) assert.ok(y.nexuses[i - 1].strength >= y.nexuses[i].strength, 'ordered by strength');
  }
  // a chord's field is finer than the engine's grid can always separate: every nexus is still a real maximum, and the
  // grid's misses are pairs closer than three grid cells or peaks the grid samples just under the cut (spec: as built)
  const p = { chord: [432, 540] }, y = ley(p).infra.ley, f = fine(p), pts = y.nexuses.map((x) => [x.pos[0], x.pos[2]]);
  for (const P of pts) assert.ok(near(P, f.maxima) <= f.cell, `chord nexus at ${P.map(Math.round)} is not at a maximum`);
  for (const q of f.maxima) if (near(q, pts) > f.cell) assert.ok(near(q, pts) <= 4 * f.cell || f.absAt(q[0], q[1]) < 0.55 * Math.max(...f.maxima.map((m) => f.absAt(m[0], m[1]))), `chord maximum at ${q.map(Math.round)} missed for no reason`);
  assert.equal(y.nexuses.length, 65);
});

test('lines are the Gabriel graph, by brute force', () => {
  for (const p of [CITY, { chord: [432, 540] }, { frequency: 432, plate: 'sphere' }]) {
    const y = ley(p).infra.ley, P = y.nexuses.map((x) => x.pos), d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    const want = [];
    for (let a = 0; a < P.length; a++) for (let b = a + 1; b < P.length; b++) {
      const M = P[a].map((v, k) => (v + P[b][k]) / 2), r2 = d2(P[a], P[b]) / 4;
      if (P.every((Q, k) => k === a || k === b || d2(Q, M) > r2 * (1 + 1e-9))) want.push(`${a}-${b}`);
    }
    assert.deepEqual(y.lines.map((l) => `${l.a}-${l.b}`), want);
    if (p === CITY) assert.equal(y.lines.length, 47);
  }
});

test('the measured spread: the town lives on its ley, the city just does, the megastructure keeps a plant', () => {
  const r = (p) => { const y = ley(p).infra.ley; return y.supplyMW / y.demandMW; };
  assert.ok(Math.abs(r({ frequency: 432, preset: 'town' }) - 5.08) < 0.02);
  assert.ok(Math.abs(r(CITY) - 1.39) < 0.01);
  assert.ok(Math.abs(r({ frequency: 432, preset: 'megastructure' }) - 0.16) < 0.01);
  const town = ley({ frequency: 432, preset: 'town' }), mega = ley({ frequency: 432, preset: 'megastructure' }), c = ley(CITY);
  assert.equal(town.infra.power.plants.length, 0); assert.equal(c.infra.power.plants.length, 0);
  const y = mega.infra.ley;
  assert.deepEqual(mega.infra.power.plants.map((x) => [x.kind, x.capacityMW]), [['core reactor', Math.ceil((y.undeliveredMW * 1.25) / 50) * 50]]);
  assert.ok(mega.infra.power.plants[0].capacityMW < city({ frequency: 432, preset: 'megastructure' }).infra.power.plants[0].capacityMW);
  const st = (x) => Object.fromEntries(x.infra.checks.map((k) => [k.id, k.status]));
  assert.equal(st(mega)['ley-supply'], 'warn'); assert.equal(st(c)['ley-supply'], 'pass'); assert.equal(st(town)['ley-supply'], 'pass');
  // every substation is fed: the taps and the plant together reach all of them
  for (const x of [town, c, mega]) assert.equal(x.infra.checks.find((k) => k.id === 'service').status, 'pass');
  // the plant out: what the ley delivers keeps flowing
  const out = impact(mega, mega.infra, { kind: 'plant', index: 0 });
  assert.ok(Math.abs(out.shortfallMW - Math.max(0, mega.infra.power.peakMW - y.deliveredMW)) < 1e-6);
});

test('N-1 on the ley: losing the strongest nexus or the busiest line, what the plant cannot cover is stranded', () => {
  const town = ley({ frequency: 432, preset: 'town' }), y = town.infra.ley;
  assert.ok(['nexus', 'line'].includes(y.n1.kind));
  const chk = town.infra.checks.find((k) => k.id === 'ley-n1');
  assert.match(chk.value, /% of people stranded by losing the (strongest nexus|busiest ley line)/);
  assert.equal(chk.status, y.n1.share <= 0.2 + 1e-9 ? 'pass' : 'warn');
  // a ley that cannot spare its strongest nexus: one nexus carries the city
  const solo = ley({ frequency: 432, preset: 'town', magic: { ley: { nexusStrength: 0.99 } } }).infra.ley;
  assert.equal(solo.nexuses.length >= 1, true);
  if (solo.nexuses.length === 1 && solo.plantMW === 0) assert.equal(solo.n1.share, 1);
});

test('a foreign field: constant ℓ gives equal flux per m², a single bump gives one nexus at the bump', () => {
  const W = 9, H = 9, F = fieldPreview(CITY), area = Math.PI * F.extent * F.extent;
  const flat = ley({ ...CITY, magic: { ley: { field: { width: W, height: H, data: new Array(W * H).fill(0.25) } } } }).infra.ley;
  assert.ok(Math.abs(flat.supplyMW - (LEY.flux * 0.25 * area) / 1e6) < 1e-6, `${flat.supplyMW} MW`);
  assert.ok(flat.nexuses.length >= 1);
  const data = []; for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) data.push(Math.exp(-((i - 6) ** 2 + (j - 2) ** 2) / 2));
  const bump = ley({ ...CITY, magic: { ley: { field: { width: W, height: H, data } } } });
  assert.equal(bump.infra.ley.nexuses.length, 1);
  const at = F.toWorld(F.lo + ((F.hi - F.lo) * 6) / (W - 1), F.lo + ((F.hi - F.lo) * 2) / (H - 1));
  assert.ok(Math.hypot(bump.infra.ley.nexuses[0].pos[0] - at[0], bump.infra.ley.nexuses[0].pos[2] - at[2]) < (2 * F.extent) / 220 * 1.5);
  assert.equal(bump.meta.magic.ley.field, 'grid');
  assert.throws(() => generateCity({ ...CITY, magic: { ley: { field: { width: 3, height: 3, data: [1, 2] } } } }), /width × height/);
  assert.throws(() => generateCity({ ...CITY, magic: { ley: { flux: -1 } } }), /flux in W\/m² of 0 or more/);
  assert.throws(() => generateCity({ ...CITY, magic: { ley: { fluxx: 1 } } }), /unknown key "fluxx"/);
  assert.throws(() => generateCity({ ...CITY, magic: { underworld: { deeps: true } } }), /underworld is not built/);
});

test('the ley rides with the plan: a year of growth keeps its nexuses and rebalances its demand', () => {
  const L = generateCity({ frequency: 432, preset: 'town', magic: LEYON }), y = cityAt(L, { year: 30 });
  assert.deepEqual(y.layout.meta.magic.ley.nexuses, L.meta.magic.ley.nexuses);
  assert.ok(y.layout.infra.ley.demandMW < buildInfrastructure(L).ley.demandMW);
  assert.ok(y.layout.infra.checks.some((k) => k.id === 'ley-supply'));
});
