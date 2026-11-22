# Cymatic City Engine — agent guide

A drive frequency (or a chord of up to three) becomes a complete settlement: Chladni-pattern streets,
buildings, underground networks, terrain, growth, commuters, and a query layer. Pure ES modules, no
dependencies; runs in Node 18+, the browser and a Web Worker.

## Profile, not geometry

A **profile** (the `generateCity` input) regenerates its city byte for byte, so it is the only thing worth
passing around. Work with a city through its **summary**: run it and read the answer.

```sh
node bin/cymatic.mjs -f 432                                  # headline stats + checks that did not pass
node bin/cymatic.mjs summary --chord 432,540 --plate square --infra --people
node bin/cymatic.mjs ask -f 432 "which districts lose water if tower 1 fails"
node bin/cymatic.mjs query -f 432 --q '{"from":"streets","orderBy":[{"field":"vc","dir":"desc"}],"limit":5}'
node bin/cymatic.mjs help                                    # every command and flag
```

Geometry goes to a file (`generate --out city.glb|.gltf|.geojson|.city.json|.obj|.json`, with `--year Y
[--horizon H]` for the city at a year of its growth) and into the conversation as one line: path and size. Cost guide for one default city: ~2 s to generate, +1.5 s with `--infra`, +5 s with `--people`; ask for
the extra stages only when the question needs them. The MCP server in `.mcp.json` (`cymatic`) offers the same
through `generate_city`, `query_city`, `ask_city`, `suggest_metro_station`, `search_plans`. Its `query_city`
returns 25 rows unless `limit` is set: aggregate or name `fields` before raising it.

## Finding code

`src/` is ~290 KB and README.md ~60 KB: find with Grep, then read the line range you need.
`grep -n '^## ' README.md` lists its sections; **Module API** and **Data contract** hold signatures and
shapes. The reason behind a rule or constant lives in `docs/research-notes/<topic>.md`; past review findings
in CHANGELOG.md; what is next in ROADMAP.md and `docs/PHASE7-SPEC.md` (Phase 6's spec is
`docs/PHASE6-SPEC.md`; the scripts behind Phase 7's numbers are in `docs/phase7-measurements/`).

## Invariants — a broken invariant is a bug even when tests pass

- **Determinism, across runtimes.** Same profile → byte-identical output in Node and in the browser. All
  randomness comes from `mulberry32(seed …)`; order never depends on time; and `src/` never calls
  `Math.sin cos tan atan atan2 asin acos exp log log2 log10 pow hypot` or `**`: use `DM.*` from
  `src/detmath.js` (`Math.sqrt abs floor round min max` are exact and fine). `test/detmath.test.mjs` scans
  for this; `test/page.test.mjs` compares Chromium with Node.
- **Pure, plain data.** Every `src/` stage is JSON in, JSON out, with no DOM, globals or I/O (it runs in a
  Worker). `build.mjs` inlines `src/` into the viewer: a new export the viewer uses goes into its export
  lists, and `src/` stays free of closing script tags.
- **A chord of one is the plain frequency**, byte for byte.
- **A year needs its horizon.** Growth is paced to finish at the horizon, so `(profile, year)` names a city
  only with `horizon` (profile key, default 100). `simulate()` is `schedule()` + `frameAt()`; the golden
  hashes in `test/time.test.mjs` pin its output, and a deliberate change to growth re-records them. Year
  frames carry `meta.year` and `meta.horizon`; a profile with `year` is built at that year.
- **Exports are deterministic and validated.** `src/export.js` writes the same bytes for the same layout;
  glTF must pass `gltf-validator` (a devDependency: `npm install`) with 0 errors and 0 warnings.
- **Contract changes bump `ENGINE_VERSION`** (src/cymatic-engine.js) and get a CHANGELOG entry.
- **Honest checks.** Every rule reports `{ id, label, value, status: pass|warn|fail|info, basis }`, and
  fantasy (`enforce: false`) still reports what would fail. When a city fails a check, the city changes,
  never the check.
- **Indexing.** `query()` and the agent tools count from 0; the page and `ask()` count from 1.
- **Tunables** (`TRAFFIC LAND WATER SEWER POWER TRANSIT GROWTH`) stay mutable exports so other engines retune
  without forking.

## Tests

Iterate on the one suite that covers the change: `npm run test:<module>`. Measured, one file at a time:
physics, detmath and export ~1 s each, cli ~7 s (`test:fast` runs all four); time 15 s, formats 30 s,
simulation 22 s, query 23 s, people 32 s, terrain 51 s, chord 64 s, infrastructure 69 s, city 102 s, page
240 s (builds the page and drives a Chromium; run it after any change to `src/` math, the viewer or the CLI's
export). Before committing, `npm run test:quiet` once (about ten minutes; failures and one totals line).
Report counts and failures, not logs.

A new rule gets a test that goes **red** without it: break the rule, watch the test fail, restore.

## Rhythm

- One task per session; unfinished work ends with a handover (decisions, open questions, next step).
- A roadmap phase ends with an **independent review** in a fresh session that has not seen the
  implementation: read the diff and the spec, mutation-test the new rules, record findings in CHANGELOG.
- Routing: design decisions, numerical or determinism bugs, and the phase review go to the strongest model at
  high effort; implementation against a settled spec, tests and docs to a mid-tier model.
