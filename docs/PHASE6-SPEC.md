# Phase 6 — Export and headless CLI: draft spec

Status: **draft for review.** Written against 1.5.0. Items marked **⚑** are open design decisions for the
reviewing model to settle before implementation starts; everything else is a proposal it may also overturn.

ROADMAP goal: glTF with instancing (Blender, Unreal, Godot), GeoJSON with a chosen origin for GIS, CityJSON,
and `cymatic generate profile.json --year 80 --out city.gltf`. Proof: files validate in their reference
validators; a profile round-tripped through the CLI reproduces the viewer's city byte for byte.

## Already in place (1.5.x, this branch)

- `bin/cymatic.mjs`: `summary | checks | metrics | query | ask | export | tools`, profile from JSON, file or
  flags, `--json`, `--strict`. `export --out x.json|x.obj` is byte-identical to `toJSON`/`toOBJ` (tested).
- `bin/cymatic-mcp.mjs`: MCP server over `agentTools()`.

Phase 6 extends the CLI rather than starting a new one: `generate` becomes the documented name, `export`
stays as an alias.

## 1. New module `src/export.js`

Pure functions, plain data in, `Uint8Array` or string out, no dependencies, worker-safe (the viewer calls
them too). Each takes a layout (optionally with `infra`) and options.

| Function | Output |
|---|---|
| `toGLB(layout, opts)` | binary glTF 2.0 (`.glb`) |
| `toGLTF(layout, opts)` | `{ json, bin }` for `.gltf` + `.bin` |
| `toGeoJSON(layout, opts)` | RFC 7946 FeatureCollection string |
| `toCityJSON(layout, opts)` | CityJSON 2.0 string |

`build.mjs` must add the module to the viewer bundle and its export list.

## 2. glTF

**Buildings.** There are seven building shapes (`block house tower terrace pod dome spire`). Every building is
its shape's unit prism or frustum (`buildingMesh` with w = d = h = 1) under a TRS transform: translation
`pos`, rotation from the `(fwd, up, right)` basis as a quaternion, scale `(w, h, d)`. The top-scale factor
is part of the unit mesh, so non-uniform scale reproduces `buildingMesh` exactly. Seven meshes serve the
whole city.

- **⚑ Instancing route.** (a) One node per building referencing the shared mesh (core glTF, every importer).
  (b) `EXT_mesh_gpu_instancing` (one node per shape, per-instance TRS accessors; far smaller files, but
  importer support must be checked for the Blender, Unreal and Godot versions we target). Proposal: (a) by
  default, (b) behind `--instanced`, with a fallback-free extension declared in `extensionsUsed` only.
- **Materials.** One material per zone (core, mixed, residential, green) with the viewer's palette; per-building
  attributes in `extras` (`district`, `zone`, `floors`, `era`, `landmark`, `amp`). **⚑** Whether to also emit
  a vertex-colour or `KHR_materials_variants` route for "paint by era / land value".
- **Roads** as one merged mesh per road kind (flat strips as in `toOBJ`). Trees as instanced cones or omitted
  behind a flag.
- **Underground** (`--infra`): pipes, mains, feeders, tunnels as `LINES` primitives at true depth, one node per
  network, matching the OBJ object names. **⚑** Lines import poorly in some engines; tubes cost size.
- **Axes.** glTF is y-up, metres, right-handed: matches the engine on flat plates. On the sphere, positions are
  already 3D; no change.
- **Determinism.** Same profile → byte-identical `.glb`: fixed accessor order, float32 written with
  `DataView`, no timestamps, `asset.generator` = `Cymatic City Engine <version>`.

## 3. GeoJSON

RFC 7946 requires WGS84 longitude/latitude, so local metres are projected from a chosen origin.

- `--origin lat,lon` (default `0,0`) and `--bearing deg` (default 0, +x = east, +z = south as in the engine).
- **⚑ Projection.** A local east-north tangent plane is accurate to well under a metre across a 6 km city at
  mid latitudes; a transverse Mercator about the origin is exact enough everywhere. Proposal: tangent plane with
  the WGS84 radii of curvature at the origin; document the error bound and test it against a reference value.
- Features: building footprints (Polygon, properties as in glTF `extras` plus `heightM`), roads (LineString,
  `kind`, `widthM`), districts (**⚑** derive hulls, or omit), stations and network assets (Point) with `--infra`.
- **⚑ Sphere plate.** Map the sphere to the globe (radius ratio), refuse, or export a tangent patch. Proposal:
  refuse with a clear error in 6, revisit in 8.

## 4. CityJSON 2.0

- One `Building` per building, LoD 1 `Solid` (the prism or frustum), `attributes` as above; vertices with a
  `transform` (scale 0.001, translate = minimum), integer coordinates.
- Roads as `Road` objects with LoD 0 `MultiSurface` strips; trees as `SolitaryVegetationObject` points.
- **⚑ CRS.** CityJSON wants a projected CRS (`metadata.referenceSystem`). Options: local engineering CRS with
  no EPSG code, or a UTM zone derived from `--origin`. The second makes it load in GIS directly.
- **⚑ Underground networks.** CityJSON 2.0 has no utility-network types. Options: an Extension (`+SewerPipe`
  etc.), `GenericCityObject`, or leave networks to glTF/OBJ. Proposal: leave them out in 6.

## 5. CLI

```
cymatic generate <profile> --out city.glb|city.gltf|city.geojson|city.city.json|city.json|city.obj
                 [--year N] [--infra] [--instanced] [--origin lat,lon] [--bearing deg]
```

- Format from the extension; `--format` overrides.
- `--year N`: the city as it stood at year N of `simulate()`.
  **⚑ Year semantics — measured, needs a decision.** The state at a given year depends on the horizon: growth
  is scheduled so the whole plan is built by `years` (`built = ln(1 + q·(e^{r·years} − 1)) / r`, and floor
  factors use `built / years`). Measured on `{frequency: 432, preset: 'town'}`: year 80 of an 80-year run has
  1,063 buildings; year 80 of a 100-year run has 494 (chord 432+540: 1,216 vs 565). So "year 80" only means
  something with a horizon. Proposal: `--year Y [--horizon H]`, default H = 120 (the viewer's horizon field; `simulate()` itself defaults to 100 — **⚑** align them), and
  `Y ≤ H`. Second gap: keyframes sit only at `H·(k+1)/K`, so an arbitrary Y needs either a keyframe count that
  lands on it or a new `stateAt(layout, sim, year)` in `simulation.js` built from `history` (the keyframe body
  already does this per frame; extracting it is a refactor, and must leave keyframes byte-identical).
- Prints one line: what it wrote, bytes, building count. Never the geometry.

## 6. Proof and tests

| Claim | Test |
|---|---|
| glTF/GLB valid | Khronos `gltf-validator` reports 0 errors (**⚑** devDependency, or a Python/CLI validator like the zip test uses `python3`) |
| GeoJSON valid | RFC 7946 structure check in-repo (closed rings, right-hand winding, lon/lat ranges) + round-trip of one footprint's area within 0.5 % |
| CityJSON valid | `cjval` 0 errors (**⚑** availability in CI) |
| Faithful | GLB building count, bounding box and per-shape vertex positions equal `buildingMesh` within float32 |
| Deterministic | same profile → byte-identical output for every format, twice in one process and across processes |
| CLI round-trip | `generate --out x.json` equals the viewer's `toJSON` for the same profile (already tested for `export`) |
| Year | `--year Y --horizon H` equals the keyframe at Y of `simulate(layout, { years: H })` when one lands there |

The engine has no dependencies today. **⚑** Whether validators may be devDependencies, or tests skip when a
validator is missing (with the skip reported), is a project-level decision.

## 7. Out of scope for 6

Textures and UVs, LoD 2+ roofs, Unreal/Godot-specific project files, streaming tiles (3D Tiles), and
GeoJSON/CityJSON for the sphere.
