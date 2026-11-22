import { generateCity, fieldPreview } from '../../src/cymatic-engine.js';
import { buildInfrastructure } from '../../src/infrastructure.js';
const FLUX = 600; // W per m² at unit S²
const d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
for (const p of [{ frequency: 432, preset: 'town' }, { frequency: 432 }, { frequency: 300 }, { frequency: 648 }, { frequency: 540, plate: 'square' }, { chord: [432, 540] }, { frequency: 432, preset: 'megastructure' }, { frequency: 432, preset: 'alien' }]) {
  const F = fieldPreview(p), L = generateCity(p), I = buildInfrastructure(L), E = F.extent, N = 240, W = N + 1, step = 2 * E / N, S = new Float64Array(W * W), ins = new Uint8Array(W * W); let smax = 0;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const [u, v] = F.toNorm([-E + i * step, 0, -E + j * step]); if (!F.inside(u, v)) continue; const s = F.at(u, v).S; S[j * W + i] = s; ins[j * W + i] = 1; smax = Math.max(smax, Math.abs(s)); }
  const nx = []; for (let j = 2; j < N - 1; j++) for (let i = 2; i < N - 1; i++) { const k = j * W + i; if (!ins[k]) continue; const w = Math.abs(S[k]); if (w < 0.5 * smax) continue; let top = true; for (let dj = -2; dj <= 2 && top; dj++) for (let di = -2; di <= 2; di++) { const q = k + dj * W + di; if (q !== k && ins[q] && (Math.abs(S[q]) > w || (Math.abs(S[q]) === w && q < k))) { top = false; break; } } if (top) nx.push({ x: -E + i * step, z: -E + j * step, out: 0, dem: 0 }); }
  const nearest = (x, z) => { let b = 0, bd = Infinity; nx.forEach((q, n) => { const dd = (q.x - x) ** 2 + (q.z - z) ** 2; if (dd < bd) { bd = dd; b = n; } }); return b; };
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const k = j * W + i; if (ins[k]) nx[nearest(-E + i * step, -E + j * step)].out += S[k] * S[k] * step * step * FLUX / 1e6; }
  const totalFloor = L.buildings.reduce((s, b) => s + b.w * b.d * b.floors, 0);
  for (const b of L.buildings) nx[nearest(b.pos[0], b.pos[2])].dem += I.power.peakMW * (b.w * b.d * b.floors) / totalFloor;
  const supply = nx.reduce((s, q) => s + q.out, 0), demand = I.power.peakMW;
  // Gabriel lines
  const n = nx.length, adj = nx.map(() => []), lines = [];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) { const m = { x: (nx[a].x + nx[b].x) / 2, z: (nx[a].z + nx[b].z) / 2 }, r = d(nx[a], nx[b]) / 2; let ok = true; for (let c = 0; c < n && ok; c++) if (c !== a && c !== b && d(nx[c], m) < r - 1e-9) ok = false; if (ok) { adj[a].push([b, lines.length]); adj[b].push([a, lines.length]); lines.push({ a, b, len: 2 * r, load: 0 }); } }
  // serve what the ley can: scale demand down to supply when short; deficits pull from the nearest surplus along the lines
  const served = Math.min(1, supply / (demand * 1.0)), bal = nx.map((q) => q.out * Math.min(1, demand / supply) - q.dem * served);
  const order = nx.map((_, i) => i).filter((i) => bal[i] < -1e-9).sort((x, y) => bal[x] - bal[y]);
  for (const t of order) { // Dijkstra from the deficit node
    const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), pl = new Int32Array(n).fill(-1), done = new Uint8Array(n); dist[t] = 0;
    for (;;) { let u = -1; for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i; if (u < 0 || dist[u] === Infinity) break; done[u] = 1; for (const [v, li] of adj[u]) if (dist[u] + lines[li].len < dist[v]) { dist[v] = dist[u] + lines[li].len; prev[v] = u; pl[v] = li; } }
    const srcs = nx.map((_, i) => i).filter((i) => bal[i] > 1e-9 && dist[i] < Infinity).sort((x, y) => dist[x] - dist[y]);
    for (const s of srcs) { if (bal[t] > -1e-9) break; const amt = Math.min(bal[s], -bal[t]); bal[s] -= amt; bal[t] += amt; for (let u = s; u !== t; u = prev[u]) lines[pl[u]].load += amt; }
  }
  const ratios = lines.filter((l) => l.load > 1e-9).map((l) => l.load / Math.min(nx[l.a].out, nx[l.b].out)).sort((x, y) => x - y);
  const q = (f) => ratios.length ? ratios[Math.min(ratios.length - 1, Math.floor(f * ratios.length))].toFixed(2) : '-';
  console.log(JSON.stringify(p), '| nexuses', n, 'lines', lines.length, '| ley supply', Math.round(supply), 'MW, peak demand', Math.round(demand), 'MW →', (supply / demand).toFixed(2), '× | strongest nexus', Math.round(Math.max(...nx.map((x) => x.out))), 'MW, weakest', Math.round(Math.min(...nx.map((x) => x.out))),
    '| lines carrying', ratios.length, 'load ÷ weaker end: median', q(0.5), '90th', q(0.9), 'max', q(0.999), '| total moved', Math.round(lines.reduce((s, l) => s + l.load * 0 , 0) + order.reduce((s, t) => s, 0)) || '', 'heaviest line', Math.round(Math.max(0, ...lines.map((l) => l.load))), 'MW');
}
