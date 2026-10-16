# Cymatic City Engine

**Pick a frequency. Get a city.**

The Cymatic City Engine turns a drive frequency into a complete 3D settlement — town, city, megastructure or alien city — whose street plan is the standing-wave (Chladni) pattern of a vibrating plate at that frequency. It then makes the result buildable with real planning and structural rules, and builds the underground beneath it: service connections, gravity sewers, looped water mains, a power grid, metro tunnels and utility galleries. Every layout is deterministic, every rule is measured and reported, and every piece can be inspected in 3D above or below ground.

It runs as a single self-contained web page (`dist/cymatic-city.html`) or as a dependency-free ES module you can call from your own engine.

---

## Contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Using the viewer](#using-the-viewer)
- [How a frequency becomes a city](#how-a-frequency-becomes-a-city)
- [The underground](#the-underground)
- [Realism and fantasy](#realism-and-fantasy)
- [Profiles](#profiles)
- [Module API](#module-api)
- [Data contract](#data-contract)
- [Plugging into a master engine](#plugging-into-a-master-engine)
- [Verification](#verification)
- [Limits and honesty](#limits-and-honesty)
- [Project layout](#project-layout)
- [Sources](#sources)

---

## What it does

| Layer | What you get |
|---|---|
| **Physics** | Driven-plate modes for a disk membrane (Bessel), a square Chladni plate (cos–cos combinations on corner coordinates) and a sphere (real spherical harmonics); a damped resonance sums the modes near your frequency and reports how sharp the pattern is. |
| **Plan** | Nodal lines become boulevards; amplitude contours become ring roads; gradient streets climb from each nodal line to the crest of its lobe; a perimeter road closes the plate. Streets are added until the plan reaches UN-Habitat's 18 km of street per km². |
| **Buildings** | Amplitude sets zoning (core / mixed / residential / green) and height; the wave's sign splits alternating districts; the peak of each district gets a landmark. Every footprint clears every road edge, never overlaps a neighbour, and sits within walking reach of a street. |
| **Structure** | Height ≤ σ/(ρ·g·3) for the chosen material; slenderness ≤ 1:10 (city) scaled by g^-1/3; buildings over six floors need a 14 m lift core; arcologies are terraced so no exposed face exceeds 1:8; spherical arcologies stay a shell. |
| **Underground** | Street graph with junctions at every crossing; a service lateral per building; gravity sewers sized by Manning and laid at Ten-State minimum slopes with lift stations and force mains; looped water mains fed from elevated tanks and a treatment plant; a power station, substations, 11 kV feeders and 110 kV transmission; metro stations at district landmarks with tunnels bored below every foundation; utility galleries under arcology boulevards. |
| **Checks** | Street share, street density, open space, residents/ha, tallest vs. material limit, most slender building, walking reach, road clearance, terrace steps, pattern sharpness, sewer slope and depth, water velocity and pressure, substation loading, tunnel clearance. |
| **Viewer** | Surface / X-ray / Underground views, layer chips, pipe exaggeration, section cut, orbit + WASD/QE fly, full zoom, click-to-inspect anything with a Focus action, themes, custom settlements, profiles, PNG and zip export (OBJ + JSON + profile). |

Same inputs and seed produce byte-identical output. The seed changes buildings, never streets.

## Quick start

```bash
npm test          # 56 tests: physics against reference values, brute-force geometry, structural and utility invariants
npm run build     # writes dist/cymatic-city.html (artifact page) and dist/cymatic-city-standalone.html (opens anywhere)
```

Open `dist/cymatic-city-standalone.html` in a browser. (Saving files from the page only works when it is hosted inside Claude; everything else works anywhere.)

From code:

```js
import { generateCity, toOBJ, toJSON } from './src/cymatic-engine.js';
import { buildInfrastructure } from './src/infrastructure.js';

const city = generateCity({ frequency: 432, plate: 'circle', preset: 'city', seed: 1 });
city.infra = buildInfrastructure(city);
console.log(city.stats.population, city.infra.stats.sewerKm, city.checks, city.infra.checks);
const obj = toOBJ(city);      // buildings, roads, and the networks as line objects at true depth
const json = toJSON(city);    // everything, plain data
```

## Using the viewer

- **Drive frequency**: the slider is logarithmic across the plate's modelled range; type an exact value in the box. **Tone** plays it.
- **Town / City / Mega / Alien / Custom** choose the settlement scale; **Disk / Square / Sphere** choose the plate.
- **Seed** changes buildings only. **Resonance Q** sets how sharply the plate resonates: high Q gives pure modes in narrow windows, low Q morphs smoothly between neighbours.
- **Build on the sand lines** inverts the mapping: the tallest buildings line the boulevards and lobe centres become plazas.
- **Surface / X-ray / Underground** (bottom left) switch the view; the chips toggle layers. In Underground the ground and buildings go translucent and the camera may go below ground.
- **Fly**: `W A S D` move, `Q E` down/up, `Shift` fast; drag to orbit, scroll to zoom (down to 2 m). Click anything — a building, a street, a pipe, a cable, a tunnel, a tank, a substation, a station — for its data; **Focus** or double-click to orbit around it; `Esc` clears.
- **Section cut** slices the whole scene along x, z or a horizontal plane so you can look inside.
- **Pipe exaggeration** scales diameters for visibility (depths are always true scale).
- **Save** gives a `.zip` with `city.obj`, `layout.json`, `profile.json` and a README, or a `.png` of the current view.

## How a frequency becomes a city

1. **Modes.** Each plate has natural modes at fixed frequencies: `f ∝ j_mn` (disk membrane, Bessel zeros), `f ∝ m² + n²` (square plate), `f ∝ √(l(l+1))` (sphere). The engine tabulates 820 disk modes, 420 square modes and 48 spherical degrees, each with its norm `∫φ² dA` and its value at the drive point.
2. **Driven response.** In the orthonormal basis each mode's amplitude is `α = φ̂(drive) / (f_k² − f² + i f_k f / Q)`. The pattern is taken at the phase that holds the most motion; the leftover quadrature motion is reported as blur (`sharpness`). Degenerate modes (square ±, sphere m) are resolved by the drive point, exactly as on a real plate.
3. **Sand to streets.** Sand on a Chladni plate settles on nodal lines; those become boulevards (marching squares on a 220² grid, or 120×240 on the sphere). Contour rings and gradient streets (Chen et al.'s tensor-field idea) fill in to the UN-Habitat street density; the wall closes the plate.
4. **Lots.** A jittered lot grid is tested against every road with an exact outline check; two passes give the high-amplitude cores double lots. Zone, floors and shape come from amplitude and preset; districts from the wave's sign.
5. **Structure.** Limits are applied in order: slenderness (widen the footprint if the lot allows, else cap), lift core, material self-weight. Arcologies are terraced with a Dijkstra pass so no step exceeds the slenderness rule.

## The underground

Everything below runs on a street graph built from the road segments, with junction nodes wherever two streets cross and short connectors joining any stray loop.

- **Service laterals.** Every building connects to its nearest street node and carries its residents and jobs (45 m² per resident, 15 m² per worker, 70 % net-to-gross).
- **Sewers.** Treatment plants sit on the perimeter (one per 300,000 people). A multi-source shortest-path forest gives each street its downstream direction; flows accumulate leaves-first with the Harmon peaking factor. Each pipe takes the smallest standard diameter (200 mm – 3 m) whose Manning capacity at 80 % full meets the peak, never narrower than anything upstream, laid at the Ten-State minimum slope for that diameter **divided by g** (self-cleansing velocity: `v = √(8 g R S / f)`). Depth grows downstream from 1.5 m cover; when a run would pass 8 m a **lift station** restarts it at cover, and a run too long for gravity even from cover becomes a **force main** (pumped, constant depth). Manholes sit at junctions and ends of runs.
- **Water.** Elevated tanks (one per 25,000 people, zones split when they grow past twice that) hold one day of demand at a height of `35 m / g` for 3.4 bar — capped at 80 m with pumps. Distribution mains are sized for peak hour (3×) at 1.5 m/s, minimum 150 mm for fire flow; every other street gets a 150 mm loop main so no zone dead-ends. A treatment plant on the far side of the city feeds every tank through trunk mains sized for the summed max-day flow (1.8×).
- **Power.** Loads are 0.7 kW per resident and 1.0 kW per job at a 1.6 peak factor and 0.9 power factor. Substations (30–120 MVA by preset) are placed by farthest-point sampling and zones are split until none exceeds its rating; a dense node that needs more gets transformer banks. Feeders (11 kV, 0.9 m deep) are the shortest-path forest with accumulated loads; 110 kV transmission (1.5 m deep) is the shortest-path tree from the plant, which is a perimeter power station or, for arcologies and alien cities, a central core. Plant capacity is 1.25× peak, rounded to 50 MW.
- **Metro.** Stations sit at the strongest building of each district (≥ 700 m apart; a sparse city gets extra stops on its busiest streets). Tunnels (6.3 m bore) follow a minimum spanning tree of street paths; the whole line is bored at one depth — at least 20 m, and at least 4.5 m below every foundation whose footprint reaches the corridor. Foundations are taken as 2 m + 10 % of height (capped at 60 m).
- **Utility galleries.** Arcologies get a 3 × 3 m gallery at 6 m under every boulevard and service corridor, carrying water, power, sewer, data and heat.

Lower gravity steepens the sewers (more lift stations), raises the tanks and relaxes slenderness; heavier gravity does the reverse.

## Realism and fantasy

The engine is one set of equations with two switches:

- **Realism (default).** The material self-weight limit, the slenderness limit, the lift-core rule and the terrace rule cap the buildings. The checks show what bound.
- **Fantasy (`enforce: false`).** Buildings keep the heights the pattern asks for; the same limits are still computed and reported as checks, so you always know what a real material would allow. Geometry rules that are not negotiable (no overlaps, road clearance, walking reach, sewer slopes, substation ratings, tunnel clearance) still hold.

**Custom settlements** start from any preset and override radius, lot size, floor height, floor range, core floors, street spacing, slenderness, arcology design height and terrace step, the look, gravity, and the material — including a custom material given as compressive strength and density (`{ label: 'Living wood', sigma: 40e6, rho: 600 }`).

**Themes** rename and recolour without touching the engineering: *Realistic*, *High fantasy* (aqueducts, ley lines, deep roads, dwarven galleries…), *Alien hive* (nutrient veins, bioelectric lines, burrow ways…) and *Solarpunk*.

## Profiles

A profile is the complete recipe for a city: every engine parameter plus the theme. **Copy profile** in the viewer puts it on the clipboard; **Apply pasted profile** restores it; the zip export includes `profile.json`. A profile passed to `generateCity()` reproduces the same city anywhere.

```json
{ "engine": "1.0.0", "frequency": 432, "plate": "circle", "preset": "custom", "seed": 1, "Q": 100, "inverse": false,
  "custom": { "base": "city", "label": "Elven haven", "coreFloors": 90, "floorH": 4.5 },
  "material": { "label": "Living wood", "sigma": 40000000, "rho": 600 },
  "gravity": 0.8, "enforce": false, "theme": "fantasy" }
```

## Module API

`src/cymatic-engine.js` (no dependencies, ES module, runs in Node 18+, browsers and Web Workers):

| Export | Purpose |
|---|---|
| `generateCity(input)` | Build a layout. `input`: `frequency`, `plate` (`circle` \| `square` \| `sphere`), `preset` (`town` \| `city` \| `megastructure` \| `alien` \| `custom` \| a custom spec object), `custom`, `seed`, `Q`, `gravity`, `material` (key or `{label, sigma, rho}`), `fundamentalHz`, `driveOffset` (0–0.95), `azimuthal` (sphere), `inverse`, `enforce`. Throws clear errors for bad input. |
| `fieldPreview(input)` | The standing-wave field alone (`at(u, v) → {S, A}`, coordinate helpers) for painting the plate. |
| `enumerateModes`, `drivenResponse`, `frequencyRange`, `drivePoint`, `modeLabel` | The physics layer. |
| `besselJ`, `besselZeros`, `legendreNormalized`, `realSphericalHarmonic` | Special functions (cross-checked against scipy). |
| `PRESETS`, `PLATES`, `MATERIALS`, `CUSTOM_FIELDS`, `customPreset`, `resolveMaterial`, `heightLimit`, `slendernessLimit`, `SAFETY_FACTOR`, `CORE_FLOORS`, `MIN_CORE_SIDE` | Rules and constants. |
| `toJSON(layout)`, `toOBJ(layout)`, `buildingMesh(b)`, `zipStore(files)`, `crc32` | Export. |
| `mulberry32(seed)`, `noteName(hz)` | Utilities. |

`src/infrastructure.js`:

| Export | Purpose |
|---|---|
| `buildInfrastructure(layout)` | Build every network for a layout; returns `{ graph, laterals, sewer, water, power, transit, utilidors, stats, checks }` and attaches the OBJ hook. |
| `buildStreetGraph(layout)` | The street graph alone. |
| `sewerMinSlope(D, g)`, `foundationDepth(b)`, `underground(layout, P, depth)`, `infraToOBJ` | Rules and helpers. |
| `SEWER`, `WATER`, `POWER`, `TRANSIT`, `UTILIDOR` | Design constants with their sources in the comments. |

## Data contract

`toJSON(layout)` is plain JSON (typed arrays become arrays). Units are metres, seconds and SI throughout; y is up on flat plates; on the sphere positions are 3D on the surface and "up" is radial.

```
layout
├─ meta        frequency, note, plate, preset, base, arcology, presetLabel, presetSpec?, seed, Q, gravity, material, materialSpec,
│              enforce, inverse, modes[], dominant, symmetry, sharpness, world{shape, extent, area, Rs}, ringLevels, …
├─ roads[]     { a:[x,y,z], b:[x,y,z], w, kind: boulevard|ring|spoke|wall }
├─ buildings[] { pos, up, fwd, w, d, h, floors, zone, shape, polarity, amp, district, landmark }
├─ trees[]     { pos, up, s }
├─ stats       areaKm2, buildings, roadLengthKm, streetDensity, roadShare, greenShare, far, population, jobs, densityPerHa,
│              maxHeight, heightLimit, slendernessLimit, maxSlenderness, maxStreetDistance, minRoadClearance, binding, …
├─ checks[]    { id, label, value, status: pass|warn|fail|info, basis }
└─ infra
   ├─ graph     { nodes[{pos, deg}], edges[{a, b, len, kind, w}], connectors }
   ├─ laterals[] { building, node, length, residents, jobs }
   ├─ sewer     { plants[], pipes[{up, down, edge, length, diameter, slope, upDepth, downDepth, flow, avgFlow, lift, forceMain, plant}],
   │             liftStations[], manholes[], nodeDepth[] }
   ├─ water     { towers[{node, pos, height, pumped, storageM3, served, demandM3Day}], plant, mains[{a, b, diameter, flow, velocity, depth, kind, zone}], nodeHead[] }
   ├─ power     { plants[], substations[{node, pos, ratingMVA, banks, loadMVA}], feeders[{a, b, loadMVA, classMVA, depth, kV, substation}], transmission[], peakMW }
   ├─ transit   { stations[{node, pos, depth, district, name}], tunnels[{a, b, length, line, depth, diameter, nearBuildings[]}], depth }
   ├─ utilidors[] { a, b, length, width, height, depth, carries[] }
   ├─ stats     sewerKm, liftStations, forceMains, waterKm, towers, towerHeight, powerKm, substations, peakMW, transitKm, stations, excavationM3, …
   └─ checks[]
```

`toOBJ(layout)` writes one object per building (outward-wound prisms), one per road segment (flat strips), then the networks as line objects (`sewer_pipes`, `water_mains`, `power_feeders`, `power_transmission`, `transit_tunnels`, `utility_tunnels`) at true depth.

## Plugging into a master engine

The engine was built to be one stage in a larger pipeline:

- **Pure functions, plain data.** `generateCity` and `buildInfrastructure` have no side effects, no DOM, no globals; the output is JSON-serialisable. Run them in a Worker (the viewer does) or on a server.
- **Stable identity.** A profile fully determines a city, so other engines can reference a settlement by profile and regenerate it on demand instead of storing geometry.
- **Open seams.** Feed your own terrain by replacing `fieldPreview`-style fields (the planner only needs a scalar field and its gradient); add your own presets through `customPreset`; add rule checks by pushing onto `checks`; consume `infra.graph` as a transport network for agents or traffic.
- **Build step.** `build.mjs` inlines both modules into the viewer (the infrastructure module is wrapped in its own scope because it shares helper names with the engine). Other hosts can import the modules directly.
- **Versioning.** `meta.engine` carries the engine version; keep profiles alongside the version that made them.

## Verification

- `npm test` runs 56 tests in about three minutes: Bessel values and zeros against scipy, spherical-harmonic orthonormality, mode norms by numerical integration, the square-plate corner convention, drive-point coupling, analytic nodal sets for boulevards, brute-force road-clearance and overlap checks on sampled cities, structural limits across every plate × preset, gravity scaling, OBJ winding and index validity, zip validity (checked with Python's `zipfile`), determinism, input validation; and for the underground, sewer slope/depth/flow conservation, force mains, looped mains and trunk flows, substation ratings and feeder accumulation, junctions at every crossing, brute-force tunnel-clearance over every building, connector lengths, and timing.
- The page is rendered headless (Playwright + Chromium) at desktop and phone widths through every view mode, with picking, fly controls and the section cut exercised.
- Two independent review passes (one on the city layer, one on the underground) each found real defects that were then fixed and re-verified: the square-plate coordinate convention, modal normalisation, inverted OBJ winding, tunnels missing foundations on long edges, streets crossing without junctions, undersized trunk mains.

## Limits and honesty

- The standing-wave patterns are real physics; turning them into a city is a design choice. No evidence shows that 432 Hz, Solfeggio tones or the Schumann resonance make a place healthier or more harmonious, so the engine treats every frequency alike.
- Between two modes the plate never fully stands still; the viewer shows the pattern's sharpness and the boulevards follow the dominant standing pattern.
- The sphere is an idealised scalar model, not a thin elastic shell.
- Water pressure is static head only; electrical loads are per-capita averages; metro ridership is not modelled. Arcology service corridors run through the structure rather than under streets, by design.
- Preset street widths, lot sizes and several planning thresholds are tunables chosen within the ranges in the research notes; the notes mark which numbers are sourced and which are not.

## Project layout

```
src/cymatic-engine.js     physics, plan, buildings, structure, export
src/infrastructure.js     street graph and every underground network
src/viewer.html           the 3D page (three.js from a CDN, everything else inline)
build.mjs                 inlines the modules into dist/
test/                     physics, city, export and infrastructure suites
research_notes/           cymatics physics, city realism, cymatic-architecture claims, utility standards
reports/                  the research report behind the design
```

## Sources

Key references used for the rules (full citations in `research_notes/`): NIST DLMF §10.21 (Bessel zeros); Dalessi et al. 2021 and Tuan et al. 2015 (Chladni plates); arXiv 2008.02040 (driven modal response); Chen et al. 2008 (tensor-field streets); UN-Habitat *Five Principles of Sustainable Neighbourhood Planning*; Architectural Record and CTBUH material on slenderness; Illinois 35 IAC 370 / Ten-State Standards (sewer slopes), Utah and Saanich design standards (manholes, flows); City of Vaughan water design criteria; WHO water-service levels; TCQSM / TCRP 165 (rail capacity); Singapore and Barcelona tunnel case histories (depths and pile clearances); Jahn, Devereux & Ibison 1996 and Wright 2007 (archaeoacoustics).
