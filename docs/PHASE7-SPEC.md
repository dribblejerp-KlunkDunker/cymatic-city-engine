# Phase 7 — Fantasy as mechanics: spec

Status: **final for implementation.** sleeves approved all five calls as recommended on 2026-11-22 (listed at
the end). Written 2026-11-22 against engine 1.6.0. The calls are pictured on the
real 432 Hz city in the artifact "Phase 7 Calls". Every number below was measured
on 1.6.0 with the scripts in `docs/phase7-measurements/` (run any of them with `node`).

ROADMAP brief: ley lines as a real network with capacity and nodes; per-district physics overrides as wards;
underworld layers below the utilities with their own access rules; magical power sources with different siting
rules. Same engine, different constants and extra layers, all reported honestly by the checks. Proof: a fantasy
profile with Earth constants reproduces the realistic city; every extra layer obeys the clearance and overlap
rules of the layers above it.

## The shape of it

One new profile key, `magic`, with three independent parts. A profile without it runs none of the new code and
gives the 1.6.0 bytes.

```json
{ "frequency": 432,
  "magic": {
    "wards": [ { "where": { "polarity": 1 }, "gravity": 0.5 },
               { "where": { "at": [120, -340] }, "strength": 3, "pressure": 0.5 } ],
    "ley": true,
    "underworld": { "catacombs": true, "deeps": true } } }
```

| Part | What it is | What it changes |
|---|---|---|
| **Wards** | Per-district multipliers on gravity, material strength and water pressure | Building limits, sewer slopes, water towers and head, and a new report: what stands only while a ward holds |
| **Ley** | The plate's own vibration energy as a field; nexuses at its antinodes; straight lines between them with capacity | Where the city's power comes from: nexuses inside the plan instead of a station at its edge, with a plant only for the shortfall |
| **Underworld** | Catacombs between the utilities and the metro; deeps below everything, laid out on the pattern of the octave below | Two new layers with entrances and shafts, and one general clearance check over every layer |

## What was measured

| Question | Finding |
|---|---|
| Do the stock presets ever hit the material limit? | No. Height limits are 170 m (town) to 3,578 m (alien) against tallest buildings of 21 to 600 m; the material rule binds on 0 buildings in every preset. Slenderness binds on 1,643 megastructure buildings and on 0 to 2 elsewhere. With realism off, 0 to 5 buildings exceed any limit. |
| So what does gravity change? | **Megastructure:** half gravity raises the tallest building from 600 m to 780 m and the population from 442,448 to 486,924; double gravity lowers them to 480 m and 394,443 and the material rule binds on 254. **City:** the skyline barely moves, but half gravity needs 134 sewage lift stations instead of 26 and 70 m water tanks instead of 35 m; double gravity needs 1 lift station and 18 m tanks. |
| Where are the field's antinodes? | 432 Hz has 84 at a tenth of the peak or more (14 districts: a district is a sign region and holds several). At half strength or more: 36 at 432 Hz, 12 at 300 Hz, 38 at 648 Hz, 33 on the 540 Hz square, 60 for the chord 432 + 540. Landmarks cannot stand in for them: the megastructure has none. |
| How much energy is there? | Mean S² over the plate is 0.045 to 0.066. Peak electrical demand is 5 W/m² (alien), 6 (town), 20 to 28 (cities), 196 (megastructure). |
| What does a flux of 600 W/m² at unit S² buy? | Ley supply over peak demand: town 5.1×, alien 6.3×, 540 Hz square 2.3×, cities 1.34× to 1.45×, megastructure 0.16×. |
| How many lines, and how loaded? | Gabriel graph of the nexuses: 13 to 105 lines (49 for the default city). Moving surplus to deficit along it loads the busiest line to 0.35 to 0.75 of its weaker end's output in the town, alien, square and 300 Hz cities, 1.97 in the default city, 2.62 at 648 Hz and 6.31 in the chord city. |
| How big do catacombs get? | Galleries under every street within reach of a seed, default city (565 km of streets, 13 km of metro): around the 36 nexuses, 20 km at 100 m, **44 km at 150 m**, 78 km at 200 m, 230 km at 400 m; around the 14 landmarks, 5, **11**, 21 and 85 km. |
| What would a height multiplier do? | Sketch on the default city's largest district (2,202 buildings) at four times the requested height: 278 buildings ask for more than the world's slenderness rule allows; under a half-gravity ward 211 stand taller than the world would permit (tallest 272 m against 236 m). At twice the height almost nothing binds (5 buildings). |
| Is there room for catacombs? | Sewers bottom out at 7.5 to 10.1 m; arcology utility tunnels occupy 6 to 9 m; the metro's crown is at 16.9 m in the default city (18.4 at 648 Hz, 36 to 60 m where foundations push it down). The tightest band is 6.8 m. |
| What does the octave below look like? | Its nodal network is about half as long as this octave's: about 38 km under the default city (this octave about 80 km; streets 566 km), about 9 km under the town, by a grid-crossing estimate. It exists whenever f/2 is above the plate's fundamental (40 Hz). Metro stations are 182 to 485 m from the nearest deep road, landmarks 59 to 469 m. |

## Decisions

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | Where do the mechanics live in a profile? | One key, `magic: { wards, ley, underworld }`. Themes stay names and colours. | A profile is the identity of a city; one key keeps "no `magic`, same bytes" checkable. |
| 2 | What is "Earth constants"? | Neutral values resolve to nothing: a ward of 1 × 1 × 1 is dropped, `ley: false` and an empty `underworld` likewise, and a `magic` that resolves to nothing leaves no trace in `meta`. Separately, `ley: { flux: 0 }` builds the ley layer but the power network is the realistic one, byte for byte. | Both readings of the roadmap's proof, each testable. |
| 3 | How is a ward addressed? | `where`: `{ district: n }`, `{ at: [x, z] }` (the district under that point), `{ polarity: 1 \| -1 }` (every district of that sign), or `"all"`. A district in two wards is refused, naming it. | District numbers are stable but not memorable; a point or a polarity is. Polarity is the plate's own up-phase and down-phase. |
| 4 | What can a ward override? | `gravity`, `strength`, `pressure`: multipliers on the world's gravity, the material's σ and the water head rules. Effective gravity stays inside the engine's 0.05 to 5 range or the ward is refused. Plus `height` (call W, below). | The roadmap's three; multipliers compose with any world. |
| 5 | Which stages see a ward? | **Structure** (height limit, slenderness, terrace step; in `generateCity` and in growth), **sewers** (minimum slope and capacity at the pipe's upstream node), **water** (head limits at the node, tank height at the tank), and `flows()`. | These are the four places gravity enters today (`cymatic-engine.js:1093–1096`, `infrastructure.js:333, 366–367, 406`, `simulation.js:126, 317`). |
| 6 | Which ward is a street node in? | Streets are nodal lines, the borders between districts, so a node has no district. A node takes the ward of the majority (by floor area) of the buildings it serves; a node serving none is unwarded. | Measured fact about the plan, not a choice; without a rule the hydraulics are undefined. |
| 7 | How is a ward reported? | `layout.wards[]` with its districts, buildings and residents, and `dependent`: the buildings (and residents) that break the world's own limits and stand only while the ward holds. Check `ward-dependence` (info). `impact(layout, infra, { kind: 'ward', index })` returns the same list. | "All reported honestly by the checks": a ward is an asset whose failure has a body count, like a substation. |
| 8 | What is the ley field? | ℓ = S², the energy of the same field the streets are the zero lines of (for a chord, the chord's field). Optional `ley.field: { width, height, data }` replaces it with a foreign grid. | The plan's own physics; the grid is the Phase 8 seam ("magic fields from other engines enter as scalar fields"). |
| 9 | Where are the nexuses? | Local maxima of \|S\| on the engine's sample grid at `nexusStrength` (0.5) of the plate's maximum or more, refined by one quadratic fit, rounded to 1 cm, ordered by strength then position. | 12 to 60 per city: the scale of the substations they feed (1 to 38). Independent of buildings, so arcologies have them too. |
| 10 | What does a nexus give? | `flux` × ∫ℓ dA over its cell (the part of the plate nearer to it than to any other nexus), in MW. `LEY.flux` = 600 W/m² (call F). | One constant, one integral, conserved: the cells tile the plate. |
| 11 | What are the lines? | Straight segments: the Gabriel graph of the nexuses. Capacity = `lineFactor` (2) × the weaker end's output. | Straight alignments between sites are what ley lines are. Gabriel is planar, contains the minimum spanning tree, and has spare paths for N-1. Factor 2 passes the default city (1.97) and fails the chord city's core (6.31): a rule with teeth. |
| 12 | How does power reach the city? | Each substation taps its nearest nexus. Demand and supply are balanced over the lines by successive shortest paths that respect capacity (ties broken by index). What the ley cannot deliver is `undeliveredMW`; the perimeter station is built for that shortfall × 1.25 and not at all when it is zero. Street transmission runs from the taps as it runs from the station today. | "Magical power sources as plants with different siting rules": many small sources inside the plan. The megastructure (0.16×) honestly keeps its reactor. |
| 13 | Is the ley a physical layer? | No. Lines have no trench and no clearance; nexuses are places (position, strength, output), not structures. | Nothing to collide with; the clearance proof is for the underworld. |
| 14 | How are layers checked? | A registry, `infra.layers[]`: each layer lists its elements (street edge, free segment or footprint) with top and bottom depth. One check, `layer-clearance`, takes every pair of layers and every place they share plan position and requires the larger of their two clearances between them. It includes today's layers and replaces nothing: `tunnel-clearance` stays. | The proof says "every extra layer obeys the rules of the layers above it"; a pairwise rule over a registry is that sentence as code, and it audits the existing layers for free. |
| 15 | Where do catacombs go? | Galleries 2 m wide and 2.4 m high under streets within 150 m (along streets) of a seed: each nexus when the ley is on, else each landmark, else each district's strongest building. Crown = the deepest utility on that edge + 1 m. Where a metro tunnel shares the edge the floor must clear its crown by 2 m, or the edge is left out and counted. | The tightest band is 6.8 m and the gallery with both clearances needs 5.4 m. Streets carry no foundations. A reach of 150 m gives 44 km around nexuses; the first draft's 400 m gave 230 km, two fifths of every street in the city. |
| 16 | Catacomb access? | An entrance at each seed and wherever needed so that no point of a gallery is more than 250 m, along galleries, from one. Check `catacomb-egress`. | An access rule that can fail and be seen to. |
| 17 | Where do the deeps go? | On the nodal lines of the octave below (f/2; a chord uses its first voice), simplified to segments of 20 m or more, level, 6 m below the lower of the metro's floor and the deepest foundation. No deeps, with the reason, when f/2 is under the fundamental. (Call D.) | Half the length of this octave's pattern (38 km under the default city): a second, coarser city. It crosses under streets and buildings alike, so it must be below everything. |
| 18 | Deeps access? | Shafts, because stations and landmarks are 59 to 485 m away from the nearest deep road. One shaft per 800 m of deep road or less, each where a deep road passes under a street edge that carries no metro tunnel; the shaft head opens on the street. Checks `deep-access` (every point within 800 m, along the deeps, of a shaft; every connected piece has one) and `layer-clearance` for the shafts. | Measured: gates at stations would give none. A street edge keeps the shaft out of foundations. |
| 19 | Determinism? | Unchanged and enforced: `DM.*` only, grid-defined maxima, index tie-breaks, 1 cm rounding. `test/page.test.mjs` gains a magic city. | The Phase 6 review failed on exactly this. |
| 20 | Cost when magic is off? | None: no new stage runs. The golden hashes in `test/time.test.mjs` already pin it. | Phases 0 to 6 must not pay for 7. |

## Stages

One stage per session, each on its own branch, each ending green with its proof table. 7a and 7b are
independent; 7d needs 7c. Implementation is for a mid-tier model against this spec; 7b's flow and the phase
review are for the strongest.

### 7a — Wards

- `resolveParams` reads `magic.wards`, drops neutral ones, refuses overlaps and out-of-range gravity.
- Limits become per ward: `heightLimit(material, g·k_g) · k_σ`, `slendernessLimit(base, g·k_g)`, terrace step.
  `layout.stats.heightLimit` and `slendernessLimit` stay the world's; `layout.wards[i]` carries its own.
  Buildings in a ward gain `ward: i`. Checks `self-weight` and `slenderness` judge each building by its own limit.
- Networks: `gAt(node)` and `pressureAt(node)` by decision 6 replace the single `g` in the four places.
- `dependent`, `ward-dependence`, `impact({ kind: 'ward' })`.
- `height` (call W, approved) multiplies the height the pattern asks for, for each building in the ward, before any
  limit is applied, in `generateCity` and wherever growth recomputes a building's height. A ward of `height`
  alone is not neutral and is kept.
- **Out:** `layout.meta.magic.wards` (resolved), `layout.wards[]`, `building.ward`.

| Claim | Test |
|---|---|
| Neutral is nothing | Wards of 1 × 1 × 1 give the bytes of the profile without them (`toJSON`, and the networks). |
| A ward over everything is that world | `where: "all", gravity: 0.5` gives the buildings, roads and networks of the same profile with world gravity halved, field for field (megastructure and city). |
| Local where it can be | On a non-arcology city, a ward on one district leaves every building outside it identical. |
| The measured effects | Megastructure, `"all"`, gravity 0.5: tallest 780 m (600 without). City, gravity 0.5: 134 lift stations (26 without), 70 m tanks. |
| Dependence is real | Every `dependent` building breaks an unwarded limit and no other building does; `impact` agrees; a ward that tightens limits has none. |
| Height asks, the limits answer (call W) | A ward of `height: 4` alone raises requested heights and every building still passes the world's limits, with none `dependent`. The same ward with `gravity: 0.5` builds some of them taller, and exactly those are `dependent`. Outside the ward nothing changes. |
| Refusals | A district in two wards, gravity outside 0.05 to 5, an `at` outside the plate, an unknown `where`: each named. |

### 7b — Ley

- New `src/ley.js` (`buildLey(layout, opts)` → `ley`), called by `buildInfrastructure` when `magic.ley` is on;
  the power builder takes its sources and plant duty from it.
- **Out:** `infra.ley { flux, nexuses[{ pos, sign, strength, outputMW, demandMW }], lines[{ a, b, length,
  capacityMW, loadMW }], taps[{ nexus, substation, MW }], supplyMW, demandMW, undeliveredMW }`.
- Checks: `ley-supply` (supply ÷ peak × 1.25: pass at 1 or more, warn below, never fail: the plant covers it),
  `ley-line-load` (worst load ÷ capacity; fail above 1), `ley-n1` (people stranded by losing the strongest
  nexus or the busiest line; warn above 20 %, as `grid-n1` does).

| Claim | Test |
|---|---|
| Off is nothing; flux 0 is the realistic grid | No `ley`, same `infra` bytes. `flux: 0`: `infra.power` equals the realistic one byte for byte. |
| Energy is conserved | Σ nexus output = flux × ∫S² dA over the plate within 0.5 % (independent quadrature). Σ taps + undelivered = demand. Flow in = flow out at every nexus. No line above capacity. |
| Nexuses are the antinodes | Each is a strict local maximum of \|S\| by brute force on a finer grid, at half strength or more; none is missed. Counts: 36 at 432 Hz, 12 at 300 Hz. |
| Lines are Gabriel | Brute force: a pair is a line exactly when no third nexus lies inside the circle on it as diameter. 49 for the default city. |
| The measured spread | Supply ÷ peak: town about 5.1, default city about 1.39, megastructure about 0.16; the megastructure keeps a plant sized to its shortfall, the town has none. |
| A foreign field works | A constant grid gives equal flux per m²; a single bump gives one nexus at the bump. |
| Same in the browser | `test/page.test.mjs`: a ley city hashes the same in Chromium. |

### 7c — Layers and catacombs

- `infra.layers[]` for today's layers (sewer, water, power, transmission, utility tunnels, metro, foundations)
  and the check `layer-clearance`. **Run it on the 1.6.0 presets first: whatever it finds in existing layers is
  a finding to report and fix or explain, never to tune away.**
- `src/underworld.js`: `buildCatacombs`. **Out:** `infra.underworld.catacombs { galleries[{ edge, a, b,
  crown, floor }], entrances[{ node, pos }], skipped }`.

| Claim | Test |
|---|---|
| The rule holds for every pair | For every two layers and every shared plan position, the gap is at least the larger clearance, by brute force independent of the builder. |
| The rule can fail | Raising a gallery 2 m, or dropping the metro test, turns `layer-clearance` to fail. |
| Catacombs fit | Default city: galleries exist, crowns below every utility on their edge by 1 m, floors 2 m above any tunnel; `skipped` counts the rest. |
| Egress | No gallery point farther than 250 m from an entrance, by a separate search; removing an entrance fails the check. |
| Off is nothing | No `underworld`, same `infra` bytes apart from nothing: `layers` is added only when a magic layer asks for it. |

### 7d — Deeps

- `buildDeeps`: the zero contour of the octave-below field (the engine's own marching squares), simplified,
  placed at depth; shafts by decision 18. **Out:** `infra.underworld.deeps { hz, depth, roads[{ a, b }],
  shafts[{ pos, top, bottom, edge }], reason? }`.

| Claim | Test |
|---|---|
| It is the octave below | Every deep road lies within one grid cell of a sign change of the f/2 field; total length within 10 % of an independent grid-crossing estimate (about 38 km under the default city). |
| Below everything | Deeper by 6 m than every foundation and every tunnel floor; `layer-clearance` passes including shafts. |
| Reachable | Every point within 800 m of a shaft along the deeps; every connected piece has a shaft; shaft heads on street edges without tunnels. |
| Refused honestly | f/2 below the fundamental: no deeps, `reason` says why, no check fails. |

### 7e — Everything else

- Page: layers and theme names (the fantasy theme's "Ley lines" for feeders becomes "Ley conduits", since ley
  lines are now a thing of their own), a ward painter, the `magic` key in profiles.
- Exports: glTF groups `ley`, `catacombs`, `deeps`; GeoJSON kinds; CityJSON unchanged.
- Queries: collections `wards`, `nexuses`, `leyLines`, `galleries`, `deepRoads`; `ask` templates ("what falls
  if ward 2 fails", "which nexus feeds the core"); five MCP evaluation questions.
- `ENGINE_VERSION` 1.7.0, README, CHANGELOG, and the independent review in a fresh session.

## The five calls (approved as recommended, 2026-11-22)

The stages above assume the recommended column. Changing one later changes only the stage named.

| | Call | Recommended | The alternative |
|---|---|---|---|
| **K** | The profile key | `magic` | `arcana`, `fantasy` (the last collides with the theme and with "fantasy mode") |
| **W** | May a ward also ask for more height? | Yes: `height`, a multiplier on the heights the pattern asks for in that district. Without it a ward changes the skyline only in megastructures (measured), and has nothing to hold up. It takes a bold multiplier to matter: about four, not two. | Physics only: wards then matter mostly for sewers, water and megastructures. (7a) |
| **F** | The ley flux | 600 W/m² at unit S²: a town or an alien city lives on its ley five times over, the default city just does (1.39×), a megastructure cannot (0.16×). | 150: only towns and alien cities are self-sufficient. 5,000: everything is. (7b) |
| **D** | Where the deeps run | On the pattern of the octave below. | Under the boulevards, like the metro. Cheaper, and says nothing. (7d) |
| **C** | What catacombs gather around | Nexuses when the ley is on, else landmarks: 36 small crypts, 44 km. | Always landmarks: 14 crypts, 11 km. (7c) |

## Out of scope for Phase 7

Combat, creatures or any agent in the underworld; ley effects on people or land value; wards that move with
time (growth uses the wards it is given); underworld layers on the sphere beyond catacombs; and anything that
makes a check pass by changing the check.
