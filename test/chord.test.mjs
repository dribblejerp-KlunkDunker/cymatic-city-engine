// Multi-frequency chords (Phase 4): a chord of one is the plain frequency byte for byte; the composite field is
// the in-phase superposition of the voices with a time-averaged amplitude; each voice's boulevards lie on that
// voice's own nodal set; every invariant of the single-frequency city holds; eras order the growth.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, toJSON, fieldPreview, checksFor, MAX_VOICES, VOICE_BAND } from '../src/cymatic-engine.js';
import { buildInfrastructure } from '../src/infrastructure.js';
import { simulate } from '../src/simulation.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} got ${a}, expected ${b}`);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const roadKm = (roads) => roads.reduce((s, r) => s + Math.hypot(...sub(r.b, r.a)), 0) / 1000;
function distToSegment(P, A, B) { const ab = sub(B, A), t = Math.max(0, Math.min(1, dot(sub(P, A), ab) / (dot(ab, ab) || 1))); return Math.hypot(...sub(P, [A[0] + ab[0] * t, A[1] + ab[1] * t, A[2] + ab[2] * t])); }
// footprint outline every metre, in the building's own frame (works on the sphere too)
function outline(b) {
  const right = cross(b.fwd, b.up), at = (x, z) => [0, 1, 2].map((i) => b.pos[i] + b.fwd[i] * x + right[i] * z), pts = [];
  const nx = Math.ceil(b.w), nz = Math.ceil(b.d);
  for (let i = 0; i <= nx; i++) { const x = -b.w / 2 + (b.w * i) / nx; pts.push(at(x, b.d / 2), at(x, -b.d / 2)); }
  for (let k = 0; k <= nz; k++) { const z = -b.d / 2 + (b.d * k) / nz; pts.push(at(b.w / 2, z), at(-b.w / 2, z)); }
  return pts;
}
// oriented-rectangle overlap by separating axes, both footprints projected onto the first one's tangent plane
function overlapping(b, c) {
  const e1 = b.fwd, e2 = cross(b.fwd, b.up), to2 = (v) => [dot(v, e1), dot(v, e2)];
  const rect = (x) => { const r = cross(x.fwd, x.up), c0 = to2(sub(x.pos, b.pos)); return { c: c0, ax: [to2(x.fwd), to2(r)], h: [x.w / 2, x.d / 2] }; };
  const A = rect(b), B = rect(c);
  for (const axis of [...A.ax, ...B.ax]) {
    const n = Math.hypot(axis[0], axis[1]); if (n < 1e-9) continue; const ax = [axis[0] / n, axis[1] / n];
    const rad = (R) => R.h[0] * Math.abs(R.ax[0][0] * ax[0] + R.ax[0][1] * ax[1]) + R.h[1] * Math.abs(R.ax[1][0] * ax[0] + R.ax[1][1] * ax[1]);
    const d = Math.abs((B.c[0] - A.c[0]) * ax[0] + (B.c[1] - A.c[1]) * ax[1]);
    if (d >= rad(A) + rad(B) - 1e-6) return false;
  }
  return true;
}
const cache = new Map();
const city = (o) => { const k = JSON.stringify(o); if (!cache.has(k)) cache.set(k, generateCity(o)); return cache.get(k); };

test('a chord of one is the plain frequency, byte for byte; chords are validated', () => {
  for (const [plate, preset, f] of [['circle', 'city', 432], ['square', 'town', 300], ['sphere', 'alien', 300]]) {
    const a = toJSON(generateCity({ plate, preset, frequency: f }));
    const b = toJSON(generateCity({ plate, preset, chord: [f] }));
    const c = toJSON(generateCity({ plate, preset, chord: [{ hz: f, weight: 1 }], frequency: 999 }));
    assert.equal(a, b, `${plate}/${preset}: chord of one`);
    assert.equal(a, c, 'the chord names the city, not the frequency field');
    assert.equal(JSON.parse(a).meta.chord, null);
  }
  assert.throws(() => generateCity({ chord: [] }), /1 to 3/);
  assert.throws(() => generateCity({ chord: [432, 500, 600, 700] }), /1 to 3/);
  assert.equal(MAX_VOICES, 3);
  assert.throws(() => generateCity({ chord: [432, 5000] }), /outside this plate/);
  assert.throws(() => generateCity({ chord: [432, { hz: 500, weight: 0 }] }), /weight/);
  assert.throws(() => generateCity({ chord: [432, { hz: 500, weight: 2 }] }), /weight/);
  assert.throws(() => generateCity({ chord: [432, 'x'] }), /must be a number/);
  assert.throws(() => generateCity({ chord: [432, 432] }), /within 1 %/, 'a voice twice is refused');
  assert.throws(() => generateCity({ chord: [432, 434] }), /within 1 %/, 'so is a voice within 1 %');
  assert.throws(() => generateCity({ chord: [432, { hz: 500, weight: 0.005 }] }), /weight/, 'weights below 0.01 are refused');
  // only the ratios of the weights matter: the same streets and buildings (meta keeps the weights as given)
  const half = JSON.parse(toJSON(generateCity({ plate: 'circle', preset: 'town', chord: [{ hz: 300, weight: 0.5 }, { hz: 450, weight: 0.25 }] })));
  const full = JSON.parse(toJSON(generateCity({ plate: 'circle', preset: 'town', chord: [{ hz: 300, weight: 1 }, { hz: 450, weight: 0.5 }] })));
  assert.equal(JSON.stringify(half.roads), JSON.stringify(full.roads)); assert.equal(JSON.stringify(half.buildings), JSON.stringify(full.buildings));
});

test('the composite field is Σ w·S_v in sign and √Σ (w·A_v)² in amplitude, each voice normalised to its own peak', () => {
  for (const [plate, preset, f0, f1] of [['circle', 'city', 432, 576], ['square', 'town', 300, 450], ['sphere', 'alien', 300, 400]]) {
  const o = { plate, preset, chord: [f0, { hz: f1, weight: 0.6 }] };
  const F = fieldPreview(o);
  assert.equal(F.voices.length, 2);
  const V0 = fieldPreview({ plate, preset, frequency: f0 }), V1 = fieldPreview({ plate, preset, frequency: f1 });
  // the composite is one constant times the superposition of the single-voice previews, at every point
  let ratio = null, n = 0;
  for (let i = 0; i < 400; i++) {
    let u = -0.9 + 1.8 * ((i * 37) % 97) / 97, v = -0.9 + 1.8 * ((i * 53) % 89) / 89;
    if (plate === 'square') { u *= 0.5; v *= 0.5; }
    if (plate === 'sphere') { u = 0.1 + (Math.PI - 0.2) * ((i * 37) % 97) / 97; v = 2 * Math.PI * ((i * 53) % 89) / 89; }
    if (!F.inside(u, v)) continue;
    const s0 = V0.at(u, v), s1 = V1.at(u, v), c = F.at(u, v);
    const S = s0.S + 0.6 * s1.S, A = Math.hypot(s0.A, 0.6 * s1.A);
    const expectedS = Math.sign(S) * Math.min(Math.abs(S), A); // the snapshot, clipped to the time-averaged envelope
    if (Math.abs(expectedS) > 0.05) { const r = c.S / expectedS; if (ratio == null) ratio = r; else close(r, ratio, 1e-6 * Math.abs(ratio), 'one scale for the signed field'); }
    if (ratio != null) close(c.A, A * ratio, 1e-6 + 1e-6 * c.A, 'amplitude is the time-averaged motion');
    assert.equal(Math.sign(c.S), Math.sign(S), 'sign of the in-phase superposition');
    assert.ok(c.A >= Math.abs(c.S) - 1e-12, 'amplitude never under the signed field');
    n++;
  }
  assert.ok(n > 200 && ratio > 0, `${plate}: ${n} points`);
  // the voices on the preview are the single-voice fields
  for (let i = 0; i < 50; i++) { const u = (plate === 'sphere' ? 1 : -0.4) + i / 120, v = 0.2; close(F.voices[0].at(u, v).S, V0.at(u, v).S, 1e-12); close(F.voices[1].at(u, v).S, V1.at(u, v).S, 1e-12); }
  }
});

test("each voice's boulevards lie on that voice's nodal lines, and the rings on its contours", () => {
  for (const [plate, preset, chord] of [['circle', 'city', [432, 576]], ['square', 'town', [300, 375, 450]], ['sphere', 'alien', [300, 450]]]) {
    const o = { plate, preset, chord };
    const L = city(o), F = fieldPreview(o);
    const eras = new Set(L.roads.map((r) => r.era));
    assert.deepEqual([...eras].sort(), chord.map((_, i) => i), `${plate}: every voice laid streets`);
    for (const r of L.roads) {
      if (r.kind !== 'boulevard') continue;
      const mid = [(r.a[0] + r.b[0]) / 2, (r.a[1] + r.b[1]) / 2, (r.a[2] + r.b[2]) / 2];
      const [u, v] = F.toNorm(mid);
      assert.ok(Math.abs(F.voices[r.era].S(u, v)) < 0.06, `${plate}: boulevard of voice ${r.era} off its nodal line (|S| ${Math.abs(F.voices[r.era].S(u, v)).toFixed(3)})`);
    }
    // rings run along one of their voice's contour levels 0.9 i / (k + 1)
    const levels = []; for (let k = 1; k <= 6; k++) for (let i = 1; i <= k; i++) levels.push((0.9 * i) / (k + 1));
    let rings = 0;
    for (const r of L.roads) {
      if (r.kind !== 'ring') continue; rings++;
      const [u, v] = F.toNorm([(r.a[0] + r.b[0]) / 2, (r.a[1] + r.b[1]) / 2, (r.a[2] + r.b[2]) / 2]), sv = Math.abs(F.voices[r.era].S(u, v));
      assert.ok(Math.min(...levels.map((l) => Math.abs(l - sv))) < 0.05, `${plate}: ring of voice ${r.era} at |S| ${sv.toFixed(3)}, off every contour level`);
    }
    if (preset !== 'megastructure') assert.ok(rings > 0, `${plate}: rings exist`);
    // clipping to territories leaves no short disconnected fragments: every connected piece of street (joined within
    // 1 m, endpoint to segment) is at least 100 m long, counted here independently of the engine
    const R = L.roads, cellOf = (P) => P.map((x) => Math.floor(x / 40)), hash = new Map();
    R.forEach((r, i) => { for (const P of [r.a, r.b, r.a.map((x, c) => (x + r.b[c]) / 2)]) { const k = cellOf(P).join(','); (hash.get(k) ?? hash.set(k, []).get(k)).push(i); } });
    const seen = new Uint8Array(R.length);
    for (let s0 = 0; s0 < R.length; s0++) {
      if (seen[s0]) continue; seen[s0] = 1; let len = 0; const stack = [s0];
      while (stack.length) {
        const r = R[stack.pop()]; len += Math.hypot(...sub(r.b, r.a));
        for (const P of [r.a, r.b]) {
          const [x, y, z] = cellOf(P);
          for (let a = x - 1; a <= x + 1; a++) for (let b = y - 1; b <= y + 1; b++) for (let c = z - 1; c <= z + 1; c++) for (const j of hash.get(`${a},${b},${c}`) ?? []) {
            if (seen[j]) continue; const o = R[j];
            if (Math.min(distToSegment(r.a, o.a, o.b), distToSegment(r.b, o.a, o.b), distToSegment(o.a, r.a, r.b), distToSegment(o.b, r.a, r.b)) <= 1) { seen[j] = 1; stack.push(j); }
          }
        }
      }
      assert.ok(len >= 100, `${plate}: a disconnected street fragment of ${len.toFixed(0)} m`);
    }
    // a voice lays streets only in its territory: where its weighted envelope (local peak amplitude) is within the
    // band of the strongest voice's; and its envelope really is the local maximum of its own amplitude
    const weights = chord.map((c) => (typeof c === 'object' ? c.weight : 1));
    for (const r of L.roads) {
      if (r.kind === 'wall') continue;
      const [u, v] = F.toNorm([(r.a[0] + r.b[0]) / 2, (r.a[1] + r.b[1]) / 2, (r.a[2] + r.b[2]) / 2]);
      const w = F.voices.map((vc, i) => weights[i] * vc.env(u, v));
      assert.ok(w[r.era] >= (1 - VOICE_BAND) * Math.max(...w) - 1e-9, `${plate}: a street of voice ${r.era} outside its territory`);
      assert.ok(F.voices[r.era].env(u, v) >= F.voices[r.era].at(u, v).A - 0.05, 'the envelope is at least the amplitude under it (grid resolution aside)');
    }
    assert.ok(L.roads.some((r) => r.kind === 'wall') === (plate !== 'sphere'), 'a perimeter on plane plates only');
    // each stretch of the perimeter belongs to the voice that shapes it there (strongest weighted envelope), once
    const wts = chord.map((c) => (typeof c === 'object' ? c.weight : 1));
    for (const r of L.roads.filter((x) => x.kind === 'wall')) {
      const [u, v] = F.toNorm([(r.a[0] + r.b[0]) / 2, (r.a[1] + r.b[1]) / 2, (r.a[2] + r.b[2]) / 2]);
      const w = F.voices.map((vc, i) => wts[i] * vc.env(u, v)); let best = 0; w.forEach((x, i) => { if (x > w[best]) best = i; });
      assert.equal(r.era, best, `${plate}: a wall stretch laid by voice ${r.era}, shaped by voice ${best}`);
    }
    const wallKeys = L.roads.filter((x) => x.kind === 'wall').map((r) => [r.a, r.b].map((P) => P.map((x) => x.toFixed(2)).join(',')).sort().join('|'));
    assert.equal(new Set(wallKeys).size, wallKeys.length, `${plate}: no stretch of wall laid twice`);
  }
});

test('the street budget follows the voices: a faint voice lays little, and a chord paves no more than its loudest voice alone', () => {
  const single = city({ plate: 'circle', preset: 'city', frequency: 432 });
  const faint = city({ plate: 'circle', preset: 'city', chord: [432, { hz: 576, weight: 0.05 }] });
  const km = roadKm(single.roads), kmFaint = roadKm(faint.roads), kmFaint1 = roadKm(faint.roads.filter((r) => r.era === 1));
  assert.ok(Math.abs(kmFaint - km) / km < 0.05, `a near-silent voice leaves the city as it was: ${kmFaint.toFixed(0)} vs ${km.toFixed(0)} km`);
  assert.ok(kmFaint1 < 0.02 * kmFaint, `the faint voice lays ${kmFaint1.toFixed(1)} km`);
  assert.ok(Math.abs(faint.stats.buildings - single.stats.buildings) / single.stats.buildings < 0.05);
  // and the same when the faint voice is the first one (the perimeter goes to the voice that shapes it)
  for (const [plate, preset, f0, f1] of [['circle', 'city', 432, 576], ['square', 'town', 300, 375]]) {
    const loud = city({ plate, preset, frequency: f1 }), weak = city({ plate, preset, chord: [{ hz: f0, weight: 0.01 }, f1] });
    assert.ok(Math.abs(roadKm(weak.roads) - roadKm(loud.roads)) / roadKm(loud.roads) < 0.05, `${plate}: a faint first voice, ${roadKm(weak.roads).toFixed(1)} vs ${roadKm(loud.roads).toFixed(1)} km`);
    assert.ok(Math.abs(weak.stats.buildings - loud.stats.buildings) / loud.stats.buildings < 0.05, `${plate}: ${weak.stats.buildings} vs ${loud.stats.buildings} buildings`);
  }
  // weight moves the streets between voices, monotonically
  const share = (w) => { const L = city({ plate: 'circle', preset: 'city', chord: [432, { hz: 648, weight: w }] }); return roadKm(L.roads.filter((r) => r.era === 1)) / roadKm(L.roads); };
  const s3 = share(0.3), s6 = share(0.6), s10 = share(1);
  assert.ok(s3 < s6 && s6 < s10, `voice 2's street share rises with its weight: ${s3.toFixed(2)} ${s6.toFixed(2)} ${s10.toFixed(2)}`);
  // no chord doubles the paving: total street length stays within 20 % of the single-voice plans
  for (const chord of [[432, 648], [432, 540, 648], [432, 576]]) {
    const L = city({ plate: 'circle', preset: 'city', chord });
    const ref = Math.max(...chord.map((f) => roadKm(city({ plate: 'circle', preset: 'city', frequency: f }).roads)));
    assert.ok(roadKm(L.roads) < 1.2 * ref, `${chord}: ${roadKm(L.roads).toFixed(0)} km against ${ref.toFixed(0)} km for the busiest voice alone`);
  }
});

test('a chord city keeps every invariant: clearance, no overlap, structure, and the measured checks', () => {
  for (const [plate, preset, chord] of [['circle', 'city', [432, 576]], ['square', 'city', [200, 300]], ['circle', 'megastructure', [432, 648]], ['sphere', 'alien', [300, 450]]]) {
    const L = city({ plate, preset, chord });
    const hard = L.checks.filter((c) => ['access', 'setback', 'slenderness', 'self-weight', 'terrace', 'core'].includes(c.id));
    for (const c of hard) assert.notEqual(c.status, 'fail', `${plate}/${preset}: ${c.id} ${c.value}`);
    // brute force: no footprint outline point inside any road (centre-line distance minus half the width), sampled lots
    const B = L.buildings, step = Math.max(1, Math.floor(B.length / 80));
    for (let i = 0; i < B.length; i += step) {
      const b = B[i], near = L.roads.filter((r) => distToSegment(b.pos, r.a, r.b) < Math.hypot(b.w, b.d) + r.w);
      for (const P of outline(b)) for (const r of near) assert.ok(distToSegment(P, r.a, r.b) - r.w / 2 >= -1e-6, `${plate}/${preset}: a building intrudes into a ${r.kind} of voice ${r.era}`);
    }
    // brute force: no two footprints overlap (oriented rectangles, separating axes; sphere included)
    const lot = L.meta.presetSpec?.lot ?? { town: 26, city: 40, megastructure: 28, alien: 52 }[preset], cellSize = 2 * lot;
    const cell = new Map(); B.forEach((b, i) => { const k = b.pos.map((x) => Math.floor(x / cellSize)).join(','); (cell.get(k) ?? cell.set(k, []).get(k)).push(i); });
    let overlaps = 0;
    B.forEach((b, i) => {
      const [x, y, z] = b.pos.map((v) => Math.floor(v / cellSize));
      for (let a = x - 1; a <= x + 1; a++) for (let c = y - 1; c <= y + 1; c++) for (let e = z - 1; e <= z + 1; e++) for (const j of cell.get(`${a},${c},${e}`) ?? []) if (j > i && overlapping(b, B[j])) overlaps++;
    });
    assert.equal(overlaps, 0, `${plate}/${preset}: overlapping footprints`);
    // eras: every building has one, and no voice is empty
    assert.ok(B.every((b) => Number.isInteger(b.era) && b.era >= 0 && b.era < chord.length));
    for (const n of L.stats.eras) assert.ok(n > 0.05 * B.length, `${plate}/${preset}: eras ${L.stats.eras}`);
    assert.equal(L.meta.chord.length, chord.length); assert.equal(L.meta.frequency, chord[0]);
  }
});

test('a lot belongs to the voice that moves the plate most under it', () => {
  const o = { plate: 'circle', preset: 'city', chord: [432, { hz: 576, weight: 0.6 }] };
  const L = city(o), F = fieldPreview(o);
  for (const b of L.buildings) {
    const [u, v] = F.toNorm(b.pos);
    const a0 = 1 * F.voices[0].at(u, v).A, a1 = 0.6 * F.voices[1].at(u, v).A;
    assert.equal(b.era, a0 >= a1 ? 0 : 1);
  }
});

test('growth on a chord: the first voice is the old city, later voices break ground after it, keyframes stay sound', () => {
  const L = city({ plate: 'circle', preset: 'town', chord: [300, 450] });
  const sim = simulate(L, { years: 80, keyframes: 4 });
  assert.equal(L.buildings[sim.founding.building].era, 0, 'founded on the first voice');
  const built = (e) => sim.history.filter((h) => L.buildings[h.building].era === e).map((h) => h.built);
  assert.ok(Math.max(...built(0)) <= Math.min(...built(1)) + 1e-9, 'every era-0 lot precedes every era-1 lot');
  assert.deepEqual(sim.eraStarts.map((x) => x.era), [0, 1]);
  assert.equal(sim.eraStarts[0].year, 0);
  close(sim.eraStarts[1].year, Math.min(...built(1)), 1e-9);
  assert.ok(sim.events.some((e) => /voice 2 \(450 Hz\) breaks ground/.test(e.note)));
  for (const k of sim.keyframes) {
    assert.equal(k.layout.meta.chord.length, 2);
    for (const c of k.infra.checks) assert.notEqual(c.status, 'fail', `year ${k.year}: ${c.id} ${c.value}`);
    if (k.year < sim.eraStarts[1].year) {
      assert.ok(k.layout.buildings.every((b) => b.era === 0), `year ${k.year}: only the old city stands`);
      // before voice 2 breaks ground nothing is credited to it: streets along its lines were laid by the old city
      assert.ok(k.layout.roads.every((r) => r.era === 0), `year ${k.year}: a street credited to voice 2 before it breaks ground`);
    }
  }
  // every street the old city laid along voice 2's lines lies on a route the old city uses: recompute the routes
  // independently (Dijkstra from the nucleus, later voices' streets five times as long, as the growth model does)
  // and check each early street carries a routed edge of its own voice
  const I = L.infra ?? buildInfrastructure(L), G = I.graph, nodeOf = new Map(I.laterals.map((l) => [l.building, l.node]));
  const n = G.nodes.length, d = new Float64Array(n).fill(Infinity), par = new Int32Array(n).fill(-1), pe = new Int32Array(n).fill(-1), done = new Uint8Array(n);
  d[sim.founding.node] = 0;
  for (;;) { // plain O(n²) Dijkstra: a town is small
    let u = -1; for (let v = 0; v < n; v++) if (!done[v] && Number.isFinite(d[v]) && (u < 0 || d[v] < d[u])) u = v;
    if (u < 0) break; done[u] = 1;
    for (const ei of G.adj[u]) { const e = G.edges[ei], v = e.a === u ? e.b : e.a, w = e.len * (1 + 4 * (e.era ?? 0)); if (d[u] + w < d[v]) { d[v] = d[u] + w; par[v] = u; pe[v] = ei; } }
  }
  for (const k of sim.keyframes) {
    const early = k.layout.roads.filter((r) => r.follows != null && r.follows !== r.era);
    if (!early.length) continue;
    const routed = []; const used = new Uint8Array(G.edges.length);
    for (const h of sim.history) { if (h.built > k.year) continue; for (let u = nodeOf.get(h.building); u != null && u >= 0 && pe[u] >= 0; u = par[u]) { if (used[pe[u]]) break; used[pe[u]] = 1; routed.push(pe[u]); } }
    const mids = routed.filter((ei) => G.edges[ei].era > 0).map((ei) => { const e = G.edges[ei], A = G.nodes[e.a].pos, B = G.nodes[e.b].pos; return { era: e.era, M: [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2] }; });
    const off = early.filter((r) => !mids.some((m) => m.era === r.follows && distToSegment(m.M, r.a, r.b) <= 0.5));
    assert.equal(off.length, 0, `year ${k.year}: ${off.length} of ${early.length} early voice-2 streets lie on no route of the old city`);
  }
  // and the old city keeps to its own streets where it can: lots reachable over voice-1 streets alone route over them
  const own = new Float64Array(n).fill(Infinity), q = [sim.founding.node]; own[sim.founding.node] = 0;
  while (q.length) { const u = q.pop(); for (const ei of G.adj[u]) { const e = G.edges[ei], v = e.a === u ? e.b : e.a; if ((e.era ?? 0) === 0 && own[v] === Infinity) { own[v] = 1; q.push(v); } } }
  let reachable = 0, strayed = 0;
  for (const h of sim.history) { if (L.buildings[h.building].era !== 0) continue; const u0 = nodeOf.get(h.building); if (u0 == null || own[u0] === Infinity) continue; reachable++; for (let u = u0; pe[u] >= 0; u = par[u]) if ((G.edges[pe[u]].era ?? 0) > 0) { strayed++; break; } }
  assert.ok(reachable > 0 && strayed <= 0.02 * reachable, `${strayed} of ${reachable} old-city lots with an old-city route still route over voice 2`);
  // a single-frequency city has no eras and no era starts
  const single = simulate(city({ plate: 'circle', preset: 'town', frequency: 300 }), { years: 40, keyframes: 2 });
  assert.equal(single.eraStarts, null);
});

test('chords are deterministic, serialise, and build their underground', () => {
  const o = { plate: 'square', preset: 'town', chord: [300, 375, 450], seed: 7 };
  const a = toJSON(generateCity(o)), b = toJSON(generateCity(o));
  assert.equal(a, b);
  const J = JSON.parse(a);
  assert.equal(J.meta.chord.length, 3); assert.ok(J.meta.chord.every((v) => v.note && v.dominant && v.modes.length));
  const L = generateCity(o), I = buildInfrastructure(L);
  assert.equal(I.laterals.length, L.buildings.length);
  for (const c of I.checks) assert.notEqual(c.status, 'fail', `${c.id} ${c.value}`);
});

test('terrain and people on a chord: the preview ground is the city ground, and the commute runs', async () => {
  for (const [plate, preset, chord, terrain] of [['circle', 'town', [300, 450], 'relief'], ['square', 'town', [300, 375, 450], 'valleys']]) {
    const o = { plate, preset, chord, terrain }, L = city(o), F = fieldPreview(o);
    close(F.terrain.relief, L.stats.terrain.relief, 1e-9, `${plate}: the preview and the city agree on the relief`);
    for (const b of L.buildings.slice(0, 200)) { const [u, v] = F.toNorm(b.pos); close(b.elevation, F.terrain.z(u, v), 1e-6, `${plate}: building on the preview ground`); }
  }
  const { people } = await import('../src/people.js');
  const L = city({ plate: 'circle', preset: 'city', chord: [432, 648] }); const I = buildInfrastructure(L), P = people(L, I);
  assert.ok(P.stats.commuters > 0 && Number.isFinite(P.stats.meanTripMin));
  for (const c of [...I.checks, ...P.checks]) assert.notEqual(c.status, 'fail', `${c.id} ${c.value}`);
  // every street edge of the graph keeps the voice that laid it
  assert.ok(I.graph.edges.filter((e) => e.kind !== 'service' && e.kind !== 'corridor').every((e) => e.era === 0 || e.era === 1));
});
