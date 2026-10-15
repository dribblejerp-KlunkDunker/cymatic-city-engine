// City contract: deterministic, physically anchored to the field, and buildable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateCity, toJSON, toOBJ, buildingMesh, heightLimit, slendernessLimit, distToSegment, PRESETS,
  enumerateModes, besselZeros,
} from '../src/cymatic-engine.js';

const cache = new Map();
const city = (o) => { const k = JSON.stringify(o); if (!cache.has(k)) cache.set(k, generateCity(o)); return cache.get(k); };
const PLATES = ['circle', 'square', 'sphere'];

// independent brute-force clearance (does not use the engine's spatial hash)
function minClearance(points, roads) {
  let best = Infinity;
  for (const P of points) for (const r of roads) {
    const d = distToSegment(P, r.a, r.b) - r.w / 2;
    if (d < best) best = d;
  }
  return best;
}
function outline(b, step = 1) {
  const right = [b.fwd[1] * b.up[2] - b.fwd[2] * b.up[1], b.fwd[2] * b.up[0] - b.fwd[0] * b.up[2], b.fwd[0] * b.up[1] - b.fwd[1] * b.up[0]];
  const at = (x, z) => [0, 1, 2].map((i) => b.pos[i] + b.fwd[i] * x + right[i] * z);
  const pts = [b.pos];
  const nx = Math.ceil(b.w / step), nz = Math.ceil(b.d / step);
  for (let i = 0; i <= nx; i++) { const x = -b.w / 2 + (b.w * i) / nx; pts.push(at(x, b.d / 2), at(x, -b.d / 2)); }
  for (let k = 0; k <= nz; k++) { const z = -b.d / 2 + (b.d * k) / nz; pts.push(at(b.w / 2, z), at(-b.w / 2, z)); }
  return pts;
}
// 2D oriented-rectangle overlap (separating axis theorem) on the x/z plane
function obb(b) {
  const f = [b.fwd[0], b.fwd[2]], r = [-b.fwd[2], b.fwd[0]];
  return { c: [b.pos[0], b.pos[2]], axes: [f, r], half: [b.w / 2, b.d / 2] };
}
function overlap(A, B) {
  for (const ax of [...A.axes, ...B.axes]) {
    const proj = (O) => O.axes.reduce((s, a, i) => s + O.half[i] * Math.abs(a[0] * ax[0] + a[1] * ax[1]), 0);
    const dist = Math.abs((B.c[0] - A.c[0]) * ax[0] + (B.c[1] - A.c[1]) * ax[1]);
    if (dist >= proj(A) + proj(B) - 1e-6) return false;
  }
  return true;
}

test('generation is deterministic; the seed changes buildings but not the street plan', () => {
  const a = toJSON(generateCity({ preset: 'town', frequency: 432, seed: 7 }));
  const b = toJSON(generateCity({ preset: 'town', frequency: 432, seed: 7 }));
  assert.equal(a, b);
  const c = generateCity({ preset: 'town', frequency: 432, seed: 8 });
  assert.equal(JSON.stringify(c.roads), JSON.stringify(JSON.parse(a).roads));
  assert.notEqual(JSON.stringify(c.buildings), JSON.stringify(JSON.parse(a).buildings));
});

test('boulevards lie on the nodal lines of the field (|S| ≈ 0)', () => {
  for (const plate of PLATES) {
    const L = city({ plate, preset: 'city', frequency: 432 });
    const blv = L.roads.filter((r) => r.kind === 'boulevard');
    assert.ok(blv.length > 50, `${plate}: boulevards exist`);
    let worst = 0;
    for (const r of blv.slice(0, 2000)) {
      const [u, v] = L.field.toNorm(r.a);
      worst = Math.max(worst, Math.abs(L.field.at(u, v).S));
    }
    assert.ok(worst < 0.03, `${plate}: worst |S| on a boulevard ${worst}`);
  }
});

test('at a pure resonance the boulevards fall on the analytic nodal set (independent of the engine field)', () => {
  // circle (3,2): nodal diameters where cos 3θ = 0, a nodal circle at r = j31/j32, and the rim
  const md = enumerateModes({ plate: 'circle' }).find((m) => m.m === 3 && m.n === 2);
  const L = generateCity({ plate: 'circle', preset: 'town', frequency: md.f, Q: 1000 });
  assert.equal(L.meta.dominant, '(m 3, n 2)');
  const R = L.meta.world.extent, rc = besselZeros(3, 2)[0] / besselZeros(3, 2)[1];
  for (const r of L.roads.filter((x) => x.kind === 'boulevard')) {
    const rr = Math.hypot(r.a[0], r.a[2]) / R, th = Math.atan2(r.a[2], r.a[0]);
    const onDiam = Math.abs(Math.cos(3 * th)) * rr < 0.02, onCircle = Math.abs(rr - rc) < 0.02, onRim = rr > 0.97;
    assert.ok(onDiam || onCircle || onRim, `boulevard point r=${rr.toFixed(3)} θ=${th.toFixed(3)} is off the nodal set`);
  }
  // square at the (0,1) frequency, off-centre drive: the degenerate pair (0,1)± is excited in the ratio
  // φ±(drive)/N±. Rebuild that field here from the textbook shapes and check boulevards sit on its zeros.
  const sq = generateCity({ plate: 'square', preset: 'town', frequency: 5, Q: 1000, driveOffset: 0.3 });
  const shape = (s, x, y) => Math.cos(Math.PI * x) + s * Math.cos(Math.PI * y);   // (0,1)±, corner coords
  const dx = 0.5 + 0.5 * 0.3, dy = 0.5 + 0.31 * 0.3;                              // drive point
  const g = (x, y) => (shape(1, dx, dy) * shape(1, x, y) + shape(-1, dx, dy) * shape(-1, x, y)) / 2; // N = 2 for both
  let gmax = 0;
  for (let i = 0; i <= 50; i++) for (let k = 0; k <= 50; k++) gmax = Math.max(gmax, Math.abs(g(i / 50, k / 50)));
  const side = 2 * sq.meta.world.extent;
  const blv = sq.roads.filter((x) => x.kind === 'boulevard');
  assert.ok(blv.length > 20);
  for (const r of blv) {
    const x = r.a[0] / side + 0.5, y = r.a[2] / side + 0.5;
    assert.ok(Math.abs(g(x, y)) / gmax < 0.02, `square boulevard at (${x.toFixed(3)}, ${y.toFixed(3)}) is off the nodal line`);
  }
});

test('Q reaches the city: a sharper resonance gives a sharper plan', () => {
  const lo = generateCity({ preset: 'town', frequency: 432, Q: 5 }), hi = generateCity({ preset: 'town', frequency: 432, Q: 500 });
  assert.ok(hi.meta.sharpness > lo.meta.sharpness);
  assert.notEqual(JSON.stringify(lo.roads), JSON.stringify(hi.roads));
});

test('every measured realism check that is a hard rule passes (walking reach, setback, slenderness, self-weight, terraces)', () => {
  const hard = ['access', 'setback', 'slenderness', 'self-weight', 'terrace'];
  for (const plate of PLATES) for (const preset of Object.keys(PRESETS)) for (const f of [plate === 'square' ? 20 : 45, 432]) {
    const L = city({ plate, preset, frequency: f });
    for (const c of L.checks.filter((x) => hard.includes(x.id))) assert.equal(c.status, 'pass', `${plate}/${preset}/${f}: ${c.id} ${c.value}`);
  }
});

test('the lowest modes still get a connected street plan', () => {
  for (const [plate, f] of [['circle', 40], ['square', 5], ['sphere', 30]]) {
    const L = generateCity({ plate, preset: 'city', frequency: f });
    assert.ok(L.roads.some((r) => r.kind === 'spoke'), `${plate} ${f} Hz has gradient streets`);
    assert.ok(L.stats.streetDensity > 14, `${plate} ${f} Hz: ${L.stats.streetDensity} km/km²`);
  }
});

test('changing the frequency changes the mode and the plan', () => {
  const lo = city({ preset: 'town', frequency: 200 }), hi = city({ preset: 'town', frequency: 700 });
  assert.notEqual(lo.meta.dominant, hi.meta.dominant);
  assert.ok(hi.meta.modes[0].f > lo.meta.modes[0].f);
});

test('no building footprint touches a road (brute force, 1 m outline sampling)', () => {
  for (const plate of PLATES) {
    for (const preset of ['town', 'alien', 'megastructure']) {
      const L = city({ plate, preset, frequency: 432 });
      const sample = L.buildings.filter((_, i) => i % Math.max(1, Math.floor(L.buildings.length / 60)) === 0);
      for (const b of sample) {
        const c = minClearance(outline(b), L.roads);
        assert.ok(c >= -1e-6, `${plate}/${preset}: building at ${b.pos.map((x) => x.toFixed(1))} intrudes ${c.toFixed(2)} m into a road`);
      }
    }
  }
});

test('no two buildings overlap', () => {
  for (const plate of PLATES) {
    for (const preset of ['town', 'city', 'megastructure']) {
      const L = city({ plate, preset, frequency: 432 });
      const cell = PRESETS[preset].lot * 2;
      const grid = new Map();
      L.buildings.forEach((b, i) => {
        const k = `${Math.floor(b.pos[0] / cell)},${Math.floor(b.pos[1] / cell)},${Math.floor(b.pos[2] / cell)}`;
        (grid.get(k) ?? grid.set(k, []).get(k)).push(i);
      });
      let bad = 0;
      L.buildings.forEach((b, i) => {
        const [x, y, z] = b.pos.map((v) => Math.floor(v / cell));
        for (let a = x - 1; a <= x + 1; a++) for (let c = y - 1; c <= y + 1; c++) for (let e = z - 1; e <= z + 1; e++) {
          for (const j of grid.get(`${a},${c},${e}`) ?? []) {
            if (j <= i) continue;
            const o = L.buildings[j];
            if (plate === 'sphere') {
              // bounding circles in 3D (the lot spacing guarantees this conservatively)
              const dist = Math.hypot(b.pos[0] - o.pos[0], b.pos[1] - o.pos[1], b.pos[2] - o.pos[2]);
              if (dist < Math.hypot(b.w, b.d) / 2 + Math.hypot(o.w, o.d) / 2 - 1e-6) bad++;
            } else if (overlap(obb(b), obb(o))) bad++;
          }
        }
      });
      assert.equal(bad, 0, `${plate}/${preset}: ${bad} overlapping pairs`);
    }
  }
});

test('every building respects the material self-weight limit and the slenderness limit', () => {
  for (const plate of PLATES) {
    for (const preset of Object.keys(PRESETS)) {
      const L = city({ plate, preset, frequency: 432 });
      const hMax = heightLimit(L.meta.material, L.meta.gravity);
      const sl = PRESETS[preset].arcology ? Infinity : slendernessLimit(PRESETS[preset].slender, L.meta.gravity);
      for (const b of L.buildings) {
        assert.ok(b.h <= hMax + 1e-6, `${plate}/${preset}: ${b.h} m exceeds ${hMax} m`);
        assert.ok(b.h <= sl * Math.min(b.w, b.d) + 1e-6, `${plate}/${preset}: ${b.h} m on a ${Math.min(b.w, b.d).toFixed(1)} m base`);
        assert.ok(b.h > 0 && b.floors >= 1);
      }
      assert.equal(L.checks.find((c) => c.id === 'self-weight').status, 'pass');
    }
  }
});

test('a spherical megastructure stays a shell under a quarter of the radius', () => {
  const L = city({ plate: 'sphere', preset: 'megastructure', frequency: 432 });
  for (const b of L.buildings) assert.ok(b.h <= 0.25 * L.meta.world.Rs + 1e-6);
});

test('buildings over six floors have room for a lift core', () => {
  for (const plate of PLATES) for (const preset of ['city', 'alien']) for (const inverse of [false, true]) {
    const L = city({ plate, preset, frequency: 432, inverse });
    for (const b of L.buildings) {
      if (b.floors > 6) assert.ok(Math.min(b.w, b.d) >= 14 - 1e-9, `${plate}/${preset}: ${b.floors} floors on ${Math.min(b.w, b.d).toFixed(1)} m`);
    }
  }
});

test('the material limit binds when it should (heavy gravity)', () => {
  const L = generateCity({ preset: 'city', frequency: 300, gravity: 5 });
  const hMax = heightLimit('concrete', 5);
  assert.ok(L.stats.binding.material > 0, 'some towers were capped by the material');
  for (const b of L.buildings) assert.ok(b.h <= hMax + 1e-6);
});

test('megastructure terraces: seed varies them and no step exceeds the allowed rise', () => {
  for (const plate of PLATES) {
    const a = generateCity({ plate, preset: 'megastructure', frequency: 432, seed: 1 });
    const b = generateCity({ plate, preset: 'megastructure', frequency: 432, seed: 2 });
    assert.notEqual(JSON.stringify(a.buildings), JSON.stringify(b.buildings), plate);
    assert.ok(a.stats.maxTerraceStep <= a.stats.terraceRise + 1e-6, `${plate}: step ${a.stats.maxTerraceStep} > ${a.stats.terraceRise}`);
  }
});

test('the height limit scales as 1/g', () => {
  const ratio = heightLimit('concrete', 0.38) / heightLimit('concrete', 1);
  assert.ok(Math.abs(ratio - 1 / 0.38) < 1e-9);
  const low = city({ preset: 'alien', frequency: 300, gravity: 0.2 }), high = city({ preset: 'alien', frequency: 300, gravity: 2 });
  assert.ok(low.stats.heightLimit > high.stats.heightLimit * 9.9);
});

test('sphere cities sit on the sphere with radial up vectors', () => {
  const L = city({ plate: 'sphere', preset: 'city', frequency: 432 });
  const Rs = L.meta.world.Rs;
  for (const b of L.buildings) {
    const r = Math.hypot(...b.pos);
    assert.ok(Math.abs(r - Rs) < 1e-6 * Rs);
    const dotUp = (b.pos[0] * b.up[0] + b.pos[1] * b.up[1] + b.pos[2] * b.up[2]) / r;
    assert.ok(Math.abs(dotUp - 1) < 1e-9);
    assert.ok(Math.abs(b.fwd[0] * b.up[0] + b.fwd[1] * b.up[1] + b.fwd[2] * b.up[2]) < 1e-9);
  }
});

test('towns and cities land in a plausible planning range', () => {
  for (const plate of PLATES) for (const preset of ['town', 'city']) for (const f of [180, 432, 750]) {
    const s = city({ plate, preset, frequency: f }).stats;
    assert.ok(s.roadShare > (preset === 'town' ? 0.12 : 0.22) && s.roadShare < 0.42, `${plate}/${preset}/${f}: road share ${s.roadShare}`);
    assert.ok(s.streetDensity > 14, `${plate}/${preset}/${f}: street density ${s.streetDensity}`);
    assert.ok(s.greenShare < 0.4, `${plate}/${preset}/${f}: green ${s.greenShare}`);
    assert.ok(s.buildings > (preset === 'town' ? 300 : 2500), `${plate}/${preset}/${f}: ${s.buildings} buildings`);
  }
});

test('a city generates in under 2.5 s', () => {
  const t = Date.now();
  generateCity({ preset: 'city', plate: 'circle', frequency: 517, seed: 99 });
  assert.ok(Date.now() - t < 2500, `${Date.now() - t} ms`);
});

test('OBJ faces point outward', () => {
  const L = city({ preset: 'town', frequency: 432 });
  for (const b of L.buildings.slice(0, 200)) {
    const { verts, faces } = buildingMesh(b);
    const c = verts.reduce((s, v) => s.map((x, i) => x + v[i] / verts.length), [0, 0, 0]);
    for (const f of faces) {
      const n = [0, 0, 0];
      for (let i = 0; i < f.length; i++) { // Newell's method
        const p = verts[f[i]], q = verts[f[(i + 1) % f.length]];
        n[0] += (p[1] - q[1]) * (p[2] + q[2]); n[1] += (p[2] - q[2]) * (p[0] + q[0]); n[2] += (p[0] - q[0]) * (p[1] + q[1]);
      }
      const fc = f.reduce((s, i) => s.map((x, k) => x + verts[i][k] / f.length), [0, 0, 0]);
      const out = n[0] * (fc[0] - c[0]) + n[1] * (fc[1] - c[1]) + n[2] * (fc[2] - c[2]);
      assert.ok(out > 0, 'face winds inward');
    }
  }
});

test('OBJ export is well formed', () => {
  const L = city({ preset: 'town', frequency: 432 });
  const obj = toOBJ(L);
  const v = obj.split('\n').filter((l) => l.startsWith('v ')).length;
  let maxIdx = 0, faces = 0;
  for (const l of obj.split('\n')) if (l.startsWith('f ')) { faces++; for (const i of l.slice(2).split(' ')) maxIdx = Math.max(maxIdx, +i); }
  const expected = L.buildings.reduce((s, b) => s + buildingMesh(b).verts.length, 0) + L.roads.length * 4;
  assert.equal(v, expected);
  assert.equal(maxIdx, v);
  assert.ok(faces > L.buildings.length);
});

test('bad input is rejected with a clear message', () => {
  assert.throws(() => generateCity({ frequency: -5 }), /positive/);
  assert.throws(() => generateCity({ plate: 'hexagon' }), /Unknown plate/);
  assert.throws(() => generateCity({ preset: 'village' }), /Unknown preset/);
  assert.throws(() => generateCity({ plate: 'circle', frequency: 1e5 }), /outside this plate's modelled range/);
  assert.throws(() => generateCity({ driveOffset: 1.2 }), /Drive point/);
  assert.throws(() => generateCity({ gravity: NaN }), /Gravity must be a number/);
  assert.throws(() => generateCity({ fundamentalHz: -40 }), /above 0/);
});
