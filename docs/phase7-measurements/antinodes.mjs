import { generateCity, fieldPreview } from '../../src/cymatic-engine.js';
import { buildInfrastructure } from '../../src/infrastructure.js';
const profiles = [{ frequency: 432, preset: 'town' }, { frequency: 432 }, { frequency: 300 }, { frequency: 540, plate: 'square' }, { chord: [432, 540] }, { frequency: 432, preset: 'megastructure' }, { frequency: 700, preset: 'alien', seed: 3 }];
console.log('building keys', Object.keys(generateCity(profiles[0]).buildings[0]).join(','));
for (const p of profiles) {
  const F = fieldPreview(p), L = generateCity(p), I = buildInfrastructure(L), E = L.meta.world.extent, N = 240, W = N + 1;
  const S = new Float64Array(W * W), ins = new Uint8Array(W * W), step = 2 * E / N;
  let smax = 0, energy = 0, cells = 0;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const x = -E + i * step, z = -E + j * step, [u, v] = F.toNorm([x, 0, z]); if (!F.inside(u, v)) continue; const s = F.at(u, v).S; ins[j * W + i] = 1; S[j * W + i] = s; smax = Math.max(smax, Math.abs(s)); energy += s * s; cells++; }
  const peaks = [];
  for (let j = 1; j < N; j++) for (let i = 1; i < N; i++) { const k = j * W + i; if (!ins[k]) continue; const w = Math.abs(S[k]); if (w < 0.1 * smax) continue; let top = true; for (let dj = -2; dj <= 2 && top; dj++) for (let di = -2; di <= 2; di++) { if (!di && !dj) continue; const q = (j + dj) * W + i + di; if (j + dj < 0 || j + dj > N || i + di < 0 || i + di > N) continue; if (ins[q] && (Math.abs(S[q]) > w || (Math.abs(S[q]) === w && q < k))) { top = false; break; } } if (top) peaks.push({ x: -E + i * step, z: -E + j * step, w: w / smax, sign: Math.sign(S[k]) }); }
  // basin energy: each inside cell goes to the nearest peak of the same sign (cheap stand-in for the sign region)
  const supply = new Float64Array(peaks.length);
  for (let j = 0; j <= N; j += 2) for (let i = 0; i <= N; i += 2) { const k = j * W + i; if (!ins[k]) continue; const x = -E + i * step, z = -E + j * step; let best = -1, bd = Infinity; peaks.forEach((q, n) => { const d = (q.x - x) ** 2 + (q.z - z) ** 2; if (d < bd) { bd = d; best = n; } }); if (best >= 0) supply[best] += S[k] * S[k]; }
  const demand = new Float64Array(peaks.length); let totalD = 0;
  for (const b of L.buildings) { const d = b.w * b.d * b.floors; let best = -1, bd = Infinity; peaks.forEach((q, n) => { const dd = (q.x - b.pos[0]) ** 2 + (q.z - b.pos[2]) ** 2; if (dd < bd) { bd = dd; best = n; } }); demand[best] += d; totalD += d; }
  const totalS = supply.reduce((a, b) => a + b, 0);
  // local balance if total supply were sized to 1.25 × demand
  let moved = 0; const ratio = []; peaks.forEach((q, n) => { const s = supply[n] / totalS * 1.25, d = demand[n] / totalD; ratio.push(s / Math.max(d, 1e-9)); moved += Math.max(0, d - s); });
  // Gabriel graph on the peaks
  const edges = []; for (let a = 0; a < peaks.length; a++) for (let b = a + 1; b < peaks.length; b++) { const mx = (peaks[a].x + peaks[b].x) / 2, mz = (peaks[a].z + peaks[b].z) / 2, r2 = ((peaks[a].x - peaks[b].x) ** 2 + (peaks[a].z - peaks[b].z) ** 2) / 4; let ok = true; for (let c = 0; c < peaks.length && ok; c++) if (c !== a && c !== b && (peaks[c].x - mx) ** 2 + (peaks[c].z - mz) ** 2 < r2 - 1e-9) ok = false; if (ok) edges.push([a, b, 2 * Math.sqrt(r2)]); }
  const opp = edges.filter(([a, b]) => peaks[a].sign !== peaks[b].sign).length;
  const nn = peaks.map((q) => Math.min(...peaks.filter((r) => r !== q).map((r) => Math.hypot(q.x - r.x, q.z - r.z))));
  const strong = peaks.filter((q) => q.w >= 0.5).length;
  console.log(JSON.stringify(p), '| extent', Math.round(E), 'districts', new Set(L.buildings.map((b) => b.district)).size, 'antinodes', peaks.length, `(≥ half strength: ${strong})`, 'spacing m', Math.round(Math.min(...nn)), '–', Math.round(Math.max(...nn)),
    '| Gabriel lines', edges.length, 'total km', (edges.reduce((s, e) => s + e[2], 0) / 1000).toFixed(1), 'longest m', Math.round(Math.max(...edges.map((e) => e[2]))), 'opposite-sign', opp,
    '| demand that must travel', (moved * 100).toFixed(0) + '%', 'supply/demand ratio min–max', Math.min(...ratio).toFixed(2), '–', Math.max(...ratio).toFixed(1), '| substations', I.power.substations.length, 'peakMW', Math.round(I.power.peakMW));
}
