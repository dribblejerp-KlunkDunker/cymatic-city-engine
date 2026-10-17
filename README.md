# Cymatic City Engine

**Pick a frequency. Get a city.**

The Cymatic City Engine turns a drive frequency into a complete 3D settlement — town, city, megastructure or alien city — whose street plan is the standing-wave (Chladni) pattern of a vibrating plate at that frequency. It then makes the result buildable with real planning and structural rules, and builds the underground beneath it: service connections, gravity sewers, looped water mains, a power grid, metro tunnels and utility galleries. Every layout is deterministic, every rule is measured and reported, and every piece can be inspected in 3D above or below ground.

It runs as a single self-contained web page (`dist/cymatic-city.html`) or as a dependency-free ES module you can call from your own engine.

![A city at 432 Hz on a circular membrane: nodal boulevards, ring roads, districts and landmarks](docs/screenshots/01-city-surface.webp)

---

## Contents

- [What it does](#what-it-does)
- [Gallery](#gallery)
- [Quick start](#quick-start)
- [Using the viewer](#using-the-viewer)
- [How a frequency becomes a city](#how-a-frequency-becomes-a-city)
- [The underground](#the-underground)
- [Terrain and water](#terrain-and-water)
- [Simulation: time, flow, failure](#simulation-time-flow-failure)
- [People, traffic, land value](#people-traffic-land-value)
- [Chords: several frequencies, several eras](#chords-several-frequencies-several-eras)
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
| **Terrain** | Flat by default. *Relief* lets the standing wave be the ground (antinodes rise, troughs sink and flood into lakes crossed by bridges); *valleys* make every lobe a hill with the sand lines as valleys, optionally flooded into canals; or import a heightmap from another engine. Automatic relief keeps the ground under a 9 % grade; sewers follow true inverts, tanks climb to the high ground, pressure zones split and valves cap the basins. |
| **Underground** | Street graph with junctions at every crossing; a service lateral per building; gravity sewers sized by Manning and laid at Ten-State minimum slopes with lift stations and force mains; looped water mains fed from elevated tanks and a treatment plant; a power station, substations, 11 kV feeders and 110 kV transmission; metro stations at district landmarks with tunnels bored below every foundation; utility galleries under arcology boulevards. |
| **Simulation** | A time axis: the city is founded at the strongest antinode near the drive point and grows outward along its streets on an exponential built-up curve; buildings age on Weibull lifetimes and are rebuilt denser within the same structural limits; every keyframe is a complete city with its networks rebuilt. An hourly flow model: Hazen-Williams pressure along the water mains, three-phase voltage drop along the feeders, Manning partial-flow depth in the sewers, a gravity-model commute on the metro. Failure analysis: fail any asset and see who loses service; N-1 resilience per network. |
| **Chords** | Two or three drive frequencies at once. Each voice is driven and normalised on its own; the city's amplitude is their time-averaged motion; each voice lays its own streets on its own sand lines in the part of the plate it shapes, and settles as one era, oldest voice first. Intervals (fifth, fourth, third, octave) one click away. |
| **People** | A commuting population drawn from the buildings' residents and jobs: workplaces by a gravity model on street distance, walk / metro / car by door-to-door time, cars assigned to the streets with congestion; Hansen accessibility and a land-value index per lot; the zoning the land market would produce against the wave's; street widths judged by the flow they carry; metro ridership earned and handed to the flow model. |
| **Checks** | Street share, street density, open space, residents/ha, tallest vs. material limit, most slender building, walking reach, road clearance, terrace steps, pattern sharpness, sewer slope and depth, water velocity and pressure, substation loading, tunnel clearance. |
| **Viewer** | Surface / X-ray / Underground views, layer chips, pipe exaggeration, section cut, orbit + WASD/QE fly, full zoom, click-to-inspect anything with a Focus action, themes, custom settlements, profiles, PNG and zip export (OBJ + JSON + profile). |

Same inputs and seed produce byte-identical output. The seed changes buildings, never streets.

## Gallery

Captured headless from the page in this repository (`docs/screenshots/`).

| | |
|---|---|
| ![City on a circular membrane](docs/screenshots/01-city-surface.webp) **City, circular membrane, 432 Hz.** Boulevards on the nodal lines, rings on the amplitude contours, tallest buildings at the antinodes. | ![Square Chladni plate](docs/screenshots/02-square-plate.webp) **Square Chladni plate.** The cos–cos pattern of a clamped square plate becomes the street grid. |
| ![Alien city on a sphere](docs/screenshots/03-sphere-alien.webp) **Alien city on a sphere.** Spherical harmonics, low gravity, speculative material: the checks report what Earth rules would allow. | ![Megastructure](docs/screenshots/04-megastructure.webp) **Megastructure.** One terraced arcology; no exposed face steeper than 1:8, the whole structure under the material's self-weight limit. |
| ![Town, close](docs/screenshots/05-town-close.webp) **Town.** Pitched roofs, greens where the plate barely moves, the landmark at the district's crest. | ![Underground](docs/screenshots/06-underground.webp) **Underground view.** Sewers, water mains, feeders, transmission and metro tunnels under the ghosted city. |
| ![Underground, close](docs/screenshots/07-underground-close.webp) **Under one street.** Pipes at their real depths and diameters (exaggeration optional); click anything to inspect it. | ![Section cut](docs/screenshots/08-section-cut.webp) **Section cut.** A clipping plane through the model shows foundations above the tunnels. |
| ![Flows at 19:00](docs/screenshots/09-flows-evening.webp) **Evening peak.** Networks coloured by load at 19:00: pressure, voltage, sewer fullness, metro crowding. | ![Failure impact](docs/screenshots/10-failure-impact.webp) **Fail a tank.** The buildings that lose or degrade service turn red; the panel counts people and jobs. |
| ![Year 40](docs/screenshots/11-timeline-year-40.webp) **Year 40 of 120.** The city founded at the strongest antinode near the drive point, growing outward along its streets. | ![Year 80](docs/screenshots/12-timeline-year-80.webp) **Year 80.** Networks rebuilt for the city of that year; lift stations and substations added as it grows. |
| ![Relief terrain](docs/screenshots/16-terrain-relief.webp) **Relief.** The wave is the ground: lobes rise, troughs flood, streets bridge the lakes. | ![Bridges](docs/screenshots/17-terrain-bridges.webp) **Bridges and embankments.** Decks one freeboard above the water on piers; shore streets embanked to the same level. |
| ![Sewers on terrain](docs/screenshots/18-terrain-sewers-underground.webp) **Sewers on the heightfield.** Inverts fall with the ground; plants sit on the lowest perimeter; valves cap pressure in the basins. | ![Canals](docs/screenshots/19-terrain-canals.webp) **Valleys with canals.** Every lobe a hill, the sand lines flooded: a town of islands and causeways. |
| ![Fantasy theme](docs/screenshots/13-fantasy-theme.webp) **High-fantasy theme.** A custom settlement in living wood with realism off: the engine builds what the pattern asks for and the checks say what would stand. | ![Hive theme, X-ray](docs/screenshots/14-hive-xray.webp) **Alien hive, X-ray.** Same engineering, different names and colours. |
| ![Sphere relief](docs/screenshots/20-terrain-sphere.webp) **Relief on a sphere.** Radial terrain, with seas in the troughs. | ![Traffic](docs/screenshots/21-traffic.webp) **Peak-hour traffic.** Streets coloured by volume over capacity after the commute is assigned; this plan has street to spare. |
| ![Land value](docs/screenshots/22-land-value.webp) **Land value.** Accessibility to jobs, amplitude and the metro, brightest where the market would pay most. | ![Market zoning](docs/screenshots/23-market-zoning.webp) **Market zoning vs. the wave's.** Orange where the land market would put the core; red-tinted lots disagree with the zoning the pattern assigned. |
| ![Chord eras](docs/screenshots/24-chord-eras.webp) **A chord, 432 + 648 Hz.** Orange streets and lots belong to the first voice, blue to the fifth above it; the two patterns interleave lobe by lobe. | ![Old city](docs/screenshots/25-chord-old-city.webp) **The old city.** Early in the growth simulation only the first voice stands; the second breaks ground once the first has settled. |
| ![Phone layout](docs/screenshots/15-phone.webp) **Phone.** The panel becomes a sheet; everything still works at 390 px. | |

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
- **Simulate growth** runs the time axis (default 120 years, six keyframes); the **Year** slider walks the keyframes and **plan** returns to the generated plan. The **Hour of day** slider with *Colour the networks by load* runs the flow model and recolours every pipe, cable and tunnel by utilisation (blue–gold–red); the tiles below report the lowest pressure, lowest voltage, busiest substation, fullest sewer and busiest metro link.
- **Fail this** on any inspected asset (tank, plant, main, treatment plant, lift station, sewer, power station, substation, feeder, transmission corridor, tunnel, station) paints the affected buildings red (cut off) and amber (degraded) and explains the impact. The **Resilience (N-1)** tiles show the worst single failure per network with a Show button.
- **Save** gives a `.zip` with `city.obj`, `layout.json`, `profile.json`, a README and, when present, `simulation.json` and `flows-HHMM.json`, or a `.png` of the current view.

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

## Terrain and water

`terrain` is `'flat'` (default), `'relief'`, `'valleys'`, or an object `{ mode, relief, waterLevel, canals, heightmap }`.

- **Relief.** The ground is `R · S(u, v)`: the signed standing wave scaled to a relief `R`. Antinodes of one sign rise into hills, the other sign sinks into basins; the default water level is `−0.5 R`, so the deepest basins become lakes.
- **Valleys.** The ground is `R · (2A − 1)`: every lobe is a hill and the nodal lines are the valleys between them. With `canals: true` the lowest 8 % of the plate by amplitude floods, so the boulevards run as causeways through a network of channels.
- **Heightmap.** `{ width, height, data }` with row-major values in 0..1 (the page loads a grey PNG, white high) stands in for a terrain from another engine; on a sphere the grid wraps in longitude.
- **Automatic relief** is 4 % of the nodal spacing, then held down so the ground itself never exceeds a 9 % slope (local streets are limited to 10 %); an explicit `relief` in metres is taken as given and the **steepest street** check says what it costs. The **freeboard** is `clamp(0.15 R, 0.5, 3)` m: shore streets within it are embanked to that level, bridge decks sit at it, and no building stands below it.
- **Streets** take one elevation per plan point (the ground or the embankment), so streets meeting at a point agree on its height; a segment that dips under water anywhere along it is a **bridge**, drawn on piers. Buildings stand on the ground; an arcology spans its basins and its terraces are cut from the ground under each cell, including the open ground beyond the grid's edge.
- **Underground.** Street-graph nodes carry elevations. Sewers run on true inverts (ground minus depth) and must fall at least the self-cleansing slope between manholes; routing is weighted against climbing, treatment plants sit on the lowest 30 % of the perimeter, and climbs that would push a run past 8 m deep get lift stations or force mains. Water tanks climb to the highest customer of the zone they serve and are built only as tall as that zone needs (taller than the design height means pumped); a zone splits when any customer's static head falls under 20 m (196 kPa), and a **pressure-reducing valve** resets the grade line wherever a run has dropped more than 56 m (552 kPa) below its tank, set as high as the limit allows so the run below it stays served. Trunk mains past the largest pipe run as parallel barrels. The flow model uses the same elevations and valve set points. Metro tunnels keep their depth below the ground.
- **Reported:** `stats.terrain { mode, relief, waterLevel, shore, waterShare, bridges, bridgeLength, waterLots, maxGrade }`, `meta.terrain`, the checks `street-grade`, `water`, `pressure-zones`, `sewer-gravity`, and per-asset `elevation`, `elev`, `bridge`, `outletHeadM`.

Flat terrain reproduces the 1.1 layouts byte for byte.

## Simulation: time, flow, failure

**Time.** `simulate(layout, { years, keyframes })` founds the city at the building with the strongest amplitude nearest the drive point and orders settlement by street distance from it, pulled earlier by amplitude. Build years follow built-up growth of 3.7 % a year (the Lincoln Institute figure for fast-growing cities), so the first keyframes are a small town and the last half of the horizon adds most of the city. Each building then ages on a Weibull lifetime by type (shape 1.5; 70–120 year scales for Western stock) and is rebuilt; rebuilds grow toward and beyond the design height where the plate moves most, but never past the material, slenderness or lift-core limits when realism is on. Streets switch on along each new building's path back to the nucleus. Every keyframe is a full layout with its own networks, stats and checks, so anything that reads a layout reads a year of history. The simulated end state is denser than the generated plan; the viewer's **plan** button returns to it.

**Flow.** `flows(layout, infra, hour)` applies hourly profiles (two-peak water, lagged sewage, evening residential and daytime commercial power, AM/PM rail) and runs each network:
- water: Hazen-Williams head loss (C = 130) along the distribution forest from each tank; pressure per node; flags below 241 kPa (normal minimum) and 140 kPa (fire residual);
- power: three-phase drop `√3·I·L·(R cos φ + X sin φ)` along feeders with 11 kV aluminium XLPE conductors chosen per cable class (parallel runs above 455 A); voltage per node, loading per cable and substation; flags under 0.95 pu. The hourly factor is normalised so the design peak is the busiest hour;
- sewers: Manning partial-flow depth from Q/Q_full, so the tightest pipe runs at its 80 % design depth at the sewage peak; force mains are pressurised and exempt;
- metro: catchments within 1.2 km of each station, a gravity model (P_i·A_j/d) scaled to 35 % of commuters, hourly share from the rail profile, inbound before 13:00 and outbound after, assigned to the unique tunnel-tree path; link loads against 30,000 passengers per hour per direction.

**Failure.** `impact(layout, infra, { kind, index })` removes one asset and reports the buildings cut off and degraded, people and jobs, and a sentence. Water looks for an alternate path through the loop mains from other tanks; sewers walk the tree upstream; power uses connectivity of the logical 110 kV lines to any source; metro reports the share of daily trips that lose their route. `resilience()` scores each network's worst single failure. Because backup lines are only useful if they don't share a trench, the grid is built with a second injection point (a grid intertie on the far side), substation-to-substation backup lines routed away from busy trenches, and N-1 scored per **corridor** (every line in one trench fails together). Dense arcologies with few corridors cannot reach the 20 % target and say so.

## People, traffic, land value

`people(layout, infra, { origins, iterations })` (src/people.js) runs after the networks:

- **Population.** Residents and jobs per street node from the service laterals; 55 % of residents commute, never more than there are jobs. 160 origins are drawn in proportion to residents and every residential node is attached to its nearest origin by street distance, so each origin carries its whole cell's commuters (seeded, deterministic).
- **Destinations.** A gravity model on street-network distance, `P(j) ∝ jobs_j · exp(−d / 5 km)`, 48 destinations per origin drawn once and kept across passes.
- **Modes.** Walk by distance (half at 1.2 km); metro vs. car by door-to-door minutes in a logit (0.12/min): walk to the nearest stations within 1.2 km, 5 min wait, 35 km/h along the tunnel tree, against congested street time plus 8 min for parking and the walk at both ends. The metro share is **earned**, and the viewer hands the ridership to `flows()` in place of the 35 % assumption.
- **Assignment.** 25 % of commute trips start in the peak hour at 1.3 persons per car; cars take the time-shortest path, with BPR delay `t = t₀ (1 + 0.15 (v/c)⁴)` on lanes = ⌊(width − 6 m) / 3.5 m⌋ at 1,800 veh/h; three all-or-nothing passes averaged (MSA). Per edge: flow, v/c, speed, lanes needed.
- **Land value.** Hansen accessibility `Σ jobs_j · exp(−d / 5 km)` at the origins, reported relative to the city; value index = 0.6 · access^0.7 + 0.25 · amplitude + 0.15 · metro proximity, best lot = 1. **Market zoning** by value rank (top 15 % core, next 35 % mixed) is compared with the zoning the wave assigned and reported, not enforced.
- **Checks:** `street-capacity`, `street-width` (lengths that need more lanes or have three spare), `commute`, `mode-share`, `zoning`.
- **Viewer:** Run people and traffic; colour the city by traffic, land value or market zoning; flow, load and lanes on every street you click; value, access and market zoning on every building; `people.json` in the export.

Sources and tunables: `docs/research-notes/people_traffic.md`. Not modelled: non-commute trips, signals, parking supply, route choice between equal paths, value feedback on growth.

## Chords: several frequencies, several eras

`chord: [432, 648]` or `chord: [{ hz: 432, weight: 1 }, { hz: 576, weight: 0.6 }]`, up to three voices with weights in 0.01–1 (only their ratios matter); voices within 1 % of each other are refused. The first voice names the city and `frequency` is ignored when a chord is given. A chord of one is the plain frequency byte for byte.

- **Physics.** A plate is linear, so its response to several tones is the sum of its responses to each. For tones that do not share a period, no fixed shape exists; what is stationary is the time-averaged motion, whose mean square adds: the engine's amplitude is `√Σ (w·A_v)²` with each voice normalised to its own peak. The signed field keeps the sign of the in-phase snapshot `Σ w·S_v` (clipped to that envelope) for districts and relief. Sand on a real two-tone plate settles only where both voices are quiet, so the engine does not build on the composite's nodal set; it reads the chord as eras.
- **Eras.** Each voice lays its own nodal boulevards, rings and spokes in its **territory**, where its weighted envelope (its local peak amplitude) is within 15 % of the strongest voice's, with a street budget in proportion to its share of the plate; a faint voice lays little and a chord paves about as much as its loudest voice alone. The first voice closes the perimeter; disconnected fragments under 100 m left at territory edges are dropped. A lot belongs to the voice that moves the plate most under it (`building.era`); a street's era is whose sand lines it follows (`road.era`, `stats.eras`). In `simulate()` the first voice is the old city and settles completely before the next voice breaks ground (`eraStarts`, event notes); the old city's routes between its separated lobes run along a later voice's lines and open early, every other later street waits for its voice.
- **Megastructures.** Every voice's boulevards are open canyons through an arcology, so a chord leaves about half the cells of its first voice alone; the checks still pass.
- **Viewer.** "+ fifth / fourth / third / octave" add a voice (folded down an octave when the plate's range cannot reach it, refused when it lands on an existing voice); each voice has a weight slider and a frequency field; the tone plays the chord; the modes list shows each voice; "Colour the city by chord voice" paints streets and lots by era; profiles carry `chord`.

Sources and limits: `docs/research-notes/chords.md`.

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
| `generateCity(input)` | Build a layout. `input`: `frequency` (or `chord: [hz | {hz, weight}]`, 1–3 voices), `plate` (`circle` \| `square` \| `sphere`), `preset` (`town` \| `city` \| `megastructure` \| `alien` \| `custom` \| a custom spec object), `custom`, `seed`, `Q`, `gravity`, `material` (key or `{label, sigma, rho}`), `fundamentalHz`, `driveOffset` (0–0.95), `azimuthal` (sphere), `inverse`, `enforce`, `terrain` (`'flat'` \| `'relief'` \| `'valleys'` \| `{ mode, relief, waterLevel, canals, heightmap }`). Throws clear errors for bad input. |
| `fieldPreview(input)` | The standing-wave field alone (`at(u, v) → {S, A}`, coordinate helpers) and its `terrain` (`z(u, v)`, `lift(P)`, `waterAt(u, v)`, `relief`, `waterLevel`, `shore`) for painting the plate. |
| `resolveTerrain`, `makeTerrain`, `autoRelief`, `maxFieldSlope`, `canalAmplitude`, `TERRAIN_MODES`, `MAX_AUTO_GRADE` | The terrain layer. |
| `MAX_VOICES`, `VOICE_BAND`, `FRAGMENT_MIN` | Chord limit (3), territory overlap band (15 %), shortest street fragment kept (100 m); `fieldPreview(...).voices[]` exposes each voice's field and envelope (`at`, `S`, `env`). |
| `enumerateModes`, `drivenResponse`, `frequencyRange`, `drivePoint`, `modeLabel` | The physics layer. |
| `besselJ`, `besselZeros`, `legendreNormalized`, `realSphericalHarmonic` | Special functions (cross-checked against scipy). |
| `PRESETS`, `PLATES`, `MATERIALS`, `CUSTOM_FIELDS`, `customPreset`, `resolveMaterial`, `heightLimit`, `slendernessLimit`, `SAFETY_FACTOR`, `CORE_FLOORS`, `MIN_CORE_SIDE` | Rules and constants. |
| `toJSON(layout)`, `toOBJ(layout)`, `buildingMesh(b)`, `zipStore(files)`, `crc32`, `checksFor(meta, stats)` | Export and re-checking. |
| `mulberry32(seed)`, `noteName(hz)` | Utilities. |

`src/infrastructure.js`:

| Export | Purpose |
|---|---|
| `buildInfrastructure(layout)` | Build every network for a layout; returns `{ graph, laterals, sewer, water, power, transit, utilidors, stats, checks }` and attaches the OBJ hook. On terrain, `graph.nodes[i].elev`, `sewer.pipes[].slope` (the invert fall), `water.towers[].elev/height/pumped`, `water.prvs[]`, `water.nodeHeadM[]`. |
| `buildStreetGraph(layout)` | The street graph alone. |
| `sewerMinSlope(D, g)`, `foundationDepth(b)`, `underground(layout, P, depth)`, `infraToOBJ` | Rules and helpers. |
| `SEWER`, `WATER`, `POWER`, `TRANSIT`, `UTILIDOR` | Design constants with their sources in the comments. |

`src/people.js`:

| Export | Purpose |
|---|---|
| `people(layout, infra, { origins, iterations, onProgress })` | `{ sample{origins, commuters}, trips{total, meanKm, meanMin, modeShare, assigned}, traffic{edgeFlow[], vc[], speedKmh[], lanes[], lanesNeeded[], capacity[], congestedKm, vkt, underbuiltKm, overbuiltKm}, access[] (per node), landValue[] (per building), emergentZone[], zoneAgreement, stats, checks }`. |
| `TRAFFIC`, `LAND`, `laneCount`, `edgeCapacity`, `freeFlowMinutes`, `bprMinutes`, `landValueOf` | Constants and formulas (mutable objects, so a master engine can retune them). |

`src/simulation.js`:

| Export | Purpose |
|---|---|
| `simulate(layout, { years, keyframes, onKeyframe })` | `{ years, founding, history[{building, built, distance, generations[{year, floors, h}]}], keyframes[{year, layout, infra, stats}], events[], eraStarts }` (`eraStarts` for chords: when each voice broke ground). |
| `flows(layout, infra, hour, { hazenC, modeShare, metroTrips })` | `{ hour, water{nodePressure[], minPressure, lowNodes, criticalNodes, totalFlow, mains[], staticKPa}, power{nodeVoltage[], minPu, underVoltage, feeders[], substations[], totalMVA, blend}, sewer{pipes[{fullness, surcharged}], surcharged, maxFullness}, transit{links[{loadAB, loadBA, capacity, loadFactor}], stations[], dailyTrips, hourTrips, maxLoadFactor}, flags[] }`. |
| `impact(layout, infra, { kind, index })` | `{ affected[], degraded[], people, degradedPeople, jobs, share, summary, … }` for tower, waterplant, water, treatment, lift, sewer, plant, substation, power, transmission, transit, station. |
| `resilience(layout, infra)` | `{ water, power, sewer, transit }` each `{ worstShare, worst{kind, index}, score }`. |
| `PROFILES`, `PEAK_HOUR`, `GROWTH`, `LIFETIMES`, `POWER_FLOW`, `hazenWilliams`, `voltageDrop`, `partialFlowDepth`, `cableFor`, `cityStats` | Constants and formulas. |

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
   ├─ water     { towers[{node, pos, height, pumped, storageM3, served, demandM3Day}], plant, mains[{a, b, tree[child, parent]?, diameter, flow, distFlow, velocity, depth, kind, zone}], nodeHead[] }
   ├─ power     { plants[{kind, capacityMW}], sources[], substations[{node, pos, ratingMVA, banks, loadMVA}], feeders[{a, b, loadMVA, classMVA, depth, kV, substation}],
   │             transmission[{a, b, edge, line, lines[], n1}], lines[{from, to, edges[], length}], n1Transmission, peakMW }
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

- `npm test` runs 107 tests in about six minutes: Bessel values and zeros against scipy, spherical-harmonic orthonormality, mode norms by numerical integration, the square-plate corner convention, drive-point coupling, analytic nodal sets for boulevards, brute-force road-clearance and overlap checks on sampled cities, structural limits across every plate × preset, gravity scaling, OBJ winding and index validity, zip validity (checked with Python's `zipfile`), determinism, input validation; and for the underground, sewer slope/depth/flow conservation, force mains, looped mains and trunk flows, substation ratings and feeder accumulation, junctions at every crossing, brute-force tunnel-clearance over every building, connector lengths, and timing; and for the simulation, profile means and shapes, Hazen-Williams and voltage-drop hand-worked cases, strict head and voltage loss along every loaded main and feeder, Manning partial flow at the design peak, metro conservation and AM/PM reversal link by link, growth determinism and nesting, structural caps through densification, keyframe stats recomputed, impact sets, and agreement between the N-1 tiles and the failure model; and for terrain, flat-mode byte identity, ground and freeboard rules for every building and street, bridges that really cross water, one height per plan point, the reported grade against a recompute, arcology faces to open ground by brute force, sewer inverts against the heightfield, plant and tank siting, static heads within limits with valves exercised on 40 m of relief, elevation heads in the flow model, and keyframes that keep it all; and for people, trip conservation, vehicle-kilometres against car trips times their paths, flow only on shortest-path trees, BPR and capacity by hand, response to congestion and averaging that is really an average, land value monotone in its inputs and rank-correlated with access, zoning as value bands, the earned ridership carried by the flow model, determinism, and empty cities; and for chords, byte identity of a chord of one, duplicate voices refused, the composite field against the single-voice previews point by point on every plate, each voice's boulevards on its own nodal set and rings on its contours, streets only in their voice's territory, no short disconnected fragments, a faint voice converging to the single-voice city and the street share rising with weight, brute-force clearance and oriented-rectangle overlap on chord cities (sphere included), lot eras by dominant voice, era-ordered growth with later-voice streets confined to the old city's routes, terrain and the commute on chords, determinism and the underground.
- The page is rendered headless (Playwright + Chromium) at desktop and phone widths through every view mode, with picking, fly controls and the section cut exercised.
- Six independent review passes (city layer, underground, simulation, terrain, people, chords) each found real defects that were then fixed and re-verified: the square-plate coordinate convention, modal normalisation, inverted OBJ winding, tunnels missing foundations on long edges, streets crossing without junctions, undersized trunk mains, backup power lines sharing trenches with the lines they backed up, a slope cap reading the circle's scale wrong, valves starving the runs that climbed below them, 4 m steps at bridge abutments, and three tests that could not fail (now they can: mutation-tested); in the people model, destination sampling noise masquerading as equilibrium, a metro hand-off on the wrong base (+82 % ridership on the megastructure), and a sphere road-matching bug; in chords, a street budget that ignored the weights (a near-silent voice still laid a full network, +51 % street), duplicate voices doubling streets, and a ground preview that ignored all but the first voice.

## Limits and honesty

- The standing-wave patterns are real physics; turning them into a city is a design choice. No evidence shows that 432 Hz, Solfeggio tones or the Schumann resonance make a place healthier or more harmonious, so the engine treats every frequency alike.
- Between two modes the plate never fully stands still; the viewer shows the pattern's sharpness and the boulevards follow the dominant standing pattern.
- The sphere is an idealised scalar model, not a thin elastic shell.
- Water pressure is static head minus tree losses (loops carry no modelled flow); power flow is a radial voltage-drop model, not a full load flow; metro ridership is a gravity model on a tree; growth is a settlement-order model, not an economic one. Arcology service corridors run through the structure rather than under streets, by design.
- Terrain is a displacement of the plate, not geology: no erosion, no drainage basins beyond the wave's own, no retaining walls or cut-and-fill. Explicit relief far beyond the automatic one (hundreds of metres on a 3 km plate) gives streets no city could build and pressure zones the 48-pass zoning loop cannot finish; the checks fail and say so. Bridges are decks on piers without approach ramps longer than one street segment.
- Preset street widths, lot sizes and several planning thresholds are tunables chosen within the ranges in the research notes; the notes mark which numbers are sourced and which are not.

## Project layout

```
src/cymatic-engine.js     physics, plan, buildings, structure, export
src/infrastructure.js     street graph and every underground network
src/simulation.js         time axis, hourly flows, failure analysis
src/people.js             population, commuting, traffic assignment, land value
src/viewer.html           the 3D page (three.js from a CDN, everything else inline)
build.mjs                 inlines the modules into dist/
test/                     physics, city, export, infrastructure, simulation, terrain, people and chord suites
docs/screenshots/         the gallery above, captured headless
research_notes/           cymatics physics, city realism, cymatic-architecture claims, utility standards
reports/                  the research report behind the design
```

## Sources

Key references used for the rules (full citations in `research_notes/`): NIST DLMF §10.21 (Bessel zeros); Dalessi et al. 2021 and Tuan et al. 2015 (Chladni plates); arXiv 2008.02040 (driven modal response); Chen et al. 2008 (tensor-field streets); UN-Habitat *Five Principles of Sustainable Neighbourhood Planning*; Architectural Record and CTBUH material on slenderness; Illinois 35 IAC 370 / Ten-State Standards (sewer slopes), Utah and Saanich design standards (manholes, flows); City of Vaughan water design criteria; WHO water-service levels; TCQSM / TCRP 165 (rail capacity); Singapore and Barcelona tunnel case histories (depths and pile clearances); Jahn, Devereux & Ibison 1996 and Wright 2007 (archaeoacoustics).
