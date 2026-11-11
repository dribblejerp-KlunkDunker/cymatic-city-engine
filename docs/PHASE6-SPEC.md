# Phase 6 — Export and headless CLI: spec

Status: **implemented in 1.6.0** (spec settled 2026-11-11 against engine 1.5.0; stages 6a–6d and the 6e wiring
built the same day). Every decision is below with its reason; a reviewer checks the proof tables. What was built
differently, and what is still to prove, is listed under "As built" at the end.

ROADMAP goal: glTF with instancing (Blender, Unreal, Godot), GeoJSON with a chosen origin for GIS, CityJSON,
and `cymatic generate profile.json --year 80 --out city.gltf`. Proof: files validate in their reference
validators; a profile round-tripped through the CLI reproduces the viewer's city byte for byte.

## Decisions

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | What does "year 80" mean? | A year needs a **horizon**. `horizon` (years to build-out, default 100) becomes a profile key; `(profile, year)` is then a complete identity. | Measured: growth is scheduled to finish the plan at the horizon, and the number of random draws per building depends on it. Town 432 Hz at year 80: 1,063 buildings with horizon 80, 494 with horizon 100. |
| 2 | Arbitrary years | New `cityAt(layout, { year, horizon })` in `simulation.js`, by splitting `simulate()` into a schedule and a per-year frame. | Measured: the state at a year is independent of the keyframe count (K = 5 and K = 10 give the identical year-80 frame; the keyframe loop draws no random numbers), so a frame at any year is well defined. |
| 3 | 100 or 120? | 100 everywhere. The viewer's horizon field default changes 120 → 100 and the viewer writes `horizon` into the profile when it differs from 100. | `simulate()` already defaults to 100 and is the documented API; old profiles stay byte-identical because the key is written only when it differs. |
| 4 | glTF instancing | Default: one node per building, all sharing one mesh per (shape, material). `--instanced` switches to `EXT_mesh_gpu_instancing`. | Shared meshes under per-node transforms are core glTF and import everywhere. The extension imports in Blender (manual 4.4) but Godot's importer has no support yet (PR #112866 open, milestone 4.8), and Unreal's is unconfirmed. |
| 5 | Paint modes in glTF | `--paint zone` (default) or `era`; materials are chosen at export. No `KHR_materials_variants`, no vertex colours. | One plain material per class works in all three targets without material setup. |
| 6 | Normals | Explicit `NORMAL` on every triangle mesh, vertices split per face. | Importers that generate missing normals smooth across shared vertices, which rounds off prisms. Seven unit meshes make the cost nil. |
| 7 | Underground in glTF | `--infra` adds each network as one `LINES` mesh at true depth. Tubes are deferred. | Lines validate and stay small. Revisit when a target engine is shown to drop line primitives. |
| 8 | Ground | The exporter takes an optional elevation sampler and emits a `ground` grid mesh and a `water` plane; the CLI always passes one. | A terrain city without ground floats in an engine. The layout holds no heightfield, so the caller supplies it (`fieldPreview(profile).terrain`, as the viewer does). |
| 9 | GeoJSON projection | Exact tangent plane: local east-north-up → ECEF → WGS84 geodetic. `--origin lat,lon` is required; `--bearing` optional. | Measured with pyproj: within 2 mm of the geodesic at 6 km. The first-order radii-of-curvature formula is off by 1.2 m at 45° and 5.3 m at 60° over the same distance. |
| 10 | Sphere plates in GeoJSON and CityJSON | Refused with a clear error. glTF and OBJ carry spheres. | A sphere city is not a map of the Earth; a faithful mapping is a Phase 8 question. |
| 11 | Districts in GeoJSON | No district polygons; every building carries `district`. | GIS tools dissolve by attribute; hulls would be invented geometry. |
| 12 | CityJSON CRS | Local metric coordinates, no `referenceSystem`. Georeferenced CityJSON is deferred. | `referenceSystem` is optional and should be a 3D CRS; UTM EPSG codes are 2D, so there is no clean code for an arbitrary origin. GIS placement is covered by GeoJSON. Revisit when a consumer asks. |
| 13 | Networks and trees in CityJSON | Left out. | CityJSON 2.0 has no utility-network types; glTF, OBJ and GeoJSON carry them. |
| 14 | Validators | `gltf-validator` becomes a pinned devDependency. Runtime dependencies stay at zero. Tests that need a validator skip visibly when it is absent; the phase review must run with 0 skipped. CityJSON is checked by an in-repo structural validator in the tests and by `cjval` once at the phase review. | The Khronos validator is pure JS and ran here (2.0.0-dev.3.10). `cjval` is a Rust binary and could not be installed in the cloud session, so it cannot be a test dependency. |
| 15 | Order of work | Four stages, each shippable with its own proof: 6a time, 6b glTF, 6c GeoJSON, 6d CityJSON; then 6e wiring and release. | Each stage is small enough for one session and one review. |

Facts the decisions rest on, all measured on 1.5.0: building frames are orthonormal on every plate and terrain
(max |up·fwd| < 2e-16), so a translation-rotation-scale transform reproduces `buildingMesh` exactly; `up` is
vertical on flat plates and radial on the sphere. Sizes: town 1,063 buildings / 4,809 road segments; city
6,481 / 22,807; megastructure 4,460 / 4,002; alien 8,371 / 24,500; extents 700 m to 4.2 km. Building shapes:
block, house, tower, terrace, pod, dome, spire. `generateCity` ignores unknown profile keys.

## Stage 6a — time: `cityAt`, `generate`, horizon

**Engine (`src/simulation.js`).** Split `simulate()` without changing its output:

- `schedule(layout, { years })` → everything computed before the keyframe loop (`history`, `roadYear`,
  `eraStart`, founding), consuming the random stream exactly as today.
- `frameAt(layout, schedule, year)` → `{ year, layout, infra, stats }`, the body of the keyframe loop.
- `simulate()` = `schedule` + K × `frameAt` + events, as now.
- `cityAt(layout, { year, horizon = 100 })` → `frameAt(layout, schedule(layout, { years: horizon }), year)`.
  `year` is rounded to 0.1 and must satisfy 0 < year ≤ horizon; anything else throws with both numbers. A year
  so early that no network can be built reports that error with the year.

**CLI (`bin/cymatic.mjs`).** `generate` is the documented command; `export` stays as an alias.

```
cymatic generate <profile> --out <file> [--year Y] [--horizon H] [--infra] [--format F]
```

- Format from the extension, checked longest first: `.city.json`, `.geojson`, `.gltf`, `.glb`, `.obj`, `.json`.
  `--format` overrides. An unknown extension is refused (already so in 1.5.x).
- `--year Y` exports `cityAt`. Horizon: `--horizon`, else `profile.horizon`, else 100.
- Prints one line: file, bytes, building count, and year/horizon when given.

**Viewer.** Horizon field default 100; `profileOf()` writes `horizon` only when it is not 100; applying a
profile sets the field.

| Proof 6a | Test |
|---|---|
| Refactor changes nothing | Before refactoring, record a hash of `toJSON` of every keyframe (years 100, K 8) for a plain town, a chord town and a `valleys` town, plus `events` and `history`. The same hashes hold after. |
| `cityAt` is the keyframe | `cityAt(L, {year: 80, horizon: 100})` equals keyframe 80 of `simulate(L, {years: 100, keyframes: 5})`, field for field. |
| Horizon matters, K does not | Year 80 differs between horizons 80 and 100; K = 5 and K = 10 agree at year 80. |
| Bounds | year 0, year > horizon and non-numbers throw. |
| CLI | `generate --year 80 --out x.json` equals `toJSON(cityAt(...).layout)`; `profile.horizon` and `--horizon` are honoured in that order of precedence (flag wins). |
| Old profiles | A 1.5.0 profile without `horizon` exports byte-identically before and after. |

## Stage 6b — glTF 2.0

New module `src/export.js`: pure, no dependencies, worker-safe; `build.mjs` adds it to the viewer bundle.

- `toGLB(layout, opts)` → `Uint8Array`; `toGLTF(layout, opts)` → `{ json: string, bin: Uint8Array }`
  (the CLI writes `<name>.gltf` and `<name>.bin`).
- `opts`: `paint` ('zone' | 'era'), `instanced`, `infra`, `trees` (default true), `elevation` (sampler, see
  decision 8), `groundGrid` (default 128).

**Scene.** Root node `city` with children `buildings`, `roads`, `trees`, `ground`, `water`, `underground`.
Metres, y up, right-handed: the engine's own axes, on flat plates and on the sphere.

- **Unit meshes.** For each shape, `buildingMesh` with w = d = h = 1 at the origin, basis x = fwd, y = up,
  z = right, triangulated, vertices split per face with normals. One mesh per (shape, material) in use.
- **Buildings, default.** Node `b<index>`: `mesh`, `translation` = pos, `rotation` = quaternion of the
  (fwd, up, right) basis, `scale` = (w, h, d). `extras`: `index, district, zone, floors, era, landmark, amp`,
  and `built, rebuilt` in a `--year` export. Translations and scales rounded to 1 mm, quaternions to 1e-6.
- **Buildings, `--instanced`.** One node per (shape, material) with `EXT_mesh_gpu_instancing`
  (`TRANSLATION`, `ROTATION`, `SCALE` accessors); the extension is listed in `extensionsUsed` only. Per-building
  `extras` are absent in this mode; say so in the CLI line.
- **Materials.** `zone:<name>` with the viewer's `ZONE_COLOR`, or `era:<n>` with the viewer's era palette;
  metallic 0, roughness 0.9. Roads, ground, water and each network get one material each.
- **Roads.** One mesh per road kind: the flat strips `toOBJ` writes, with normals, `uint32` indices.
- **Trees.** One unit tree mesh; a node per tree with translation, rotation from `up`, uniform scale `s`.
- **Ground and water.** With `elevation`: a `groundGrid`² grid over the plate's bounding square, clipped to the
  plate, y from the sampler; a `water` quad mesh at the water level when it is finite. Flat plates get the plate
  outline at y = 0. The sphere gets no ground mesh in this phase.
- **Underground** (`infra`): `sewer_pipes`, `water_mains`, `power_feeders`, `power_transmission`,
  `transit_tunnels`, `utility_tunnels` as `LINES` meshes, matching the OBJ object names.
- **Determinism.** Fixed order of buffers, accessors and nodes; little-endian `float32` through `DataView`;
  `asset.generator` = `Cymatic City Engine <version>`; no timestamps. Accessor `min`/`max` on every `POSITION`.

| Proof 6b | Test |
|---|---|
| Valid | `gltf-validator`: 0 errors and 0 warnings for town (flat), town (`valleys`, with ground), a chord, the sphere, `--infra`, and `--instanced`. The validator does not check the instancing extension's contents, so a structural test asserts the three instance accessors have equal counts and sum to the building count. |
| Faithful | For every building of a town, the unit mesh under its node transform equals `buildingMesh(b)` vertex for vertex within 1 mm. Node count = buildings (+ trees). |
| Ground meets buildings | Each building's base y equals the sampler at its (x, z) within 1 cm. |
| Deterministic | Byte-identical output for the same profile, twice in one process and in two processes. |
| GLB container | Header magic, version 2, total length, JSON and BIN chunk lengths padded to 4 bytes. |
| Imports (phase review, where the tools exist) | Blender headless import and Godot `--headless --import` each load `city.glb`; record object counts in CHANGELOG. |

## Stage 6c — GeoJSON (RFC 7946)

`toGeoJSON(layout, { origin: [lat, lon], bearing = 0, infra })` → string. Flat plates only.

- **Projection.** Plan east e0 = x, plan north n0 = −z. Bearing b (degrees clockwise from north) turns the
  plan: `e = e0·cos b + n0·sin b`, `n = −e0·sin b + n0·cos b`. Then (e, n, 0) → ECEF by the tangent-plane
  rotation at the origin → geodetic by an iterative or closed-form WGS84 inverse. Coordinates are written as
  [lon, lat] with 7 decimals.
- **Refusals.** Sphere plates; |origin lat| > 89; any output longitude outside [−180, 180].
- **Features**, each with `id` and `properties.kind`:
  - `building` — Polygon of the base ring (closed, exterior ring counter-clockwise), properties
    `index, district, zone, floors, height, elevation, shape, era, landmark`.
  - `road` — LineString a→b, properties `roadKind, width, era, bridge`.
  - `tree` — Point.
  - with `infra`: stations, substations, tanks, lift stations, treatment plants as Points; sewer pipes, water
    mains, feeders, transmission and tunnels as LineStrings with `depth` and their sizing fields.
- `bbox` on the collection; a `cymatic` foreign member with `engine` and the profile inputs.

Reference vectors (pyproj 3.8 topocentric pipeline, WGS84), required to 1e-8 degrees:

| origin lat, lon | east, north (m) | lat, lon |
|---|---|---|
| 45, 7 | 3000, 2000 | 45.017990282, 7.038060361 |
| 60, 10 | −4200, 4200 | 60.037676226, 9.924645498 |
| 0, 0 | 1000, −1000 | −0.009043695, 0.008983153 |
| −33.9, 151.2 | 2500, −700 | −33.906307853, 151.227031090 |

| Proof 6c | Test |
|---|---|
| Projection | The four vectors above; bearing 90 sends plan-north to east. |
| Structure | FeatureCollection; every ring closed with ≥ 4 positions and counter-clockwise; longitudes and latitudes in range; `bbox` contains every position. |
| Metric fidelity | A footprint's area computed back through the inverse projection is within 0.1 % of w·d (prisms). Feature counts equal buildings, roads, trees. |
| Refusals | Sphere, polar origin and antimeridian each throw with the reason. |
| Deterministic | Byte-identical for the same profile and origin. |

## Stage 6d — CityJSON 2.0

`toCityJSON(layout)` → string. Flat plates only; local coordinates (decision 12).

- Axes: X = x (east), Y = −z (north), Z = y (up). The map preserves orientation, so outward faces stay outward.
- `"type": "CityJSON"`, `"version": "2.0"`, `transform` with scale 0.001 and `translate` = the minimum corner
  rounded to 1 mm; integer `vertices`, de-duplicated by their integer triple.
- `metadata`: `title`, `geographicalExtent`. No dates, no `referenceSystem`.
- **Buildings.** One `Building` per building, id `b<index>`, one `Solid`: `lod` "1" for vertical prisms
  (block, tower, terrace, pod), "2" for tapered shapes (house, dome, spire). Semantics on every surface:
  `GroundSurface`, `WallSurface`, `RoofSurface`. Attributes: `measuredHeight`, `storeysAboveGround`, `zone`,
  `district`, `shape`, `era`, `landmark`, and `built` (simulation year) in a `--year` export.
- **Roads.** One `Road` per (kind, era): `MultiSurface`, `lod` "1", every surface `TrafficArea`; attributes
  `roadKind`, `era`, `lengthM`.

| Proof 6d | Test |
|---|---|
| Structure (in-repo validator, test helper) | Required members; every vertex an integer triple; every boundary index in range; rings ≥ 3 distinct vertices; `semantics.values` shaped like the boundaries; `lod` matches `^\d(\.\d)?$`; no duplicate vertices; ids unique. |
| Faithful | Decoded Solid vertices equal `buildingMesh(b)` under the axis map within 1 mm; one Building per building. |
| Closed solids | Every edge of a Solid is used exactly twice, in opposite directions. |
| Reference validator (phase review) | `cjval city.city.json` reports valid for town and city; output recorded in CHANGELOG. |
| Refusal, determinism | Sphere throws; byte-identical for the same profile. |

## Stage 6e — wiring and release

- Viewer: export menu entries for GLB, GeoJSON (asks for origin) and CityJSON; the zip export gains `city.glb`.
- `agentTools()`: no new tool. Geometry stays out of agent context; agents call the CLI and report path and size.
- README: Module API, Data contract and quick start; ROADMAP Phase 6 marked done; CHANGELOG entry;
  `ENGINE_VERSION` 1.6.0 (new exports, new profile key).
- Independent review in a fresh session: read the diff against this spec, mutation-test every proof row, run
  the validators with 0 tests skipped, run the import checks, record findings and fixes in CHANGELOG.

**Done when** every proof row above is a passing test or a recorded review result, `npm run test:quiet`
reports 0 failed and 0 skipped with the validator installed, and the review's findings are fixed or answered.

## As built (1.6.0)

Differences from the text above, each small and deliberate:

- **Water** is the plate's outline at the water level (a disc on a circular plate), not a quad: a quad would
  show water beyond the rim. It is drawn translucent (`alphaMode: BLEND`).
- **Road materials** are one per kind (`road:<kind>`) in the page's street colours, not one for all roads.
- **Trees** are instanced too under `--instanced`. A tree's size is the page's: 0.22 × the preset's lot × `s`.
- **`--year`** works with every city command (`summary`, `checks`, `query`, `ask`), not only `generate`.
- **Identity in the files.** The glTF root node's `extras`, the GeoJSON `cymatic` member and the CityJSON title
  record the inputs, and the year and horizon when given. A `--year` export to `.json` is the keyframe as
  `simulate()` gives it (proof 6a), so it records `meta.year` but not the horizon: **open**, see below.
- **`cityAt` refuses a horizon under 5 years** where `simulate()` silently raises it to 5.
- **GeoJSON** also writes power plants and water tanks; the metric proof is 0.5 % per footprint and 0.1 % over
  the town, because seven decimals of a degree is about a centimetre on a ten-metre house.
- **Viewer.** There is no export menu: Save's zip gains `city.glb` (with ground and networks) and
  `city.city.json`, and `city.geojson` when a map origin is typed into the new field under the button.

Still to do at the independent review (6e):

- `cjval` on a town and a city; Blender and Godot headless imports of `city.glb`, object counts recorded.
- Decide whether keyframe layouts should carry `meta.horizon` (a contract change that re-records the golden
  hashes), so a `.json` year export names its own horizon.
- Unreal's handling of `LINES` primitives and of the instancing extension remains unconfirmed.

## Out of scope for Phase 6

Textures and UVs; tubes for underground networks; ground mesh on the sphere; georeferenced CityJSON; utility
networks and trees in CityJSON; district polygons; 3D Tiles; engine-specific project files.

## Sources

- Blender manual 4.4, glTF 2.0 add-on (extensions on import and export, custom properties):
  https://docs.blender.org/manual/en/4.4/addons/import_export/scene_gltf2.html
- Godot PR "GLTF: Support MultiMesh objects using EXT_mesh_gpu_instancing" (#112866, open, milestone 4.8).
- CityJSON 2.0.2 specification: https://www.cityjson.org/specs/2.0.2/
- Khronos glTF Validator, npm `gltf-validator` 2.0.0-dev.3.10 (run against a per-node, an instanced and a
  LINES sample: 0 errors, 0 warnings).
- RFC 7946 (GeoJSON): WGS84 longitude-latitude, exterior rings counter-clockwise.
