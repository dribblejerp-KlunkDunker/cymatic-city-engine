# Roadmap

Where the Cymatic City Engine goes from a generator (one frequency in, one consistent city out) to a living model that runs, responds, fails and answers questions — and how it stays a clean part for a larger master engine.

Each phase lists what ships, what proves it, and the seam it opens for other engines. Phases are ordered by leverage; later phases build on earlier ones. Status: ✅ shipped · 🔨 in progress · ⏳ planned.

| # | Phase | Status |
|---|---|---|
| 0 | Generator: physics → plan → buildings → structure → underground | ✅ 1.0.0 |
| 1 | Time axis, flow model, failure analysis | ✅ 1.1.0 |
| 2 | Terrain and water | ✅ 1.2.0 |
| 3 | People, traffic, land value | ✅ 1.3.0 |
| 4 | Multi-frequency chords | ✅ 1.4.0 |
| 5 | Query layer and the inverse problem | ⏳ |
| 6 | Export and headless CLI | ⏳ |
| 7 | Fantasy as mechanics | ⏳ |
| 8 | Master-engine integration | ⏳ (seams kept open throughout) |

---

## Phase 1 — Time axis, flow, failure (1.1)

**Time axis.** `simulate(layout, { years, keyframes })` turns the static plan into a growth history. The founding nucleus is the strongest antinode nearest the drive point; growth spreads outward along the street graph with higher-amplitude lobes settling first. Every building gets a build year; buildings age on a Weibull lifetime by type and are replaced, denser where amplitude is high. Each keyframe is a complete city (buildings existing at that year, networks rebuilt for them) with its own stats and checks.

**Flow.** `flows(layout, infra, hour)` runs the networks under load for an hour of the day:
- hourly demand profiles for water, wastewater, residential and commercial power, and rail boardings;
- water: Hazen-Williams head loss along the distribution forest from each tank, pressure at every node, low-pressure flags (below 140 kPa residual);
- power: three-phase voltage drop along feeders with cable R/X by class, loading per cable and substation, under-voltage flags (below 95 %);
- sewers: Manning partial-flow depth ratio per pipe, surcharge flags;
- metro: gravity-model trip distribution between station catchments, link loads on the tunnel tree against line capacity, crowding flags.

**Failure analysis.** `impact(layout, infra, asset)` removes any asset (tank, plant, substation, feeder, trunk main, tunnel, station) and reports the buildings and people cut off or degraded, with alternate paths where loops exist. An N-1 resilience score per network: the worst single failure's share of demand lost.

**Viewer.** A year slider over the keyframes; an hour slider that recolours every network by utilisation and animates flow direction; a Fail button on every inspected asset with the impact shown in red on the model and in numbers in the panel.

**Proof.** Tests: growth is monotone and deterministic; keyframes keep every invariant of 1.0 (clearance, overlap, structure, utilities); hydraulic and electrical formulas against hand-worked cases; conservation of flow; the profiles' means; impact sets are supersets of the removed asset's direct customers; resilience scores in [0, 1]. Independent review before merge.

**Seam.** Keyframes are plain layouts, so anything that consumes a layout consumes a year of history. Hourly results are arrays indexed by the graph's node and edge ids.

## Phase 2 — Terrain and water (1.2)

**Shipped.** `terrain: 'relief' | 'valleys' | { mode, relief, waterLevel, canals, heightmap }`. The signed wave (relief) or its amplitude (valleys) becomes the ground; basins flood into lakes or the sand lines into canals; a heightmap from another engine plugs in as a grid. Automatic relief keeps the ground under a 9 % slope; shore streets are embanked to the freeboard and water is crossed by bridges on piers. Sewers run on true inverts with plants on the low ground; tanks climb to the top of their zones, zones split by static head, pressure-reducing valves cap the basins with set points that keep the runs below them served; the flow model uses elevation heads. Arcologies span their basins and are terraced from the ground.

**Proof (shipped):** sewer inverts fall on the heightfield (every gravity run, checked); static head within 20–56 m at every customer with valves exercised on 40 m of relief; buildings exactly on the ground and never within the freeboard; bridges only where streets cross water; the reported grade matches a recompute; arcology faces to open ground within the limit by brute force; flat mode byte-identical to 1.1.

**Not done (honest gaps):** rivers that flow to the perimeter (water is a level, not a drainage solution); retaining walls, cut-and-fill and approach ramps; metro depth is below the local ground rather than a level alignment; explicit relief far beyond automatic leaves pressure zones the zoning loop cannot finish (checks fail and say so).

## Phase 3 — People, traffic, land value (1.3)

**Shipped.** `people(layout, infra)`: residents and jobs per street node; sampled origins carrying their cells; gravity destination choice on street distance; walk by distance, metro vs. car by door-to-door time; peak-hour cars assigned with BPR delay and averaged over passes; Hansen accessibility and a land-value index per lot; the zoning the market would produce reported against the wave's; street widths judged by the flow they carry; metro ridership earned and carried by `flows()`.

**Proof (shipped):** trips conserved; vehicle-kilometres equal car trips times their paths; flow only on shortest-path trees; BPR and capacity by hand; congestion raises times and moves people to the metro; averaging verified against a last-pass-only mutant; land value monotone in its inputs and rank-correlated with access (ρ ≈ 0.93–0.99); zoning as value bands; determinism.

**Not done (honest gaps):** non-commute trips; signal and turning delay; parking supply; value feedback on growth (densification is still amplitude-led); route choice between equal paths; the emergent zoning is reported, not built.

## Phase 4 — Multi-frequency chords (1.4)

**Shipped.** Two or three drive frequencies. Each voice is driven on its own; the composite amplitude is the plate's time-averaged motion and the signed field the clipped in-phase snapshot. Each voice lays its own streets as an era in the territory it shapes (budget by share of the plate, perimeter from the first voice), lots belong to the voice that moves the plate most under them, and growth settles the voices in order. Intervals one click away in the page; the tone plays the chord.

**Proof (shipped):** a chord of one is byte-identical to the plain frequency; the composite equals the superposition of the single-voice previews point by point on every plate; each voice's boulevards lie on its own nodal set and its streets in its own territory; a faint voice converges to the single-voice city; brute-force clearance and overlap hold on chord cities; lot eras recomputed from the voices; era-0 lots all precede era-1 lots in the history; keyframe networks never fail their checks.

**Not done (honest gaps):** a megastructure whose shell and interior follow different harmonics (voices share one lot grid); scales beyond three voices; a literal two-tone sand figure (the intersections of the nodal sets) is not offered as a plan, by design — see `docs/research-notes/chords.md`.

## Phase 5 — Query layer and the inverse problem (1.5)

**Shipped.** Structured queries over every collection of a city (buildings, streets, districts, tanks, substations, stations, lift stations, treatment, pipes) with filters, failure scenarios, grouping, aggregates and ordering; models built only when a query needs them. A plain-English template front end that shows the query it understood. Station suggestions by greedy maximal covering. The inverse problem: constraints on physics, plan, network and commute metrics; a physics scan over hundreds of frequencies with one candidate per mode; staged builds within a budget; refinement of the closest misses; distinct patterns first and near-misses when nothing fits. Five agent tools with JSON schemas. In the page: Ask the city (answers painted on the model) and Find a frequency (constraint rows, progress, Load).

**Proof (shipped):** query answers equal direct computation from the layout, networks and commute; failure queries equal `impact()`; the English examples map to the queries they should; suggestion gains recomputed; every search candidate regenerated from its profile meets every constraint; the search is deterministic for a seed and stays within its budget; physics-only searches build nothing; agent-tool schemas match the engine's tables. Seventh independent review: two blocking defects (accessibility read as zero, refinement outside the given frequency range) and eight more fixed; every fix mutation-tested (11 of 11 mutants caught, plus the reviewer's 7).

**Not done (honest gaps):** chords are not searched; the English parser covers templates, not paraphrase; no joins or disjunction in queries; suggestions only for metro stations; one candidate per mode can still miss a frequency of the same mode that a plan-level threshold needs (refinement recovers some); near-misses are ranked by the stages they reached; a 16-city search on the full city preset takes about a minute.

## Phase 6 — Export and headless CLI

glTF with instancing (Blender, Unreal, Godot), GeoJSON with a chosen origin for GIS, CityJSON, and `cymatic generate profile.json --year 80 --out city.gltf` so other engines call it without the page.

Proof: exported files validate in their reference validators; round-trip of a profile through the CLI reproduces the viewer's city byte for byte.

## Phase 7 — Fantasy as mechanics

Themes currently rename and recolour. Next: ley lines as a real network with capacity and nodes; per-district physics overrides (gravity, material strength, pressure) as wards; underworld layers below the utilities (catacombs, deeps) with their own access rules; magical power sources as plants with different siting rules. Same engine, different constants and extra layers, all reported honestly by the checks.

Proof: a fantasy profile with Earth constants reproduces the realistic city; every extra layer obeys the clearance and overlap rules of the layers above it.

## Phase 8 — Master-engine integration

Kept open from the start rather than done at the end:

- **Pure functions, plain data.** Every stage is JSON in, JSON out, deterministic from a profile. No DOM, no globals, worker-safe.
- **Stable contracts.** `layout`, `infra`, `keyframes[]`, `flows`, `impact` are documented shapes (README → Data contract); changes bump `meta.engine`.
- **Pluggable fields.** Terrain, climate or magic fields from other engines enter as scalar fields with gradients.
- **Shared graph.** `infra.graph` is an ordinary weighted graph other engines can route agents, trade or traffic over.
- **Profiles as identity.** Other engines reference a settlement by profile (plus year) and regenerate on demand instead of storing geometry.
- **Events out.** The simulation emits a plain event log (built, replaced, lift station added, substation split, failure impact) that a narrative or RPG engine can consume.

When the other engines are known, this phase adds adapters in both directions and a shared profile schema.
