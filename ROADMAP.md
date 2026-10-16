# Roadmap

Where the Cymatic City Engine goes from a generator (one frequency in, one consistent city out) to a living model that runs, responds, fails and answers questions — and how it stays a clean part for a larger master engine.

Each phase lists what ships, what proves it, and the seam it opens for other engines. Phases are ordered by leverage; later phases build on earlier ones. Status: ✅ shipped · 🔨 in progress · ⏳ planned.

| # | Phase | Status |
|---|---|---|
| 0 | Generator: physics → plan → buildings → structure → underground | ✅ 1.0.0 |
| 1 | Time axis, flow model, failure analysis | ✅ 1.1.0 |
| 2 | Terrain and water | ✅ 1.2.0 |
| 3 | People, traffic, land value | ⏳ |
| 4 | Multi-frequency chords | ⏳ |
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

## Phase 3 — People, traffic, land value

A synthetic population with homes and jobs; commute assignment on the street graph (sampled origins, all-or-nothing then iterative); street widths justified by flow rather than preset; metro ridership earned from the assignment; land value rising with amplitude and access; density feeding back into zoning so it emerges rather than being assigned.

Proof: trip conservation; congestion only on streets that carry flow; land value monotone in access; the emergent FAR distribution stays within the planning checks.

## Phase 4 — Multi-frequency chords

Drive the plate with two or three frequencies. Interference gives an old city on one mode overlaid by a later expansion on another, or a megastructure whose shell and interior follow different harmonics. Musical intervals and scales become urban form. Ties to the time axis: each voice of the chord can be a growth era.

Proof: the single-frequency case is reproduced exactly as a chord of one; nodal sets of a chord match the analytic superposition; every 1.0 invariant holds.

## Phase 5 — Query layer and the inverse problem

Structured and natural-language questions over a layout and its simulation ("which districts lose water if tank 3 fails?", "where would a fourth line pay off?"), and the inverse problem: search the frequency space (and Q, drive point, plate) for a plan that meets constraints ("12 spokes, a central plaza, under 30 lift stations"). Exposes the engine as a tool for agents.

Proof: query answers equal direct computation; the inverse search returns only candidates that satisfy the constraints and is deterministic for a given seed.

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
