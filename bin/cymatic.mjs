#!/usr/bin/env node
// Headless command line for the Cymatic City Engine.
//
// Built for agents and scripts as much as people: every command prints a short summary by default
// (headline numbers and only the checks that did not pass), never the geometry. A profile is the identity of a
// city, so pass the profile around and regenerate instead of passing layouts.
//
//   cymatic summary  -f 432                         headline stats + checks that did not pass (the default command)
//   cymatic summary  profile.json --infra --people  add network and commute summaries
//   cymatic checks   '{"frequency":432,"plate":"square"}'
//   cymatic metrics  -f 432 population metroShare meanCommuteMin
//   cymatic query    -f 432 --q '{"from":"districts","orderBy":[{"field":"residents","dir":"desc"}],"limit":3}'
//   cymatic ask      -f 432 "which districts lose water if tower 1 fails"
//   cymatic export   -f 432 --out city.json [--infra]   (or city.obj)
//   cymatic tools                                    the agent tools and their sizes
//
// A profile is a JSON string, a path to a .json file, or shorthand flags (-f/--frequency, --chord 432,540,
// --plate, --preset, --seed, --Q, --terrain, --gravity, --material, --fantasy). Flags override the JSON.
// --json prints machine-readable output instead of text. Exit code 1 on error, 2 when a check fails and --strict.
import { readFileSync, writeFileSync } from 'node:fs';
import { generateCity, toJSON, toOBJ, ENGINE_VERSION } from '../src/cymatic-engine.js';
import { cityOf, query, ask, metricsOf, agentTools, METRICS } from '../src/query.js';

const COMMANDS = ['summary', 'checks', 'metrics', 'query', 'ask', 'export', 'tools', 'help'];

export function parseArgs(argv) {
  const out = { command: 'summary', profile: {}, positional: [], flags: {} };
  const args = [...argv];
  if (args.length && COMMANDS.includes(args[0])) out.command = args.shift();
  const num = (v, name) => { const x = Number(v); if (!Number.isFinite(x)) throw new Error(`--${name} needs a number, got "${v}"`); return x; };
  const shorthand = {};
  while (args.length) {
    const a = args.shift();
    const val = () => { if (!args.length) throw new Error(`${a} needs a value`); return args.shift(); };
    switch (a) {
      case '-f': case '--frequency': shorthand.frequency = num(val(), 'frequency'); break;
      case '--chord': shorthand.chord = val().split(',').map((s) => { const [hz, w] = s.split(':'); return w === undefined ? num(hz, 'chord') : { hz: num(hz, 'chord'), weight: num(w, 'chord') }; }); break;
      case '--plate': shorthand.plate = val(); break;
      case '--preset': shorthand.preset = val(); break;
      case '--seed': shorthand.seed = num(val(), 'seed'); break;
      case '--Q': case '-Q': shorthand.Q = num(val(), 'Q'); break;
      case '--gravity': shorthand.gravity = num(val(), 'gravity'); break;
      case '--material': shorthand.material = val(); break;
      case '--terrain': shorthand.terrain = val(); break;
      case '--fantasy': shorthand.enforce = false; break;
      case '--q': out.flags.q = val(); break;
      case '--out': case '-o': out.flags.out = val(); break;
      case '--infra': out.flags.infra = true; break;
      case '--people': out.flags.people = true; break;
      case '--json': out.flags.json = true; break;
      case '--strict': out.flags.strict = true; break;
      case '--all': out.flags.all = true; break;
      case '-h': case '--help': out.command = 'help'; break;
      default:
        if (a.startsWith('-') && !/^-\d/.test(a)) throw new Error(`Unknown option ${a} (cymatic help)`);
        out.positional.push(a);
    }
  }
  // the first positional is a profile when it looks like one (JSON or a .json file)
  const first = out.positional[0];
  if (first !== undefined && (first.trim().startsWith('{') || /\.json$/i.test(first))) {
    out.positional.shift();
    const text = first.trim().startsWith('{') ? first : readFileSync(first, 'utf8');
    let p;
    try { p = JSON.parse(text); } catch (e) { throw new Error(`Profile is not valid JSON: ${e.message}`); }
    // a saved profile may wrap the input as { input, engine, theme }
    out.profile = p && typeof p === 'object' && p.input && typeof p.input === 'object' ? { ...p.input } : { ...p };
  }
  Object.assign(out.profile, shorthand);
  if (out.profile.frequency === undefined && out.profile.chord === undefined) out.profile.frequency = 432;
  return out;
}

const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : x);
const fmt = (x) => (typeof x === 'number' ? (Math.abs(x) >= 1000 ? Math.round(x).toLocaleString('en-US') : String(r1(x))) : String(x));
const notPassing = (checks) => checks.filter((c) => c.status !== 'pass' && c.status !== 'info');

export function summarize(city, flags = {}) {
  const L = city.layout, m = L.meta, s = L.stats;
  const out = {
    engine: ENGINE_VERSION,
    input: m.chord && m.chord.length > 1 ? { chord: m.chord.map((v) => v.hz) } : { frequency: m.frequency, note: m.note },
    plate: m.plate, preset: m.preset, seed: m.seed, dominant: m.dominant ?? null,
    stats: { buildings: s.buildings, population: s.population, jobs: s.jobs, districts: s.districts, tallestM: s.maxHeight, streetKm: r1(s.roadLengthKm), densityPerHa: r1(s.densityPerHa), greenPct: r1((s.greenShare ?? 0) * 100) },
    checks: { total: L.checks.length, notPassing: (flags.all ? L.checks : notPassing(L.checks)).map(({ id, status, value }) => ({ id, status, value })) },
  };
  if (flags.infra || flags.people) {
    const I = city.infra.stats;
    out.infra = { liftStations: I.liftStations, substations: I.substations, metroStations: I.stations, waterTanks: I.towers, excavationMm3: r1(I.excavationM3 / 1e6) };
    const ic = city.infra.checks ?? [];
    out.infra.checks = { total: ic.length, notPassing: (flags.all ? ic : notPassing(ic)).map(({ id, status, value }) => ({ id, status, value })) };
  }
  if (flags.people) {
    const P = city.people.stats;
    out.people = { meanCommuteMin: r1(P.meanTripMin), modeShare: Object.fromEntries(Object.entries(P.modeShare ?? {}).map(([k, v]) => [k, Math.round(v * 1000) / 1000])), congestedKm: r1(P.congestedKm) };
  }
  return out;
}

function summaryText(S) {
  const lines = [];
  const what = S.input.chord ? `chord ${S.input.chord.join(' + ')} Hz` : `${S.input.frequency} Hz (${S.input.note})`;
  lines.push(`${what} · ${S.plate} · ${S.preset} · seed ${S.seed} · engine ${S.engine}`);
  lines.push(Object.entries(S.stats).map(([k, v]) => `${k} ${fmt(v)}`).join(' · '));
  const checkLine = (label, c) => {
    if (!c.notPassing.length) return `${label}: all ${c.total} pass`;
    return `${label}: ${c.notPassing.length}/${c.total} not passing\n` + c.notPassing.map((x) => `  ${x.status.padEnd(4)} ${x.id} = ${x.value}`).join('\n');
  };
  lines.push(checkLine('checks', S.checks));
  if (S.infra) {
    const { checks, ...rest } = S.infra;
    lines.push('infra ' + Object.entries(rest).map(([k, v]) => `${k} ${fmt(v)}`).join(' · '));
    lines.push(checkLine('infra checks', checks));
  }
  if (S.people) lines.push(`people meanCommuteMin ${fmt(S.people.meanCommuteMin)} · congestedKm ${fmt(S.people.congestedKm)} · modes ${Object.entries(S.people.modeShare).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(' ')}`);
  return lines.join('\n');
}

const HELP = `cymatic <command> [profile] [options]   (Cymatic City Engine ${ENGINE_VERSION})

commands
  summary   headline stats and checks that did not pass (default)   --infra --people --all
  checks    every check with its value and basis
  metrics   named metrics: ${Object.keys(METRICS).join(', ')}
  query     structured query: --q '<json>'   (see src/query.js FIELDS)
  ask       plain-English question (template parser)
  export    --out file.json | file.obj   [--infra]
  tools     agent tool names, descriptions and schema sizes

profile     JSON string or file.json, or -f/--frequency, --chord 432,540[:w], --plate circle|square|sphere,
            --preset town|city|megastructure|alien, --seed, --Q, --gravity, --material, --terrain flat|relief|valleys, --fantasy
output      text by default; --json for machine-readable; --strict exits 2 when any check fails`;

export function run(argv, io = { log: (s) => process.stdout.write(s + '\n') }) {
  const a = parseArgs(argv), json = !!a.flags.json;
  const print = (obj, text) => io.log(json ? JSON.stringify(obj) : text ?? JSON.stringify(obj, null, 2));
  switch (a.command) {
    case 'help': io.log(HELP); return 0;
    case 'tools': {
      const tools = agentTools().map(({ name, description, input_schema }) => ({ name, description, schemaBytes: JSON.stringify(input_schema).length }));
      print(tools, tools.map((t) => `${t.name} (${t.schemaBytes} B schema)\n  ${t.description.slice(0, 160)}${t.description.length > 160 ? '…' : ''}`).join('\n'));
      return 0;
    }
    case 'metrics': {
      const names = a.positional.length ? a.positional : ['population', 'jobs', 'failingChecks'];
      const r = metricsOf(a.profile, names);
      print(r, Object.entries(r).map(([k, v]) => `${k} ${fmt(v)}`).join('\n'));
      return 0;
    }
  }
  if (a.positional.length && a.command !== 'ask') throw new Error(`Unexpected argument "${a.positional[0]}" (cymatic help)`);
  const city = cityOf(generateCity(a.profile));
  const failing = city.layout.checks.some((c) => c.status === 'fail');
  switch (a.command) {
    case 'summary': {
      const S = summarize(city, a.flags);
      print(S, summaryText(S));
      break;
    }
    case 'checks': {
      const rows = city.layout.checks.map(({ id, label, value, status, basis }) => ({ id, status, value, label, basis }));
      print(rows, rows.map((c) => `${c.status.padEnd(4)} ${c.id} = ${c.value}  (${c.basis})`).join('\n'));
      break;
    }
    case 'query': {
      if (!a.flags.q) throw new Error('query needs --q \'{"from": "...", ...}\'');
      let q; try { q = JSON.parse(a.flags.q); } catch (e) { throw new Error(`--q is not valid JSON: ${e.message}`); }
      const r = query(city, q);
      const out = { count: r.count, total: r.total, rows: r.rows.slice(0, 200), failure: r.failure ?? null };
      print(out, `${r.count} of ${r.total} match; showing ${out.rows.length}\n` + out.rows.map((row) => JSON.stringify(row)).join('\n'));
      break;
    }
    case 'ask': {
      const question = a.positional.join(' ');
      if (!question) throw new Error('ask needs a question');
      const r = ask(city, question);
      const out = { answer: r.answer, understood: r.understood, rows: (r.rows ?? []).slice(0, 50) };
      print(out, `${r.answer}\n(understood as ${JSON.stringify(r.understood)})`);
      break;
    }
    case 'export': {
      const file = a.flags.out;
      if (!file) throw new Error('export needs --out file.json or file.obj');
      if (a.flags.infra) void city.infra; // attaches layout.infra and its OBJ writer
      const body = /\.obj$/i.test(file) ? toOBJ(city.layout) : toJSON(city.layout);
      writeFileSync(file, body);
      print({ wrote: file, bytes: body.length }, `wrote ${file} (${fmt(body.length)} bytes)`);
      break;
    }
  }
  return a.flags.strict && failing ? 2 : 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/cymatic.mjs') || process.argv[1]?.endsWith('/cymatic')) {
  try { process.exitCode = run(process.argv.slice(2)); }
  catch (e) { process.stderr.write(`cymatic: ${e.message}\n`); process.exitCode = 1; }
}
