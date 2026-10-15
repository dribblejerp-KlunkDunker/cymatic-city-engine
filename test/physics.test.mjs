// Physics contract: values cross-checked against scipy (research notes, cymatics_physics.md)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  besselJ, besselZeros, legendreNormalized, realSphericalHarmonic,
  enumerateModes, drivenResponse, mulberry32, drivePoint,
} from '../src/cymatic-engine.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} got ${a}, expected ${b} (±${tol})`);

test('Bessel J matches reference values', () => {
  close(besselJ(0, 1), 0.765197686558, 1e-11, 'J0(1)');
  close(besselJ(1, 1), 0.440050585745, 1e-11, 'J1(1)');
  close(besselJ(2, 2), 0.352834028616, 1e-11, 'J2(2)');
  close(besselJ(0, 5), -0.177596771314, 1e-11, 'J0(5)');
  close(besselJ(3, -2), -besselJ(3, 2), 1e-14, 'odd parity');
});

test('Bessel zeros match DLMF/scipy table', () => {
  close(besselZeros(0, 1)[0], 2.4048255577, 1e-9, 'j01');
  close(besselZeros(1, 1)[0], 3.8317059702, 1e-9, 'j11');
  close(besselZeros(2, 1)[0], 5.1356223018, 1e-9, 'j21');
  close(besselZeros(5, 4)[3], 18.9801338752, 1e-9, 'j54');
  const z = besselZeros(3, 6);
  for (let i = 1; i < z.length; i++) assert.ok(z[i] > z[i - 1] + 2.5, 'zeros strictly increasing, ~pi apart');
});

test('membrane fundamental reproduces worked example (R=0.1 m, c=100 m/s -> 382.74 Hz)', () => {
  const f = besselZeros(0, 1)[0] * 100 / (2 * Math.PI * 0.1);
  close(f, 382.74, 0.01);
});

test('spherical harmonics are orthonormal on the sphere', () => {
  const integrate = (fn) => {
    const nT = 400, nP = 400; let s = 0;
    for (let i = 0; i < nT; i++) {
      const th = (i + 0.5) * Math.PI / nT;
      for (let j = 0; j < nP; j++) {
        const ph = (j + 0.5) * 2 * Math.PI / nP;
        s += fn(th, ph) * Math.sin(th);
      }
    }
    return s * (Math.PI / nT) * (2 * Math.PI / nP);
  };
  close(integrate((t, p) => realSphericalHarmonic(4, 2, t, p) ** 2), 1, 2e-3, '<Y42,Y42>');
  close(integrate((t, p) => realSphericalHarmonic(5, 0, t, p) ** 2), 1, 2e-3, '<Y50,Y50>');
  close(integrate((t, p) => realSphericalHarmonic(4, 2, t, p) * realSphericalHarmonic(6, 2, t, p)), 0, 2e-3, '<Y42,Y62>');
  close(legendreNormalized(0, 0, 0.3), Math.sqrt(1 / (4 * Math.PI)), 1e-12, 'P00');
});

test('driving exactly at a mode frequency makes that mode dominant', () => {
  const modes = enumerateModes({ plate: 'circle', fundamentalHz: 40, driveOffset: 0.37 });
  const target = modes.find(m => m.m === 3 && m.n === 2);
  const r = drivenResponse(modes, target.f, 40);
  assert.equal(r.active[0].m, 3);
  assert.equal(r.active[0].n, 2);
  close(r.active[0].weight, 1, 1e-12);
});

test('frequency laws: membrane f ∝ j, plate f ∝ m²+n², sphere f ∝ sqrt(l(l+1))', () => {
  const c = enumerateModes({ plate: 'circle', fundamentalHz: 40 });
  const m01 = c.find(m => m.m === 0 && m.n === 1), m11 = c.find(m => m.m === 1 && m.n === 1);
  close(m01.f, 40, 1e-9); close(m11.f / m01.f, 3.8317059702 / 2.4048255577, 1e-9);
  const s = enumerateModes({ plate: 'square', fundamentalHz: 5 });
  close(s.find(m => m.m === 3 && m.n === 4).f, 5 * 25, 1e-9);
  const sp = enumerateModes({ plate: 'sphere', fundamentalHz: 30 });
  close(sp.find(m => m.l === 6).f, 30 * Math.sqrt(42) / Math.sqrt(2), 1e-9);
});

test('square plate: centre drive cannot excite the minus combination (it vanishes at centre)', () => {
  const modes = enumerateModes({ plate: 'square', fundamentalHz: 5, driveOffset: 0 });
  for (const m of modes) if (m.sign < 0) close(m.coupling, 0, 1e-12, `(${m.m},${m.n},-)`);
});

test('circle: a drive point on a mode\'s nodal circle does not couple to it', () => {
  // (0,2) has an interior nodal circle at r = j01/j02
  const rNode = besselZeros(0, 2)[0] / besselZeros(0, 2)[1];
  const modes = enumerateModes({ plate: 'circle', fundamentalHz: 40, driveOffset: rNode });
  close(modes.find(m => m.m === 0 && m.n === 2).coupling, 0, 1e-9);
});

test('seeded RNG is deterministic', () => {
  const a = mulberry32(42), b = mulberry32(42);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
});

test('mode norms ∫φ² dA match numerical integration', () => {
  const circle = enumerateModes({ plate: 'circle' }).find((m) => m.m === 3 && m.n === 2);
  let I = 0; const N = 600;
  for (let i = 0; i < N; i++) {
    const r = (i + 0.5) / N;
    I += besselJ(3, circle.j * r) ** 2 * r / N;
  }
  close(I * Math.PI, circle.norm, 1e-5, 'circle (3,2)');
  const sq = enumerateModes({ plate: 'square' });
  for (const [m, n, sign] of [[1, 2, 1], [0, 3, -1], [2, 2, 1]]) {
    const md = sq.find((x) => x.m === m && x.n === n && x.sign === sign);
    let J = 0; const K = 200;
    for (let i = 0; i < K; i++) for (let k = 0; k < K; k++) {
      const x = (i + 0.5) / K, y = (k + 0.5) / K;
      const phi = Math.cos(n * Math.PI * x) * Math.cos(m * Math.PI * y) + sign * Math.cos(m * Math.PI * x) * Math.cos(n * Math.PI * y);
      J += phi * phi / (K * K);
    }
    close(J, md.norm, 1e-3, `square (${m},${n},${sign})`);
  }
});

test('square plate uses corner coordinates: (0,1)+ has its node on the anti-diagonal and at the centre', () => {
  const md = enumerateModes({ plate: 'square', driveOffset: 0 }).find((m) => m.m === 0 && m.n === 1 && m.sign === 1);
  close(md.coupling, 0, 1e-12, 'centre is on the node');
  const off = enumerateModes({ plate: 'square', driveOffset: 0.3 }).find((m) => m.m === 0 && m.n === 1 && m.sign === 1);
  const { x, y } = drivePoint('square', 0.3);
  close(off.coupling, Math.cos(Math.PI * x) + Math.cos(Math.PI * y), 1e-12);
});

test('sphere coupling follows the drive point', () => {
  const a = enumerateModes({ plate: 'sphere', driveOffset: 0.1 }), b = enumerateModes({ plate: 'sphere', driveOffset: 0.9 });
  const l6a = a.find((m) => m.l === 6), l6b = b.find((m) => m.l === 6);
  const tA = drivePoint('sphere', 0.1).theta;
  close(l6a.coupling, realSphericalHarmonic(6, l6a.m, tA, 0), 1e-12);
  assert.notEqual(l6a.coupling.toFixed(6), l6b.coupling.toFixed(6));
});

test('higher Q sharpens the pattern; low Q spreads the response over more modes', () => {
  const modes = enumerateModes({ plate: 'circle' });
  const lo = drivenResponse(modes, 432, 5), hi = drivenResponse(modes, 432, 500);
  assert.ok(hi.sharpness > lo.sharpness, `${hi.sharpness} vs ${lo.sharpness}`);
  const onMode = drivenResponse(modes, modes.find((m) => m.m === 4 && m.n === 3).f, 500);
  assert.ok(onMode.sharpness > 0.99);
});

test('the response normalises each mode by its norm ∫φ² before comparing and summing', () => {
  // two modes at the same frequency whose normalised shapes take the same value at the drive point
  const modes = [{ plate: 'circle', m: 0, n: 1, f: 100, coupling: 2, norm: 4 }, { plate: 'circle', m: 1, n: 1, f: 100, coupling: 1, norm: 1 }];
  const r = drivenResponse(modes, 100, 50);
  assert.equal(r.active.length, 2);
  close(r.active[0].weight, 1, 1e-12); close(r.active[1].weight, 1, 1e-12);
  // field coefficients return to the un-normalised shapes: c / √N
  const a = r.active.find((x) => x.m === 0), b = r.active.find((x) => x.m === 1);
  close(Math.hypot(a.cr, a.ci) / Math.hypot(b.cr, b.ci), 0.5, 1e-12);
});
