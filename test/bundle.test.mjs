// The page bundle (build.mjs) wraps each module after the engine in its own scope and hands it only the names in
// that module's export list. A name one module imports from another must be in that list, or it is undefined on the
// page while every Node test passes (1.7.0: flows() called wardGravity, which the networks scope did not export).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

test('every name a module imports from a scoped module is in that module\'s bundle export list', () => {
  const build = read('build.mjs');
  const list = (name) => { const m = build.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`)); assert.ok(m, name); return new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])); };
  const scoped = { 'infrastructure.js': list('INFRA_EXPORTS'), 'simulation.js': list('SIM_EXPORTS'), 'people.js': list('PEOPLE_EXPORTS'), 'query.js': list('QUERY_EXPORTS'), 'export.js': list('EXPORT_EXPORTS') };
  const missing = [];
  for (const file of readdirSync(new URL('src/', root)).filter((f) => f.endsWith('.js'))) {
    for (const [, names, from] of read(`src/${file}`).matchAll(/^import \{([^}]*)\} from '\.\/([^']+)';$/gm)) {
      if (!scoped[from]) continue; // the engine and detmath sit at the top of the bundle, seen by every scope
      for (const n of names.split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) if (!scoped[from].has(n)) missing.push(`${file} imports ${n} from ${from}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('the built page code runs every stage on a warded city', () => {
  execFileSync(process.execPath, ['build.mjs'], { cwd: new URL('.', root) });
  const html = read('dist/cymatic-city.html');
  const i = html.indexOf('const { DM } = (() =>'), j = html.indexOf('</script>', i);
  assert.ok(i > 0 && j > i, 'bundle found');
  const code = html.slice(i, j).split('\n').filter((l) => !/^\s*(import|export)\b/.test(l)).join('\n');
  const run = new Function(`${code}
    const L = generateCity({ frequency: 300, preset: 'town', magic: { wards: [{ where: { polarity: 1 }, gravity: 0.5, height: 2 }] } });
    const I = buildInfrastructure(L);
    const f = flows(L, I, 8), r = impact(L, I, { kind: 'ward', index: 0 }), y = cityAt(L, { year: 30 });
    return { wards: L.wards.length, pressure: f.water.minPressure, summary: r.summary, year: y.layout.meta.year };`);
  const out = run();
  assert.equal(out.wards, 1);
  assert.ok(out.pressure > 0);
  assert.match(out.summary, /^Ward 1 fails/);
  assert.equal(out.year, 30);
});
