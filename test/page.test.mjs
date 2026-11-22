// The page and the command line are the same engine to the bit.
// Chromium runs the same source modules as Node and must produce the same bytes at every stage; then the built
// page saves a city and `cymatic generate`, given only the profile from that save, must write the same files.
// Needs Playwright with a Chromium (not a dependency of this package): the tests skip, saying so, without it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fingerprint } from '../src/detmath.js';
import { run } from '../bin/cymatic.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* optional */ }
let browser = null, server = null, base = '', why = chromium ? '' : 'Playwright is not installed';

before(async () => {
  if (!chromium) return;
  try { browser = await chromium.launch(); } catch (e) { why = `Chromium could not start (${String(e.message).split('\n')[0]})`; return; }
  const built = spawnSync(process.execPath, [join(ROOT, 'build.mjs')], { encoding: 'utf8' });
  if (built.status !== 0) throw new Error(`build failed: ${built.stderr}`);
  const types = { js: 'text/javascript', mjs: 'text/javascript', html: 'text/html', json: 'application/json' };
  server = createServer((req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    if (path.includes('..')) { res.writeHead(400); return res.end(); }
    try { const body = readFileSync(join(ROOT, path)); res.writeHead(200, { 'content-type': types[path.split('.').pop()] ?? 'application/octet-stream' }); res.end(body); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await browser?.close(); server?.close(); });

// The same work as source text, so Node and the browser run exactly the same statements.
const WORK = `async (base, sha) => {
  const [D, E, I, S, P, X, Q] = await Promise.all(['detmath', 'cymatic-engine', 'infrastructure', 'simulation', 'people', 'export', 'query'].map((m) => import(base + '/src/' + m + '.js')));
  const out = { fingerprint: D.fingerprint() };
  const cities = { town: { frequency: 432, preset: 'town' }, chord: { chord: [432, 540], preset: 'town' }, relief: { frequency: 432, preset: 'town', terrain: 'relief' },
    valleys: { frequency: 528, preset: 'town', terrain: 'valleys', plate: 'square' }, sphere: { frequency: 300, preset: 'town', plate: 'sphere' }, alien: { frequency: 300, preset: 'alien', seed: 3 } };
  for (const [name, p] of Object.entries(cities)) {
    const L = E.generateCity(p);
    out[name + ' layout'] = await sha(E.toJSON(L));
    L.infra = I.buildInfrastructure(L);
    out[name + ' with networks'] = await sha(E.toJSON(L));
    out[name + ' obj'] = await sha(E.toOBJ(L));
    out[name + ' glb'] = await sha(X.toGLB(L, { infra: true }));
    if (p.plate !== 'sphere') { out[name + ' geojson'] = await sha(X.toGeoJSON(L, { origin: [45.07, 7.69], bearing: 30, infra: true })); out[name + ' cityjson'] = await sha(X.toCityJSON(L)); }
    if (name === 'alien') continue;
    out[name + ' year 40 of 100'] = await sha(E.toJSON(S.cityAt(L, { year: 40 }).layout));
    const people = P.people(L, L.infra);
    out[name + ' people'] = await sha(JSON.stringify([people.stats, people.checks]));
    out[name + ' flows'] = await sha(JSON.stringify(S.flows(L, L.infra, 8)));
  }
  const sim = S.simulate(E.generateCity(cities.town), { years: 60, keyframes: 3 });
  out['growth events and history'] = await sha(JSON.stringify([sim.events, sim.history]));
  const found = Q.search({ base: { preset: 'town' }, vary: { frequency: [300, 500] }, constraints: [{ metric: 'population', op: '>=', value: 1000 }], objective: { metric: 'population', goal: 'max' }, budget: 6, seed: 2 });
  out['inverse search'] = await sha(JSON.stringify([found.candidates, found.nearMisses, found.evaluated]));
  return out;
}`;
const nodeSha = async (x) => createHash('sha256').update(x).digest('hex').slice(0, 16);
const BROWSER_SHA = `async (x) => { const d = await crypto.subtle.digest('SHA-256', typeof x === 'string' ? new TextEncoder().encode(x) : x); return [...new Uint8Array(d)].map((v) => v.toString(16).padStart(2, '0')).join('').slice(0, 16); }`;

test('Chromium and Node produce the same bytes at every stage, from the math up', async (t) => {
  if (!browser) return t.skip(why);
  const mine = await (0, eval)(`(${WORK})`)(pathToFileURL(ROOT).href.replace(/\/$/, ''), nodeSha);
  const page = await browser.newPage();
  await page.goto(`${base}/test/blank.html`).catch(() => {}); // any page on the origin; a 404 still gives one
  const theirs = await page.evaluate(`(${WORK})(${JSON.stringify(base)}, ${BROWSER_SHA})`);
  await page.close();
  assert.equal(mine.fingerprint, fingerprint());
  assert.ok(Object.keys(mine).length >= 50, `${Object.keys(mine).length} outputs compared`);
  const differ = Object.keys(mine).filter((k) => mine[k] !== theirs[k]);
  assert.deepEqual(differ, [], `differs between Node ${process.version} and Chromium ${browser.version()}`);
  assert.deepEqual(theirs, mine);
});

// read a stored (uncompressed) zip
function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), files = {};
  for (let o = 0; dv.getUint32(o, true) === 0x04034b50;) { const size = dv.getUint32(o + 18, true), n = dv.getUint16(o + 26, true), x = dv.getUint16(o + 28, true); files[new TextDecoder().decode(bytes.subarray(o + 30, o + 30 + n))] = bytes.subarray(o + 30 + n + x, o + 30 + n + x + size); o += 30 + n + x + size; }
  return files;
}
async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  // the page saves through the host's download service: stand in for it and keep the bytes
  await page.addInitScript(() => { window.claude = { use: async () => ({ save: async ({ filename, data }) => { window.__saved = { filename, bytes: Array.from(new Uint8Array(await data.arrayBuffer())) }; } }) }; });
  await page.goto(`${base}/dist/cymatic-city-standalone.html`);
  await page.waitForFunction(() => window.cymatic?.layout?.buildings?.length > 0 && !!window.cymatic.layout.infra, null, { timeout: 120000 });
  return { page, errors };
}
async function save(page) {
  await page.evaluate(() => { window.__saved = null; });
  await page.click('#save-model');
  await page.waitForFunction(() => window.__saved, null, { timeout: 60000 });
  return unzip(Uint8Array.from(await page.evaluate(() => window.__saved.bytes)));
}
// regenerate every file of a save from its profile.json alone and compare bytes
function regenerate(files, extra = []) {
  const dir = mkdtempSync(join(tmpdir(), 'page-')), profile = join(dir, 'profile.json');
  writeFileSync(profile, files['profile.json']);
  const differ = [];
  for (const [name, flags] of Object.entries({ 'layout.json': [], 'city.obj': [], 'city.glb': [], 'city.city.json': [], 'city.geojson': ['--origin', '45.07,7.69'] })) {
    if (!files[name]) continue;
    const out = join(dir, name);
    run(['generate', profile, '--infra', '--out', out, ...flags, ...extra], { log: () => {} });
    if (!Buffer.from(files[name]).equals(readFileSync(out))) differ.push(`${name} (page ${files[name].length} bytes, command line ${readFileSync(out).length})`);
  }
  return differ;
}

test('a city saved from the page is regenerated byte for byte by the command line from its profile.json', async (t) => {
  if (!browser) return t.skip(why);
  const { page, errors } = await openPage();
  const profiles = [{ frequency: 432, preset: 'town', terrain: { mode: 'relief' } }, { chord: [432, 540], preset: 'town', plate: 'square' }, { frequency: 300, preset: 'town', plate: 'sphere' }];
  for (const p of profiles) {
    await page.evaluate((q) => window.cymatic.applyProfile(q), p);
    await page.waitForFunction((q) => { const m = window.cymatic.layout?.meta; return m && m.preset === 'town' && m.plate === (q.plate ?? 'circle') && (m.terrain?.mode ?? 'flat') === (q.terrain?.mode ?? 'flat') && (m.chord?.length ?? 1) === (q.chord?.length ?? 1) && !!window.cymatic.layout.infra; }, p, { timeout: 120000 });
    await page.fill('#geo-origin', p.plate === 'sphere' ? '' : '45.07, 7.69');
    const files = await save(page);
    const want = p.plate === 'sphere' ? ['README.txt', 'city.glb', 'city.obj', 'layout.json', 'profile.json'] : ['README.txt', 'city.city.json', 'city.geojson', 'city.glb', 'city.obj', 'layout.json', 'profile.json'];
    assert.deepEqual(Object.keys(files).sort(), want, JSON.stringify(p));
    assert.deepEqual(Object.keys(JSON.parse(new TextDecoder().decode(files['layout.json']))).sort(), ['buildings', 'checks', 'infra', 'meta', 'roads', 'stats', 'trees'], 'layout.json holds the layout and nothing the page added');
    assert.deepEqual(regenerate(files), [], JSON.stringify(p));
  }
  assert.deepEqual(errors, []);
  await page.close();
});

test('a year of growth saved from the page names its year and horizon, and the command line rebuilds it', async (t) => {
  if (!browser) return t.skip(why);
  const { page, errors } = await openPage();
  await page.evaluate(() => window.cymatic.applyProfile({ frequency: 432, preset: 'town' }));
  await page.waitForFunction(() => window.cymatic.layout?.meta?.preset === 'town' && !!window.cymatic.layout.infra, null, { timeout: 120000 });
  await page.fill('#sim-years', '80');
  await page.click('#sim-run');
  await page.waitForFunction(() => window.cymatic.sim && !document.getElementById('timeline').hidden, null, { timeout: 180000 });
  // a middle keyframe: the town part-way through its 80 years
  await page.evaluate(() => window.cymatic.showKeyframe(2));
  await page.waitForFunction(() => window.cymatic.layout?.meta?.year !== undefined && window.cymatic.layout.meta.year < 80, null, { timeout: 60000 });
  const meta = await page.evaluate(() => window.cymatic.layout.meta);
  assert.equal(meta.horizon, 80);
  assert.equal(meta.year, 40);
  const files = await save(page), profile = JSON.parse(new TextDecoder().decode(files['profile.json']));
  assert.equal(profile.year, 40); assert.equal(profile.horizon, 80);
  assert.deepEqual(regenerate(files), []);
  // the flag still wins over the profile's year
  const dir = mkdtempSync(join(tmpdir(), 'page-')), p = join(dir, 'profile.json'), out = join(dir, 'x.json');
  writeFileSync(p, files['profile.json']);
  run(['generate', p, '--year', '60', '--out', out], { log: () => {} });
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).meta.year, 60);
  // back on the plan, the profile carries the horizon but no year, and the files name neither
  await page.click('#plan-btn');
  await page.waitForFunction(() => window.cymatic.layout?.meta?.year === undefined, null, { timeout: 60000 });
  const plan = await save(page), planProfile = JSON.parse(new TextDecoder().decode(plan['profile.json']));
  assert.equal(planProfile.year, undefined); assert.equal(planProfile.horizon, 80);
  const glb = plan['city.glb'], root = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + new DataView(glb.buffer, glb.byteOffset).getUint32(12, true)))).nodes[0];
  assert.equal(root.extras.year, undefined); assert.equal(root.extras.horizon, undefined);
  assert.deepEqual(regenerate(plan), []);
  assert.deepEqual(errors, []);
  await page.close();
  assert.ok(existsSync(out));
});
