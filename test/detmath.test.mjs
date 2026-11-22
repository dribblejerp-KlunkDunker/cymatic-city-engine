// Deterministic math: the same bits in every runtime, within one ulp of the true value, and used everywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DM, sin, cos, atan, atan2, asin, acos, exp, log, log2, pow, hypot, fingerprint } from '../src/detmath.js';

const f = new Float64Array(1), b = new BigInt64Array(f.buffer);
const bits = (x) => { f[0] = x; return b[0]; };
// how many representable numbers apart two results are
const ulps = (a, e) => { if (Object.is(a, e) || (a !== a && e !== e)) return 0; if (!Number.isFinite(a) || !Number.isFinite(e)) return Infinity; const d = bits(a) - bits(e); return Number(d < 0n ? -d : d); };
let seed = 20261122;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
const worst = (mine, ref, gen, n = 20000) => { let w = 0; for (let i = 0; i < n; i++) { const x = gen(); w = Math.max(w, ulps(mine(x), ref(x))); } return w; };

test('the fingerprint is pinned: every function returns these exact bits on this runtime', () => {
  // Recorded on Node 22 and matched in Chromium by test/page.test.mjs. If this changes, the engine's output
  // changes: that is a contract change (version bump, goldens re-recorded), never a casual edit.
  assert.equal(fingerprint(), 'b3d42c63b0365c4b');
  assert.deepEqual(Object.keys(DM).sort(), ['acos', 'asin', 'atan', 'atan2', 'cos', 'exp', 'hypot', 'log', 'log2', 'pow', 'sin']);
});

test('each function is within one ulp of the platform’s (itself within one ulp of the truth)', () => {
  // two results that are each less than one ulp from the true value are at most one ulp apart
  assert.ok(worst(sin, Math.sin, () => (rnd() - 0.5) * 40) <= 1, 'sin near');
  assert.ok(worst(cos, Math.cos, () => (rnd() - 0.5) * 40) <= 1, 'cos near');
  assert.ok(worst(sin, Math.sin, () => (rnd() - 0.5) * 2e6) <= 1, 'sin to ±10^6');
  assert.ok(worst(cos, Math.cos, () => (rnd() - 0.5) * 2e6) <= 1, 'cos to ±10^6');
  assert.ok(worst(exp, Math.exp, () => (rnd() - 0.5) * 1400) <= 1, 'exp');
  assert.ok(worst(log, Math.log, () => rnd() * 10 + 1e-9) <= 1, 'log');
  assert.ok(worst(log, Math.log, () => Math.pow(10, (rnd() - 0.5) * 600)) <= 1, 'log over 600 decades');
  assert.ok(worst(log2, Math.log2, () => rnd() * 100 + 1e-6) <= 1, 'log2');
  assert.ok(worst(atan, Math.atan, () => (rnd() - 0.5) * 100) <= 1, 'atan');
  assert.ok(worst((p) => atan2(p[0], p[1]), (p) => Math.atan2(p[0], p[1]), () => [(rnd() - 0.5) * 10, (rnd() - 0.5) * 10]) <= 1, 'atan2');
  assert.ok(worst(asin, Math.asin, () => rnd() * 2 - 1) <= 1, 'asin');
  assert.ok(worst(acos, Math.acos, () => rnd() * 2 - 1) <= 1, 'acos');
  // pow: whole part by products, the rest by exp(r·log x) with |r| ≤ ½
  assert.ok(worst((p) => pow(p[0], p[1]), (p) => Math.pow(p[0], p[1]), () => [rnd() * 50 + 0.01, (rnd() - 0.5) * 6]) <= 6, 'pow');
  assert.ok(worst((p) => hypot(p[0], p[1], p[2]), (p) => Math.hypot(p[0], p[1], p[2]), () => [rnd() * 100, rnd() * 100, rnd() * 100]) <= 2, 'hypot');
});

test('exact where exactness is expected, and the edge cases of IEEE arithmetic', () => {
  const same = (a, e, what) => assert.ok(Object.is(a, e), `${what}: ${a} is not ${e}`);
  same(sin(0), 0, 'sin 0'); same(sin(-0), -0, 'sin −0'); same(cos(0), 1, 'cos 0'); same(exp(0), 1, 'exp 0'); same(log(1), 0, 'log 1');
  same(sin(Math.PI / 2), 1, 'sin π/2'); same(cos(Math.PI), -1, 'cos π');
  for (let k = -40; k <= 40; k++) same(log2(2 ** k), k, `log2 2^${k}`);
  for (let k = 0; k <= 15; k++) { same(pow(10, k), Number(`1e${k}`), `10^${k}`); same(pow(2, k), 2 ** k, `2^${k}`); }
  same(pow(10, -3), 0.001, '10^−3'); same(pow(7, 2), 49, '7²'); same(pow(-8, 3), -512, '(−8)³'); same(pow(-2, 4), 16, '(−2)⁴');
  same(pow(4, 1.5), 8, '4^1.5'); same(pow(2, 0.5), Math.SQRT2, '√2'); same(pow(9, 0.5), 3, '√9'); same(pow(4, -0.5), 0.5, '4^−½'); same(pow(27, 0), 1, 'x⁰'); same(pow(5, 1), 5, 'x¹');
  for (let i = 0; i < 200; i++) { const x = rnd() * 100 - 50; same(pow(x, 2), x * x, 'x² is x·x'); same(pow(Math.abs(x), 0.5), Math.sqrt(Math.abs(x)), 'x^½ is √x'); }
  same(hypot(3, 4), 5, 'hypot 3 4'); same(hypot(2, 3, 6), 7, 'hypot 2 3 6'); same(hypot(1, 2, 2, 4), 5, 'hypot of four');
  same(acos(1), 0, 'acos 1'); same(acos(-1), Math.PI, 'acos −1'); same(acos(0), Math.PI / 2, 'acos 0'); same(asin(1), Math.PI / 2, 'asin 1'); same(asin(-1), -Math.PI / 2, 'asin −1'); same(asin(0), 0, 'asin 0');
  same(atan2(1, 1), Math.PI / 4, 'atan2 1 1'); same(atan2(0, -1), Math.PI, 'atan2 0 −1'); same(atan2(-0, -1), -Math.PI, 'atan2 −0 −1'); same(atan2(-1, 0), -Math.PI / 2, 'atan2 −1 0'); same(atan2(0, 1), 0, 'atan2 0 1'); same(atan2(-0, 1), -0, 'atan2 −0 1'); same(atan(Infinity), Math.PI / 2, 'atan ∞');
  same(exp(-800), 0, 'exp underflow'); same(exp(800), Infinity, 'exp overflow'); same(exp(-Infinity), 0, 'exp −∞'); same(log(0), -Infinity, 'log 0'); same(log(Infinity), Infinity, 'log ∞');
  for (const v of [log(-1), log2(-1), pow(-2, 0.5), acos(1.5), asin(-1.5), sin(Infinity), cos(-Infinity), sin(NaN), exp(NaN), atan2(NaN, 1), pow(NaN, 2)]) assert.ok(Number.isNaN(v));
  same(pow(NaN, 0), 1, 'NaN⁰'); same(pow(0, 3), 0, '0³'); same(pow(0, -2), Infinity, '0^−2'); same(pow(Infinity, 0.5), Infinity, '√∞'); same(pow(0.5, Infinity), 0, '½^∞'); same(pow(2, -Infinity), 0, '2^−∞');
  // tiny and subnormal inputs
  same(sin(1e-300), 1e-300, 'sin of a tiny number'); same(exp(1e-300), 1, 'exp of a tiny number'); assert.ok(ulps(log(5e-324), Math.log(5e-324)) <= 1);
  assert.ok(ulps(exp(-745), Math.exp(-745)) <= 1); assert.ok(ulps(exp(709.7), Math.exp(709.7)) <= 1);
  // symmetry
  for (let i = 0; i < 500; i++) { const x = (rnd() - 0.5) * 300; same(sin(-x), -sin(x), 'sin is odd'); same(cos(-x), cos(x), 'cos is even'); same(atan(-x), -atan(x), 'atan is odd'); }
});

test('no stage calls the platform’s inexact functions: src/ uses DM for sin, cos, exp, log, pow, hypot and the like', () => {
  const dir = fileURLToPath(new URL('../src/', import.meta.url));
  const files = readdirSync(dir).filter((n) => n.endsWith('.js') && n !== 'detmath.js');
  assert.ok(files.length >= 6);
  const inexact = /Math\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log2|log10|log1p|pow|cbrt|hypot|random)\b/;
  for (const name of files) {
    const text = readFileSync(dir + name, 'utf8'), code = text.split('\n').map((line) => line.replace(/\/\/.*$/, ''));
    code.forEach((line, i) => {
      assert.ok(!inexact.test(line), `${name}:${i + 1} calls ${line.match(inexact)?.[0]}; use DM from detmath.js`);
      assert.ok(!/\*\*/.test(line.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '')), `${name}:${i + 1} uses the ** operator; write the product or DM.pow`);
    });
    assert.match(text, /^import \{[^}]*\bDM\b[^}]*\} from '\.\/detmath\.js';$/m, `${name} imports DM on one line (build.mjs strips single-line imports)`);
  }
  // the module itself is built from exact operations only
  const own = readFileSync(dir + 'detmath.js', 'utf8').split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
  assert.deepEqual([...new Set(own.match(/Math\.[a-zA-Z0-9]+/g))].sort(), ['Math.abs', 'Math.ceil', 'Math.floor', 'Math.imul', 'Math.max', 'Math.round', 'Math.sqrt', 'Math.trunc']);
});
