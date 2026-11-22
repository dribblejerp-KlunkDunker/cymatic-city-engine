// Cymatic City Engine — deterministic elementary functions.
//
// JavaScript guarantees the bits of + − × ÷ and Math.sqrt, but not of Math.sin, Math.exp, Math.pow and the
// rest: Node and Chromium return different last bits for the same input (measured: atan2 on 43 % of inputs).
// One bit is enough to move a street, resize a pipe or add a lift station, so "the same profile gives the same
// city" would hold only inside one runtime. Every function here is built from the guaranteed operations alone
// (and exact scaling by powers of two), so it returns the same bits everywhere.
//
// The algorithms are the classic fdlibm ones (Sun Microsystems, 1993: "Permission to use, copy, modify, and
// distribute this software is freely granted, provided that this notice is preserved"), written out for
// JavaScript. Each is within 1 ulp of the true value on the range the engine uses; sin and cos keep that for
// |x| below about 10^6 (two-step Cody–Waite reduction) and stay deterministic, though less exact, beyond it.
// pow is exact products for small whole exponents, sqrt for 0.5, and exp(y·log x) otherwise (a few ulp).
//
// Engine code calls these instead of Math.sin, Math.cos, Math.atan2, Math.acos, Math.asin, Math.exp, Math.log,
// Math.log2, Math.pow, the ** operator and Math.hypot. Math.sqrt, abs, floor, ceil, round, trunc, min, max,
// sign, fround, imul and the constants are exact and stay as they are.

const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
f64[0] = 1;
const HI = u32[1] === 0x3ff00000 ? 1 : 0, LO = 1 - HI; // which half holds the sign and exponent
const hiWord = (x) => { f64[0] = x; return u32[HI] | 0; };
const loWord = (x) => { f64[0] = x; return u32[LO] >>> 0; };
const make = (hi, lo) => { u32[HI] = hi; u32[LO] = lo; return f64[0]; };
const pow2 = (k) => make((k + 1023) << 20, 0); // 2^k exactly, −1022 ≤ k ≤ 1023
// x · 2^k with one rounding at most
function scalb(x, k) {
  if (k > 1023) { x *= pow2(1023); k -= 1023; if (k > 1023) return x * pow2(1023); }
  else if (k < -1021) return (x * pow2(Math.max(k + 1000, -1022))) * pow2(-1000);
  return x * pow2(k);
}

// ---------------------------------------------------------------- exp
const LN2_HI = 6.93147180369123816490e-01, LN2_LO = 1.90821492927058770002e-10, INV_LN2 = 1.44269504088896338700e+00;
const P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05, P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08;
export function exp(x) {
  if (x !== x) return NaN;
  if (x > 709.782712893383973096) return Infinity;
  if (x < -745.13321910194110842) return 0;
  const ax = Math.abs(x);
  let hi = 0, lo = 0, k = 0;
  if (ax > 0.34657359027997264) {            // |x| > ½ ln 2
    if (ax < 1.0397207708399179) { k = x < 0 ? -1 : 1; hi = x - k * LN2_HI; lo = k * LN2_LO; } // < 1½ ln 2
    else { k = Math.trunc(INV_LN2 * x + (x < 0 ? -0.5 : 0.5)); hi = x - k * LN2_HI; lo = k * LN2_LO; }
    x = hi - lo;
  } else if (ax < 3.725290298461914e-9) return 1 + x; // |x| < 2^−28
  const t = x * x, c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((x * c) / (c - 2) - x);
  return scalb(1 - ((lo - (x * c) / (2 - c)) - hi), k);
}

// ---------------------------------------------------------------- log
const LG1 = 6.666666666666735130e-01, LG2 = 3.999999999940941908e-01, LG3 = 2.857142874366239149e-01, LG4 = 2.222219843214978396e-01, LG5 = 1.818357216161805012e-01, LG6 = 1.531383769920937332e-01, LG7 = 1.479819860511658591e-01;
// x = 2^k · m with m in [√½, √2): returns k and log(m) in two parts (f − ½f² + s(½f² + R) is log(m))
function logParts(x) {
  let k = 0, hx = hiWord(x);
  if (hx < 0x00100000) { x *= 18014398509481984; k = -54; hx = hiWord(x); } // subnormal: scale by 2^54
  const lx = loWord(x);
  hx += 0x3ff00000 - 0x3fe6a09e;
  k += (hx >> 20) - 0x3ff;
  const m = make((hx & 0x000fffff) + 0x3fe6a09e, lx);
  const f = m - 1, hfsq = 0.5 * f * f, s = f / (2 + f), z = s * s, w = z * z;
  const R = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7))) + w * (LG2 + w * (LG4 + w * LG6));
  return { k, f, hfsq, tail: s * (hfsq + R) };
}
export function log(x) {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  if (x === 1) return 0;
  const { k, f, hfsq, tail } = logParts(x);
  return tail + k * LN2_LO - hfsq + f + k * LN2_HI;
}
// exact for powers of two
export function log2(x) {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  const { k, f, hfsq, tail } = logParts(x);
  return k + (tail - hfsq + f) * INV_LN2;
}

// ---------------------------------------------------------------- sin, cos
const INV_PIO2 = 6.36619772367581382433e-01;
const PIO2_1 = 1.57079632673412561417e+00, PIO2_2 = 6.07710050630396597660e-11, PIO2_2T = 2.02226624879595063154e-21;
const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04, S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05, C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
// sin and cos of y + t for |y| ≤ π/4, t the tail of y
function kSin(y, t) {
  const z = y * y, w = z * z, r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6), v = z * y;
  return y - ((z * (0.5 * t - v * r) - t) - v * S1);
}
function kCos(y, t) {
  const z = y * y, w = z * z, r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6)), hz = 0.5 * z, one = 1 - hz;
  return one + (((1 - one) - hz) + (z * r - y * t));
}
// x = n·π/2 + (y + t): the quadrant n (0..3) in q, the remainder in the two shared slots below
let remY = 0, remT = 0;
function remPio2(x) {
  if (Math.abs(x) <= 0.7853981633974483) { remY = x; remT = 0; return 0; }
  const fn = Math.floor(x * INV_PIO2 + 0.5);
  const t = x - fn * PIO2_1, w2 = fn * PIO2_2, r = t - w2, w = fn * PIO2_2T - ((t - r) - w2);
  remY = r - w; remT = (r - remY) - w;
  return ((fn % 4) + 4) % 4;
}
export function sin(x) {
  if (x === 0) return x;
  if (x !== x || x === Infinity || x === -Infinity) return NaN;
  const n = remPio2(x);
  return n === 0 ? kSin(remY, remT) : n === 1 ? kCos(remY, remT) : n === 2 ? -kSin(remY, remT) : -kCos(remY, remT);
}
export function cos(x) {
  if (x !== x || x === Infinity || x === -Infinity) return NaN;
  const n = remPio2(x);
  return n === 0 ? kCos(remY, remT) : n === 1 ? -kSin(remY, remT) : n === 2 ? -kCos(remY, remT) : kSin(remY, remT);
}

// ---------------------------------------------------------------- atan, atan2
const ATAN_HI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01, 9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02, 4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02];
export function atan(x) {
  if (x !== x) return NaN;
  const neg = x < 0 || (x === 0 && 1 / x < 0), ax = Math.abs(x);
  if (ax >= 7.378697629483821e19) { const z = ATAN_HI[3] + ATAN_LO[3]; return neg ? -z : z; } // 2^66
  let id, a = ax;
  if (ax < 0.4375) { if (ax < 7.450580596923828e-9) return x; id = -1; }        // 2^−27
  else if (ax < 1.1875) { if (ax < 0.6875) { id = 0; a = (2 * ax - 1) / (2 + ax); } else { id = 1; a = (ax - 1) / (ax + 1); } }
  else if (ax < 2.4375) { id = 2; a = (ax - 1.5) / (1 + 1.5 * ax); }
  else { id = 3; a = -1 / ax; }
  const z = a * a, w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) { const r = a - a * (s1 + s2); return neg ? -r : r; }
  const r = ATAN_HI[id] - ((a * (s1 + s2) - ATAN_LO[id]) - a);
  return neg ? -r : r;
}
const PI = 3.1415926535897931160e+00, PI_LO = 1.2246467991473531772e-16, PIO2 = 1.5707963267948966;
export function atan2(y, x) {
  if (x !== x || y !== y) return NaN;
  const yNeg = y < 0 || (y === 0 && 1 / y < 0), xNeg = x < 0 || (x === 0 && 1 / x < 0);
  if (y === 0) return xNeg ? (yNeg ? -PI : PI) : y;
  if (x === 0) return yNeg ? -PIO2 : PIO2;
  const ax = Math.abs(x), ay = Math.abs(y);
  if (ax === Infinity) {
    if (ay === Infinity) { const q = xNeg ? 3 * (PI / 4) : PI / 4; return yNeg ? -q : q; }
    return xNeg ? (yNeg ? -PI : PI) : (yNeg ? -0 : 0);
  }
  if (ay === Infinity) return yNeg ? -PIO2 : PIO2;
  const q = ay / ax;
  let z;
  if (q > 1.8446744073709552e19) z = PIO2 + 0.5 * PI_LO; // |y/x| > 2^64
  else if (xNeg && q < 5.421010862427522e-20) z = 0;      // |y/x| < 2^−64 on the left
  else z = atan(q);
  if (!xNeg) return yNeg ? -z : z;
  return yNeg ? (z - PI_LO) - PI : PI - (z - PI_LO);
}

// ---------------------------------------------------------------- asin, acos
const PIO2_HI = 1.57079632679489655800e+00, PIO2_LO = 6.12323399573676603587e-17;
const PS0 = 1.66666666666666657415e-01, PS1 = -3.25565818622400915405e-01, PS2 = 2.01212532134862925881e-01, PS3 = -4.00555345006794114027e-02, PS4 = 7.91534994289814532176e-04, PS5 = 3.47933107596021167570e-05;
const QS1 = -2.40339491173441421878e+00, QS2 = 2.02094576023350569471e+00, QS3 = -6.88283971605453293030e-01, QS4 = 7.70381505559019352791e-02;
const ratR = (z) => (z * (PS0 + z * (PS1 + z * (PS2 + z * (PS3 + z * (PS4 + z * PS5)))))) / (1 + z * (QS1 + z * (QS2 + z * (QS3 + z * QS4))));
export function acos(x) {
  if (x !== x) return NaN;
  const ax = Math.abs(x);
  if (ax >= 1) return ax > 1 ? NaN : x > 0 ? 0 : 2 * PIO2_HI + 2 * PIO2_LO;
  if (ax < 0.5) return ax < 6.938893903907228e-18 ? PIO2_HI + PIO2_LO : PIO2_HI - (x - (PIO2_LO - x * ratR(x * x))); // 2^−57
  if (x < 0) { const z = (1 + x) * 0.5, s = Math.sqrt(z), w = ratR(z) * s - PIO2_LO; return 2 * (PIO2_HI - (s + w)); }
  const z = (1 - x) * 0.5, s = Math.sqrt(z), df = make(hiWord(s), 0), c = (z - df * df) / (s + df), w = ratR(z) * s + c;
  return 2 * (df + w);
}
export function asin(x) {
  if (x !== x) return NaN;
  const ax = Math.abs(x);
  if (ax >= 1) return ax > 1 ? NaN : x * PIO2_HI + x * PIO2_LO;
  if (ax < 0.5) return ax < 1.4901161193847656e-8 ? x : x + x * ratR(x * x); // 2^−26
  const z = (1 - ax) * 0.5, s = Math.sqrt(z), r = ratR(z);
  let v;
  if (ax >= 0.975) v = PIO2_HI - (2 * (s + s * r) - PIO2_LO);
  else { const f = make(hiWord(s), 0), c = (z - f * f) / (s + f); v = 0.5 * PIO2_HI - (2 * s * r - (PIO2_LO - 2 * c) - (0.5 * PIO2_HI - 2 * f)); }
  return x < 0 ? -v : v;
}

// ---------------------------------------------------------------- pow, hypot
// x^n for a whole n by repeated squaring: plain products, so x^2 is x·x and 10^3 is exactly 1000
function powWhole(x, n) {
  let m = Math.abs(n), base = x, r = 1;
  while (m > 0) { if (m % 2 === 1) r *= base; m = Math.floor(m / 2); if (m > 0) base *= base; }
  return n < 0 ? 1 / r : r;
}
// y is split into the nearest whole number n and a rest r, |r| ≤ ½: x^y = x^n · x^r. The whole part is
// products, a rest of ½ is the square root, and any other rest is exp(r·log x), whose small exponent keeps
// the result within a few ulp (4^1.5 is exactly 8). Exponents beyond ±64 go through exp(y·log x) whole.
export function pow(x, y) {
  if (y === 0) return 1;
  if (x !== x || y !== y) return NaN;
  if (y === 1) return x;
  if (x === 1) return 1;
  const whole = Math.floor(y) === y, odd = whole && Math.abs(y) % 2 === 1;
  if (whole && Math.abs(y) <= 64) return powWhole(x, y);
  const ax = Math.abs(x);
  if (ax === 0) return y > 0 ? (odd ? x : 0) : (odd ? 1 / x : Infinity);
  if (ax === Infinity) return y > 0 ? (odd ? x : Infinity) : (odd && x < 0 ? -0 : 0);
  if (y === Infinity) return ax === 1 ? 1 : ax > 1 ? Infinity : 0;
  if (y === -Infinity) return ax === 1 ? 1 : ax > 1 ? 0 : Infinity;
  if (x < 0 && !whole) return NaN;
  if (Math.abs(y) > 64) { const r = exp(y * log(ax)); return x < 0 && odd ? -r : r; }
  const n = Math.ceil(y - 0.5), r = y - n; // r in (−½, ½], so a half is always +½: x^1.5 = x·√x, x^0.5 = √x
  const part = r === 0.5 ? Math.sqrt(ax) : exp(r * log(ax));
  return n === 0 ? part : powWhole(ax, n) * part;
}
// the length of a vector: the square root of the sum of squares, in argument order
export function hypot(a, b, c, d) {
  if (d !== undefined) return Math.sqrt(a * a + b * b + c * c + d * d);
  return Math.sqrt(c === undefined ? a * a + b * b : a * a + b * b + c * c);
}

// one name for callers: DM.sin(x) where they would have written Math.sin(x)
export const DM = { sin, cos, atan, atan2, asin, acos, exp, log, log2, pow, hypot };

// A fingerprint of this module on the machine it runs on: 16 hex digits hashing the exact bits of every
// function over a fixed set of inputs. It is the same string in every runtime; test/detmath.test.mjs pins it
// and test/page.test.mjs compares a browser's with Node's.
export function fingerprint() {
  let seed = 0x2545f491, h1 = 0x811c9dc5 | 0, h2 = 0x01000193 | 0;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
  const mix = (v) => { const a = hiWord(v), b = loWord(v) | 0; h1 = Math.imul(h1 ^ a, 16777619); h1 = Math.imul(h1 ^ b, 16777619); h2 = Math.imul(h2 + b, 0x5bd1e995) ^ (h2 >>> 13); h2 = Math.imul(h2 + a, 0x5bd1e995) ^ (h2 >>> 15); };
  for (let i = 0; i < 4000; i++) {
    const u = next(), v = next(), wide = (u - 0.5) * 2000, near = (u - 0.5) * 12, unit = 2 * u - 1, pos = u * 60 + 1e-3;
    mix(sin(wide)); mix(cos(wide)); mix(sin(near)); mix(cos(near)); mix(exp(near * 4)); mix(log(pos)); mix(log2(pos));
    mix(atan(near * 3)); mix(atan2(near, (v - 0.5) * 12)); mix(asin(unit)); mix(acos(unit));
    mix(pow(pos, (v - 0.5) * 8)); mix(pow(pos, Math.round(v * 12) - 6)); mix(pow(pos, 2 / 3)); mix(hypot(near, wide, pos));
  }
  const hex = (h) => (h >>> 0).toString(16).padStart(8, '0');
  return hex(h1) + hex(h2);
}
