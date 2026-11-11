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

Geometry goes to a file (`export --out city.json|city.obj`) and into the conversation as one line: path and
size. Cost guide for one default city: ~2 s to generate, +1.5 s with `--infra`, +5 s with `--people`; ask for
the extra stages only when the question needs them. The MCP server in `.mcp.json` (`cymatic`) offers the same
through `generate_city`, `query_city`, `ask_city`, `suggest_metro_station`, `search_plans`.

## Finding code

`src/` is ~257 KB and README.md ~52 KB: find with Grep, then read the line range you need.
`grep -n '^## ' README.md` lists its sections; **Module API** and **Data contract** hold signatures and
shapes. The reason behind a rule or constant lives in `docs/research-notes/<topic>.md`; past review findings
in CHANGELOG.md; what is next in ROADMAP.md and `docs/PHASE6-SPEC.md`.

## Invariants — a broken invariant is a bug even when tests pass

- **Determinism.** Same profile → byte-identical `toJSON`. All randomness comes from `mulberry32(seed …)`;
  order never depends on time.
- **Pure, plain data.** Every `src/` stage is JSON in, JSON out, with no DOM, globals or I/O (it runs in a
  Worker). `build.mjs` inlines `src/` into the viewer: a new export the viewer uses goes into its export
  lists, and `src/` stays free of closing script tags.
- **A chord of one is the plain frequency**, byte for byte.
- **Contract changes bump `ENGINE_VERSION`** (src/cymatic-engine.js) and get a CHANGELOG entry.
- **Honest checks.** Every rule reports `{ id, label, value, status: pass|warn|fail|info, basis }`, and
  fantasy (`enforce: false`) still reports what would fail. When a city fails a check, the city changes,
  never the check.
- **Indexing.** `query()` and the agent tools count from 0; the page and `ask()` count from 1.
- **Tunables** (`TRAFFIC LAND WATER SEWER POWER TRANSIT GROWTH`) stay mutable exports so other engines retune
  without forking.

## Tests

Iterate on the one suite that covers the change: `npm run test:<module>`. Measured, one file at a time:
physics, export, cli ~1 s each (`test:fast` runs all three); simulation 22 s, query 23 s, people 32 s,
terrain 51 s, chord 64 s, infrastructure 69 s, city 102 s. Before committing, `npm run test:quiet` once
(failures and one totals line). Report counts and failures, not logs.

A new rule gets a test that goes **red** without it: break the rule, watch the test fail, restore.

## Rhythm

- One task per session; unfinished work ends with a handover (decisions, open questions, next step).
- A roadmap phase ends with an **independent review** in a fresh session that has not seen the
  implementation: read the diff and the spec, mutation-test the new rules, record findings in CHANGELOG.
- Routing: design decisions, numerical or determinism bugs, and the phase review go to the strongest model at
  high effort; implementation against a settled spec, tests and docs to a mid-tier model.
