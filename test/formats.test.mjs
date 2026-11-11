// Exchange formats (Phase 6b–6d): glTF 2.0, GeoJSON and CityJSON 2.0.
// Each file is checked three ways: its structure (by the Khronos validator for glTF, by validators written here
// for the other two), its faithfulness to the layout (geometry decoded from the file against buildingMesh), and
// its determinism (same profile, same bytes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCity, buildingMesh, fieldPreview, ENGINE_VERSION } from '../src/cymatic-engine.js';
import { buildInfrastructure } from '../src/infrastructure.js';
import { cityAt } from '../src/simulation.js';
import { toGLB, toGLTF, toGeoJSON, toCityJSON, geoProjector, unitBuildingMesh, EXPORT_COLORS } from '../src/export.js';
import { run, formatOf } from '../bin/cymatic.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url)), CLI = join(ROOT, 'bin', 'cymatic.mjs');
const TOWN = { frequency: 432, preset: 'town' };
const cache = new Map();
const city = (o = TOWN) => { const k = JSON.stringify(o); if (!cache.has(k)) cache.set(k, generateCity(o)); return cache.get(k); };
const withInfra = (o = TOWN) => { const L = city(o); if (!L.infra) L.infra = buildInfrastructure(L); return L; };
// the ground the city was built on, as the CLI samples it
const sampler = (o) => { const F = fieldPreview(o); return (x, z) => F.terrain.z(...F.toNorm([x, 0, z])); };
const tmp = (name) => join(mkdtempSync(join(tmpdir(), 'fmt-')), name);
const cli = (...args) => { const lines = []; const code = run(args, { log: (s) => lines.push(s) }); return { code, out: lines.join('\n') }; };
const SHAPES = ['block', 'house', 'tower', 'terrace', 'pod', 'dome', 'spire'];

// ---------------------------------------------------------------- glTF helpers (independent of the exporter)
function parseGLB(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = { magic: dv.getUint32(0, true), version: dv.getUint32(4, true), length: dv.getUint32(8, true) };
  const chunks = [];
  for (let o = 12; o < bytes.length;) { const len = dv.getUint32(o, true), type = dv.getUint32(o + 4, true); chunks.push({ len, type, data: bytes.subarray(o + 8, o + 8 + len), at: o }); o += 8 + len; }
  return { header, chunks, doc: JSON.parse(new TextDecoder().decode(chunks[0].data)), bin: chunks[1]?.data ?? new Uint8Array(0) };
}
function read(doc, bin, accessor) {
  const a = doc.accessors[accessor], v = doc.bufferViews[a.bufferView], size = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
  const dv = new DataView(bin.buffer, bin.byteOffset + v.byteOffset, v.byteLength), out = [];
  for (let i = 0; i < a.count * size; i++) out.push(a.componentType === 5126 ? dv.getFloat32(4 * i, true) : dv.getUint32(4 * i, true));
  return out;
}
const triples = (flat) => { const out = []; for (let i = 0; i < flat.length; i += 3) out.push([flat[i], flat[i + 1], flat[i + 2]]); return out; };
const rotate = ([x, y, z, w], v) => { // v turned by the unit quaternion
  const u = [x, y, z], c1 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const c2 = [u[1] * c1[2] - u[2] * c1[1], u[2] * c1[0] - u[0] * c1[2], u[0] * c1[1] - u[1] * c1[0]];
  return [v[0] + 2 * (w * c1[0] + c2[0]), v[1] + 2 * (w * c1[1] + c2[1]), v[2] + 2 * (w * c1[2] + c2[2])];
};
const placed = (n, p) => { const s = n.scale ?? [1, 1, 1], r = rotate(n.rotation ?? [0, 0, 0, 1], [p[0] * s[0], p[1] * s[1], p[2] * s[2]]), t = n.translation ?? [0, 0, 0]; return [r[0] + t[0], r[1] + t[1], r[2] + t[2]]; };
const near = (a, b, tol) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
const sameSet = (A, B, tol) => A.every((a) => B.some((b) => near(a, b, tol))) && B.every((b) => A.some((a) => near(a, b, tol)));
const child = (doc, name) => { const i = doc.nodes[0].children.find((c) => doc.nodes[c].name === name); return i === undefined ? null : doc.nodes[i]; };
let validator = null;
try { validator = createRequire(import.meta.url)('gltf-validator'); } catch { /* optional: the tests that need it skip */ }
async function validate(bytes, resources = {}) {
  const r = await validator.validateBytes(bytes, { uri: 'city', externalResourceFunction: (uri) => (resources[uri] ? Promise.resolve(resources[uri]) : Promise.reject(new Error(`no ${uri}`))) });
  return { errors: r.issues.numErrors, warnings: r.issues.numWarnings, messages: r.issues.messages.filter((m) => m.severity <= 1).slice(0, 5).map((m) => `${m.code} ${m.pointer ?? ''}`) };
}

// ---------------------------------------------------------------- glTF
test('GLB container: magic, version 2, total length, a JSON chunk and a BIN chunk, both padded to four bytes', () => {
  const bytes = toGLB(city()), g = parseGLB(bytes);
  assert.equal(g.header.magic, 0x46546c67); // "glTF"
  assert.equal(g.header.version, 2);
  assert.equal(g.header.length, bytes.length);
  assert.equal(g.chunks.length, 2);
  assert.equal(g.chunks[0].type, 0x4e4f534a); // "JSON"
  assert.equal(g.chunks[1].type, 0x004e4942); // "BIN"
  for (const c of g.chunks) assert.equal(c.len % 4, 0);
  assert.equal(12 + 8 + g.chunks[0].len + 8 + g.chunks[1].len, bytes.length);
  assert.equal(g.doc.buffers[0].byteLength, g.chunks[1].len);
  assert.equal(g.doc.buffers[0].uri, undefined);
  assert.deepEqual(g.doc.asset, { version: '2.0', generator: `Cymatic City Engine ${ENGINE_VERSION}` });
  // every view starts on a four-byte boundary inside the buffer
  for (const v of g.doc.bufferViews) { assert.equal(v.byteOffset % 4, 0); assert.ok(v.byteOffset + v.byteLength <= g.chunks[1].len); }
});

test('glTF validates: 0 errors and 0 warnings for flat, terrain with ground, chord by era, sphere, networks, instanced, and .gltf + .bin', { skip: validator ? false : 'gltf-validator is not installed (npm install)' }, async () => {
  const valleys = { ...TOWN, terrain: 'valleys' }, relief = { ...TOWN, terrain: 'relief' }, chord = { chord: [432, 540], preset: 'town' }, sphere = { ...TOWN, plate: 'sphere' };
  const cases = {
    flat: toGLB(city()),
    'valleys with ground': toGLB(city(valleys), { elevation: sampler(valleys) }),
    'relief with ground and water': toGLB(city(relief), { elevation: sampler(relief) }),
    'chord by era': toGLB(city(chord), { paint: 'era' }),
    sphere: toGLB(city(sphere)),
    'sphere with networks': toGLB(withInfra(sphere), { infra: true }),
    networks: toGLB(withInfra(), { infra: true }),
    instanced: toGLB(city(), { instanced: true }),
    'square megastructure': toGLB(city({ frequency: 432, preset: 'megastructure', plate: 'square' })),
    'a year of growth': toGLB(cityAt(city(), { year: 30 }).layout, { infra: true }),
  };
  for (const [name, bytes] of Object.entries(cases)) assert.deepEqual(await validate(bytes), { errors: 0, warnings: 0, messages: [] }, name);
  const { json, bin } = toGLTF(city(), { binName: 'town.bin' });
  assert.equal(JSON.parse(json).buffers[0].uri, 'town.bin');
  assert.deepEqual(await validate(new TextEncoder().encode(json), { 'town.bin': bin }), { errors: 0, warnings: 0, messages: [] }, '.gltf + .bin');
});

test('glTF is faithful: each building node, applied to its unit mesh, is buildingMesh vertex for vertex within 1 mm', () => {
  for (const o of [TOWN, { ...TOWN, terrain: 'valleys' }, { ...TOWN, plate: 'sphere' }, { frequency: 300, preset: 'alien', seed: 3 }]) {
    const L = city(o), { doc, bin } = parseGLB(toGLB(L));
    const nodes = child(doc, 'buildings').children.map((i) => doc.nodes[i]);
    assert.equal(nodes.length, L.buildings.length);
    const unit = new Map(); // mesh index → its positions
    const seenShapes = new Set();
    nodes.forEach((n, i) => {
      const b = L.buildings[i];
      assert.equal(n.name, `b${i}`);
      if (!unit.has(n.mesh)) unit.set(n.mesh, triples(read(doc, bin, doc.meshes[n.mesh].primitives[0].attributes.POSITION)));
      assert.equal(doc.meshes[n.mesh].name, `building:${b.shape}:zone:${b.zone}`);
      seenShapes.add(b.shape);
      const got = unit.get(n.mesh).map((p) => placed(n, p)), want = buildingMesh(b).verts;
      assert.ok(sameSet(got, want, 1e-3), `${JSON.stringify(o)} building ${i} (${b.shape})`);
      assert.deepEqual(n.extras, { index: i, district: b.district, zone: b.zone, floors: b.floors, era: b.era ?? 0, landmark: !!b.landmark, amp: Math.round(b.amp * 1e4) / 1e4 });
    });
    // one mesh per (shape, material) in use, all sharing the shape's geometry
    const kinds = new Set(L.buildings.map((b) => `${b.shape}|${b.zone}`));
    assert.equal(unit.size, kinds.size);
    const positionsOfShape = new Map();
    for (const m of doc.meshes.filter((m) => m.name.startsWith('building:'))) { const s = m.name.split(':')[1], acc = m.primitives[0].attributes.POSITION; assert.equal(positionsOfShape.get(s) ?? acc, acc, `${s} shares one geometry`); positionsOfShape.set(s, acc); }
    assert.equal(positionsOfShape.size, seenShapes.size);
    // trees: one node each, standing where the tree stands
    const trees = child(doc, 'trees');
    assert.equal(trees?.children.length ?? 0, L.trees.length);
    (trees?.children ?? []).forEach((ti, k) => assert.ok(near(doc.nodes[ti].translation, L.trees[k].pos, 1e-3)));
    assert.equal(doc.extensionsUsed, undefined);
  }
});

test('glTF meshes: normals are unit and face outward, triangles wind counter-clockwise, roads face up', () => {
  for (const shape of SHAPES) {
    const m = unitBuildingMesh(shape), P = triples(m.positions), N = triples(m.normals);
    const c = P.reduce((s, p) => [s[0] + p[0] / P.length, s[1] + p[1] / P.length, s[2] + p[2] / P.length], [0, 0, 0]);
    assert.ok(P.every((p) => Math.abs(p[0]) <= 0.5 + 1e-12 && Math.abs(p[2]) <= 0.5 + 1e-12 && p[1] >= 0 && p[1] <= 1), `${shape} fits the unit box`);
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, d] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]].map((i) => P[i]);
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
      const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], gl = Math.hypot(...g);
      assert.ok(gl > 1e-9, `${shape}: no flat triangles`);
      const n = N[m.indices[t]];
      assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-9, `${shape}: unit normal`);
      assert.ok((g[0] * n[0] + g[1] * n[1] + g[2] * n[2]) / gl > 0.999999, `${shape}: winding agrees with the normal`);
      const mid = [(a[0] + b[0] + d[0]) / 3 - c[0], (a[1] + b[1] + d[1]) / 3 - c[1], (a[2] + b[2] + d[2]) / 3 - c[2]];
      assert.ok(mid[0] * n[0] + mid[1] * n[1] + mid[2] * n[2] > 0, `${shape}: the normal points out of the solid`);
      for (const i of [m.indices[t + 1], m.indices[t + 2]]) assert.deepEqual(N[i], n, `${shape}: one normal per face`);
    }
  }
  // roads: one mesh per kind, four vertices and two triangles a street, facing up; the strips are toOBJ's
  for (const o of [TOWN, { ...TOWN, plate: 'sphere' }]) {
    const L = city(o), { doc, bin } = parseGLB(toGLB(L)), roads = child(doc, 'roads').children.map((i) => doc.nodes[i]);
    const kinds = [...new Set(L.roads.map((r) => r.kind))].sort();
    assert.deepEqual(roads.map((n) => n.name), kinds.map((k) => `roads:${k}`));
    roads.forEach((n, k) => {
      const prim = doc.meshes[n.mesh].primitives[0], P = triples(read(doc, bin, prim.attributes.POSITION)), N = triples(read(doc, bin, prim.attributes.NORMAL)), I = read(doc, bin, prim.indices);
      const mine = L.roads.filter((r) => r.kind === kinds[k]);
      assert.equal(P.length, 4 * mine.length); assert.equal(I.length, 6 * mine.length);
      assert.equal(doc.accessors[prim.indices].componentType, 5125);
      for (let t = 0; t < I.length; t += 3) {
        const [a, b, d] = [I[t], I[t + 1], I[t + 2]].map((i) => P[i]), e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
        const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], n = N[I[t]];
        assert.ok(g[0] * n[0] + g[1] * n[1] + g[2] * n[2] > 0, 'winds with its normal');
        const up = o.plate === 'sphere' ? a.map((v) => v / Math.hypot(...a)) : [0, 1, 0];
        assert.ok(n[0] * up[0] + n[1] * up[1] + n[2] * up[2] > 0.99, 'faces up');
      }
      // the first street of the kind: its strip is centred on the street, as wide as the street, 5 cm above it
      const r = mine[0], q = P.slice(0, 4), mid = (i, j) => [(q[i][0] + q[j][0]) / 2, (q[i][1] + q[j][1]) / 2, (q[i][2] + q[j][2]) / 2];
      const lift = o.plate === 'sphere' ? null : [0, 0.05, 0];
      if (lift) { assert.ok(near(mid(0, 1), [r.a[0], r.a[1] + 0.05, r.a[2]], 1e-3)); assert.ok(near(mid(2, 3), [r.b[0], r.b[1] + 0.05, r.b[2]], 1e-3)); }
      assert.ok(Math.abs(Math.hypot(q[0][0] - q[1][0], q[0][1] - q[1][1], q[0][2] - q[1][2]) - r.w) < 1e-3);
    });
  }
});

test('glTF --instanced: EXT_mesh_gpu_instancing with three equal-length instance accessors that add up to the city', () => {
  const L = city(), { doc, bin } = parseGLB(toGLB(L, { instanced: true }));
  assert.deepEqual(doc.extensionsUsed, ['EXT_mesh_gpu_instancing']);
  assert.equal(doc.extensionsRequired, undefined);
  const nodes = child(doc, 'buildings').children.map((i) => doc.nodes[i]);
  let total = 0; const seen = [];
  for (const n of nodes) {
    const at = n.extensions.EXT_mesh_gpu_instancing.attributes, counts = ['TRANSLATION', 'ROTATION', 'SCALE'].map((k) => doc.accessors[at[k]].count);
    assert.ok(counts[0] > 0 && counts[0] === counts[1] && counts[1] === counts[2], n.name);
    assert.deepEqual(['TRANSLATION', 'ROTATION', 'SCALE'].map((k) => doc.accessors[at[k]].type), ['VEC3', 'VEC4', 'VEC3']);
    assert.equal(n.extras, undefined);
    total += counts[0];
    // the instances are the same transforms the plain export writes on its nodes
    const T = triples(read(doc, bin, at.TRANSLATION)), S = triples(read(doc, bin, at.SCALE)), R = read(doc, bin, at.ROTATION);
    const unit = triples(read(doc, bin, doc.meshes[n.mesh].primitives[0].attributes.POSITION));
    const [, shape, , zone] = doc.meshes[n.mesh].name.split(':');
    const mine = L.buildings.map((b, i) => ({ b, i })).filter(({ b }) => b.shape === shape && b.zone === zone);
    assert.equal(mine.length, counts[0], n.name);
    mine.forEach(({ b, i }, k) => {
      const got = unit.map((p) => placed({ translation: T[k], scale: S[k], rotation: R.slice(4 * k, 4 * k + 4) }, p));
      assert.ok(sameSet(got, buildingMesh(b).verts, 2e-3), `instance of building ${i}`); // float32 translations
      seen.push(i);
    });
  }
  assert.equal(total, L.buildings.length);
  assert.equal(new Set(seen).size, L.buildings.length);
  const trees = child(doc, 'trees').children.map((i) => doc.nodes[i]);
  assert.equal(trees.length, 1);
  assert.equal(doc.accessors[trees[0].extensions.EXT_mesh_gpu_instancing.attributes.TRANSLATION].count, L.trees.length);
});

test('glTF ground: follows the sampler inside the plate, buildings stand on it, water lies at the water level', () => {
  const relief = { ...TOWN, terrain: 'relief' }, L = city(relief), el = sampler(relief), E = L.meta.world.extent;
  for (const b of L.buildings) assert.ok(Math.abs(b.pos[1] - el(b.pos[0], b.pos[2])) <= 0.01, 'a building base is on the sampled ground');
  const { doc, bin } = parseGLB(toGLB(L, { elevation: el, groundGrid: 64 }));
  const ground = child(doc, 'ground'), prim = doc.meshes[ground.mesh].primitives[0];
  const P = triples(read(doc, bin, prim.attributes.POSITION)), I = read(doc, bin, prim.indices), N = triples(read(doc, bin, prim.attributes.NORMAL));
  assert.ok(P.length > 2000 && P.length <= 65 * 65);
  let rim = 0;
  for (const p of P) {
    const r = Math.hypot(p[0], p[2]);
    assert.ok(r <= E * (1 + 1e-6), 'no ground outside the plate');
    if (r > E * (1 - 1e-6)) rim++;
    assert.ok(Math.abs(p[1] - el(p[0], p[2])) < 1e-3, 'ground height is the sampler');
  }
  assert.ok(rim > 100, 'the rim is closed with vertices pulled onto it');
  let area = 0;
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t], I[t + 1], I[t + 2]].map((i) => P[i]);
    const up = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]); // y of the cross product
    assert.ok(up > 0, 'ground triangles face up');
    area += up / 2;
  }
  assert.ok(Math.abs(area / (Math.PI * E * E) - 1) < 0.005, `the ground covers the plate (${(area / (Math.PI * E * E)).toFixed(4)})`);
  for (const n of N) assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-5 && n[1] > 0);
  // water: this relief has a finite water level
  const wl = L.meta.terrain.waterLevel;
  assert.ok(Number.isFinite(wl));
  const water = child(doc, 'water'), W = triples(read(doc, bin, doc.meshes[water.mesh].primitives[0].attributes.POSITION));
  assert.ok(W.every((p) => Math.abs(p[1] - wl) < 1e-4));
  assert.equal(doc.materials[doc.meshes[water.mesh].primitives[0].material].alphaMode, 'BLEND');
  // no sampler, no ground for a terrain city; valleys without canals have no water
  assert.equal(child(parseGLB(toGLB(L)).doc, 'ground'), null);
  assert.equal(child(parseGLB(toGLB(L)).doc, 'water'), null);
  const valleys = { ...TOWN, terrain: 'valleys' };
  assert.equal(child(parseGLB(toGLB(city(valleys), { elevation: sampler(valleys) })).doc, 'water'), null);
  // a flat plate gets its outline at y = 0, with or without a sampler; a square plate a square
  const flat = parseGLB(toGLB(city())), F = triples(read(flat.doc, flat.bin, flat.doc.meshes[child(flat.doc, 'ground').mesh].primitives[0].attributes.POSITION));
  assert.ok(F.length === 96 && F.every((p) => p[1] === 0 && Math.abs(Math.hypot(p[0], p[2]) - city().meta.world.extent) < 1e-3));
  const sq = city({ ...TOWN, plate: 'square' }), S = parseGLB(toGLB(sq)), Q = triples(read(S.doc, S.bin, S.doc.meshes[child(S.doc, 'ground').mesh].primitives[0].attributes.POSITION));
  assert.equal(Q.length, 4);
  assert.ok(Q.every((p) => Math.abs(Math.abs(p[0]) - sq.meta.world.extent) < 1e-3 && Math.abs(Math.abs(p[2]) - sq.meta.world.extent) < 1e-3));
  // the sphere has no ground mesh in this phase
  assert.equal(child(parseGLB(toGLB(city({ ...TOWN, plate: 'sphere' }))).doc, 'ground'), null);
});

test('glTF networks: one LINES mesh per network at true depth, under the OBJ names; refused without networks', () => {
  const L = withInfra(), { doc, bin } = parseGLB(toGLB(L, { infra: true })), I = L.infra;
  const want = { sewer_pipes: I.sewer.pipes.length, water_mains: I.water.mains.length, power_feeders: I.power.feeders.length, power_transmission: I.power.transmission.length, transit_tunnels: I.transit.tunnels.length, utility_tunnels: I.utilidors.length };
  const nodes = child(doc, 'underground').children.map((i) => doc.nodes[i]);
  assert.deepEqual(nodes.map((n) => n.name), Object.keys(want).filter((k) => want[k] > 0));
  for (const n of nodes) {
    const prim = doc.meshes[n.mesh].primitives[0];
    assert.equal(prim.mode, 1);
    assert.equal(prim.indices, undefined);
    assert.equal(doc.accessors[prim.attributes.POSITION].count, 2 * want[n.name], n.name);
    assert.equal(doc.materials[prim.material].name, `network:${n.name}`);
  }
  // true depth: the first sewer pipe starts at its upstream node, upDepth below the street
  const sewer = nodes.find((n) => n.name === 'sewer_pipes'), P = triples(read(doc, bin, doc.meshes[sewer.mesh].primitives[0].attributes.POSITION)), p0 = I.sewer.pipes[0], up = I.graph.nodes[p0.up].pos;
  assert.ok(near(P[0], [up[0], up[1] - p0.upDepth, up[2]], 1e-3));
  assert.ok(P.every((p) => p[1] < 0), 'under a flat plate everything is below zero');
  // every OBJ network object has its glTF node
  const objNames = [...L.infraToOBJ(L, 1).text.matchAll(/^o (\S+)/gm)].map((m) => m[1]);
  assert.deepEqual(nodes.map((n) => n.name), objNames);
  assert.equal(child(parseGLB(toGLB(L)).doc, 'underground'), null, 'not written unless asked for');
  assert.throws(() => toGLB(generateCity(TOWN), { infra: true }), /networks were asked for/);
  assert.throws(() => toGLB(L, { paint: 'rainbow' }), /paint must be/);
});

test('glTF scene: a city root with named groups, materials in the page’s colours, paint by era, years on the nodes', () => {
  const L = withInfra(), { doc } = parseGLB(toGLB(L, { infra: true, horizon: 100 }));
  assert.deepEqual(doc.scenes, [{ name: 'city', nodes: [0] }]);
  assert.equal(doc.nodes[0].name, 'city');
  assert.deepEqual(doc.nodes[0].children.map((i) => doc.nodes[i].name), ['buildings', 'roads', 'trees', 'ground', 'underground']);
  assert.deepEqual(doc.nodes[0].extras, { engine: ENGINE_VERSION, frequency: 432, plate: 'circle', preset: 'town', seed: 1, Q: 100, horizon: 100, paint: 'zone' });
  for (const a of doc.accessors) if (a.type === 'VEC3' && doc.bufferViews[a.bufferView].target === 34962 && a.min) assert.ok(a.min.every((v, k) => v <= a.max[k]));
  const linear = (hex) => [1, 3, 5].map((i) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  for (const m of doc.materials.filter((m) => m.name.startsWith('zone:'))) {
    const want = linear(EXPORT_COLORS.zone[m.name.slice(5)]);
    m.pbrMetallicRoughness.baseColorFactor.slice(0, 3).forEach((v, k) => assert.ok(Math.abs(v - want[k]) < 1e-4));
    assert.equal(m.pbrMetallicRoughness.metallicFactor, 0); assert.equal(m.pbrMetallicRoughness.roughnessFactor, 0.9);
  }
  // a chord painted by era: the materials are the eras, and both voices have buildings
  const C = city({ chord: [432, 540], preset: 'town' }), byEra = parseGLB(toGLB(C, { paint: 'era' })).doc;
  assert.deepEqual(byEra.materials.filter((m) => m.name.startsWith('era:')).map((m) => m.name).sort(), ['era:0', 'era:1']);
  assert.equal(byEra.materials.some((m) => m.name.startsWith('zone:')), false);
  child(byEra, 'buildings').children.forEach((i, k) => assert.ok(byEra.meshes[byEra.nodes[i].mesh].name.endsWith(`era:${C.buildings[k].era}`)));
  // a year of growth: nodes are named by the building's number in the full plan and carry their dates
  const frame = cityAt(city(), { year: 30 }).layout, Y = parseGLB(toGLB(frame, { horizon: 100 })).doc;
  assert.equal(Y.nodes[0].extras.year, 30);
  child(Y, 'buildings').children.forEach((i, k) => {
    const n = Y.nodes[i], b = frame.buildings[k];
    assert.equal(n.name, `b${b.source}`);
    assert.equal(n.extras.index, b.source); assert.equal(n.extras.built, b.built); assert.equal(n.extras.rebuilt, b.rebuilt);
  });
  // trees can be left out
  assert.equal(child(parseGLB(toGLB(city(), { trees: false })).doc, 'trees'), null);
});

test('glTF, GeoJSON and CityJSON are deterministic: twice in one process and in two processes, byte for byte', () => {
  const relief = { ...TOWN, terrain: 'relief' };
  assert.deepEqual(toGLB(city(relief), { elevation: sampler(relief) }), toGLB(generateCity(relief), { elevation: sampler(relief) }));
  assert.equal(toGeoJSON(city(), { origin: [45, 7] }), toGeoJSON(generateCity(TOWN), { origin: [45, 7] }));
  assert.equal(toCityJSON(city()), toCityJSON(generateCity(TOWN)));
  const one = mkdtempSync(join(tmpdir(), 'fmt-')), two = mkdtempSync(join(tmpdir(), 'fmt-'));
  const files = { 'a.glb': [], 'a.gltf': [], 'a.geojson': ['--origin', '45,7'], 'a.city.json': [] };
  for (const dir of [one, two]) for (const [name, extra] of Object.entries(files)) {
    const r = spawnSync(process.execPath, [CLI, 'generate', '-f', '432', '--preset', 'town', '--terrain', 'relief', '--infra', '--out', join(dir, name), ...extra], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }
  for (const name of [...Object.keys(files), 'a.bin']) assert.ok(readFileSync(join(one, name)).equals(readFileSync(join(two, name))), name);
  // and the files are what the functions return
  const L = withInfra(relief);
  assert.ok(readFileSync(join(one, 'a.glb')).equals(Buffer.from(toGLB(L, { infra: true, elevation: sampler(relief) }))));
  assert.equal(readFileSync(join(one, 'a.geojson'), 'utf8'), toGeoJSON(L, { infra: true, origin: [45, 7] }));
  assert.equal(readFileSync(join(one, 'a.city.json'), 'utf8'), toCityJSON(L));
  const pair = toGLTF(L, { infra: true, elevation: sampler(relief), binName: 'a.bin' });
  assert.equal(readFileSync(join(one, 'a.gltf'), 'utf8'), pair.json);
  assert.ok(readFileSync(join(one, 'a.bin')).equals(Buffer.from(pair.bin)));
});

test('CLI generate: the extension names the format, longest first; GeoJSON needs an origin; one line out', () => {
  assert.deepEqual(['x.city.json', 'x.geojson', 'x.gltf', 'x.glb', 'x.obj', 'x.json', 'X.GLB', 'x.fbx', 'city.json.bak'].map(formatOf), ['cityjson', 'geojson', 'gltf', 'glb', 'obj', 'json', 'glb', null, null]);
  const args = ['-f', '432', '--preset', 'town'];
  const glb = tmp('town.glb'), r = cli('generate', ...args, '--out', glb, '--json'), said = JSON.parse(r.out);
  assert.deepEqual(said, { wrote: glb, bytes: readFileSync(glb).length, format: 'glb', buildings: city().buildings.length });
  assert.ok(r.out.length < 400, 'one short line, never the geometry');
  const gltf = tmp('town.gltf'), g = JSON.parse(cli('generate', ...args, '--out', gltf, '--json').out);
  assert.deepEqual(g.also, { file: gltf.replace(/\.gltf$/, '.bin'), bytes: readFileSync(gltf.replace(/\.gltf$/, '.bin')).length });
  assert.match(cli('generate', ...args, '--out', tmp('i.glb'), '--instanced').out, /per-building extras are not written/);
  assert.throws(() => cli('generate', ...args, '--out', tmp('town.geojson')), /--origin latitude,longitude/);
  assert.throws(() => cli('generate', ...args, '--out', tmp('town.geojson'), '--origin', '45'), /latitude,longitude/);
  assert.throws(() => cli('generate', ...args, '--plate', 'sphere', '--out', tmp('s.geojson'), '--origin', '45,7'), /sphere/);
  assert.throws(() => cli('generate', ...args, '--plate', 'sphere', '--out', tmp('s.city.json')), /sphere/);
  assert.throws(() => cli('generate', ...args), /needs --out/);
  // --format overrides the extension; a bearing reaches the file
  const odd = tmp('town.data');
  cli('generate', ...args, '--out', odd, '--format', 'geojson', '--origin', '45,7', '--bearing', '30');
  assert.deepEqual(JSON.parse(readFileSync(odd, 'utf8')).cymatic, { engine: ENGINE_VERSION, frequency: 432, plate: 'circle', preset: 'town', seed: 1, Q: 100, origin: [45, 7], bearing: 30 });
  // a terrain city exported through the CLI comes with its ground
  const hills = tmp('hills.glb');
  cli('generate', ...args, '--terrain', 'relief', '--out', hills);
  assert.ok(child(parseGLB(new Uint8Array(readFileSync(hills))).doc, 'ground'));
});

// ---------------------------------------------------------------- GeoJSON
const WGS = { a: 6378137, f: 1 / 298.257223563 };
// geodetic → local east/north at an origin (the inverse of the exporter's projection, written separately)
function toEastNorth([lat0, lon0], [lon, lat]) {
  const rad = Math.PI / 180, e2 = WGS.f * (2 - WGS.f);
  const ecef = (la, lo) => { const s = Math.sin(la * rad), N = WGS.a / Math.sqrt(1 - e2 * s * s); return [N * Math.cos(la * rad) * Math.cos(lo * rad), N * Math.cos(la * rad) * Math.sin(lo * rad), N * (1 - e2) * s]; };
  const O = ecef(lat0, lon0), P = ecef(lat, lon), d = [P[0] - O[0], P[1] - O[1], P[2] - O[2]];
  const sp = Math.sin(lat0 * rad), cp = Math.cos(lat0 * rad), sl = Math.sin(lon0 * rad), cl = Math.cos(lon0 * rad);
  return [-sl * d[0] + cl * d[1], -sp * cl * d[0] - sp * sl * d[1] + cp * d[2]];
}
const shoelace = (ring) => { let s = 0; for (let i = 0; i + 1 < ring.length; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]; return s / 2; };

test('GeoJSON projection: the four pyproj reference points to 1e-8 degrees; a bearing turns plan-north', () => {
  const vectors = [ // origin [lat, lon], east/north metres, expected [lat, lon] (pyproj 3.8 topocentric pipeline, WGS84)
    [[45, 7], [3000, 2000], [45.017990282, 7.038060361]],
    [[60, 10], [-4200, 4200], [60.037676226, 9.924645498]],
    [[0, 0], [1000, -1000], [-0.009043695, 0.008983153]],
    [[-33.9, 151.2], [2500, -700], [-33.906307853, 151.22703109]],
  ];
  for (const [origin, [e, n], [lat, lon]] of vectors) {
    const got = geoProjector(origin)(e, -n); // plan x is east, plan −z is north
    assert.ok(Math.abs(got[1] - lat) < 1e-8 && Math.abs(got[0] - lon) < 1e-8, `${origin}: got ${got[1]}, ${got[0]}`);
  }
  // the origin maps to itself
  const o = geoProjector([45, 7])(0, 0);
  assert.ok(Math.abs(o[0] - 7) < 1e-12 && Math.abs(o[1] - 45) < 1e-12);
  // bearing 90: plan-north (−z) now points east; bearing 0 keeps it north
  const north0 = geoProjector([45, 7], 0)(0, -1000), north90 = geoProjector([45, 7], 90)(0, -1000), east0 = geoProjector([45, 7], 0)(1000, 0);
  assert.ok(north0[1] > 45.008 && Math.abs(north0[0] - 7) < 1e-9);
  assert.ok(Math.abs(north90[0] - east0[0]) < 1e-9 && Math.abs(north90[1] - east0[1]) < 1e-9);
  // and plan-east (x) points south at bearing 90
  const east90 = geoProjector([45, 7], 90)(1000, 0);
  assert.ok(east90[1] < 44.992 && Math.abs(east90[0] - 7) < 1e-9);
  // distances survive: 5 km of plan is 5 km of ground within a centimetre
  const [e, n] = toEastNorth([60, 10], geoProjector([60, 10], 37)(3000, -4000));
  assert.ok(Math.abs(Math.hypot(e, n) - 5000) < 0.01, `${Math.hypot(e, n)}`);
});

test('GeoJSON structure: a FeatureCollection of closed counter-clockwise rings in range, inside its bbox, one feature per thing', () => {
  const L = withInfra(), origin = [45.07, 7.69], doc = JSON.parse(toGeoJSON(L, { origin, infra: true }));
  assert.equal(doc.type, 'FeatureCollection');
  assert.deepEqual(doc.cymatic, { engine: ENGINE_VERSION, frequency: 432, plate: 'circle', preset: 'town', seed: 1, Q: 100, origin, bearing: 0 });
  const [w, s, e, n] = doc.bbox;
  assert.ok(w < e && s < n && w > 7.67 && e < 7.71 && s > 45.06 && n < 45.08);
  const count = {}, ids = new Set();
  const within = (c) => { assert.equal(c.length, 2); assert.ok(c[0] >= w && c[0] <= e && c[1] >= s && c[1] <= n, 'inside the bbox'); assert.ok(Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90); assert.equal(c[0], Number(c[0].toFixed(7))); assert.equal(c[1], Number(c[1].toFixed(7))); };
  let touches = [false, false, false, false];
  for (const f of doc.features) {
    assert.equal(f.type, 'Feature');
    assert.ok(typeof f.id === 'string' && !ids.has(f.id), `unique id ${f.id}`); ids.add(f.id);
    count[f.properties.kind] = (count[f.properties.kind] ?? 0) + 1;
    const g = f.geometry, all = g.type === 'Point' ? [g.coordinates] : g.type === 'LineString' ? g.coordinates : g.coordinates.flat();
    all.forEach(within);
    for (const c of all) touches = [touches[0] || c[0] === w, touches[1] || c[1] === s, touches[2] || c[0] === e, touches[3] || c[1] === n];
    if (g.type === 'Polygon') {
      assert.equal(g.coordinates.length, 1);
      const ring = g.coordinates[0];
      assert.ok(ring.length >= 5, 'at least four corners and the closing position');
      assert.deepEqual(ring[0], ring[ring.length - 1], 'closed');
      assert.ok(shoelace(ring) > 0, 'exterior ring runs counter-clockwise');
    } else if (g.type === 'LineString') assert.equal(g.coordinates.length, 2);
    else assert.equal(g.type, 'Point');
  }
  assert.deepEqual(touches, [true, true, true, true], 'the bbox is tight');
  const I = L.infra;
  assert.deepEqual(count, {
    building: L.buildings.length, road: L.roads.length, tree: L.trees.length,
    ...Object.fromEntries(Object.entries({ metroStation: I.transit.stations.length, substation: I.power.substations.length, powerPlant: I.power.plants.length, waterTank: I.water.towers.length, liftStation: I.sewer.liftStations.length, treatmentPlant: I.sewer.plants.length,
      sewerPipe: I.sewer.pipes.length, waterMain: I.water.mains.length, powerFeeder: I.power.feeders.length, powerTransmission: I.power.transmission.length, metroTunnel: I.transit.tunnels.length, utilityTunnel: I.utilidors.length }).filter(([, v]) => v > 0)),
  });
  // properties, on the first building, the first road and the first sewer pipe
  const b = L.buildings[0], fb = doc.features.find((f) => f.id === 'b0');
  assert.deepEqual(fb.properties, { kind: 'building', index: 0, district: b.district, zone: b.zone, floors: b.floors, height: Math.round(b.h * 1000) / 1000, elevation: 0, shape: b.shape, era: 0, landmark: !!b.landmark });
  const r = L.roads[0], fr = doc.features.find((f) => f.id === 'r0');
  assert.deepEqual(fr.properties, { kind: 'road', roadKind: r.kind, width: Math.round(r.w * 1000) / 1000, era: 0, bridge: false });
  const pipe = I.sewer.pipes[0], fp = doc.features.find((f) => f.id === 'sewer0');
  assert.equal(fp.properties.depth, Math.round(pipe.upDepth * 1000) / 1000); assert.equal(fp.properties.diameter, pipe.diameter);
  // without --infra there are no network features; without networks the request is refused
  assert.equal(JSON.parse(toGeoJSON(L, { origin })).features.length, L.buildings.length + L.roads.length + L.trees.length);
  assert.throws(() => toGeoJSON(generateCity(TOWN), { origin, infra: true }), /networks were asked for/);
  // a year of growth carries its dates
  const frame = cityAt(city(), { year: 30 }).layout, Y = JSON.parse(toGeoJSON(frame, { origin, horizon: 100 }));
  assert.equal(Y.cymatic.year, 30); assert.equal(Y.cymatic.horizon, 100);
  const f0 = Y.features[0];
  assert.equal(f0.id, `b${frame.buildings[0].source}`); assert.equal(f0.properties.built, frame.buildings[0].built);
});

test('GeoJSON keeps the metres: footprints measured back on the ground have the area and place the plan gave them', () => {
  for (const [origin, bearing] of [[[45.07, 7.69], 0], [[-33.9, 151.2], 250], [[64.1, -21.9], 37]]) {
    const L = city(), doc = JSON.parse(toGeoJSON(L, { origin, bearing }));
    const rad = Math.PI / 180, cb = Math.cos(bearing * rad), sb = Math.sin(bearing * rad);
    let total = 0, want = 0;
    L.buildings.forEach((b, i) => {
      const ring = doc.features[i].geometry.coordinates[0].map((c) => toEastNorth(origin, c)), area = shoelace(ring);
      const prism = b.shape === 'block' || b.shape === 'house' || b.shape === 'tower' || b.shape === 'terrace';
      const plan = prism ? b.w * b.d : 2 * Math.SQRT2 * (b.w / 2) * (b.d / 2); // an octagon inscribed in the w × d ellipse
      total += area; want += plan;
      // seven decimals of a degree is about a centimetre, so a single small footprint is good to half a per cent…
      assert.ok(Math.abs(area / plan - 1) < 0.005, `building ${i}: ${area} vs ${plan}`);
      // the footprint is where the plan put it: its centre, turned by the bearing
      const cx = ring.slice(0, -1).reduce((s2, p) => s2 + p[0], 0) / (ring.length - 1), cy = ring.slice(0, -1).reduce((s2, p) => s2 + p[1], 0) / (ring.length - 1);
      const e0 = b.pos[0], n0 = -b.pos[2];
      assert.ok(Math.hypot(cx - (e0 * cb + n0 * sb), cy - (-e0 * sb + n0 * cb)) < 0.02, `building ${i} is in place`);
    });
    // …and over the town the rounding averages out: the built area is right within 0.1 %
    assert.ok(Math.abs(total / want - 1) < 0.001, `${origin}: ${total} vs ${want}`);
    // streets keep their length
    const r = L.roads[0], line = doc.features[L.buildings.length].geometry.coordinates.map((c) => toEastNorth(origin, c));
    assert.ok(Math.abs(Math.hypot(line[1][0] - line[0][0], line[1][1] - line[0][1]) - Math.hypot(r.b[0] - r.a[0], r.b[2] - r.a[2])) < 0.02);
  }
});

test('GeoJSON refuses a sphere, a polar origin, a missing or malformed origin and the antimeridian, each with its reason', () => {
  const L = city();
  assert.throws(() => toGeoJSON(city({ ...TOWN, plate: 'sphere' }), { origin: [45, 7] }), /sphere plate is a world of its own/);
  assert.throws(() => toGeoJSON(L, {}), /origin \[latitude, longitude\] is required/);
  assert.throws(() => toGeoJSON(L, { origin: [89.5, 7] }), /too close to a pole/);
  assert.throws(() => toGeoJSON(L, { origin: [-89.01, 7] }), /too close to a pole/);
  assert.throws(() => toGeoJSON(L, { origin: [45, 181] }), /outside ±180/);
  for (const bad of ['45,7', [45], [45, 7, 0], [45, NaN], ['45', '7'], null]) assert.throws(() => toGeoJSON(L, { origin: bad }), /origin must be \[latitude, longitude\]/, JSON.stringify(bad));
  assert.throws(() => toGeoJSON(L, { origin: [45, 7], bearing: 'north' }), /bearing must be a number/);
  assert.throws(() => toGeoJSON(L, { origin: [10, 179.999] }), /antimeridian/);
  assert.throws(() => toGeoJSON(L, { origin: [10, -179.999] }), /antimeridian/);
  assert.doesNotThrow(() => toGeoJSON(L, { origin: [89, 7] }));
  assert.doesNotThrow(() => toGeoJSON(L, { origin: [10, 179.9] })); // 11 km from the line: a town fits
});

// ---------------------------------------------------------------- CityJSON
// A structural validator for the parts of CityJSON 2.0 this engine writes.
function checkCityJSON(doc) {
  const problems = [], bad = (m) => { if (problems.length < 10) problems.push(m); };
  if (doc.type !== 'CityJSON') bad('type'); if (doc.version !== '2.0') bad('version');
  const t = doc.transform;
  if (!t || !Array.isArray(t.scale) || t.scale.length !== 3 || !Array.isArray(t.translate) || t.translate.length !== 3 || ![...t.scale, ...t.translate].every(Number.isFinite) || !t.scale.every((v) => v > 0)) bad('transform');
  if (!Array.isArray(doc.vertices)) bad('vertices'); if (!doc.CityObjects || typeof doc.CityObjects !== 'object') bad('CityObjects');
  const seen = new Set(), used = new Uint8Array(doc.vertices.length);
  doc.vertices.forEach((v, i) => {
    if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isInteger)) bad(`vertex ${i} is not an integer triple`);
    const k = v.join(','); if (seen.has(k)) bad(`duplicate vertex ${i}`); seen.add(k);
  });
  const TYPES = { Building: ['Solid'], Road: ['MultiSurface'] }, SEM = { Building: ['GroundSurface', 'WallSurface', 'RoofSurface'], Road: ['TrafficArea'] };
  const ring = (id, r) => {
    if (!Array.isArray(r) || !r.every((i) => Number.isInteger(i) && i >= 0 && i < doc.vertices.length)) return bad(`${id}: ring index out of range`);
    if (new Set(r).size < 3 || new Set(r).size !== r.length) bad(`${id}: ring needs three or more distinct vertices`);
    for (const i of r) used[i] = 1;
  };
  for (const [id, o] of Object.entries(doc.CityObjects)) {
    if (!TYPES[o.type]) { bad(`${id}: type ${o.type}`); continue; }
    if (!Array.isArray(o.geometry) || o.geometry.length !== 1) { bad(`${id}: geometry`); continue; }
    const g = o.geometry[0];
    if (!TYPES[o.type].includes(g.type)) bad(`${id}: geometry type ${g.type}`);
    if (typeof g.lod !== 'string' || !/^\d(\.\d)?$/.test(g.lod)) bad(`${id}: lod ${g.lod}`);
    const surfaces = g.type === 'Solid' ? g.boundaries.flat() : g.boundaries, shells = g.type === 'Solid' ? g.boundaries.length : null;
    if (g.type === 'Solid' && shells !== 1) bad(`${id}: one shell expected`);
    for (const s of surfaces) { if (!Array.isArray(s) || s.length !== 1) bad(`${id}: a surface is one ring`); else ring(id, s[0]); }
    const sem = g.semantics;
    if (!sem || !Array.isArray(sem.surfaces) || !sem.surfaces.every((x) => SEM[o.type].includes(x.type))) { bad(`${id}: semantics.surfaces`); continue; }
    const values = g.type === 'Solid' ? sem.values : [sem.values];
    if (!Array.isArray(values) || values.length !== (g.type === 'Solid' ? g.boundaries.length : 1)) { bad(`${id}: semantics.values depth`); continue; }
    values.forEach((vs, k) => {
      const n = g.type === 'Solid' ? g.boundaries[k].length : g.boundaries.length;
      if (!Array.isArray(vs) || vs.length !== n) bad(`${id}: semantics.values is not shaped like the boundaries`);
      else if (!vs.every((v) => v === null || (Number.isInteger(v) && v >= 0 && v < sem.surfaces.length))) bad(`${id}: semantics value out of range`);
    });
  }
  if (used.some((u) => !u)) bad('unused vertices');
  const ext = doc.metadata?.geographicalExtent;
  if (!Array.isArray(ext) || ext.length !== 6 || !ext.every(Number.isFinite) || ext[0] > ext[3] || ext[1] > ext[4] || ext[2] > ext[5]) bad('metadata.geographicalExtent');
  if (doc.metadata?.referenceSystem !== undefined) bad('no CRS is written for local coordinates');
  return problems;
}
const decode = (doc, i) => { const v = doc.vertices[i], t = doc.transform; return [v[0] * t.scale[0] + t.translate[0], v[1] * t.scale[1] + t.translate[1], v[2] * t.scale[2] + t.translate[2]]; };
const toPlan = ([X, Y, Z]) => [X, Z, -Y]; // CityJSON X east, Y north, Z up → plan x, y up, z south

test('CityJSON structure: valid for a town, a terrain town, a chord, a megastructure, an alien city and a year of growth', () => {
  const cases = [TOWN, { ...TOWN, terrain: 'valleys' }, { chord: [432, 540], preset: 'town' }, { frequency: 432, preset: 'megastructure', plate: 'square' }, { frequency: 300, preset: 'alien', seed: 3 }];
  for (const o of cases) {
    const L = city(o), doc = JSON.parse(toCityJSON(L));
    assert.deepEqual(checkCityJSON(doc), [], JSON.stringify(o));
    assert.deepEqual(doc.transform.scale, [0.001, 0.001, 0.001]);
    const buildings = Object.entries(doc.CityObjects).filter(([, v]) => v.type === 'Building');
    assert.equal(buildings.length, L.buildings.length);
    assert.deepEqual(buildings.map(([k]) => k), L.buildings.map((_, i) => `b${i}`));
    const groups = new Set(L.roads.map((r) => `road-${r.kind}-era${r.era ?? 0}`));
    assert.deepEqual(Object.keys(doc.CityObjects).filter((k) => doc.CityObjects[k].type === 'Road').sort(), [...groups].sort());
    assert.equal(Object.keys(doc.CityObjects).length, L.buildings.length + groups.size);
    // the translation is the minimum corner (so no coordinate is negative) and the extent holds every vertex
    assert.ok(doc.vertices.every((v) => v.every((c) => c >= 0)));
    for (let k = 0; k < 3; k++) assert.equal(doc.vertices.reduce((m, v) => Math.min(m, v[k]), Infinity), 0);
    const ext = doc.metadata.geographicalExtent;
    for (let i = 0; i < doc.vertices.length; i += 97) { const p = decode(doc, i); for (let k = 0; k < 3; k++) assert.ok(p[k] >= ext[k] - 1e-3 && p[k] <= ext[k + 3] + 1e-3); }
    assert.match(doc.metadata.title, /^Cymatic City Engine \d+\.\d+\.\d+ · /);
    assert.deepEqual(Object.keys(doc).sort(), ['CityObjects', 'metadata', 'transform', 'type', 'version', 'vertices']);
  }
  const frame = cityAt(city(), { year: 30 }).layout, Y = JSON.parse(toCityJSON(frame, { horizon: 100 }));
  assert.deepEqual(checkCityJSON(Y), []);
  assert.match(Y.metadata.title, /year 30 of 100$/);
  const first = frame.buildings[0];
  assert.equal(Y.CityObjects[`b${first.source}`].attributes.built, first.built);
  // the validator itself notices what it is there for
  const broken = JSON.parse(toCityJSON(city()));
  broken.vertices.push([...broken.vertices[0]]); broken.CityObjects.b0.geometry[0].lod = 'one'; broken.CityObjects.b1.geometry[0].semantics.values[0].pop(); broken.CityObjects.b2.geometry[0].boundaries[0][0][0][0] = 1e9;
  const found = checkCityJSON(broken).join('; ');
  for (const want of ['duplicate vertex', 'lod one', 'not shaped like the boundaries', 'out of range', 'unused vertices']) assert.ok(found.includes(want), `${want} in: ${found}`);
});

test('CityJSON is faithful: each Building is buildingMesh under the axis map within 1 mm, with its attributes and surfaces', () => {
  for (const o of [TOWN, { ...TOWN, terrain: 'valleys' }, { frequency: 300, preset: 'alien', seed: 3 }]) {
    const L = city(o), doc = JSON.parse(toCityJSON(L));
    L.buildings.forEach((b, i) => {
      const obj = doc.CityObjects[`b${i}`], g = obj.geometry[0], mesh = buildingMesh(b), sides = mesh.verts.length / 2;
      const idx = [...new Set(g.boundaries.flat(3))], got = idx.map((v) => toPlan(decode(doc, v)));
      assert.ok(sameSet(got, mesh.verts, 1e-3), `${JSON.stringify(o)} building ${i}`);
      assert.equal(idx.length, mesh.verts.length);
      assert.equal(g.type, 'Solid');
      assert.equal(g.lod, b.shape === 'house' || b.shape === 'dome' || b.shape === 'spire' ? '2' : '1', b.shape);
      assert.equal(g.boundaries[0].length, sides + 2);
      assert.deepEqual(g.semantics.surfaces, [{ type: 'GroundSurface' }, { type: 'WallSurface' }, { type: 'RoofSurface' }]);
      assert.deepEqual(g.semantics.values, [[...Array(sides).fill(1), 0, 2]]);
      // the surface called the ground is the lowest, the roof the highest
      const zOf = (s) => s[0].reduce((a, v) => a + decode(doc, v)[2], 0) / s[0].length, surf = g.boundaries[0];
      assert.ok(zOf(surf[sides]) < zOf(surf[0]) && zOf(surf[0]) < zOf(surf[sides + 1]));
      assert.deepEqual(obj.attributes, { measuredHeight: Math.round(b.h * 1000) / 1000, storeysAboveGround: b.floors, zone: b.zone, district: b.district, shape: b.shape, era: b.era ?? 0, landmark: !!b.landmark });
    });
  }
});

test('CityJSON solids are closed and face outward: every edge is used twice, once each way, and the volume is positive', () => {
  for (const o of [TOWN, { ...TOWN, terrain: 'valleys' }, { frequency: 300, preset: 'alien', seed: 3 }, { frequency: 432, preset: 'megastructure' }]) {
    const L = city(o), doc = JSON.parse(toCityJSON(L));
    L.buildings.forEach((b, i) => {
      const surf = doc.CityObjects[`b${i}`].geometry[0].boundaries[0], edges = new Map();
      let volume6 = 0;
      const ref = decode(doc, surf[0][0][0]);
      for (const [ring] of surf) {
        for (let k = 0; k < ring.length; k++) { const key = `${ring[k]}>${ring[(k + 1) % ring.length]}`; edges.set(key, (edges.get(key) ?? 0) + 1); }
        const P = ring.map((v) => { const p = decode(doc, v); return [p[0] - ref[0], p[1] - ref[1], p[2] - ref[2]]; });
        for (let k = 1; k + 1 < P.length; k++) volume6 += P[0][0] * (P[k][1] * P[k + 1][2] - P[k][2] * P[k + 1][1]) - P[0][1] * (P[k][0] * P[k + 1][2] - P[k][2] * P[k + 1][0]) + P[0][2] * (P[k][0] * P[k + 1][1] - P[k][1] * P[k + 1][0]);
      }
      for (const [key, n] of edges) { const [a, c] = key.split('>'); assert.ok(n === 1 && edges.get(`${c}>${a}`) === 1, `${JSON.stringify(o)} building ${i}: edge ${key}`); }
      assert.ok(volume6 > 0, `building ${i} faces outward (signed volume ${volume6 / 6})`);
      // and the volume is the solid's: a prism is w·d·h, a tapered shape less
      const full = (b.shape === 'pod' || b.shape === 'dome' || b.shape === 'spire' ? 2 * Math.SQRT2 * 0.25 : 1) * b.w * b.d * b.h, taper = { house: 0.6, dome: 0.35, spire: 0.08 }[b.shape] ?? 1;
      const want = full * (1 + taper + taper * taper) / 3; // a frustum between similar rings
      assert.ok(Math.abs(volume6 / 6 / want - 1) < 0.01, `building ${i} (${b.shape}): ${volume6 / 6} vs ${want}`);
    });
  }
});

test('CityJSON roads are traffic areas facing up; a sphere is refused', () => {
  const L = city({ chord: [432, 540], preset: 'town' }), doc = JSON.parse(toCityJSON(L));
  let surfaces = 0, length = 0;
  for (const [id, o] of Object.entries(doc.CityObjects).filter(([, v]) => v.type === 'Road')) {
    const g = o.geometry[0];
    assert.equal(g.type, 'MultiSurface'); assert.equal(g.lod, '1');
    assert.deepEqual(g.semantics.surfaces, [{ type: 'TrafficArea' }]);
    assert.ok(g.semantics.values.every((v) => v === 0) && g.semantics.values.length === g.boundaries.length);
    const mine = L.roads.filter((r) => r.kind === o.attributes.roadKind && (r.era ?? 0) === o.attributes.era);
    assert.equal(id, `road-${o.attributes.roadKind}-era${o.attributes.era}`);
    assert.equal(g.boundaries.length, mine.length);
    const len = mine.reduce((s, r) => s + Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1], r.b[2] - r.a[2]), 0);
    assert.ok(Math.abs(o.attributes.lengthM - len) <= 0.05);
    for (const [ring] of g.boundaries) {
      assert.equal(ring.length, 4);
      const P = ring.map((v) => decode(doc, v)); let a2 = 0;
      for (let k = 0; k < 4; k++) a2 += P[k][0] * P[(k + 1) % 4][1] - P[(k + 1) % 4][0] * P[k][1];
      assert.ok(a2 > 0, 'counter-clockwise seen from above: the road faces up');
    }
    surfaces += g.boundaries.length; length += len;
  }
  assert.equal(surfaces, L.roads.length);
  assert.ok(new Set(L.roads.map((r) => r.era ?? 0)).size === 2, 'the chord has streets of both voices');
  assert.throws(() => toCityJSON(city({ ...TOWN, plate: 'sphere' })), /sphere plate has no flat map/);
});
