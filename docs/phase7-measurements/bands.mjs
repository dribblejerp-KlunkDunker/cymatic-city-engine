import { generateCity, fieldPreview, heightLimit } from '../../src/cymatic-engine.js';
import { buildInfrastructure, UTILIDOR, TRANSIT } from '../../src/infrastructure.js';
const grid = (p, N = 240) => { const F = fieldPreview(p), E = F.extent, W = N + 1, S = new Float64Array(W * W), ins = new Uint8Array(W * W), step = 2 * E / N; let e = 0, c = 0, smax = 0;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const [u, v] = F.toNorm([-E + i * step, 0, -E + j * step]); if (!F.inside(u, v)) continue; const s = F.at(u, v).S; S[j * W + i] = s; ins[j * W + i] = 1; e += s * s; c++; smax = Math.max(smax, Math.abs(s)); }
  let nodal = 0; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const k = j * W + i; if (!ins[k] || !ins[k + 1] || !ins[k + W]) continue; if (S[k] * S[k + 1] < 0) nodal += step; if (S[k] * S[k + W] < 0) nodal += step; }
  return { E, step, meanS2: e / c, area: c * step * step, smax, nodalKm: nodal * (Math.PI / 4) / 1000 }; }; // π/4: grid-crossing count → length
for (const p of [{ frequency: 432, preset: 'town' }, { frequency: 432 }, { frequency: 432, preset: 'megastructure' }, { frequency: 432, preset: 'alien' }, { frequency: 300 }, { frequency: 648 }]) {
  const L = generateCity(p), I = buildInfrastructure(L), g = grid(p), s = L.stats;
  const demandWm2 = I.power.peakMW * 1e6 / g.area;
  const lm = L.buildings.filter((b) => b.landmark).length;
  const free = L.buildings.filter((b) => true).length;
  const Lf = generateCity({ ...p, enforce: false });
  const over = Lf.buildings.filter((b) => b.h > Lf.stats.heightLimit + 1e-6).length, slim = Lf.buildings.filter((b) => b.h / Math.min(b.w, b.d) > Lf.stats.slendernessLimit + 1e-6).length;
  const sewerBottom = Math.max(...I.sewer.pipes.map((q) => Math.max(q.upDepth, q.downDepth) + q.diameter));
  const tun = I.transit.tunnels.map((t) => t.depth), half = (p.frequency ?? 0) / 2;
  let lower = 'n/a'; try { const h = grid({ ...p, frequency: half }); lower = `${h.nodalKm.toFixed(1)} km`; } catch (e) { lower = 'refused: ' + e.message.slice(0, 60); }
  console.log(JSON.stringify(p), '| fundamental', L.meta.fundamentalHz.toFixed(1), 'Hz | mean S²', g.meanS2.toFixed(3), 'max|S|', g.smax.toFixed(2), '| demand', Math.round(demandWm2), 'W/m² → needs', Math.round(demandWm2 * 1.25 / g.meanS2), 'W/m² per unit S²',
    '| landmarks', lm, '| height limit', Math.round(s.heightLimit), 'm, tallest', s.maxHeight, 'binding', JSON.stringify(s.binding), 'unenforced: over height', over, 'too slender', slim, 'of', Lf.buildings.length,
    '| sewer bottom', sewerBottom.toFixed(1), 'utilidors', I.utilidors.length ? `${UTILIDOR.depth}–${UTILIDOR.depth + UTILIDOR.height}` : 'none', 'metro crown', tun.length ? (Math.min(...tun) - TRANSIT.diameter / 2).toFixed(1) : 'none', 'deepest foundation', Math.max(...L.buildings.map((b) => Math.min(60, 2 + 0.1 * b.h))).toFixed(1),
    '| nodal network', g.nodalKm.toFixed(1), 'km, streets', s.roadLengthKm.toFixed(1), 'km; octave below', lower);
}
