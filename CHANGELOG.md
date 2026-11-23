# Changelog

## 1.7.1 — Phase 7b: ley (2026-11-23)

Stage 7b adds `magic.ley` (`docs/PHASE7-SPEC.md` decisions 8–13). New module `src/ley.js`. A profile without
`magic.ley` gives the bytes it gave before (checked on six profiles apart from the version, and by the golden hashes).

- **Nexuses** (in `generateCity`, from the field alone): local maxima of |S| on the engine's sample grid at
  `nexusStrength` (0.5) of the plate's strongest or more, one quadratic fit per axis, positions to 1 cm, ordered by
  strength then position. Each gives `flux` × ∫S² dA over its nearest-nexus cell (trapezoid weights at the grid's
  edge, sin θ on a sphere, normalised to the plate's exact area). They ride in `meta.magic.ley`, so year frames and
  JSON round trips keep them. `field: { width, height, data }` replaces S² with a foreign grid.
- **Lines, taps, balance** (in the network stage, `buildLey`): the Gabriel graph of the nexuses (closed disc, so a
  square of nexuses keeps its sides, not crossing diagonals), capacity `lineFactor` × the weaker end. Each
  substation taps its nearest nexus; deficits, largest first, draw from the nearest surplus along lines with room
  left. What cannot be delivered is `undeliveredMW`; the plant is built for it × 1.25 (to 50 MW), none when it is
  zero, and no intertie once the ley feeds anything. The tap nodes join the plant as transmission sources.
  `flux: 0` gives the realistic `infra.power` byte for byte.
- **Out:** `infra.ley { flux, nexuses[{ pos, sign, strength, outputMW, demandMW, node }], lines[{ a, b, length,
  capacityMW, loadMW, flowMW }], taps[{ nexus, substation, node, MW }], supplyMW, demandMW, deliveredMW,
  undeliveredMW, plantMW, n1 }`, `infra.stats.ley`. Checks `ley-supply` (warn below 1, never fail), `ley-line-load`
  (fail above 1), `ley-n1` (strongest nexus or busiest line lost; warn above 20 %). `impact({ kind: 'plant' })`
  counts what the ley still delivers.
- **Measured** (supply ÷ peak demand): town 432 Hz 5.08× (no plant), default city 1.39× (no plant; 36 nexuses, 47
  lines, busiest line at 90 %), 300 Hz 1.45× (12 nexuses), megastructure 0.16× (a 1,300 MW core reactor for 1,010 MW
  undelivered, instead of 1,550 MW), alien 6.30×, chord 432 + 540 1.35× (65 nexuses, 110 lines, 18 MW undelivered
  behind full lines: a 50 MW plant), square 540 Hz 2.32×, sphere 432 Hz 1.82×.
- **Spec differences, measured.** The default city has 47 Gabriel lines, not the prototype's 49: the open and closed
  disc rules agree on 47, so the difference is the refined positions. The chord city has 65 nexuses, not 60; a 600 ×
  600 grid finds 74, and the count does not settle with resolution (220: 65, 330: 64, 440: 73, 660: 75) while supply
  moves 0.1 %. The misses are peaks sampled just under the cut or pairs closer than three grid cells. Kept the
  spec's grid-defined rule (decision 9); single-frequency cities miss nothing at any resolution.
- **Codex review on PR #5, both verified and fixed.** (1) A plant on the same street node as a ley tap took the tap
  down with it in `impact({ kind: 'plant' })`, and any single-plant city with the ley on was reported "the whole city
  goes dark" (the megastructure: 1 substation and 1,009 MW are really lost). The tap now keeps its node live, and the
  ley counts as a source in the wording. (2) A dense foreign field could give thousands of nexuses (9,387 from a
  220 × 220 checkerboard: 112 s to build the networks); `LEY.maxNexuses` (1,000) keeps the strongest, the cells
  re-tile the plate so supply is unchanged, and `meta.magic.ley.found` records how many there were (0.2 s).
  Also "1 substation loses its only source" (was "lose their").
- **Page.** `test/page.test.mjs` gains a warded town, a ley square and a ley sphere (Chromium = Node). `src/ley.js`
  is bundled in its own scope after the math; `test/bundle.test.mjs` checks its export list.
- Tests: `test/ley.test.mjs`, 9 tests (`npm run test:ley`, about 40 s). Mutation pass: 22 mutants, 21 killed (two of them
  by timeout: without the tie-break or the neighbour test thousands of grid points become nexuses and the Gabriel
  step, cubic in their number, does not finish). The survivor makes `ley-line-load` never fail; the balance respects
  capacity by construction, so no input reaches that branch: the check is a guard, recorded as unreachable.

## 1.7.0 — Phase 7a: wards (2026-11-22)

Phase 7 is fantasy as mechanics (`docs/PHASE7-SPEC.md`). Stage 7a adds one profile key, `magic.wards`. The engine is
1.7.0 from this stage on (sleeves' call, 2026-11-22; the spec had held the bump for 7e); later Phase 7 stages that
change the contract bump the patch number, so the minor number keeps naming the phase. A profile without `magic`
gives the 1.6.0 bytes apart from the version string: checked on six profiles (city, town and alien on hills, megastructure, chord, low-gravity
megastructure on hills) for the city, its networks, `flows()` and a year of growth, and by the golden hashes.

- **Wards.** `{ where, gravity, strength, pressure, height }`, multipliers on the world's gravity, the material's σ,
  the water head rules and the heights the pattern asks for. `where`: `"all"`, `{ district }`, `{ at }`, `{ polarity }`.
  Neutral wards resolve to nothing. Refused by name: a district in two wards, `"all"` beside another ward, effective
  gravity outside 0.05–5 g, a point off the plate or in no district, a district the city does not have, an unknown
  `where` or key. `magic.ley` and `magic.underworld` are refused as not built yet (stages 7b–7d), unless off;
  `underworld: {}` and an underworld with every layer off are off (decision 2; Codex review on PR #4).
- **Structure.** Inside a ward the limits are the world's formulas at the ward's values: `heightLimit(material, g·k_g)·k_σ`,
  `slendernessLimit(base, g·k_g)`, and the terrace step (a terrace rises by its own ward's step above any neighbour).
  `height` multiplies the requested height before any limit, in `generateCity` and in growth. `stats.heightLimit` and
  `slendernessLimit` stay the world's. The `self-weight`, `slenderness` and `terrace` checks judge each building by
  its own limit and report the one nearest (or furthest past) it.
- **Report.** `building.ward`, `layout.wards[]` (districts, multipliers, limits, buildings, residents, `dependent`:
  the buildings that break the world's own limits), `meta.magic.wards`, `stats.wards`, the `ward-dependence` info
  check, and `impact(layout, infra, { kind: 'ward', index })`. Year frames recompute the report for what stands.
- **Networks.** A street node takes the ward holding most of the floor area it serves (decision 6). Sewers take their
  minimum slope and capacity from gravity at the pipe's upstream node; tanks their height from the tank's node; head
  limits and pressures are per node; `flows()` likewise. `wardGravity(meta)` gives `gAt` and `headGAt`. Where a ward
  covers part of the plan, the water builder sizes and splits zones by the customers they serve (as on terrain),
  each starved zone gets a tank at its neediest customer per round, and a ward too light for any tank is pumped, as
  the world would be; `pressure-zones` then judges every node by its own ward in kPa.
- **CLI and tools.** The summary gains a `wards` line when a ward resolves: count, buildings, residents, dependent.
  `query()` and the `query_city` tool take `fail: { kind: 'ward', index }`; the tool's schema lists it (Codex review on PR #4).
- Measured (the spec's 7a table): megastructure, `"all"`, gravity 0.5: tallest 780 m (600 without), field for field the
  half-gravity world; city: 134 lift stations (26) and 70 m tanks (35). Height 4 on the largest district (2,202
  buildings): every building within the world's limits, none dependent; with gravity 0.5, 211 dependent (38,459
  residents), tallest 272 m. Megastructure at 4 g with a strength-3 ward over everything: 324 dependent.
- **Page bundle.** `wardGravity` is in the networks scope's export list, so `flows()` runs on the page (it threw
  "wardGravity is not defined": every Node test passed, and the page test never calls `flows()`). New
  `test/bundle.test.mjs` (in `test:fast`): every name a module imports from a scoped module is in that scope's list,
  and the built page code runs generate, networks, flows, a ward impact and a year on a warded town. Both go red
  without the fix.
- Tests: `test/wards.test.mjs`, 11 tests (`npm run test:wards`, about 55 s). Mutation pass: 22 mutants, 21 killed. The
  survivor lets a node's exact floor-area tie go to the ward instead of to no ward; no stock city has such a tie
  (0 of 51 mixed nodes in the default city, 0 of 34 in the town).

## 1.6.0 — 2026-11-22

Phase 6: exchange formats and time. Spec, decisions and what was built differently: `docs/PHASE6-SPEC.md`.

### Independent review (2026-11-19) and its fixes (2026-11-22)

A fresh session reviewed the phase and failed it on one blocking finding: **the page and the command line did not produce the same bytes.** Node's V8 and Chromium's V8 return different last bits for `Math.sin`, `exp`, `pow`, `atan2` and the rest (atan2 on 43 % of inputs), and one bit is enough to change a water-main layout or a feeder's size. Everything below answers that review; its full text is the Project note "Phase 6 independent review".

- **B1, fixed: `src/detmath.js`.** sin, cos, atan, atan2, asin, acos, exp, log, log2, pow and hypot built only from operations whose bits the language guarantees (+ − × ÷, sqrt, exact scaling by powers of two), after the classic fdlibm algorithms. Each is within one ulp of the platform's. Every stage in `src/` calls `DM.*`; a test scans `src/` and fails on any platform call. `test/page.test.mjs` runs the same modules in Chromium and in Node and compares more than fifty outputs from the math up, then saves a city and a year of growth from the built page and requires `cymatic generate profile.json` to write the same `layout.json`, `city.obj`, `city.glb`, `city.city.json` and `city.geojson` byte for byte. "Same profile, same city" now holds across runtimes, not only inside one.
  - Cost: none that can be measured. Generating the default city takes 0.82 s against 0.76 s; the commuting model is inside run-to-run noise (3.6–5.9 s both before and after).
  - Effect on cities: last-bit changes only. The default city and town keep their building, street and population counts, and all ten answers in `docs/mcp-evaluation.xml` are unchanged. Bytes differ from 1.5.0, so the golden hashes were re-recorded once; they are now the same in every runtime.
- **`meta.horizon`** (the open decision, taken): year frames carry the horizon beside the year, so a saved year names its own city. The exchange files read it from there.
- **S1** A year saved from the page round-trips: the page writes `year` (and the horizon) into `profile.json` while a year of growth is shown, and the CLI builds a profile that carries `year` at that year. Flags still win.
- **S2** The page's `layout.json` no longer has the extra `resilience` key.
- **S3** glTF ground against the mesh, not only the layout: on terrain each building gets a foundation prism down to its foundation depth (group `foundations`), and the default ground grid follows the plate's size (about 10 m cells, at most 384 a side). Tests check both against the exported mesh.
- **S4** GeoJSON leaves out a line whose two ends round to the same position (street-graph edges under a centimetre); the others keep their ids.
- **S5** `cymatic metrics` honours `--year`.
- **S6** `--origin`, `--bearing`, `--paint`, `--no-trees`, `--instanced` and the horizon in the files' identity are each tested through to the written file.
- **S7** A profile of `-` is read from standard input; `--out -` with `--format` writes the file to standard output (binary-safe; the one-line report goes to standard error). `.gltf` is refused there because it is two files.
- **Nits.** Quaternions are written to 1e-9 and translations to 0.1 mm (buildings on the largest sphere were 1.17 mm off; the proof is now 0.2 mm). `--infra` decides whether a year export carries the networks, as it does for the plan. A flag that would change nothing in the chosen format is refused with the format it belongs to. The page's horizon field accepts what the CLI accepts (5 to 1000, fractions allowed). `cityAt` reports a failed frame with the real error.
- Tests: 162 in all (`test/detmath.test.mjs` 4, `test/page.test.mjs` 3, five more in the time and format suites). The page tests need Playwright with a Chromium and skip, saying so, without one.
- Validated by the reviewer on the pre-fix build (formats unchanged since): glTF 58 files with 0 errors and 0 warnings; GeoJSON 77 files (3.2 million features) read by GDAL with matching counts, projection within 7.9 mm of pyproj; CityJSON `cjval 0.10.0` "File is valid" on eleven cities, all 36,281 solids closed.
- Mutation pass on these fixes: 26 mutants, 25 killed. The survivor changes the smallest coefficient of `exp` by one unit in its last place, which is below the rounding of every result (the same change to the largest coefficient is caught by the fingerprint). Two flag mutants were first "caught" only because comparing megabyte byte arrays with `deepEqual` ran the test process out of memory; the format tests now compare bytes directly and fail with the name of the file and the first differing byte.
- Still open: a Godot import and Unreal; the review's N7 (an importer without the instancing extension shows one unit mesh per node) is documented in the README. These fixes have their own mutation pass (below) but not a second independent review.

### As first built (2026-11-11)

- **Time.** `simulate()` is now `schedule()` (when everything is built; all the random draws) plus `frameAt()` (the complete city at one year). Its output is unchanged: hashes of every keyframe, the events and the history, recorded on 1.5.0 before the split for a plain, a chord and a valleys town, still hold. New `cityAt(layout, { year, horizon = 100 })` gives the city at any year, equal to the keyframe there. A year means something only with its horizon (town 432 Hz at year 80: 1,063 buildings under horizon 80, 494 under horizon 100), so `horizon` is a profile key, written by the page only when it is not 100; the page's horizon field now defaults to 100, as `simulate()` always did.
- **`src/export.js`** (pure, no dependencies, deterministic):
  - `toGLB` / `toGLTF`: glTF 2.0. One node per building over a shared unit mesh per shape and colour (seven shapes serve a city), or `EXT_mesh_gpu_instancing` with `instanced`; explicit flat normals; streets as one mesh per kind; trees; the ground from an elevation sampler, clipped to the plate; water; the networks as `LINES` at true depth under the OBJ names; `paint` by zone or era.
  - `toGeoJSON`: RFC 7946, placed on the Earth by an exact tangent-plane projection at a required origin (matches the four pyproj reference points to under 1e-9°); footprints, streets, trees and, with `infra`, every network asset and line. Spheres, polar origins and antimeridian crossings are refused with the reason.
  - `toCityJSON`: CityJSON 2.0 in local metres; buildings as closed, outward-facing `Solid`s with ground, wall and roof surfaces; streets as `TrafficArea`s.
- **CLI.** `generate` (alias `export`) writes `.glb .gltf .geojson .city.json .obj .json` by extension, longest first, or by `--format`; `--year Y [--horizon H]` works with every city command (horizon: flag, then the profile, then 100); `--paint`, `--instanced`, `--no-trees`, `--origin`, `--bearing`. Reported sizes are bytes on disk (they were characters).
- **Page.** Save's zip gains `city.glb` (with ground and networks), `city.city.json` on flat plates, and `city.geojson` when a map origin is typed under the button. Checked in a headless browser: three saves, the GLB inside each zip valid, a bad origin refused with nothing saved.
- `gltf-validator` 2.0.0-dev.3.10 is a pinned devDependency; runtime dependencies stay at zero. `package.json` exposes `./export`.
- Tests: `test/time.test.mjs` (7) and `test/formats.test.mjs` (18); 150 tests in all. Mutation testing of the new rules: 64 of 64 mutants killed (mirrored frames, swapped scales, flipped normals and windings, GLB header fields, unclipped ground, wrong depths, lost instances, flipped north and bearing, wrong ellipsoid, open or clockwise rings, loosened refusals, mirrored CityJSON, swapped ground and roof, unshared vertices, horizon and year bounds, flag precedence).
- Checked outside the test suite:
  - Khronos validator: 0 errors, 0 warnings on eleven files in the tests and on the full city (6,481 buildings, 5.9 MB).
  - CityJSON 2.0.2 official schema (`cityjson.min.schema.json`, Python `jsonschema`): 0 errors for the town (1,066 objects) and the city (6,485 objects).
  - Blender 5.3 (`bpy`) imports the town (1,095 mesh objects over 13 shared meshes), the instanced town (1,180 mesh objects: Blender expands the extension) and the city (7,802 objects); `b0` arrives with its size (w, d, h) and its properties.
  - **Not done:** `cjval` and a Godot import. Building or running downloaded programs was not permitted in the build session. Unreal is unconfirmed.
- This phase was implemented and mutation-tested in one session; the independent review in a fresh session (6e) is still owed.

Earlier in this release (agent tooling):

- Headless CLI `bin/cymatic.mjs`: `summary` (default), `checks`, `metrics`, `query`, `ask`, `export`, `tools`; profile from JSON, a file (saved `{input, …}` profiles too) or flags; text or `--json`; `--strict` exits 2 when a check fails. Summaries list only the checks that did not pass; `export` is byte-identical to `toJSON`/`toOBJ`.
- MCP server `bin/cymatic-mcp.mjs` (stdio, no dependencies) exposing `agentTools()`; registered in `.mcp.json`.
- Test tiers: `test:fast`, `test:<module>`, `test:quiet` with a failures-only reporter (`test/quiet-reporter.mjs`). New `test/cli.test.mjs`.
- `CLAUDE.md` (agent guide) and `docs/PHASE6-SPEC.md`. Measured for the spec: a city's state at year Y depends on the simulation horizon (growth completes the plan by the horizon), so `--year` needs a horizon.
- README: quick start and project layout brought up to date.
- Review of the tooling (eighth review; different model, same session as the implementation), with mutation testing. Found and fixed:
  - **The programs did not start when linked.** Both `bin` entries decided whether to run by the file name in `argv`, so `cymatic-mcp` as npm links it, any other link name, and Windows paths exited silently with code 0. Now `isMain()` compares real paths as file URLs.
  - **The MCP server died on a bare JSON value** (`5`, `"x"`, `null`): now refused with −32600; a stray reply is dropped; an error inside a request returns −32603 and the server lives on.
  - **`export --out city.glb` wrote JSON under that name.** Unknown extensions are refused.
  - **A query with no limit cost ~34 KB** (200 building rows) through the MCP server: it now returns the first 25 rows with a note unless `limit` is set. `search_plans` says in its description that a commute-constrained search at the default budget blocks for about two minutes (measured 125 s on the city preset).
  - `--strict` and `checks` ignored the networks' checks under `--infra`; both include them now.
  - The quiet reporter said only "test failed" when a test file could not load; it now shows the reason from stderr.
  - Mutation testing: 12 of 19 mutants killed by the first tests; `test/cli.test.mjs` grew to 8 tests (programs run as subprocesses and through links, `--strict` exit codes, infra numbers against the engine, row caps, junk input, the reporter itself) and now kills all 33.
- `docs/PHASE6-SPEC.md` is final: 15 decisions with their measurements, four stages (time, glTF, GeoJSON, CityJSON) and a proof table each. Open for a later phase: running `search_plans` off the request thread with progress.

## 1.5.0 — 2026-10-17

- Query layer (`src/query.js`): `cityOf` bundles a layout with lazily built networks and commute; `query()` over buildings, streets, districts, tanks, substations, stations, lift stations, treatment plants and pipes with `where` (`= != > >= < <= in`), `fail: {kind, index}` (answers from `impact()`), `groupBy`, aggregates (`count`, `sum`, `mean`, `min`, `max`), `orderBy`, `limit`, `fields`.
- `ask()`: plain-English questions by template (failures, counts, superlatives, district population, inventory, busiest street, station siting); every answer carries the structured query it understood.
- `suggest(city, 'metro-station')`: greedy maximal-covering station sites at the minimum spacing, with the street length to the nearest station.
- `search()`: the inverse problem. Constraints and an objective over `METRICS` (physics, plan, networks, commute); physics scan with one candidate per dominant mode; staged builds within a budget; refinement of near misses; distinct patterns first; near-misses when nothing fits; deterministic per seed.
- `agentTools()`: `generate_city`, `query_city`, `ask_city`, `suggest_metro_station`, `search_plans` with JSON schemas.
- Viewer: Ask the city (example chips; failures painted on the model, buildings focused, station marker) and Find a frequency (constraint rows, example, budget, progress, Load); both run in the worker.
- `impact()` refuses unknown kinds and out-of-range indices with the count the city has (it used to crash or answer zero); the water plant's summary says "Water treatment plant".
- Tests: 117 (10 for queries); seventh independent review with fixes and mutation testing. Research note `docs/research-notes/queries.md`.

## 1.4.0 — 2026-10-17

- Chords: `chord: [hz | {hz, weight}]` with up to three voices (weights 0.01–1, voices at least 1 % apart). Each voice is driven and normalised on its own; the composite amplitude is the time-averaged motion √Σ(w·A)², the signed field keeps the in-phase sign clipped to that envelope. Each voice lays its own streets as one era in its territory (where its weighted envelope is within 15 % of the strongest), with a budget in proportion to its share of the plate; each stretch of the perimeter belongs to the voice that shapes it; short disconnected fragments are dropped; lots belong to the voice that moves the plate most; growth settles the first voice before the next breaks ground (`eraStarts`), with the old city's routes preferring its own streets and the streets it lays along a later voice's lines credited to it in the keyframes (`follows`). A chord of one is the plain frequency byte for byte.
- Street graph edges keep `era` for chord streets; `toOBJ` names the chord in its header.
- Viewer: interval buttons, voice rows with weights, chord HUD, chord tone, per-voice modes, paint by era (offered only for chords), inspector rows ("Built by", "Follows", "Laid by"); a typed voice within 1 % of another is refused in the page; the ground and plate colours follow the whole chord; profiles carry `chord` with every weight; export names carry the chord.
- Tests: 107 (9 for chords); sixth independent review with fixes and mutation testing. Research note `docs/research-notes/chords.md`.

## 1.3.0 — 2026-10-16

- People: `people(layout, infra)` draws a commuting population from residents and jobs, chooses workplaces by a gravity model on street distance, splits walk / metro / car by door-to-door time, assigns peak-hour cars to the street graph with BPR congestion averaged over passes, and reports flow, v/c, speed and lanes needed per edge.
- Land value: Hansen accessibility per node, a land-value index per building, the zoning the market would produce against the wave's, street widths judged by their flow.
- Metro ridership is earned and handed to `flows()` (`opts.metroTrips`; `opts.modeShare` also accepted).
- Viewer: People section with progress, paint by traffic / land value / market zoning, inspector rows, `people.json` in the export.
- Tests: 98 (9 new); fifth independent review with fixes and mutation testing. Research note `docs/research-notes/people_traffic.md`.

## 1.2.0 — 2026-10-16

- Terrain: `terrain` input with modes `flat` (default, byte-identical to 1.1), `relief` (the wave is the ground, basins flood), `valleys` (lobes are hills, optional canals along the sand lines) and `heightmap` (import a grid; wraps on a sphere). Automatic relief from the nodal spacing, held under a 9 % ground slope; freeboard, embanked shore streets, bridges on piers, arcology terraces cut from the ground.
- Underground on terrain: node elevations; sewers on true inverts with downhill-weighted routing and plants on low ground; tanks climb to their zone's top and size themselves, pressure zones split under 20 m, PRVs with set points that keep the runs below them served, pumped tall tanks, parallel trunk barrels; elevation heads and valve set points in the flow model; new checks `street-grade`, `water`, `pressure-zones`, `sewer-gravity`.
- Viewer: Terrain section (mode, relief, water level, canals, PNG heightmap import), displaced ground with shore and bed colours, water surface, bridge decks and piers, elevation and grade in the inspector, terrain rows in the stats.
- Screenshot gallery in `docs/screenshots/` and the README.
- Tests: 89 (15 new); fourth independent review with fixes and mutation testing.

## 1.1.0 — 2026-10-16

- Time axis: `simulate()` founds the city at the strongest antinode near the drive point, grows it outward on a 3.7 %/yr built-up curve, ages buildings on Weibull lifetimes with densifying rebuilds under the structural limits, and produces keyframes that are complete cities with rebuilt networks, stats and checks.
- Flow model: hourly profiles; Hazen-Williams pressure along water mains; three-phase voltage drop along feeders with 11 kV cable classes; Manning partial-flow sewer fullness; gravity-model metro assignment with AM/PM direction.
- Failure analysis: `impact()` for every asset kind; `resilience()` N-1 per network.
- Power grid: a second injection point (grid intertie), substation-to-substation backup lines routed away from busy trenches, N-1 scored per corridor.
- Viewer: timeline with keyframes and a plan button, hour-of-day flow colouring and tiles, Fail buttons, resilience tiles, worker-side simulation with progress.
- Tests: 74; third independent review with fixes.
- Roadmap: ROADMAP.md.

## 1.0.0 — 2026-10-15

- Physics core: disk membrane, square Chladni plate (corner coordinates), scalar sphere; normalised driven modal response with drive-point coupling and pattern sharpness.
- City layer: nodal boulevards, contour rings, gradient streets, perimeter wall; lot grid with exact road clearance; zoning, districts and landmarks; material, slenderness, lift-core and terrace limits; measured plausibility checks.
- Underground: street graph with junctions, service laterals, gravity sewers with lift stations and force mains, looped water mains with tanks and a treatment plant, power plant / substations / feeders / transmission, metro tunnels below every foundation, utility galleries for arcologies.
- Viewer: Surface / X-ray / Underground, layers, section cut, fly controls, click-to-inspect with Focus, themes, custom settlements, custom materials, realism toggle, profiles, OBJ/JSON/PNG export.
- Tests: 56; two independent review passes with fixes.
