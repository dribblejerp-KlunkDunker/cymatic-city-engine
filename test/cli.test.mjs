import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, run, isMain } from '../bin/cymatic.mjs';
import { createServer, PAGE } from '../bin/cymatic-mcp.mjs';
import { generateCity, toJSON } from '../src/cymatic-engine.js';
import { buildInfrastructure } from '../src/infrastructure.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLI = join(ROOT, 'bin', 'cymatic.mjs'), MCP = join(ROOT, 'bin', 'cymatic-mcp.mjs'), REPORTER = join(ROOT, 'test', 'quiet-reporter.mjs');
const TOWN = ['-f', '432', '--preset', 'town'];
// run() with its output captured
const cli = (...args) => { const lines = []; const code = run(args, { log: (s) => lines.push(s) }); return { code, out: lines.join('\n') }; };
// a fantasy town whose towers fail their structural checks
const FAILING = '{"frequency":432,"preset":"custom","custom":{"base":"town","coreFloors":400},"enforce":false}';

test('CLI parses commands, shorthand flags, JSON and file profiles; flags override the JSON', () => {
  const a = parseArgs(['summary', '-f', '440', '--plate', 'square', '--chord', '432,540:0.5', '--fantasy', '--json']);
  assert.equal(a.command, 'summary');
  assert.deepEqual(a.profile, { frequency: 440, plate: 'square', chord: [432, { hz: 540, weight: 0.5 }], enforce: false });
  assert.equal(a.flags.json, true);
  assert.deepEqual(parseArgs(['{"frequency":300,"seed":4}', '--seed', '9']).profile, { frequency: 300, seed: 9 });
  const dir = mkdtempSync(join(tmpdir(), 'cli-'));
  const file = join(dir, 'p.json');
  writeFileSync(file, JSON.stringify({ input: { frequency: 512, preset: 'town' }, engine: '1.5.0', theme: 'x' }));
  assert.deepEqual(parseArgs(['checks', file]).profile, { frequency: 512, preset: 'town' }); // saved profile wrapper
  assert.equal(parseArgs([]).profile.frequency, 432); // default
  assert.throws(() => parseArgs(['--nope']), /Unknown option/);
  assert.throws(() => parseArgs(['-f', 'abc']), /needs a number/);
  assert.throws(() => run(['summary', 'stray']), /Unexpected argument/);
});

test('CLI summary is short, lists only non-passing checks, and export reproduces toJSON byte for byte', () => {
  const r = cli(...TOWN, '--json');
  assert.equal(r.code, 0);
  const S = JSON.parse(r.out);
  const L = generateCity({ frequency: 432, preset: 'town' });
  assert.equal(S.stats.buildings, L.buildings.length);
  assert.equal(S.stats.population, L.stats.population);
  assert.equal(S.stats.jobs, L.stats.jobs);
  assert.notEqual(L.stats.population, L.stats.jobs);
  assert.equal(S.checks.total, L.checks.length);
  assert.deepEqual(S.checks.notPassing.map((c) => c.id), L.checks.filter((c) => c.status !== 'pass' && c.status !== 'info').map((c) => c.id));
  assert.ok(r.out.length < 2000, `summary stays small (${r.out.length} chars)`);
  const dir = mkdtempSync(join(tmpdir(), 'cli-')), out = join(dir, 'city.json');
  cli('export', ...TOWN, '--out', out);
  assert.equal(readFileSync(out, 'utf8'), toJSON(L));
  // the extension names the format: an unknown one is refused, not written as JSON under another name
  // an extension that names no format is refused, not written as JSON under another name
  assert.throws(() => cli('export', ...TOWN, '--out', join(dir, 'city.fbx')), /no format this command writes/);
  assert.equal(existsSync(join(dir, 'city.fbx')), false);
  assert.throws(() => cli('generate', ...TOWN, '--out', join(dir, 'city.json'), '--format', 'fbx'), /--format must be one of/);
  // --format names the format when the extension does not
  cli('generate', ...TOWN, '--out', join(dir, 'city.data'), '--format', 'json');
  assert.equal(readFileSync(join(dir, 'city.data'), 'utf8'), toJSON(L));
});

test('CLI --infra reports the networks, their checks, and --strict judges what it looked at', () => {
  const L = generateCity({ frequency: 432, preset: 'town' }), infra = buildInfrastructure(L), I = infra.stats;
  const S = JSON.parse(cli(...TOWN, '--infra', '--json').out);
  assert.deepEqual([S.infra.liftStations, S.infra.substations, S.infra.metroStations, S.infra.waterTanks], [I.liftStations, I.substations, I.stations, I.towers]);
  assert.equal(new Set([I.liftStations, I.substations, I.stations, I.towers]).size > 1, true); // the four are not all equal, so a swap would show
  const plain = JSON.parse(cli('checks', ...TOWN, '--json').out), withInfra = JSON.parse(cli('checks', ...TOWN, '--infra', '--json').out);
  assert.equal(plain.length, L.checks.length);
  assert.equal(withInfra.length, L.checks.length + infra.checks.length);
  assert.ok(infra.checks.length > 0);
  // --strict: 0 when nothing fails, 2 when a check fails
  assert.equal(cli(...TOWN, '--strict').code, 0);
  assert.equal(cli('summary', FAILING, '--strict').code, 2);
  assert.equal(cli('summary', FAILING).code, 0);
});

test('CLI metrics, ask, query and tools answer from the engine; query output is capped', () => {
  const L = generateCity({ frequency: 432, preset: 'town' });
  assert.deepEqual(JSON.parse(cli('metrics', ...TOWN, 'population', 'buildings', '--json').out), { population: L.stats.population, buildings: L.buildings.length });
  assert.throws(() => cli('metrics', ...TOWN, 'nonsense'), /Unknown metric/);
  assert.match(cli('ask', ...TOWN, 'what is the tallest building').out, new RegExp(String(L.stats.maxHeight)));
  const q = JSON.parse(cli('query', ...TOWN, '--q', '{"from":"streets","fields":["index"]}', '--json').out);
  assert.ok(q.total > 200 && q.rows.length === 200, `streets are capped at 200 rows (${q.rows.length} of ${q.total})`);
  assert.throws(() => cli('query', ...TOWN), /needs --q/);
  assert.deepEqual(JSON.parse(cli('tools', '--json').out).map((t) => t.name), ['generate_city', 'query_city', 'ask_city', 'suggest_metro_station', 'search_plans']);
});

test('CLI runs as a program: directly, through a link of any name, with exit codes', () => {
  const node = process.execPath;
  const direct = spawnSync(node, [CLI, ...TOWN, '--json'], { encoding: 'utf8' });
  assert.equal(direct.status, 0);
  assert.equal(JSON.parse(direct.stdout).stats.buildings, generateCity({ frequency: 432, preset: 'town' }).buildings.length);
  const bad = spawnSync(node, [CLI, '--nope'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /^cymatic: Unknown option/);
  assert.equal(spawnSync(node, [CLI, 'summary', FAILING, '--strict'], { encoding: 'utf8' }).status, 2);
  // npm links a bin under its own name; the program must still start
  const dir = mkdtempSync(join(tmpdir(), 'cli-')), link = join(dir, 'any-name');
  symlinkSync(CLI, link);
  assert.match(spawnSync(node, [link, 'help'], { encoding: 'utf8' }).stdout, /^cymatic <command>/);
  assert.equal(isMain(pathToFileURL(CLI).href, link), true);
  assert.equal(isMain(pathToFileURL(CLI).href, MCP), false);
  assert.equal(isMain(pathToFileURL(CLI).href, undefined), false);
  assert.equal(isMain(pathToFileURL(CLI).href, join(dir, 'missing')), false);
});

test('MCP server: handshake, tool list from agentTools, errors as tool results, a city held between calls', () => {
  const s = createServer();
  const init = s.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.ok(init.result.capabilities.tools);
  assert.equal(s.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal(s.handle({ jsonrpc: '2.0', id: 9, method: 'initialize', params: { protocolVersion: '1999-01-01' } }).result.protocolVersion, '2025-06-18');
  const list = s.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }).result.tools;
  assert.deepEqual(list.map((t) => t.name), ['generate_city', 'query_city', 'ask_city', 'suggest_metro_station', 'search_plans']);
  for (const t of list) { assert.equal(t.inputSchema.type, 'object'); assert.equal(t.annotations.readOnlyHint, true); }
  const early = s.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ask_city', arguments: { question: 'how many buildings are there' } } });
  assert.equal(early.result.isError, true);
  assert.match(early.result.content[0].text, /Generate a city first.*call generate_city/);
  assert.equal(s.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } }).error.code, -32602);
  assert.equal(s.handle({ jsonrpc: '2.0', id: 5, method: 'nope' }).error.code, -32601);
  const call = (id, name, args) => JSON.parse(s.handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }).result.content[0].text);
  const gen = call(6, 'generate_city', { profile: { frequency: 432, preset: 'town' } });
  assert.equal(gen.meta.frequency, 432);
  assert.equal(call(7, 'query_city', { from: 'buildings', aggregate: { n: 'count' } }).rows[0].n, gen.stats.buildings);
  // a query with no limit returns one short page and says so; a stated limit is honoured
  const page = call(8, 'query_city', { from: 'buildings', fields: ['index'] });
  assert.equal(page.rows.length, PAGE);
  assert.equal(page.count, gen.stats.buildings);
  assert.match(page.note, new RegExp(`first ${PAGE} of ${gen.stats.buildings}`));
  const sixty = call(9, 'query_city', { from: 'buildings', fields: ['index'], limit: 60 });
  assert.equal(sixty.rows.length, 60);
  assert.equal(sixty.note, undefined);
});

test('MCP server refuses what is not a request and survives it', () => {
  const s = createServer();
  for (const junk of [5, 'abc', null, true, {}, { jsonrpc: '1.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 1 }]) assert.equal(s.handle(junk).error.code, -32600, JSON.stringify(junk));
  assert.equal(s.handle({ jsonrpc: '2.0', id: 7, result: {} }), null); // a stray reply is dropped
  assert.equal(s.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: null }).error.code, -32602);
  // a request that throws inside the server comes back as an internal error instead of ending the process
  assert.equal(s.handle({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { get name() { throw new Error('boom'); } } }).error.code, -32603);
  assert.equal(s.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'generate_city', arguments: 'x' } }).result.isError, false); // no arguments: the default city
  // over stdio, through a link named as npm names the bin: junk and garbage get errors, the next request still answers
  const dir = mkdtempSync(join(tmpdir(), 'mcp-')), link = join(dir, 'cymatic-mcp');
  symlinkSync(MCP, link);
  const r = spawnSync(process.execPath, [link], { encoding: 'utf8', input: ['5', 'not json', '', '{"jsonrpc":"2.0","method":"notifications/initialized"}', '{"jsonrpc":"2.0","id":1,"method":"ping"}'].join('\n') + '\n' });
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.deepEqual(r.stdout.trim().split('\n').map((l) => { const m = JSON.parse(l); return m.error?.code ?? m.id; }), [-32600, -32700, 1]);
});

test('quiet reporter prints failures and totals only, and says why a file could not load', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rep-'));
  writeFileSync(join(dir, 'a.test.mjs'), "import { test } from 'node:test'; import assert from 'node:assert/strict';\ntest('good', () => {});\ntest('bad', () => { assert.equal(1, 2); });\ntest('later', { skip: true }, () => {});\n");
  // a test runner started from inside a test must not inherit this run's context
  const { NODE_TEST_CONTEXT: _, ...childEnv } = process.env;
  const runQuiet = (file) => spawnSync(process.execPath, ['--test', `--test-reporter=${pathToFileURL(REPORTER).href}`, join(dir, file)], { encoding: 'utf8', cwd: dir, env: childEnv });
  const r = runQuiet('a.test.mjs');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^FAIL bad {2}\(a\.test\.mjs:3\)/);
  assert.match(r.stdout, /1 !== 2/);
  assert.match(r.stdout, /FAILED: 1 passed, 1 failed, 1 skipped in \d+ s\n$/);
  assert.doesNotMatch(r.stdout, /good/);
  writeFileSync(join(dir, 'b.test.mjs'), "import { test } from 'node:test';\ntest('fine', () => {});\n");
  const ok = runQuiet('b.test.mjs');
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /^ok: 1 passed, 0 failed in \d+ s\n$/);
  writeFileSync(join(dir, 'c.test.mjs'), "import './does-not-exist.mjs';\n");
  const broken = runQuiet('c.test.mjs');
  assert.equal(broken.status, 1);
  assert.match(broken.stdout, /does-not-exist\.mjs/);
  assert.match(broken.stdout, /FAILED: 0 passed, 1 failed/);
});
