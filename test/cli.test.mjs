import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, run } from '../bin/cymatic.mjs';
import { createServer } from '../bin/cymatic-mcp.mjs';
import { generateCity, toJSON } from '../src/cymatic-engine.js';

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
  const lines = [];
  const io = { log: (s) => lines.push(s) };
  assert.equal(run(['-f', '432', '--preset', 'town', '--json'], io), 0);
  const S = JSON.parse(lines[0]);
  const L = generateCity({ frequency: 432, preset: 'town' });
  assert.equal(S.stats.buildings, L.buildings.length);
  assert.equal(S.checks.total, L.checks.length);
  assert.deepEqual(S.checks.notPassing.map((c) => c.id), L.checks.filter((c) => c.status !== 'pass' && c.status !== 'info').map((c) => c.id));
  assert.ok(lines[0].length < 2000, `summary stays small (${lines[0].length} chars)`);
  const out = join(mkdtempSync(join(tmpdir(), 'cli-')), 'city.json');
  run(['export', '-f', '432', '--preset', 'town', '--out', out], io);
  assert.equal(readFileSync(out, 'utf8'), toJSON(L));
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
  const gen = JSON.parse(s.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'generate_city', arguments: { profile: { frequency: 432, preset: 'town' } } } }).result.content[0].text);
  assert.equal(gen.meta.frequency, 432);
  const q = JSON.parse(s.handle({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'query_city', arguments: { from: 'buildings', aggregate: { n: 'count' } } } }).result.content[0].text);
  assert.equal(q.rows[0].n, gen.stats.buildings);
});
