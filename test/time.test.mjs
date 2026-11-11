// Time contract (Phase 6a): a year of a city's life is defined by the profile, the year and the horizon.
// schedule() + frameAt() reproduce simulate() exactly, cityAt() is the keyframe at any year, the horizon changes
// the city and the keyframe count does not, and the CLI's --year writes exactly that city.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateCity, toJSON, ENGINE_VERSION } from '../src/cymatic-engine.js';
import { simulate, schedule, frameAt, cityAt } from '../src/simulation.js';
import { run } from '../bin/cymatic.mjs';

const TOWN = { frequency: 432, preset: 'town' };
// hashes are taken with the engine version written as 1.5.0, so a version bump alone does not move them
const sha = (s) => createHash('sha256').update(s.split(`"engine":"${ENGINE_VERSION}"`).join('"engine":"1.5.0"')).digest('hex').slice(0, 16);
const cli = (...args) => { const lines = []; const code = run(args, { log: (s) => lines.push(s) }); return { code, out: lines.join('\n') }; };
const tmp = (name) => join(mkdtempSync(join(tmpdir(), 'time-')), name);
const cache = new Map();
const town = (o = TOWN) => { const k = JSON.stringify(o); if (!cache.has(k)) cache.set(k, generateCity(o)); return cache.get(k); };

// Recorded on engine 1.5.0, before simulate() was split into schedule() and frameAt(): the hash of toJSON of
// every keyframe (years 100, 8 keyframes), of the events and of the history. To re-record after an intended
// change to growth: run this file with CYMATIC_RECORD=1 and paste the printed object here.
const GOLDEN = {
  plain: { keyframes: ['9aef662d4335e4d4', 'cc605a577614ab5c', 'a2820b47fc6c2932', '9a8c08a89ba2ec27', 'c3add19b647ed892', 'ffcf58ef26c0ed31', 'e7b3805939de29d0', '2d98baaa444001c9'], events: '11c3a725b75c9e9d', history: '93a68dbaaede64c8', rest: 'fea03e62b43bcd2a' },
  chord: { keyframes: ['fe01a6eceae3a83d', '22e195876d0cc908', 'a2279db01ebe5a00', '56db7e27ff030bc5', '017094f771a646eb', '455374506dcd93bc', 'cd11791cad176c05', '94e81bc440539a3a'], events: '9c22d54a6c89eaae', history: 'b22baa793cc19996', rest: '00fe89552d75dc77' },
  valleys: { keyframes: ['9a8446dd023cad46', '6709266099c58b4f', '50e70c92f6ef4347', '2d95a90da6382763', '9d6f47c53df39431', '93921a05dc974417', 'fd6712773bcde00a', 'a426c31b0ff4c0f4'], events: 'bef0328929cb93c8', history: 'b6d150b23c69e0af', rest: 'fea03e62b43bcd2a' },
};
const GOLDEN_PROFILES = { plain: TOWN, chord: { chord: [432, 540], preset: 'town' }, valleys: { ...TOWN, terrain: 'valleys' } };
const GOLDEN_TOWN_JSON = 'adfbbb99219006fb'; // toJSON(generateCity(TOWN)) on 1.5.0

test('splitting simulate() changed nothing: every keyframe, the events and the history hash as on 1.5.0', () => {
  const got = {};
  for (const [name, p] of Object.entries(GOLDEN_PROFILES)) {
    const sim = simulate(generateCity(p), { years: 100, keyframes: 8 });
    got[name] = { keyframes: sim.keyframes.map((k) => sha(toJSON(k.layout))), events: sha(JSON.stringify(sim.events)), history: sha(JSON.stringify(sim.history)), rest: sha(JSON.stringify([sim.years, sim.founding, sim.eraStarts])) };
  }
  if (process.env.CYMATIC_RECORD) console.log(JSON.stringify(got));
  assert.deepEqual(got, GOLDEN);
});

test('cityAt is the keyframe: year 80 of a 100-year growth, field for field, and simulate is schedule + frames', () => {
  const L = town(), sim = simulate(L, { years: 100, keyframes: 5 });
  const key = sim.keyframes.find((k) => k.year === 80), at = cityAt(L, { year: 80, horizon: 100 });
  assert.ok(key, 'five keyframes over 100 years put one at year 80');
  assert.equal(toJSON(at.layout), toJSON(key.layout));
  assert.deepEqual(at.stats, key.stats);
  assert.equal(at.year, 80);
  assert.equal(at.layout.meta.year, 80);
  // the default horizon is 100
  assert.equal(toJSON(cityAt(L, { year: 80 }).layout), toJSON(key.layout));
  // the pieces are the whole: a frame of the schedule is the keyframe, and the schedule carries the history
  const sched = schedule(L, { years: 100 });
  assert.deepEqual(sched.history, sim.history);
  assert.equal(toJSON(frameAt(L, sched, 40).layout), toJSON(sim.keyframes.find((k) => k.year === 40).layout));
});

test('the horizon changes the city at a year; the number of keyframes does not', () => {
  const L = town();
  const h80 = cityAt(L, { year: 80, horizon: 80 }), h100 = cityAt(L, { year: 80, horizon: 100 });
  assert.equal(h80.layout.buildings.length, L.buildings.length, 'at its own horizon the plan is built out');
  assert.ok(h100.layout.buildings.length < 0.6 * h80.layout.buildings.length, `80 of 100 years is a much smaller town (${h100.layout.buildings.length} vs ${h80.layout.buildings.length})`);
  assert.notEqual(toJSON(h80.layout), toJSON(h100.layout));
  const k5 = simulate(L, { years: 100, keyframes: 5 }).keyframes.find((k) => k.year === 80);
  const k10 = simulate(L, { years: 100, keyframes: 10 }).keyframes.find((k) => k.year === 80);
  assert.equal(toJSON(k5.layout), toJSON(k10.layout));
});

test('any year is a city: what stands is exactly what the schedule had built, and towns only grow', () => {
  const L = town(), sched = schedule(L, { years: 100 });
  let prev = new Set();
  for (const year of [0.1, 12.3, 37.5, 61, 99.9, 100]) {
    const f = cityAt(L, { year, horizon: 100 });
    const built = sched.history.filter((h) => h.built <= year).map((h) => h.building);
    assert.deepEqual(f.layout.buildings.map((b) => b.source), built, `year ${year}`);
    for (const b of f.layout.buildings) assert.ok(b.built <= year && b.rebuilt <= year && b.rebuilt >= b.built, `year ${year}: building ${b.source} dated ${b.built}/${b.rebuilt}`);
    for (const s of prev) assert.ok(built.includes(s), `building ${s} stood earlier and is gone at year ${year}`);
    prev = new Set(built);
    assert.ok(f.infra && f.layout.infra === f.infra && f.layout.checks.length > 0, 'a frame is a complete city');
  }
  assert.equal(prev.size, L.buildings.length);
  // years are read to a tenth
  assert.equal(cityAt(L, { year: 37.54 }).year, 37.5);
  assert.equal(toJSON(cityAt(L, { year: 37.54 }).layout), toJSON(cityAt(L, { year: 37.5 }).layout));
});

test('cityAt refuses years outside the growth and anything that is not a number, naming both numbers', () => {
  const L = town();
  assert.throws(() => cityAt(L, { year: 0 }), /year 0 .*horizon, 100/);
  assert.throws(() => cityAt(L, { year: -5 }), /year -5 .*100/);
  assert.throws(() => cityAt(L, { year: 100.1 }), /year 100.1 .*100/);
  assert.throws(() => cityAt(L, { year: 81, horizon: 80 }), /year 81 .*80/);
  assert.throws(() => cityAt(L, { year: 0.04 }), /year 0.04 /); // rounds to year 0
  for (const bad of ['80', NaN, null, undefined, Infinity, {}]) assert.throws(() => cityAt(L, { year: bad }), /year must be a number .*horizon 100/, String(bad));
  for (const bad of ['100', NaN, null, 4, -100, Infinity]) assert.throws(() => cityAt(L, { year: 3, horizon: bad }), /horizon must be a number of years, 5 or more/, String(bad));
  assert.throws(() => cityAt(L, {}), /year must be a number/);
  assert.doesNotThrow(() => cityAt(L, { year: 5, horizon: 5 }));
});

test('CLI generate --year writes cityAt; the horizon comes from --horizon, then the profile, then 100', () => {
  const L = town(), args = ['-f', '432', '--preset', 'town'];
  const want = (horizon) => toJSON(cityAt(L, { year: 80, horizon }).layout);
  const a = tmp('a.json');
  const r = cli('generate', ...args, '--year', '80', '--out', a, '--json');
  assert.equal(r.code, 0);
  assert.equal(readFileSync(a, 'utf8'), want(100));
  const said = JSON.parse(r.out);
  assert.deepEqual({ year: said.year, horizon: said.horizon, format: said.format, buildings: said.buildings }, { year: 80, horizon: 100, format: 'json', buildings: cityAt(L, { year: 80 }).layout.buildings.length });
  assert.equal(said.bytes, readFileSync(a).length, 'bytes on disk, not characters');
  // the profile's horizon is used when no flag names one
  const b = tmp('b.json');
  cli('generate', JSON.stringify({ ...TOWN, horizon: 80 }), '--year', '80', '--out', b);
  assert.equal(readFileSync(b, 'utf8'), want(80));
  assert.notEqual(want(80), want(100));
  // and the flag wins over the profile
  const c = tmp('c.json');
  cli('generate', JSON.stringify({ ...TOWN, horizon: 80 }), '--year', '80', '--horizon', '120', '--out', c);
  assert.equal(readFileSync(c, 'utf8'), want(120));
  // text output names the year and the horizon
  assert.match(cli('generate', ...args, '--year', '80', '--horizon', '120', '--out', tmp('d.json')).out, /year 80 of 120/);
  // export is the same command
  const e = tmp('e.json');
  cli('export', ...args, '--year', '80', '--out', e);
  assert.equal(readFileSync(e, 'utf8'), want(100));
  // refusals
  assert.throws(() => cli('generate', ...args, '--horizon', '80', '--out', tmp('f.json')), /--horizon .* --year/);
  assert.throws(() => cli('generate', ...args, '--year', '200', '--out', tmp('g.json')), /year 200 .*100/);
  assert.throws(() => cli('generate', JSON.stringify({ ...TOWN, horizon: 'long' }), '--year', '5', '--out', tmp('h.json')), /horizon must be a number/);
  // --year reaches the other commands too: the summary is the town of that year
  const s = JSON.parse(cli('summary', ...args, '--year', '40', '--json').out);
  assert.equal(s.stats.buildings, cityAt(L, { year: 40 }).layout.buildings.length);
});

test('old profiles are untouched: no horizon key, or a horizon without --year, exports the 1.5.0 bytes', () => {
  assert.equal(sha(toJSON(generateCity(TOWN))), GOLDEN_TOWN_JSON);
  assert.equal(toJSON(generateCity({ ...TOWN, horizon: 80 })), toJSON(generateCity(TOWN)), 'the generator ignores the horizon');
  const a = tmp('a.json'), b = tmp('b.json'), p = tmp('profile.json');
  writeFileSync(p, JSON.stringify({ engine: '1.5.0', ...TOWN, theme: 'realistic' })); // as the page saved it on 1.5.0
  cli('generate', p, '--out', a);
  cli('generate', JSON.stringify({ ...TOWN, horizon: 80 }), '--out', b);
  assert.equal(sha(readFileSync(a, 'utf8')), GOLDEN_TOWN_JSON);
  assert.equal(readFileSync(b, 'utf8'), readFileSync(a, 'utf8'));
});
