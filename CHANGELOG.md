# Changelog

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
