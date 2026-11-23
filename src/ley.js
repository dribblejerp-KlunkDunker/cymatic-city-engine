// Ley (Phase 7b, docs/PHASE7-SPEC.md decisions 8–13): the plate's own vibration energy as a power source.
// ℓ = S², the energy of the field the streets are the zero lines of. Nexuses sit at its antinodes (local maxima
// of |S| at half the plate's strength or more); each gives flux × ∫ℓ dA over its cell (the part of the plate nearer
// to it than to any other nexus). Straight lines join them as a Gabriel graph, each with a capacity of twice its
// weaker end's output. Substations tap their nearest nexus, the lines balance supply and demand, and a power
// station is built only for what the ley cannot deliver.
//
// Two halves: findNexuses runs in generateCity, where the field and its sample grid exist, and its plain-data
// result rides in layout.meta.magic.ley (so year frames and JSON round trips keep it); buildLey runs in the
// network stage, where the substations are known. No platform transcendental math: positions come from the grid,
// the refinement is a quadratic fit, the only root is Math.sqrt (exact) and the sphere's sin θ is DM.sin.
import { DM } from './detmath.js';

export const LEY = {
  flux: 600, // W per m² at unit S² (call F): towns live on their ley, the default city just does, a megastructure cannot
  nexusStrength: 0.5, // a nexus is an antinode at this fraction of the plate's strongest |S| or more
  lineFactor: 2, // a line carries up to this many times its weaker end's output
  plantMargin: 1.25, // the shortfall plant is sized as the realistic one is: 25 % over the load it serves
  n1Warn: 0.2, // as grid-n1: one loss may strand up to 20 % of the people
};

// ---------------------------------------------------------------- profile
// `ley: true` takes the defaults; an object overrides them. `false` / `null` are off (handled by the caller).
export function resolveLey(v) {
  if (v === true) v = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('magic.ley must be true, false or an object: { flux, nexusStrength, lineFactor, field }');
  for (const k of Object.keys(v)) if (!['flux', 'nexusStrength', 'lineFactor', 'field'].includes(k)) throw new Error(`magic.ley: unknown key "${k}" (flux, nexusStrength, lineFactor, field)`);
  const n = (k, d, ok, what) => { const x = v[k] == null ? d : Number(v[k]); if (!Number.isFinite(x) || !ok(x)) throw new Error(`magic.ley.${k} must be ${what}`); return x; };
  const out = {
    flux: n('flux', LEY.flux, (x) => x >= 0, 'a flux in W/m² of 0 or more'),
    nexusStrength: n('nexusStrength', LEY.nexusStrength, (x) => x > 0 && x <= 1, 'a fraction above 0 and at most 1'),
    lineFactor: n('lineFactor', LEY.lineFactor, (x) => x > 0, 'a factor above 0'),
    field: null,
  };
  if (v.field != null) {
    const f = v.field;
    if (!f || typeof f !== 'object' || !(Number.isInteger(f.width) && f.width > 1) || !(Number.isInteger(f.height) && f.height > 1) || !f.data || f.data.length < f.width * f.height)
      throw new Error('magic.ley.field needs width and height (whole numbers above 1) and data (row-major ℓ values, width × height of them)');
    const data = Array.from(f.data, Number).slice(0, f.width * f.height);
    if (!data.every((x) => Number.isFinite(x) && x >= 0)) throw new Error('magic.ley.field.data must be numbers of 0 or more');
    out.field = { width: f.width, height: f.height, data };
  }
  return out;
}

// ---------------------------------------------------------------- nexuses (in generateCity)
// grid: the engine's sample grid { ni, nj, W, S, valid, coord, wrap }; dom: { kind, lo, hi, area, toWorld, inside };
// at(u, v): the signed field. Returns the nexuses ordered by strength, then position, each with its output in MW.
export function findNexuses(spec, grid, dom, at) {
  const { ni, nj, W, S, valid, coord } = grid, sphere = dom.kind === 'sphere', TAU = 2 * Math.PI;
  // ℓ at a plate point: the plate's S², or the foreign grid's value (mapped onto the plate as a terrain heightmap is)
  let ellAt = (u, v) => { const s = at(u, v).S; return s * s; };
  if (spec.field) {
    const { width: FW, height: FH, data } = spec.field;
    ellAt = (u, v) => {
      const x = sphere ? ((v / TAU) % 1 + 1) % 1 : (u - dom.lo) / (dom.hi - dom.lo), y = sphere ? u / Math.PI : (v - dom.lo) / (dom.hi - dom.lo);
      const fx = sphere ? x * FW : Math.min(1, Math.max(0, x)) * (FW - 1), fy = Math.min(1, Math.max(0, y)) * (FH - 1);
      const x0 = Math.min(FW - 1, Math.floor(fx)), y0 = Math.floor(fy), x1 = sphere ? (x0 + 1) % FW : Math.min(FW - 1, x0 + 1), y1 = Math.min(FH - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
      const a = data[y0 * FW + x0], b = data[y0 * FW + x1], c = data[y1 * FW + x0], d = data[y1 * FW + x1];
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    };
  }
  // the grid points that are distinct places: on a sphere the last column repeats the first, and each pole row is one point
  const n = (ni + 1) * W, live = new Uint8Array(n), ell = new Float64Array(n);
  for (let i = 0; i <= ni; i++) for (let j = 0; j <= nj; j++) {
    const k = i * W + j;
    if (!valid[k]) continue;
    if (sphere && (j === nj || ((i === 0 || i === ni) && j !== 0))) continue;
    live[k] = 1;
    ell[k] = spec.field ? ellAt(...coord(i, j)) : S[k] * S[k];
  }
  const rep = (i, j) => (sphere ? (i === 0 || i === ni ? i * W : i * W + (((j % nj) + nj) % nj)) : i * W + j);
  const neighbours = (i, j) => {
    const out = [];
    if (sphere && (i === 0 || i === ni)) { const r = i === 0 ? 1 : ni - 1; for (let jj = 0; jj < nj; jj++) out.push(rep(r, jj)); return out; }
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      if (!di && !dj) continue;
      const ii = i + di, jj = j + dj;
      if (ii < 0 || ii > ni || (!sphere && (jj < 0 || jj > nj))) continue;
      out.push(rep(ii, jj));
    }
    return out;
  };
  let lmax = 0;
  for (let k = 0; k < n; k++) if (live[k] && ell[k] > lmax) lmax = ell[k];
  if (!(lmax > 0)) return { nexuses: [], supplyMW: 0 };
  const cut = spec.nexusStrength * spec.nexusStrength * lmax; // |S| ≥ strength × max |S|  ⇔  ℓ ≥ strength² × max ℓ
  const found = [];
  for (let i = 0; i <= ni; i++) for (let j = 0; j <= nj; j++) {
    const k = i * W + j;
    if (!live[k] || ell[k] < cut) continue;
    let top = true;
    for (const q of neighbours(i, j)) if (live[q] && (ell[q] > ell[k] || (ell[q] === ell[k] && q < k))) { top = false; break; }
    if (!top) continue;
    // one quadratic fit along each grid axis; kept only if it does not fall below the grid point itself
    let [u, v] = coord(i, j), best = ell[k];
    if (!(sphere && (i === 0 || i === ni))) {
      const along = (a, b, c) => { const den = a - 2 * b + c; return den < 0 ? Math.max(-0.5, Math.min(0.5, (a - c) / (2 * den))) : 0; };
      const e = (ii, jj) => { const q = rep(ii, jj); return live[q] ? ell[q] : ell[k]; };
      const di = i > 0 && i < ni ? along(e(i - 1, j), ell[k], e(i + 1, j)) : 0;
      const dj = sphere || (j > 0 && j < nj) ? along(e(i, j - 1), ell[k], e(i, j + 1)) : 0;
      const [u1, v1] = coord(i + 1, j + 1), uu = u + di * (sphere ? Math.PI / ni : u1 - u), vv = v + dj * (sphere ? TAU / nj : v1 - v);
      if ((di || dj) && dom.inside(uu, vv)) { const l = ellAt(uu, vv); if (l >= best) { u = uu; v = vv; best = l; } }
    }
    const P = dom.toWorld(u, v).map((x) => Math.round(x * 100) / 100);
    found.push({ pos: P, sign: spec.field ? 1 : at(u, v).S >= 0 ? 1 : -1, strength: Math.sqrt(best / lmax) });
  }
  found.sort((a, b) => b.strength - a.strength || a.pos[0] - b.pos[0] || a.pos[2] - b.pos[2] || a.pos[1] - b.pos[1]);
  // outputs: each distinct grid point's ℓ goes to its nearest nexus (ties to the lower index); a sphere weights by sin θ,
  // The quadrature is normalised to the plate's exact area.
  const cell = new Float64Array(found.length);
  let wsum = 0;
  for (let i = 0; i <= ni; i++) for (let j = 0; j <= nj; j++) {
    const k = i * W + j;
    if (!live[k]) continue;
    // trapezoid weights: a grid point on the edge of the sampled square covers half a cell (a corner a quarter)
    const [u, v] = coord(i, j), w = sphere ? DM.sin(u) : (i === 0 || i === ni ? 0.5 : 1) * (j === 0 || j === nj ? 0.5 : 1);
    wsum += w;
    if (!found.length || !(w > 0)) continue;
    const P = dom.toWorld(u, v);
    let bi = 0, bd = Infinity;
    for (let m = 0; m < found.length; m++) { const Q = found[m].pos, d = (P[0] - Q[0]) * (P[0] - Q[0]) + (P[1] - Q[1]) * (P[1] - Q[1]) + (P[2] - Q[2]) * (P[2] - Q[2]); if (d < bd) { bd = d; bi = m; } }
    cell[bi] += ell[k] * w;
  }
  const toMW = wsum > 0 ? (spec.flux * dom.area) / wsum / 1e6 : 0;
  const nexuses = found.map((x, m) => ({ ...x, outputMW: cell[m] * toMW }));
  return { nexuses, supplyMW: nexuses.reduce((s, x) => s + x.outputMW, 0) };
}
// ---------------------------------------------------------------- lines, taps and flow (in the network stage)
const d2 = (a, b) => (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2]);

// Gabriel graph: a pair is a line when no third nexus lies in the closed disc (ball, on a sphere) on it as diameter.
// The closed disc keeps a square of nexuses to its four sides rather than crossing diagonals.
export function gabriel(points) {
  const lines = [];
  for (let a = 0; a < points.length; a++) for (let b = a + 1; b < points.length; b++) {
    const A = points[a], B = points[b], M = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2], r2 = d2(A, B) / 4;
    let ok = true;
    for (let c = 0; c < points.length && ok; c++) if (c !== a && c !== b && d2(points[c], M) <= r2 * (1 + 1e-12)) ok = false;
    if (ok) lines.push({ a, b, length: Math.sqrt(4 * r2) });
  }
  return lines;
}

// Balance supply and demand over the lines: each deficit, largest first (ties by index), draws from the nearest
// surplus by line length through lines with room left, until it is met or nothing more can reach it.
// Returns the signed flow on each line (a → b positive) and what each nexus could not get.
function balance(nexuses, lines, out, dem) {
  const n = nexuses.length, bal = out.map((o, i) => o - dem[i]), flow = new Float64Array(lines.length);
  const adj = nexuses.map(() => []);
  lines.forEach((l, li) => { if (l.capacityMW > 0) { adj[l.a].push(li); adj[l.b].push(li); } });
  // room to push power from `from` across line li
  const room = (li, from) => { const l = lines[li]; return from === l.a ? l.capacityMW - flow[li] : l.capacityMW + flow[li]; };
  const order = bal.map((_, i) => i).filter((i) => bal[i] < 0).sort((x, y) => bal[x] - bal[y] || x - y);
  for (const t of order) {
    for (let guard = 0; bal[t] < -1e-9 && guard < 4 * (n + lines.length); guard++) {
      // shortest paths from the deficit outward; power travels toward t, so a step from u to v uses room from v to u
      const dist = new Float64Array(n).fill(Infinity), via = new Int32Array(n).fill(-1), done = new Uint8Array(n);
      dist[t] = 0;
      let src = -1;
      for (;;) {
        let u = -1;
        for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
        if (u < 0) break;
        done[u] = 1;
        if (u !== t && bal[u] > 1e-9) { src = u; break; }
        for (const li of adj[u]) {
          const l = lines[li], v = l.a === u ? l.b : l.a;
          if (done[v] || room(li, v) <= 1e-9) continue;
          if (dist[u] + l.length < dist[v]) { dist[v] = dist[u] + l.length; via[v] = li; }
        }
      }
      if (src < 0) break;
      let amt = Math.min(bal[src], -bal[t]);
      for (let v = src; v !== t;) { const li = via[v]; amt = Math.min(amt, room(li, v)); const l = lines[li]; v = l.a === v ? l.b : l.a; }
      for (let v = src; v !== t;) { const li = via[v], l = lines[li]; flow[li] += v === l.a ? amt : -amt; v = l.a === v ? l.b : l.a; }
      bal[src] -= amt; bal[t] += amt;
    }
  }
  const short = dem.map((_, i) => Math.max(0, -bal[i]));
  return { flow, short };
}

export const leyPlantMW = (undeliveredMW) => (undeliveredMW > 1e-9 ? Math.ceil((undeliveredMW * LEY.plantMargin) / 50) * 50 : 0);

// substations: [{ node, pos, loadMVA }]; nearestNode(P) → street node. Every substation taps its nearest nexus.
export function buildLey(layout, { substations, powerFactor, nearestNode }) {
  const spec = layout.meta.magic.ley, base = spec.nexuses, flux = spec.flux;
  const nexuses = base.map((x) => ({ pos: x.pos, sign: x.sign, strength: x.strength, outputMW: x.outputMW, demandMW: 0, node: nearestNode(x.pos) }));
  const pts = nexuses.map((x) => x.pos);
  const lines = gabriel(pts).map((l) => ({ ...l, capacityMW: spec.lineFactor * Math.min(nexuses[l.a].outputMW, nexuses[l.b].outputMW), loadMW: 0, flowMW: 0 }));
  const tapOf = substations.map((s) => { let bi = -1, bd = Infinity; pts.forEach((P, m) => { const d = d2(s.pos, P); if (d < bd) { bd = d; bi = m; } }); return bi; });
  const subMW = substations.map((s) => s.loadMVA * powerFactor);
  substations.forEach((_, i) => { if (tapOf[i] >= 0) nexuses[tapOf[i]].demandMW += subMW[i]; });
  const demandMW = subMW.reduce((s, x) => s + x, 0);
  const out = nexuses.map((x) => x.outputMW), dem = nexuses.map((x) => x.demandMW);
  const { flow, short } = balance(nexuses, lines, out, dem);
  lines.forEach((l, li) => { l.flowMW = flow[li]; l.loadMW = Math.abs(flow[li]); });
  // each nexus serves its substations in proportion to their demand
  const taps = [];
  substations.forEach((_, i) => {
    const m = tapOf[i];
    if (m < 0) return;
    const served = dem[m] > 0 ? subMW[i] * (1 - short[m] / dem[m]) : 0;
    if (served > 1e-9) taps.push({ nexus: m, substation: i, node: nexuses[m].node, MW: served });
  });
  const delivered = taps.reduce((s, t) => s + t.MW, 0);
  const undeliveredMW = Math.max(0, demandMW - delivered);
  const supplyMW = out.reduce((s, x) => s + x, 0);
  const plantMW = leyPlantMW(undeliveredMW);
  // N-1: the strongest nexus or the busiest line lost; what the shortfall plant cannot cover is stranded
  const strandedBy = (outs, ls) => { const r = balance(nexuses, ls, outs, dem); return Math.max(0, r.short.reduce((s, x) => s + x, 0) - plantMW) / Math.max(demandMW, 1e-9); };
  const cases = [];
  if (nexuses.length) cases.push({ kind: 'nexus', index: 0, share: strandedBy(out.map((o, i) => (i === 0 ? 0 : o)), lines) });
  const busiest = lines.reduce((m, l, i) => (l.loadMW > 1e-9 && (m < 0 || l.loadMW > lines[m].loadMW) ? i : m), -1);
  if (busiest >= 0) cases.push({ kind: 'line', index: busiest, share: strandedBy(out, lines.map((l, i) => (i === busiest ? { ...l, capacityMW: 0 } : l))) });
  const n1 = cases.reduce((m, c) => (c.share > m.share ? c : m), cases[0] ?? { kind: 'none', index: -1, share: 0 });
  return { flux, nexuses, lines, taps, supplyMW, demandMW, deliveredMW: delivered, undeliveredMW, plantMW, n1 };
}
