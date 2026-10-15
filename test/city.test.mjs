// City contract: deterministic, physically anchored to the field, and buildable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateCity, toJSON, toOBJ, buildingMesh, heightLimit, slendernessLimit, distToSegment, PRESETS,
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
  for (const plate of PLATES) for (const preset of ['town', 'city']) for (const f of [180, 432, 800]) {
    const s = city({ plate, preset, frequency: f }).stats;
    assert.ok(s.roadShare > 0.12 && s.roadShare < 0.45, `${plate}/${preset}/${f}: road share ${s.roadShare}`);
    assert.ok(s.streetDensity > 10, `${plate}/${preset}/${f}: street density ${s.streetDensity}`);
    assert.ok(s.greenShare < 0.4, `${plate}/${preset}/${f}: green ${s.greenShare}`);
    assert.ok(s.buildings > (preset === 'town' ? 300 : 2500), `${plate}/${preset}/${f}: ${s.buildings} buildings`);
  }
});

test('a city generates in under 2.5 s', () => {
  const t = Date.now();
  generateCity({ preset: 'city', plate: 'circle', frequency: 517, seed: 99 });
  assert.ok(Date.now() - t < 2500, `${Date.now() - t} ms`);
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
});
