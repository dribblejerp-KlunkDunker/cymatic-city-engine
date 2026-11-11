// Cymatic City Engine — exchange formats.
// glTF 2.0 (.glb / .gltf + .bin) for 3D tools and game engines, GeoJSON (RFC 7946) for GIS, CityJSON 2.0 for
// city-model tools. Pure functions of a layout: no dependencies, no I/O, worker-safe, and deterministic (the
// same layout and options give the same bytes).
import { ENGINE_VERSION, buildingMesh, PRESETS } from './cymatic-engine.js';
import { underground } from './infrastructure.js';

// the viewer's colours, so an exported city looks like the one on the page
export const EXPORT_COLORS = {
  zone: { core: '#ffb347', mixed: '#d9c27a', residential: '#7fa6b8', green: '#4d8a4a' },
  era: ['#e3905f', '#63a9be', '#b7d36b'],
  road: { boulevard: '#efe2c2', ring: '#b9ac8d', spoke: '#8c8574', wall: '#d3a658' },
  tree: '#4f7a4a', ground: '#3a3830', water: '#3fa7e0',
  network: { sewer_pipes: '#a8864a', water_mains: '#3fa7e0', power_feeders: '#f2c14e', power_transmission: '#ef6a4a', transit_tunnels: '#9fb6c8', utility_tunnels: '#d7cbb0' },
};

// ---------------------------------------------------------------- small vector helpers
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const unit3 = (a) => { const l = len3(a); return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };
const round = (x, digits) => { const k = 10 ** digits, r = Math.round(x * k) / k; return r === 0 ? 0 : r; }; // never -0
const isSphere = (layout) => layout.meta.plate === 'sphere';
// Newell's method: the normal of a planar polygon, facing the side its vertices run counter-clockwise on
function polygonNormal(pts) {
  const n = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return unit3(n);
}
// unit quaternion [x, y, z, w] of the rotation whose columns are X, Y, Z (an orthonormal right-handed basis)
function quatOfBasis(X, Y, Z) {
  const m00 = X[0], m10 = X[1], m20 = X[2], m01 = Y[0], m11 = Y[1], m21 = Y[2], m02 = Z[0], m12 = Z[1], m22 = Z[2];
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) { const s = 2 * Math.sqrt(tr + 1); q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4]; }
  else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s]; }
  else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s]; }
  const l = Math.hypot(q[0], q[1], q[2], q[3]), sign = q[3] < 0 ? -1 : 1; // one of the two equal quaternions: w ≥ 0
  return q.map((v) => round((sign * v) / l, 6));
}
// the building's own frame, exactly as buildingMesh builds it
const frameOf = (b) => ({ X: b.fwd, Y: b.up, Z: unit3(cross3(b.fwd, b.up)) });
// a frame for something that only knows which way is up (trees)
function frameOfUp(up) {
  if (up[1] > 0.999999) return { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }; // upright: no turn at all
  const X = unit3(cross3(up, Math.abs(up[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1])); // perpendicular to up
  return { X, Y: up, Z: unit3(cross3(X, up)) };
}
const isIdentity = (q) => q[0] === 0 && q[1] === 0 && q[2] === 0 && q[3] === 1;
const hexToLinear = (hex) => [1, 3, 5].map((i) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return round(c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4, 4); });
const describe = (meta) => (meta.chord && meta.chord.length > 1 ? `chord ${meta.chord.map((v) => v.hz).join(' + ')} Hz` : `${meta.frequency} Hz`);
// the inputs that identify the city, for the files' own records
function identityOf(layout, extra = {}) {
  const m = layout.meta, id = { engine: ENGINE_VERSION };
  if (m.chord && m.chord.length > 1) id.chord = m.chord.map((v) => ({ hz: v.hz, weight: v.weight })); else id.frequency = m.frequency;
  Object.assign(id, { plate: m.plate, preset: m.preset, seed: m.seed, Q: m.Q });
  if (m.year !== undefined) id.year = m.year;
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null) id[k] = v;
  return id;
}

// ---------------------------------------------------------------- shared geometry
// A flat-shaded triangle mesh from polygons: vertices split per face, each with the face's normal.
function flatMesh(verts, faces) {
  const positions = [], normals = [], indices = [];
  for (const f of faces) {
    const pts = f.map((i) => verts[i]), n = polygonNormal(pts), base = positions.length / 3;
    for (const p of pts) { positions.push(p[0], p[1], p[2]); normals.push(n[0], n[1], n[2]); }
    for (let k = 1; k + 1 < pts.length; k++) indices.push(base, base + k, base + k + 1);
  }
  return { positions, normals, indices };
}
const UNIT_FRAME = { pos: [0, 0, 0], up: [0, 1, 0], fwd: [1, 0, 0], w: 1, d: 1, h: 1 };
// The unit building of a shape: buildingMesh at the origin with w = d = h = 1 (x = fwd, y = up, z = right).
// Scaled by (w, h, d), turned to the building's frame and moved to its position, it is that building's mesh.
export function unitBuildingMesh(shape) {
  const { verts, faces } = buildingMesh({ ...UNIT_FRAME, shape });
  return flatMesh(verts, faces);
}
// the viewer's tree: a five-sided cone, one unit across and 1.8 tall
function unitTreeMesh() {
  const n = 5, verts = [];
  for (let i = 0; i < n; i++) { const t = (2 * Math.PI * i) / n; verts.push([0.5 * Math.cos(t), 0, 0.5 * Math.sin(t)]); }
  verts.push([0, 1.8, 0]);
  const faces = [];
  for (let i = 0; i < n; i++) faces.push([n, (i + 1) % n, i]); // sides, facing out
  faces.push([...Array(n).keys()]);                            // base, facing down
  return flatMesh(verts, faces);
}
// the road as the flat strip toOBJ writes: four corners, 5 cm above its line, counter-clockwise seen from above
function roadStrip(layout, r) {
  const d = sub3(r.b, r.a);
  if (len3(d) < 1e-9) return null;
  const up = isSphere(layout) ? unit3(add3(r.a, r.b)) : [0, 1, 0];
  const side = mul3(unit3(cross3(up, unit3(d))), r.w / 2), lift = mul3(up, 0.05);
  return { up, corners: [add3(add3(r.a, side), lift), add3(sub3(r.a, side), lift), add3(sub3(r.b, side), lift), add3(add3(r.b, side), lift)] };
}
// the outline of a flat plate, counter-clockwise seen from above (so a fan of it faces up)
function plateOutline(meta, y = 0) {
  const E = meta.world.extent;
  if (meta.world.shape === 'square') return [[-E, y, E], [E, y, E], [E, y, -E], [-E, y, -E]];
  const n = 96, pts = [];
  for (let i = 0; i < n; i++) { const t = (2 * Math.PI * i) / n; pts.push([E * Math.cos(t), y, -E * Math.sin(t)]); }
  return pts;
}
const treeSize = (meta) => 0.22 * (meta.presetSpec?.lot ?? PRESETS[meta.base ?? meta.preset]?.lot ?? 30);
// the networks as line segments at true depth, under the names toOBJ uses
function networkSegments(layout) {
  const I = layout.infra, nodes = I.graph.nodes, at = (i, depth) => underground(layout, nodes[i].pos, depth);
  return [
    ['sewer_pipes', I.sewer.pipes.map((p) => [at(p.up, p.upDepth), at(p.down, p.downDepth)])],
    ['water_mains', I.water.mains.map((m) => [at(m.a, m.depth), at(m.b, m.depth)])],
    ['power_feeders', I.power.feeders.map((f) => [at(f.a, f.depth), at(f.b, f.depth)])],
    ['power_transmission', I.power.transmission.map((f) => [at(f.a, f.depth), at(f.b, f.depth)])],
    ['transit_tunnels', I.transit.tunnels.map((t) => [at(t.a, t.depth), at(t.b, t.depth)])],
    ['utility_tunnels', I.utilidors.map((u) => [at(u.a, u.depth), at(u.b, u.depth)])],
  ];
}
function needInfra(layout, what) {
  if (!layout.infra) throw new Error(`${what}: the networks were asked for but this layout has none; build them first (layout.infra = buildInfrastructure(layout))`);
}

// ---------------------------------------------------------------- glTF 2.0
const FLOAT = 5126, UINT32 = 5125, ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963;
function gltfWriter() {
  const doc = { asset: { version: '2.0', generator: `Cymatic City Engine ${ENGINE_VERSION}` }, scene: 0, scenes: [{ name: 'city', nodes: [0] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] };
  const parts = []; let length = 0;
  const view = (bytes, target) => {
    doc.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length, ...(target ? { target } : {}) });
    parts.push(bytes); length += bytes.length;
    const pad = (4 - (length % 4)) % 4; if (pad) { parts.push(new Uint8Array(pad)); length += pad; }
    return doc.bufferViews.length - 1;
  };
  // little-endian whatever the machine
  const floats = (values, size, type, target, withBounds) => {
    const bytes = new Uint8Array(values.length * 4), dv = new DataView(bytes.buffer);
    const min = new Array(size).fill(Infinity), max = new Array(size).fill(-Infinity);
    for (let i = 0; i < values.length; i++) {
      const v = Math.fround(values[i]); dv.setFloat32(i * 4, v, true);
      if (v < min[i % size]) min[i % size] = v; if (v > max[i % size]) max[i % size] = v;
    }
    const acc = { bufferView: view(bytes, target), componentType: FLOAT, count: values.length / size, type };
    if (withBounds) { acc.min = min; acc.max = max; }
    doc.accessors.push(acc);
    return doc.accessors.length - 1;
  };
  const indices = (values) => {
    const bytes = new Uint8Array(values.length * 4), dv = new DataView(bytes.buffer);
    for (let i = 0; i < values.length; i++) dv.setUint32(i * 4, values[i], true);
    doc.accessors.push({ bufferView: view(bytes, ELEMENT_ARRAY_BUFFER), componentType: UINT32, count: values.length, type: 'SCALAR' });
    return doc.accessors.length - 1;
  };
  const materialIndex = new Map();
  const material = (name, hex, opts = {}) => {
    if (!materialIndex.has(name)) {
      const m = { name, pbrMetallicRoughness: { baseColorFactor: [...hexToLinear(hex), opts.alpha ?? 1], metallicFactor: 0, roughnessFactor: 0.9 } };
      if (opts.alpha !== undefined && opts.alpha < 1) m.alphaMode = 'BLEND';
      if (opts.doubleSided) m.doubleSided = true;
      materialIndex.set(name, doc.materials.push(m) - 1);
    }
    return materialIndex.get(name);
  };
  const node = (n) => doc.nodes.push(n) - 1;
  const mesh = (name, primitive) => doc.meshes.push({ name, primitives: [primitive] }) - 1;
  // geometry accessors of a triangle mesh, shared by every mesh that draws it
  const geometry = (m) => ({ attributes: { POSITION: floats(m.positions, 3, 'VEC3', ARRAY_BUFFER, true), NORMAL: floats(m.normals, 3, 'VEC3', ARRAY_BUFFER) }, indices: indices(m.indices) });
  const finish = () => {
    const bin = new Uint8Array(length); let o = 0;
    for (const p of parts) { bin.set(p, o); o += p.length; }
    doc.buffers.push({ byteLength: length });
    return bin;
  };
  return { doc, floats, material, node, mesh, geometry, finish };
}

function buildGltf(layout, opts = {}) {
  const paint = opts.paint ?? 'zone';
  if (paint !== 'zone' && paint !== 'era') throw new Error(`glTF: paint must be "zone" or "era" (got ${JSON.stringify(paint)})`);
  if (opts.infra) needInfra(layout, 'glTF');
  const W = gltfWriter(), { doc } = W, meta = layout.meta, C = EXPORT_COLORS;
  const instanced = !!opts.instanced, withTrees = opts.trees !== false;
  const root = W.node({ name: 'city', children: [], extras: identityOf(layout, { horizon: opts.horizon, paint }) });
  const group = (name) => { const i = W.node({ name, children: [] }); doc.nodes[root].children.push(i); return doc.nodes[i]; };
  const trs = (pos, q, scale) => {
    const n = { translation: pos.map((v) => round(v, 3)) };
    if (!isIdentity(q)) n.rotation = q;
    n.scale = scale.map((v) => round(v, 3));
    return n;
  };
  // instances of one mesh as EXT_mesh_gpu_instancing attributes
  const instances = (name, meshIndex, list) => ({ name, mesh: meshIndex, extensions: { EXT_mesh_gpu_instancing: { attributes: {
    TRANSLATION: W.floats(list.flatMap((t) => t.translation), 3, 'VEC3'),
    ROTATION: W.floats(list.flatMap((t) => t.rotation ?? [0, 0, 0, 1]), 4, 'VEC4'),
    SCALE: W.floats(list.flatMap((t) => t.scale), 3, 'VEC3') } } } });

  // buildings: one mesh per (shape, material), every building a transform of it
  if (layout.buildings.length) {
    const g = group('buildings'), shapeGeometry = new Map(), meshOf = new Map(), byMesh = new Map();
    layout.buildings.forEach((b, i) => {
      const matName = paint === 'era' ? `era:${b.era ?? 0}` : `zone:${b.zone}`;
      const mat = W.material(matName, paint === 'era' ? C.era[b.era ?? 0] ?? '#999999' : C.zone[b.zone] ?? '#888888');
      if (!shapeGeometry.has(b.shape)) shapeGeometry.set(b.shape, W.geometry(unitBuildingMesh(b.shape)));
      const key = `${b.shape}|${matName}`;
      if (!meshOf.has(key)) meshOf.set(key, W.mesh(`building:${b.shape}:${matName}`, { ...shapeGeometry.get(b.shape), material: mat }));
      const { X, Y, Z } = frameOf(b), t = trs(b.pos, quatOfBasis(X, Y, Z), [b.w, b.h, b.d]), id = b.source ?? i;
      if (instanced) { (byMesh.get(key) ?? byMesh.set(key, []).get(key)).push(t); return; }
      const extras = { index: id, district: b.district, zone: b.zone, floors: b.floors, era: b.era ?? 0, landmark: !!b.landmark, amp: round(b.amp, 4) };
      if (b.built !== undefined) { extras.built = b.built; extras.rebuilt = b.rebuilt; }
      g.children.push(W.node({ name: `b${id}`, mesh: meshOf.get(key), ...t, extras }));
    });
    if (instanced) for (const [key, list] of byMesh) g.children.push(W.node(instances(`buildings:${key.replace('|', ':')}`, meshOf.get(key), list)));
  }

  // roads: one mesh per kind
  const strips = new Map();
  for (const r of layout.roads) {
    const s = roadStrip(layout, r); if (!s) continue;
    const m = strips.get(r.kind) ?? strips.set(r.kind, { positions: [], normals: [], indices: [] }).get(r.kind), base = m.positions.length / 3;
    for (const p of s.corners) { m.positions.push(p[0], p[1], p[2]); m.normals.push(s.up[0], s.up[1], s.up[2]); }
    m.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  if (strips.size) {
    const g = group('roads');
    for (const kind of [...strips.keys()].sort()) g.children.push(W.node({ name: `roads:${kind}`, mesh: W.mesh(`roads:${kind}`, { ...W.geometry(strips.get(kind)), material: W.material(`road:${kind}`, C.road[kind] ?? '#999999') }) }));
  }

  // trees: one unit tree, a transform per tree
  if (withTrees && layout.trees.length) {
    const g = group('trees'), size = treeSize(meta);
    const treeMesh = W.mesh('tree', { ...W.geometry(unitTreeMesh()), material: W.material('tree', C.tree) });
    const list = layout.trees.map((t) => { const { X, Y, Z } = frameOfUp(t.up); const s = size * t.s; return trs(t.pos, quatOfBasis(X, Y, Z), [s, s, s]); });
    if (instanced) g.children.push(W.node(instances('trees:tree', treeMesh, list)));
    else list.forEach((t, i) => g.children.push(W.node({ name: `t${i}`, mesh: treeMesh, ...t })));
  }

  // ground and water (flat plates; the sphere has no ground mesh in this phase)
  if (!isSphere(layout)) {
    const flat = (meta.terrain?.mode ?? 'flat') === 'flat';
    const fan = (pts) => { const m = { positions: [], normals: [], indices: [] }; pts.forEach((p) => { m.positions.push(p[0], p[1], p[2]); m.normals.push(0, 1, 0); }); for (let k = 1; k + 1 < pts.length; k++) m.indices.push(0, k, k + 1); return m; };
    let ground = null;
    if (flat) ground = fan(plateOutline(meta, 0));
    else if (typeof opts.elevation === 'function') ground = groundGrid(meta, opts.elevation, opts.groundGrid ?? 128);
    if (ground) group('ground').mesh = W.mesh('ground', { ...W.geometry(ground), material: W.material('ground', C.ground) });
    const wl = meta.terrain?.waterLevel;
    if (!flat && ground && typeof wl === 'number' && Number.isFinite(wl)) group('water').mesh = W.mesh('water', { ...W.geometry(fan(plateOutline(meta, wl))), material: W.material('water', C.water, { alpha: 0.75 }) });
  }

  // the networks as lines at true depth
  if (opts.infra) {
    const nets = networkSegments(layout).filter(([, segs]) => segs.length);
    if (nets.length) {
      const g = group('underground');
      for (const [name, segs] of nets) {
        const pos = []; for (const [A, B] of segs) pos.push(A[0], A[1], A[2], B[0], B[1], B[2]);
        g.children.push(W.node({ name, mesh: W.mesh(name, { attributes: { POSITION: W.floats(pos, 3, 'VEC3', ARRAY_BUFFER, true) }, mode: 1, material: W.material(`network:${name}`, C.network[name]) }) }));
      }
    }
  }
  // an empty group says nothing: drop it (the root always stays)
  for (const n of doc.nodes) if (n.children && !n.children.length) delete n.children;
  if (instanced) doc.extensionsUsed = ['EXT_mesh_gpu_instancing'];
  if (!doc.meshes.length) delete doc.meshes;
  if (!doc.materials.length) delete doc.materials;
  if (!doc.accessors.length) { delete doc.accessors; delete doc.bufferViews; }
  return { doc, bin: W.finish() };
}

// A grid of the ground over the plate, y from the sampler elevation(x, z). On a circular plate the cells
// outside the rim are dropped and the vertices just outside it are pulled onto the rim.
function groundGrid(meta, elevation, N) {
  N = Math.max(2, Math.min(1024, Math.round(N)));
  const E = meta.world.extent, circle = meta.world.shape !== 'square', W = N + 1;
  const xs = new Float64Array(W * W), zs = new Float64Array(W * W), inside = new Uint8Array(W * W);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    let x = -E + (2 * E * i) / N, z = -E + (2 * E * j) / N; const id = j * W + i, r = Math.hypot(x, z);
    inside[id] = !circle || r <= E ? 1 : 0;
    if (!inside[id]) { x *= E / r; z *= E / r; }
    xs[id] = x; zs[id] = z;
  }
  const remap = new Int32Array(W * W).fill(-1), positions = [], indices = [];
  const use = (id) => { if (remap[id] < 0) { remap[id] = positions.length / 3; positions.push(xs[id], elevation(xs[id], zs[id]), zs[id]); } return remap[id]; };
  const P = (k) => [positions[3 * k], positions[3 * k + 1], positions[3 * k + 2]];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1; // a b / c d, z growing downwards
    if (!(inside[a] || inside[b] || inside[c] || inside[d])) continue;
    for (const tri of [[a, c, b], [b, c, d]]) { // counter-clockwise seen from above
      const [p, q, r] = tri.map(use);
      if (len3(cross3(sub3(P(q), P(p)), sub3(P(r), P(p)))) < 1e-6) continue; // a sliver squeezed flat on the rim
      indices.push(p, q, r);
    }
  }
  const normals = new Array(positions.length).fill(0);
  for (let t = 0; t < indices.length; t += 3) {
    const [p, q, r] = [indices[t], indices[t + 1], indices[t + 2]], n = cross3(sub3(P(q), P(p)), sub3(P(r), P(p)));
    for (const k of [p, q, r]) { normals[3 * k] += n[0]; normals[3 * k + 1] += n[1]; normals[3 * k + 2] += n[2]; }
  }
  for (let k = 0; k < normals.length; k += 3) { const n = unit3([normals[k], normals[k + 1], normals[k + 2]]); const up = len3(n) ? n : [0, 1, 0]; normals[k] = up[0]; normals[k + 1] = up[1]; normals[k + 2] = up[2]; }
  return { positions, normals, indices };
}

// glTF as two files: the JSON document and its binary buffer. `binName` is the buffer's file name as the
// document refers to it.
export function toGLTF(layout, opts = {}) {
  const { doc, bin } = buildGltf(layout, opts);
  if (bin.length) doc.buffers[0].uri = opts.binName ?? 'city.bin'; else delete doc.buffers;
  return { json: JSON.stringify(doc), bin };
}
// glTF as one binary file (.glb)
export function toGLB(layout, opts = {}) {
  const { doc, bin } = buildGltf(layout, opts);
  if (!bin.length) delete doc.buffers;
  const text = utf8(JSON.stringify(doc)), jsonLen = text.length + ((4 - (text.length % 4)) % 4);
  const total = 12 + 8 + jsonLen + (bin.length ? 8 + bin.length : 0);
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jsonLen); out.set(text, 20); // JSON chunk, padded with spaces
  if (bin.length) { const o = 20 + jsonLen; dv.setUint32(o, bin.length, true); dv.setUint32(o + 4, 0x004e4942, true); out.set(bin, o + 8); }
  return out;
}
function utf8(s) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
  const out = []; // a plain encoder for hosts without TextEncoder
  for (const ch of s) { const c = ch.codePointAt(0); if (c < 0x80) out.push(c); else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63)); else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------- GeoJSON (RFC 7946)
const WGS84 = { a: 6378137, f: 1 / 298.257223563 };
// Places plan metres on the Earth: a function (x, z) → [lon, lat] in degrees. The plan is laid on the plane
// tangent to the WGS84 ellipsoid at `origin` ([lat, lon]), plan −z pointing `bearing` degrees clockwise from
// north; each point goes local east-north-up → Earth-centred → geodetic, so there is no small-area formula in it.
export function geoProjector(origin, bearing = 0) {
  if (!Array.isArray(origin) || origin.length !== 2 || !origin.every((v) => typeof v === 'number' && Number.isFinite(v))) throw new Error('GeoJSON: origin must be [latitude, longitude] in degrees');
  const [lat0, lon0] = origin;
  if (Math.abs(lat0) > 89) throw new Error(`GeoJSON: origin latitude ${lat0} is too close to a pole (the limit is ±89°)`);
  if (Math.abs(lon0) > 180) throw new Error(`GeoJSON: origin longitude ${lon0} is outside ±180°`);
  if (typeof bearing !== 'number' || !Number.isFinite(bearing)) throw new Error('GeoJSON: bearing must be a number of degrees');
  const { a, f } = WGS84, e2 = f * (2 - f), rad = Math.PI / 180;
  const sp = Math.sin(lat0 * rad), cp = Math.cos(lat0 * rad), sl = Math.sin(lon0 * rad), cl = Math.cos(lon0 * rad);
  const N0 = a / Math.sqrt(1 - e2 * sp * sp), X0 = N0 * cp * cl, Y0 = N0 * cp * sl, Z0 = N0 * (1 - e2) * sp;
  const cb = Math.cos(bearing * rad), sb = Math.sin(bearing * rad);
  return (x, z) => {
    const e0 = x, n0 = -z, e = e0 * cb + n0 * sb, n = -e0 * sb + n0 * cb;
    const X = X0 - sl * e - sp * cl * n, Y = Y0 + cl * e - sp * sl * n, Z = Z0 + cp * n;
    const p = Math.hypot(X, Y), lon = Math.atan2(Y, X) / rad;
    let lat = Math.atan2(Z, p * (1 - e2));
    for (let i = 0; i < 12; i++) { // fixed-point iteration; converges to machine precision in a few rounds
      const s = Math.sin(lat), N = a / Math.sqrt(1 - e2 * s * s), h = p / Math.cos(lat) - N;
      const next = Math.atan2(Z, p * (1 - (e2 * N) / (N + h)));
      if (Math.abs(next - lat) < 1e-15) { lat = next; break; }
      lat = next;
    }
    if (Math.abs(lon - lon0) > 180) throw new Error('GeoJSON: this city would cross the antimeridian (±180° longitude); move the origin');
    return [lon, lat / rad];
  };
}

export function toGeoJSON(layout, opts = {}) {
  if (isSphere(layout)) throw new Error('GeoJSON: a sphere plate is a world of its own, not a map of the Earth; export it as glTF or OBJ');
  if (opts.origin === undefined) throw new Error('GeoJSON: an origin [latitude, longitude] is required to place the city on the Earth');
  if (opts.infra) needInfra(layout, 'GeoJSON');
  const bearing = opts.bearing ?? 0, project = geoProjector(opts.origin, bearing);
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  const pos = (P) => {
    const [lon, lat] = project(P[0], P[2]), c = [round(lon, 7), round(lat, 7)];
    if (c[0] < bbox[0]) bbox[0] = c[0]; if (c[1] < bbox[1]) bbox[1] = c[1]; if (c[0] > bbox[2]) bbox[2] = c[0]; if (c[1] > bbox[3]) bbox[3] = c[1];
    return c;
  };
  const r3 = (v) => (typeof v === 'number' ? round(v, 3) : v);
  const features = [];
  const feature = (id, kind, geometry, properties) => features.push({ type: 'Feature', id, geometry, properties: { kind, ...properties } });
  const elevationOf = (P) => r3(P[1]);

  layout.buildings.forEach((b, i) => {
    const { verts } = buildingMesh(b), sides = verts.length / 2;
    let ring = verts.slice(0, sides).map(pos);
    let area2 = 0; for (let k = 0; k < sides; k++) { const p = ring[k], q = ring[(k + 1) % sides]; area2 += p[0] * q[1] - q[0] * p[1]; }
    if (area2 < 0) ring.reverse(); // exterior rings run counter-clockwise
    ring = [...ring, ring[0]];
    const id = b.source ?? i, props = { index: id, district: b.district, zone: b.zone, floors: b.floors, height: r3(b.h), elevation: elevationOf(b.pos), shape: b.shape, era: b.era ?? 0, landmark: !!b.landmark };
    if (b.built !== undefined) { props.built = b.built; props.rebuilt = b.rebuilt; }
    feature(`b${id}`, 'building', { type: 'Polygon', coordinates: [ring] }, props);
  });
  layout.roads.forEach((r, i) => feature(`r${i}`, 'road', { type: 'LineString', coordinates: [pos(r.a), pos(r.b)] }, { roadKind: r.kind, width: r3(r.w), era: r.era ?? 0, bridge: !!r.bridge }));
  layout.trees.forEach((t, i) => feature(`t${i}`, 'tree', { type: 'Point', coordinates: pos(t.pos) }, {}));

  if (opts.infra) {
    const I = layout.infra, nodes = I.graph.nodes, at = (i) => pos(nodes[i].pos);
    const points = (prefix, kind, list, props) => (list ?? []).forEach((o, i) => feature(`${prefix}${i}`, kind, { type: 'Point', coordinates: pos(o.pos) }, Object.fromEntries(Object.entries(props(o)).map(([k, v]) => [k, r3(v)]))));
    const lines = (prefix, kind, list, ends, props) => (list ?? []).forEach((o, i) => feature(`${prefix}${i}`, kind, { type: 'LineString', coordinates: ends(o).map(at) }, Object.fromEntries(Object.entries(props(o)).map(([k, v]) => [k, r3(v)]))));
    points('station', 'metroStation', I.transit.stations, (o) => ({ name: o.name, district: o.district, depth: o.depth }));
    points('substation', 'substation', I.power.substations, (o) => ({ ratingMVA: o.ratingMVA, loadMVA: o.loadMVA, kV: o.kV }));
    points('powerplant', 'powerPlant', I.power.plants, (o) => ({ capacityMW: o.capacityMW }));
    points('tank', 'waterTank', I.water.towers, (o) => ({ height: o.height, storageM3: o.storageM3, served: o.served, pumped: !!o.pumped }));
    points('waterplant', 'waterPlant', I.water.plant?.pos ? [I.water.plant] : [], (o) => ({ capacityM3Day: o.capacityM3Day }));
    points('lift', 'liftStation', I.sewer.liftStations, (o) => ({ flow: o.flow, fromDepth: o.fromDepth }));
    points('treatment', 'treatmentPlant', I.sewer.plants, (o) => ({ flowM3Day: o.flowM3Day, served: o.served, depth: o.depth }));
    lines('sewer', 'sewerPipe', I.sewer.pipes, (o) => [o.up, o.down], (o) => ({ depth: o.upDepth, downDepth: o.downDepth, diameter: o.diameter, slope: o.slope, flow: o.flow, forceMain: !!o.forceMain }));
    lines('main', 'waterMain', I.water.mains, (o) => [o.a, o.b], (o) => ({ depth: o.depth, diameter: o.diameter, mainKind: o.kind, flow: o.flow }));
    lines('feeder', 'powerFeeder', I.power.feeders, (o) => [o.a, o.b], (o) => ({ depth: o.depth, kV: o.kV, classMVA: o.classMVA, loadMVA: o.loadMVA }));
    lines('transmission', 'powerTransmission', I.power.transmission, (o) => [o.a, o.b], (o) => ({ depth: o.depth, kV: o.kV }));
    lines('tunnel', 'metroTunnel', I.transit.tunnels, (o) => [o.a, o.b], (o) => ({ depth: o.depth, diameter: o.diameter, line: o.line }));
    lines('utilidor', 'utilityTunnel', I.utilidors, (o) => [o.a, o.b], (o) => ({ depth: o.depth }));
  }
  const doc = { type: 'FeatureCollection', cymatic: identityOf(layout, { horizon: opts.horizon, origin: opts.origin, bearing }) };
  if (features.length) doc.bbox = bbox;
  doc.features = features;
  return JSON.stringify(doc);
}

// ---------------------------------------------------------------- CityJSON 2.0
// Local metric coordinates with X east (plan x), Y north (plan −z) and Z up; the map keeps handedness, so faces
// that look outward in the plan look outward here.
export function toCityJSON(layout, opts = {}) {
  if (isSphere(layout)) throw new Error('CityJSON: a sphere plate has no flat map; export it as glTF or OBJ');
  const meta = layout.meta, SCALE = 0.001, toLocal = (P) => [P[0], -P[2], P[1]];
  // every position first, as real coordinates, so the translation is the true minimum corner
  const objects = [], lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const note = (P) => { const L = toLocal(P); for (let k = 0; k < 3; k++) { if (L[k] < lo[k]) lo[k] = L[k]; if (L[k] > hi[k]) hi[k] = L[k]; } return L; };
  layout.buildings.forEach((b, i) => {
    const { verts, faces } = buildingMesh(b), sides = verts.length / 2;
    objects.push({ kind: 'building', b, id: b.source ?? i, sides, verts: verts.map(note), faces });
  });
  const roadGroups = new Map();
  layout.roads.forEach((r) => {
    const s = roadStrip(layout, r); if (!s) return;
    const key = `${r.kind}|${r.era ?? 0}`;
    const g = roadGroups.get(key) ?? roadGroups.set(key, { kind: r.kind, era: r.era ?? 0, strips: [], length: 0 }).get(key);
    g.strips.push(s.corners.map(note)); g.length += len3(sub3(r.b, r.a));
  });
  if (!objects.length && !roadGroups.size) { lo.fill(0); hi.fill(0); }
  const translate = lo.map((v) => round(v, 3));
  const vertices = [], index = new Map();
  const vertex = (L) => {
    const q = L.map((v, k) => Math.round((v - translate[k]) / SCALE)), key = `${q[0]},${q[1]},${q[2]}`;
    if (!index.has(key)) index.set(key, vertices.push(q) - 1);
    return index.get(key);
  };
  // a ring of vertex numbers with repeats removed; null when fewer than three are left
  const ringOf = (ids) => { const out = ids.filter((v, k) => v !== ids[(k + ids.length - 1) % ids.length]); return new Set(out).size >= 3 ? out : null; };
  const CityObjects = {};
  const tapered = { house: true, dome: true, spire: true };
  for (const o of objects) {
    const { b, sides } = o, ids = o.verts.map(vertex), surfaces = [], values = [];
    o.faces.forEach((f, k) => {
      const ring = ringOf(f.map((v) => ids[v])); if (!ring) return;
      surfaces.push([ring]); values.push(k < sides ? 1 : k === sides ? 0 : 2); // walls, then the floor, then the roof
    });
    const attributes = { measuredHeight: round(b.h, 3), storeysAboveGround: b.floors, zone: b.zone, district: b.district, shape: b.shape, era: b.era ?? 0, landmark: !!b.landmark };
    if (b.built !== undefined) attributes.built = b.built;
    CityObjects[`b${o.id}`] = { type: 'Building', attributes, geometry: [{ type: 'Solid', lod: tapered[b.shape] ? '2' : '1', boundaries: [surfaces],
      semantics: { surfaces: [{ type: 'GroundSurface' }, { type: 'WallSurface' }, { type: 'RoofSurface' }], values: [values] } }] };
  }
  for (const key of [...roadGroups.keys()].sort()) {
    const g = roadGroups.get(key), surfaces = [];
    for (const s of g.strips) { const ring = ringOf(s.map(vertex)); if (ring) surfaces.push([ring]); }
    if (!surfaces.length) continue;
    CityObjects[`road-${g.kind}-era${g.era}`] = { type: 'Road', attributes: { roadKind: g.kind, era: g.era, lengthM: round(g.length, 1) },
      geometry: [{ type: 'MultiSurface', lod: '1', boundaries: surfaces, semantics: { surfaces: [{ type: 'TrafficArea' }], values: surfaces.map(() => 0) } }] };
  }
  const year = meta.year !== undefined ? ` · year ${meta.year}${opts.horizon !== undefined ? ` of ${opts.horizon}` : ''}` : '';
  const doc = {
    type: 'CityJSON', version: '2.0',
    transform: { scale: [SCALE, SCALE, SCALE], translate },
    metadata: { title: `Cymatic City Engine ${ENGINE_VERSION} · ${describe(meta)} · ${meta.plate} · ${meta.preset} · seed ${meta.seed}${year}`, geographicalExtent: [...lo, ...hi].map((v) => round(v, 3)) },
    CityObjects, vertices,
  };
  return JSON.stringify(doc);
}
