import { generateCity, fieldPreview } from '../../src/cymatic-engine.js';
import { buildInfrastructure } from '../../src/infrastructure.js';
// (i)+(ii) what gravity does, as a stand-in for a ward covering the whole plan
for (const base of [{ frequency: 432, preset: 'megastructure' }, { frequency: 432 }]) for (const gravity of [0.5, 1, 2]) {
  const L = generateCity({ ...base, gravity }), I = buildInfrastructure(L), s = L.stats;
  console.log(base.preset ?? 'city', 'g', gravity, '| tallest', s.maxHeight, 'slenderness limit', s.slendernessLimit.toFixed(1), 'binding', JSON.stringify(s.binding), 'population', s.population,
    '| lift stations', I.stats.liftStations, 'max sewer depth', I.stats.maxSewerDepth.toFixed(1), 'tanks', I.water.towers.length, 'pumped', I.water.towers.filter((t) => t.pumped).length, 'tank height', Math.max(...I.water.towers.map((t) => t.height)).toFixed(0), 'failing checks', [...L.checks, ...I.checks].filter((c) => c.status === 'fail').map((c) => c.id).join(',') || 'none');
}
// (iii) nexus tiers and line graphs
const peaksOf = (p, N = 240, thr = 0.5) => { const F = fieldPreview(p), E = F.extent, W = N + 1, S = new Float64Array(W * W), ins = new Uint8Array(W * W), step = 2 * E / N; let smax = 0;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const [u, v] = F.toNorm([-E + i * step, 0, -E + j * step]); if (!F.inside(u, v)) continue; const s = F.at(u, v).S; S[j * W + i] = s; ins[j * W + i] = 1; smax = Math.max(smax, Math.abs(s)); }
  const out = []; for (let j = 2; j < N - 1; j++) for (let i = 2; i < N - 1; i++) { const k = j * W + i; if (!ins[k]) continue; const w = Math.abs(S[k]); if (w < thr * smax) continue; let top = true; for (let dj = -2; dj <= 2 && top; dj++) for (let di = -2; di <= 2; di++) { const q = k + dj * W + di; if (q !== k && ins[q] && (Math.abs(S[q]) > w || (Math.abs(S[q]) === w && q < k))) { top = false; break; } } if (top) out.push({ x: -E + i * step, z: -E + j * step, w: w / smax }); }
  return { peaks: out, S, ins, W, N, step, E }; };
const d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
for (const p of [{ frequency: 432 }, { frequency: 300 }, { frequency: 648 }, { frequency: 540, plate: 'square' }, { chord: [432, 540] }]) {
  const { peaks } = peaksOf(p), n = peaks.length; let gab = 0, rng = 0;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) { const dab = d(peaks[a], peaks[b]), m = { x: (peaks[a].x + peaks[b].x) / 2, z: (peaks[a].z + peaks[b].z) / 2 }; let g = true, r = true; for (let c = 0; c < n; c++) { if (c === a || c === b) continue; if (d(peaks[c], m) < dab / 2 - 1e-9) g = false; if (Math.max(d(peaks[c], peaks[a]), d(peaks[c], peaks[b])) < dab - 1e-9) r = false; } if (g) gab++; if (r) rng++; }
  console.log(JSON.stringify(p), 'nexuses (≥ half strength)', n, '| Gabriel', gab, 'relative-neighbourhood', rng, 'tree', n - 1);
}
// (iv) the octave below under the city: how near its lines pass to metro stations
{ const p = { frequency: 432 }, L = generateCity(p), I = buildInfrastructure(L), g = peaksOf({ frequency: 216 }, 480, 2), near = [];
  const cells = []; for (let j = 0; j < g.N; j++) for (let i = 0; i < g.N; i++) { const k = j * g.W + i; if (g.ins[k] && g.ins[k + 1] && g.ins[k + g.W] && (g.S[k] * g.S[k + 1] < 0 || g.S[k] * g.S[k + g.W] < 0)) cells.push([-g.E + (i + 0.5) * g.step, -g.E + (j + 0.5) * g.step]); }
  for (const s of I.transit.stations) near.push(Math.round(Math.min(...cells.map((c) => Math.hypot(c[0] - s.pos[0], c[1] - s.pos[2])))));
  const lm = L.buildings.filter((b) => b.landmark).map((b) => Math.round(Math.min(...cells.map((c) => Math.hypot(c[0] - b.pos[0], c[1] - b.pos[2])))));
  console.log('octave below (216 Hz) under the 432 Hz city: distance from each metro station to the nearest deep road (m):', near.sort((a, b) => a - b).join(' '), '| from each landmark:', lm.sort((a, b) => a - b).join(' ')); }
