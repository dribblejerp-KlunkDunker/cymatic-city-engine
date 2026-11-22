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
// hashes are taken with the engine version blanked, so a version bump alone does not move them
const sha = (s) => createHash('sha256').update(s.split(`"engine":"${ENGINE_VERSION}"`).join('"engine":""')).digest('hex').slice(0, 16);
const cli = (...args) => { const lines = []; const code = run(args, { log: (s) => lines.push(s) }); return { code, out: lines.join('\n') }; };
const tmp = (name) => join(mkdtempSync(join(tmpdir(), 'time-')), name);
const cache = new Map();
const town = (o = TOWN) => { const k = JSON.stringify(o); if (!cache.has(k)) cache.set(k, generateCity(o)); return cache.get(k); };

// Growth, pinned: the hash of toJSON of every keyframe (years 100, 8 keyframes), of the events and of the history.
// History of these numbers: recorded on 1.5.0 before simulate() was split into schedule() and frameAt(), and
// unchanged by the split (commit 41fbe43); re-recorded once in 1.6.0 when every stage moved to deterministic math
// (src/detmath.js) and year frames gained meta.horizon. Since then they are the same in every runtime:
// test/page.test.mjs hashes the same cities in Chromium. To re-record after an intended change to growth, run
// this file with CYMATIC_RECORD=1 and paste the printed objects here.
const GOLDEN = {
  plain: { keyframes: ['43850a22e18957e0', '6ea65e76e996ccac', '67433c070a992827', '1ebc50d16c686382', 'caa72e2c16b4adba', 'a7002ed82420d7df', '7c9332c6b984270d', '08068bfe5da002ac'], events: '11c3a725b75c9e9d', history: '59c7d5aafcd0debf', rest: 'fea03e62b43bcd2a' },
  chord: { keyframes: ['5e355c755989f912', 'c41207d8eb982bbe', '6e46dbee6e019853', '608f1463c31f84c1', '79d58a201dffb5d6', '4f4c9c55865f05b5', 'b8929c0feb639b1c', '5e64cf9331be6900'], events: '9c22d54a6c89eaae', history: 'bd122a015a62eacd', rest: '00fe89552d75dc77' },
  valleys: { keyframes: ['db157b597aafd340', '94f8cce1a57ec431', 'a6614c47dc8b6333', '7dff6e0b5af6894a', '2a538669e325f52d', '379745c70c8b325d', '2bf826d0c562492c', '7995965b053624e1'], events: 'bef0328929cb93c8', history: 'd2daa640d4f73743', rest: 'fea03e62b43bcd2a' },
};
const GOLDEN_PROFILES = { plain: TOWN, chord: { chord: [432, 540], preset: 'town' }, valleys: { ...TOWN, terrain: 'valleys' } };
const GOLDEN_TOWN_JSON = 'df04083d97da14b0'; // toJSON(generateCity(TOWN))

test('growth is pinned: every keyframe, the events and the history hash as recorded', () => {
  const got = {};
  for (const [name, p] of Object.entries(GOLDEN_PROFILES)) {
    const sim = simulate(generateCity(p), { years: 100, keyframes: 8 });
    got[name] = { keyframes: sim.keyframes.map((k) => sha(toJSON(k.layout))), events: sha(JSON.stringify(sim.events)), history: sha(JSON.stringify(sim.history)), rest: sha(JSON.stringify([sim.years, sim.founding, sim.eraStarts])) };
  }
  if (process.env.CYMATIC_RECORD) console.log(JSON.stringify(got), sha(toJSON(generateCity(TOWN))));
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
  // a frame names the horizon its year is measured in: the year alone would name two different towns
  assert.equal(at.layout.meta.horizon, 100);
  assert.equal(cityAt(L, { year: 80, horizon: 80 }).layout.meta.horizon, 80);
  assert.equal(L.meta.horizon, undefined, 'the plan itself has no year and no horizon');
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
  const want = (horizon, year = 80) => toJSON(cityAt(L, { year, horizon }).layout);
  const a = tmp('a.json');
  const r = cli('generate', ...args, '--year', '80', '--infra', '--out', a, '--json');
  assert.equal(r.code, 0);
  assert.equal(readFileSync(a, 'utf8'), want(100));
  const said = JSON.parse(r.out);
  assert.deepEqual({ year: said.year, horizon: said.horizon, format: said.format, buildings: said.buildings }, { year: 80, horizon: 100, format: 'json', buildings: cityAt(L, { year: 80 }).layout.buildings.length });
  assert.equal(said.bytes, readFileSync(a).length, 'bytes on disk, not characters');
  // --infra decides whether the networks are written, for a year as for the plan
  const bare = tmp('bare.json');
  cli('generate', ...args, '--year', '80', '--out', bare);
  const withNets = JSON.parse(readFileSync(a, 'utf8')), without = JSON.parse(readFileSync(bare, 'utf8'));
  assert.ok(withNets.infra && !('infra' in without));
  assert.deepEqual(without, (({ infra, ...rest }) => rest)(withNets));
  assert.equal(without.meta.year, 80); assert.equal(without.meta.horizon, 100);
  // the profile's horizon is used when no flag names one
  const b = tmp('b.json');
  cli('generate', JSON.stringify({ ...TOWN, horizon: 80 }), '--year', '80', '--infra', '--out', b);
  assert.equal(readFileSync(b, 'utf8'), want(80));
  assert.notEqual(want(80), want(100));
  // and the flag wins over the profile
  const c = tmp('c.json');
  cli('generate', JSON.stringify({ ...TOWN, horizon: 80 }), '--year', '80', '--horizon', '120', '--infra', '--out', c);
  assert.equal(readFileSync(c, 'utf8'), want(120));
  // a profile that names its own year (saved from the page while a year was shown) is built at that year…
  const d = tmp('d.json');
  cli('generate', JSON.stringify({ ...TOWN, year: 40, horizon: 80 }), '--infra', '--out', d);
  assert.equal(readFileSync(d, 'utf8'), want(80, 40));
  // …unless the flag names another
  const e = tmp('e.json');
  cli('generate', JSON.stringify({ ...TOWN, year: 40, horizon: 80 }), '--year', '60', '--infra', '--out', e);
  assert.equal(readFileSync(e, 'utf8'), want(80, 60));
  // text output names the year and the horizon
  assert.match(cli('generate', ...args, '--year', '80', '--horizon', '120', '--out', tmp('t.json')).out, /year 80 of 120/);
  // export is the same command
  const x = tmp('x.json');
  cli('export', ...args, '--year', '80', '--infra', '--out', x);
  assert.equal(readFileSync(x, 'utf8'), want(100));
  // refusals
  assert.throws(() => cli('generate', ...args, '--horizon', '80', '--out', tmp('f.json')), /--horizon .* --year/);
  assert.throws(() => cli('generate', ...args, '--year', '200', '--out', tmp('g.json')), /year 200 .*100/);
  assert.throws(() => cli('generate', JSON.stringify({ ...TOWN, horizon: 'long' }), '--year', '5', '--out', tmp('h.json')), /horizon must be a number/);
  assert.throws(() => cli('generate', JSON.stringify({ ...TOWN, year: 'soon' }), '--out', tmp('i.json')), /year must be a number/);
});

test('--year reaches every city command, metrics included', () => {
  const L = town(), args = ['-f', '432', '--preset', 'town'], at40 = cityAt(L, { year: 40 }).layout;
  const s = JSON.parse(cli('summary', ...args, '--year', '40', '--json').out);
  assert.equal(s.stats.buildings, at40.buildings.length);
  assert.deepEqual([s.year, s.horizon], [40, 100]);
  assert.match(cli('summary', ...args, '--year', '40').out, /year 40 of 100$/);
  const young = JSON.parse(cli('metrics', ...args, '--year', '40', 'population', 'buildings', '--json').out), grown = JSON.parse(cli('metrics', ...args, 'population', 'buildings', '--json').out);
  assert.equal(young.buildings, at40.buildings.length);
  assert.equal(grown.buildings, L.buildings.length);
  assert.ok(young.population < grown.population && young.population === at40.stats.population);
  assert.equal(JSON.parse(cli('metrics', JSON.stringify({ ...TOWN, year: 40 }), 'buildings', '--json').out).buildings, at40.buildings.length, 'the profile’s year counts too');
  const q = JSON.parse(cli('query', ...args, '--year', '40', '--q', '{"from":"buildings","aggregate":{"n":"count"}}', '--json').out);
  assert.equal(q.rows[0].n, at40.buildings.length);
  assert.equal(JSON.parse(cli('checks', ...args, '--year', '40', '--json').out).length, at40.checks.length);
});

test('a profile without a year builds the plan, and a horizon alone changes nothing', () => {
  assert.equal(sha(toJSON(generateCity(TOWN))), GOLDEN_TOWN_JSON);
  assert.equal(toJSON(generateCity({ ...TOWN, horizon: 80 })), toJSON(generateCity(TOWN)), 'the generator ignores the horizon');
  assert.equal(toJSON(generateCity({ ...TOWN, year: 40 })), toJSON(generateCity(TOWN)), 'and the year: only growth reads them');
  const a = tmp('a.json'), b = tmp('b.json'), p = tmp('profile.json');
  writeFileSync(p, JSON.stringify({ engine: '1.5.0', ...TOWN, theme: 'realistic' })); // as the page saved it on 1.5.0
  cli('generate', p, '--out', a);
  cli('generate', JSON.stringify({ ...TOWN, horizon: 80 }), '--out', b);
  assert.equal(sha(readFileSync(a, 'utf8')), GOLDEN_TOWN_JSON);
  assert.equal(readFileSync(b, 'utf8'), readFileSync(a, 'utf8'));
});
