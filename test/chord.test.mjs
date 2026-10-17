// Multi-frequency chords (Phase 4): a chord of one is the plain frequency byte for byte; the composite field is
// the in-phase superposition of the voices with a time-averaged amplitude; each voice's boulevards lie on that
// voice's own nodal set; every invariant of the single-frequency city holds; eras order the growth.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, toJSON, fieldPreview, checksFor, MAX_VOICES } from '../src/cymatic-engine.js';
import { buildInfrastructure } from '../src/infrastructure.js';
import { simulate } from '../src/simulation.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} got ${a}, expected ${b}`);
const cache = new Map();
const city = (o) => { const k = JSON.stringify(o); if (!cache.has(k)) cache.set(k, generateCity(o)); return cache.get(k); };

test('a chord of one is the plain frequency, byte for byte; chords are validated', () => {
  for (const [plate, preset, f] of [['circle', 'city', 432], ['square', 'town', 300], ['sphere', 'alien', 300]]) {
    const a = toJSON(generateCity({ plate, preset, frequency: f }));
    const b = toJSON(generateCity({ plate, preset, chord: [f] }));
    const c = toJSON(generateCity({ plate, preset, chord: [{ hz: f, weight: 1 }], frequency: 999 }));
    assert.equal(a, b, `${plate}/${preset}: chord of one`);
    assert.equal(a, c, 'the chord names the city, not the frequency field');
    assert.equal(JSON.parse(a).meta.chord, null);
  }
  assert.throws(() => generateCity({ chord: [] }), /1 to 3/);
  assert.throws(() => generateCity({ chord: [432, 500, 600, 700] }), /1 to 3/);
  assert.equal(MAX_VOICES, 3);
  assert.throws(() => generateCity({ chord: [432, 5000] }), /outside this plate/);
  assert.throws(() => generateCity({ chord: [432, { hz: 500, weight: 0 }] }), /weight/);
  assert.throws(() => generateCity({ chord: [432, { hz: 500, weight: 2 }] }), /weight/);
  assert.throws(() => generateCity({ chord: [432, 'x'] }), /must be a number/);
});

test('the composite field is Σ w·S_v in sign and √Σ (w·A_v)² in amplitude, each voice normalised to its own peak', () => {
  const o = { plate: 'circle', preset: 'city', chord: [432, { hz: 576, weight: 0.6 }] };
  const F = fieldPreview(o);
  assert.equal(F.voices.length, 2);
  const V0 = fieldPreview({ plate: 'circle', preset: 'city', frequency: 432 }), V1 = fieldPreview({ plate: 'circle', preset: 'city', frequency: 576 });
  // the composite is one constant times the superposition of the single-voice previews, at every point
  let ratio = null, n = 0;
  for (let i = 0; i < 400; i++) {
    const u = -0.9 + 1.8 * ((i * 37) % 97) / 97, v = -0.9 + 1.8 * ((i * 53) % 89) / 89;
    if (!F.inside(u, v)) continue;
    const s0 = V0.at(u, v), s1 = V1.at(u, v), c = F.at(u, v);
    const S = s0.S + 0.6 * s1.S, A = Math.hypot(s0.A, 0.6 * s1.A);
    const expectedS = Math.sign(S) * Math.min(Math.abs(S), A); // the snapshot, clipped to the time-averaged envelope
    if (Math.abs(expectedS) > 0.05) { const r = c.S / expectedS; if (ratio == null) ratio = r; else close(r, ratio, 1e-6 * Math.abs(ratio), 'one scale for the signed field'); }
    if (ratio != null) close(c.A, A * ratio, 1e-6 + 1e-6 * c.A, 'amplitude is the time-averaged motion');
    assert.equal(Math.sign(c.S), Math.sign(S), 'sign of the in-phase superposition');
    assert.ok(c.A >= Math.abs(c.S) - 1e-12, 'amplitude never under the signed field');
    n++;
  }
  assert.ok(n > 200 && ratio > 0);
  // the voices on the preview are the single-voice fields
  for (let i = 0; i < 50; i++) { const u = -0.5 + i / 60, v = 0.2; close(F.voices[0].at(u, v).S, V0.at(u, v).S, 1e-12); close(F.voices[1].at(u, v).S, V1.at(u, v).S, 1e-12); }
});

test("each voice's boulevards lie on that voice's nodal lines, and the rings on its contours", () => {
  for (const [plate, preset, chord] of [['circle', 'city', [432, 576]], ['square', 'town', [300, 375, 450]], ['sphere', 'alien', [300, 450]]]) {
    const o = { plate, preset, chord };
    const L = city(o), F = fieldPreview(o);
    const eras = new Set(L.roads.map((r) => r.era));
    assert.deepEqual([...eras].sort(), chord.map((_, i) => i), `${plate}: every voice laid streets`);
    for (const r of L.roads) {
      if (r.kind !== 'boulevard') continue;
      const mid = [(r.a[0] + r.b[0]) / 2, (r.a[1] + r.b[1]) / 2, (r.a[2] + r.b[2]) / 2];
      const [u, v] = F.toNorm(mid);
      assert.ok(Math.abs(F.voices[r.era].S(u, v)) < 0.06, `${plate}: boulevard of voice ${r.era} off its nodal line (|S| ${Math.abs(F.voices[r.era].S(u, v)).toFixed(3)})`);
    }
    assert.ok(L.roads.some((r) => r.kind === 'wall') === (plate !== 'sphere'), 'one perimeter, from the first voice');
    assert.ok(L.roads.filter((r) => r.kind === 'wall').every((r) => r.era === 0));
  }
});

test('a chord city keeps every invariant: clearance, no overlap, structure, and the measured checks', () => {
  for (const [plate, preset, chord] of [['circle', 'city', [432, 576]], ['square', 'city', [200, 300]], ['circle', 'megastructure', [432, 648]], ['sphere', 'alien', [300, 450]]]) {
    const L = city({ plate, preset, chord });
    const hard = L.checks.filter((c) => ['access', 'setback', 'slenderness', 'self-weight', 'terrace', 'core'].includes(c.id));
    for (const c of hard) assert.notEqual(c.status, 'fail', `${plate}/${preset}: ${c.id} ${c.value}`);
    const setback = preset === 'megastructure' ? 2 : 1.5;
    assert.ok(L.stats.minRoadClearance >= setback - 1e-6 || L.checks.find((c) => c.id === 'setback')?.status !== 'fail', `${plate}/${preset}: clearance ${L.stats.minRoadClearance}`);
    // brute-force overlap on a sample of pairs in plan
    const B = L.buildings, lot = L.meta.presetSpec?.lot ?? { town: 26, city: 40, megastructure: 28, alien: 52 }[preset];
    const cell = new Map(); B.forEach((b, i) => { const k = `${Math.floor(b.pos[0] / lot)},${Math.floor(b.pos[2] / lot)}`; (cell.get(k) ?? cell.set(k, []).get(k)).push(i); });
    let overlaps = 0;
    if (plate !== 'sphere') B.forEach((b, i) => {
      const cx = Math.floor(b.pos[0] / lot), cz = Math.floor(b.pos[2] / lot);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const j of cell.get(`${cx + dx},${cz + dz}`) ?? []) {
        if (j <= i) continue; const c = B[j];
        const d = Math.hypot(b.pos[0] - c.pos[0], b.pos[2] - c.pos[2]), r1 = Math.min(b.w, b.d) / 2, r2 = Math.min(c.w, c.d) / 2;
        if (d < r1 + r2 - 1e-6) overlaps++; // inscribed circles overlapping means footprints overlap
      }
    });
    assert.equal(overlaps, 0, `${plate}/${preset}: overlapping footprints`);
    assert.deepEqual(checksFor(L.meta, L.stats).map((c) => c.status), L.checks.map((c) => c.status));
    // eras: every building has one, and no voice is empty
    assert.ok(B.every((b) => Number.isInteger(b.era) && b.era >= 0 && b.era < chord.length));
    for (const n of L.stats.eras) assert.ok(n > 0.05 * B.length, `${plate}/${preset}: eras ${L.stats.eras}`);
    assert.equal(L.meta.chord.length, chord.length); assert.equal(L.meta.frequency, chord[0]);
  }
});

test('a lot belongs to the voice that moves the plate most under it', () => {
  const o = { plate: 'circle', preset: 'city', chord: [432, { hz: 576, weight: 0.6 }] };
  const L = city(o), F = fieldPreview(o);
  for (const b of L.buildings) {
    const [u, v] = F.toNorm(b.pos);
    const a0 = 1 * F.voices[0].at(u, v).A, a1 = 0.6 * F.voices[1].at(u, v).A;
    assert.equal(b.era, a0 >= a1 ? 0 : 1);
  }
});

test('growth on a chord: the first voice is the old city, later voices break ground after it, keyframes stay sound', () => {
  const L = city({ plate: 'circle', preset: 'town', chord: [300, 450] });
  const sim = simulate(L, { years: 80, keyframes: 4 });
  assert.equal(L.buildings[sim.founding.building].era, 0, 'founded on the first voice');
  const built = (e) => sim.history.filter((h) => L.buildings[h.building].era === e).map((h) => h.built);
  assert.ok(Math.max(...built(0)) <= Math.min(...built(1)) + 1e-9, 'every era-0 lot precedes every era-1 lot');
  assert.deepEqual(sim.eraStarts.map((x) => x.era), [0, 1]);
  assert.equal(sim.eraStarts[0].year, 0);
  close(sim.eraStarts[1].year, Math.min(...built(1)), 1e-9);
  assert.ok(sim.events.some((e) => /voice 2 \(450 Hz\) breaks ground/.test(e.note)));
  for (const k of sim.keyframes) {
    assert.equal(k.layout.meta.chord.length, 2);
    for (const c of k.infra.checks) assert.notEqual(c.status, 'fail', `year ${k.year}: ${c.id} ${c.value}`);
    if (k.year < sim.eraStarts[1].year) assert.ok(k.layout.buildings.every((b) => b.era === 0), `year ${k.year}: only the old city stands`);
  }
  // a single-frequency city has no eras and no era starts
  const single = simulate(city({ plate: 'circle', preset: 'town', frequency: 300 }), { years: 40, keyframes: 2 });
  assert.equal(single.eraStarts, null);
});

test('chords are deterministic, serialise, and build their underground', () => {
  const o = { plate: 'square', preset: 'town', chord: [300, 375, 450], seed: 7 };
  const a = toJSON(generateCity(o)), b = toJSON(generateCity(o));
  assert.equal(a, b);
  const J = JSON.parse(a);
  assert.equal(J.meta.chord.length, 3); assert.ok(J.meta.chord.every((v) => v.note && v.dominant && v.modes.length));
  const L = generateCity(o), I = buildInfrastructure(L);
  assert.equal(I.laterals.length, L.buildings.length);
  for (const c of I.checks) assert.notEqual(c.status, 'fail', `${c.id} ${c.value}`);
});
