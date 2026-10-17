// People, traffic and land value (Phase 3).
// A synthetic commuting population drawn from the buildings' residents and jobs; destination choice by a
// gravity model on street-network distance; walk / metro / car split by logit on door-to-door time; car trips
// assigned to the street graph with BPR congestion and averaged over iterations (MSA); Hansen accessibility
// and a land-value index per building; the zoning the land market would produce, compared with the zoning the
// wave assigned; street widths judged against the flow they carry; metro ridership earned, not assumed.
// Sources in docs/research-notes/people_traffic.md.
import { mulberry32 } from './cymatic-engine.js';
import { dijkstra } from './infrastructure.js';

export const TRAFFIC = {
  laneCapacity: 1800,      // veh/h per lane (HCM basic capacity for urban arterials with signals ≈ 1,800–1,900)
  laneWidth: 3.5,          // m
  sidewalks: 6,            // m of each street width given to footways and furniture (3 m a side)
  freeSpeedKmh: { boulevard: 40, ring: 32, spoke: 25, wall: 40, service: 20, corridor: 20 }, // signalised urban speeds, not posted limits
  bprAlpha: 0.15, bprBeta: 4,   // Bureau of Public Roads delay: t = t0 (1 + α (v/c)^β)
  occupancy: 1.3,          // persons per car (US NHTS commute ≈ 1.1–1.2; higher where carpooling is common)
  peakShare: 0.25,         // share of the day's commute trips that start in the peak hour
  commuters: 0.55,         // share of residents who commute to a job (labour force × employment)
  decayKm: 5.0,            // gravity model: P(j) ∝ jobs_j · exp(−d / decayKm) on network distance
  walkSpeedKmh: 4.8, walkHalfKm: 1.2, walkSlopeKm: 0.3, // P(walk) = 1 / (1 + e^((d − 1.2 km) / 0.3 km))
  metroSpeedKmh: 35, metroWaitMin: 5, metroAccessM: 1200, // access walk, wait, in-vehicle on the tunnel tree
  logitPerMin: 0.12,       // mode choice between metro and car: P(metro) = 1 / (1 + e^(0.12 (t_metro − t_car)))
  carFixedMin: 8,          // parking search and the walk at both ends
};

export const LAND = {
  accessWeight: 0.6, ampWeight: 0.25, metroWeight: 0.15, // land-value index = weighted mix, normalised to its max
  coreShare: 0.15, mixedShare: 0.35,                     // emergent zoning: top 15 % of value is core, next 35 % mixed
};

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// Street capacity and free-flow time per edge.
export function laneCount(edge) {
  return Math.max(1, Math.floor((edge.w - TRAFFIC.sidewalks) / TRAFFIC.laneWidth));
}
export function edgeCapacity(edge) {
  return laneCount(edge) * TRAFFIC.laneCapacity; // both directions together: flows are summed undirected
}
export function freeFlowMinutes(edge) {
  const v = TRAFFIC.freeSpeedKmh[edge.kind] ?? 30;
  return (edge.len / 1000 / v) * 60;
}
export function bprMinutes(edge, flow) {
  const vc = flow / edgeCapacity(edge);
  return freeFlowMinutes(edge) * (1 + TRAFFIC.bprAlpha * Math.pow(vc, TRAFFIC.bprBeta));
}

// Weighted sample without replacement (deterministic for a seed): returns indices.
function weightedSample(weights, k, rng) {
  const n = weights.length, picked = [], used = new Uint8Array(n);
  let total = weights.reduce((s, x) => s + x, 0);
  for (let i = 0; i < k && total > 1e-12; i++) {
    let r = rng() * total, j = 0;
    for (; j < n; j++) { if (used[j]) continue; r -= weights[j]; if (r <= 0) break; }
    if (j >= n) { for (j = n - 1; j >= 0 && used[j]; j--); if (j < 0) break; }
    used[j] = 1; picked.push(j); total -= weights[j];
  }
  return picked;
}

// Station graph: nearest station per street node (within the access distance) and station-to-station tunnel distance.
function metroModel(layout, infra) {
  const st = infra.transit.stations;
  if (st.length < 2) return null;
  const nodes = infra.graph.nodes;
  const nearest = new Int32Array(nodes.length).fill(-1), walk = new Float64Array(nodes.length).fill(Infinity);
  nodes.forEach((n, i) => { st.forEach((s, k) => { const d = dist(n.pos, s.pos); if (d < walk[i] && d <= TRAFFIC.metroAccessM) { walk[i] = d; nearest[i] = k; } }); });
  // all-pairs tunnel distance: tunnels are street-edge segments under the streets, so walk them node to node
  const idx = new Map(st.map((s, i) => [s.node, i]));
  const adj = new Map();
  const link = (a, b, l) => (adj.get(a) ?? adj.set(a, []).get(a)).push([b, l]);
  for (const t of infra.transit.tunnels) { link(t.a, t.b, t.length); link(t.b, t.a, t.length); }
  const D = st.map(() => new Float64Array(st.length).fill(Infinity));
  for (let s = 0; s < st.length; s++) {
    const d = new Map([[st[s].node, 0]]), stack = [st[s].node];
    while (stack.length) { const u = stack.pop(); for (const [v, l] of adj.get(u) ?? []) if (!d.has(v)) { d.set(v, d.get(u) + l); stack.push(v); } }
    for (const [node, dd] of d) { const k = idx.get(node); if (k != null) D[s][k] = dd; }
  }
  return { nearest, walk, D, stations: st };
}

export function people(layout, infra, opts = {}) {
  const t0 = Date.now();
  const graph = infra.graph, N = graph.nodes.length, E = graph.edges.length;
  const originsWanted = Math.max(8, opts.origins ?? 160), iterations = Math.max(1, opts.iterations ?? 3);
  const rng = mulberry32(((layout.meta.seed ?? 1) ^ 0x9e3779b9) >>> 0);
  const onProgress = opts.onProgress ?? (() => {});

  // ---- population on the street graph
  const resAt = new Float64Array(N), jobsAt = new Float64Array(N);
  for (const l of infra.laterals) { resAt[l.node] += l.residents; jobsAt[l.node] += l.jobs; }
  const residents = resAt.reduce((s, x) => s + x, 0), jobs = jobsAt.reduce((s, x) => s + x, 0);
  const commutersTotal = Math.min(residents * TRAFFIC.commuters, jobs); // nobody commutes to a job that is not there
  const jobNodes = []; for (let i = 0; i < N; i++) if (jobsAt[i] > 0) jobNodes.push(i);
  const empty = { residents: Math.round(residents), jobs: Math.round(jobs), commuters: 0 };
  if (!commutersTotal || !jobNodes.length) {
    return { sample: { origins: [], commuters: 0 }, trips: { total: 0, meanKm: 0, meanMin: 0, modeShare: { walk: 0, metro: 0, car: 0 } }, traffic: { edgeFlow: new Float64Array(E), vc: new Float64Array(E), speedKmh: new Float64Array(E), congestedKm: 0, vkt: 0, lanesNeeded: new Int8Array(E), underbuiltKm: 0, overbuiltKm: 0 }, access: new Float64Array(N), landValue: new Float64Array(layout.buildings.length), emergentZone: [], zoneAgreement: 0, stats: empty, checks: [], timingMs: Date.now() - t0 };
  }

  // sampled origins carry their neighbours' commuters: every resident node is assigned to the sampled node nearest to it by street distance
  const resNodes = []; for (let i = 0; i < N; i++) if (resAt[i] > 0) resNodes.push(i);
  const pickIdx = weightedSample(resNodes.map((i) => resAt[i]), Math.min(originsWanted, resNodes.length), rng);
  const origins = pickIdx.map((k) => resNodes[k]);
  const { src: originOf } = dijkstra(graph, origins);
  const originCommuters = new Float64Array(origins.length);
  for (const i of resNodes) if (originOf[i] >= 0) originCommuters[originOf[i]] += resAt[i] * TRAFFIC.commuters;
  // scale so the total is the commuter count (jobs cap)
  const sampled = originCommuters.reduce((s, x) => s + x, 0);
  const expansion = sampled > 0 ? commutersTotal / sampled : 0;
  for (let k = 0; k < origins.length; k++) originCommuters[k] *= expansion;

  const metro = metroModel(layout, infra);
  graph.edges.forEach((e, i) => { e.index = i; }); // the congested-time weight looks edges up by index
  const lanes = graph.edges.map(laneCount), capacity = graph.edges.map(edgeCapacity), t0min = graph.edges.map(freeFlowMinutes);

  // ---- assignment: all-or-nothing on current congested times, averaged (MSA)
  let flow = new Float64Array(E); // veh/h in the peak hour, both directions
  const edgeMin = new Float64Array(E); for (let e = 0; e < E; e++) edgeMin[e] = t0min[e];
  const access = new Float64Array(N); // Hansen, at sampled origins (spread to other nodes below)
  let trips = 0, tripKm = 0, tripMin = 0, walkTrips = 0, metroTrips = 0, carTrips = 0, carKm = 0;
  let byOriginSum = 0;
  for (let it = 1; it <= iterations; it++) {
    const aon = new Float64Array(E);
    trips = 0; tripKm = 0; tripMin = 0; walkTrips = 0; metroTrips = 0; carTrips = 0; carKm = 0; byOriginSum = 0;
    const timeOf = (e) => edgeMin[e.index];
    for (let k = 0; k < origins.length; k++) {
      const o = origins[k], C = originCommuters[k];
      if (C <= 0) continue;
      // shortest paths by congested time (minutes); distance along those paths for the gravity choice
      const { d: tMin, parent, pedge } = dijkstra(graph, [o], timeOf);
      const dKm = new Float64Array(N);
      // path distance by walking parents is O(path) per node; instead accumulate along the tree in order of time
      const order = Array.from({ length: N }, (_, i) => i).filter((i) => Number.isFinite(tMin[i])).sort((a, b) => tMin[a] - tMin[b]);
      for (const v of order) { if (parent[v] >= 0) dKm[v] = dKm[parent[v]] + graph.edges[pedge[v]].len / 1000; }
      // Hansen accessibility to jobs on network distance
      let acc = 0;
      for (const j of jobNodes) if (Number.isFinite(tMin[j])) acc += jobsAt[j] * Math.exp(-dKm[j] / TRAFFIC.decayKm);
      access[o] = acc;
      // destinations: gravity weights, sampled so each origin traces a bounded number of paths
      const w = jobNodes.map((j) => (Number.isFinite(tMin[j]) ? jobsAt[j] * Math.exp(-dKm[j] / TRAFFIC.decayKm) : 0));
      const picks = weightedSample(w, Math.min(48, jobNodes.length), rng);
      const wsum = picks.reduce((s, p) => s + w[p], 0);
      if (!(wsum > 0)) continue;
      // every picked destination takes its share of the origin's commuters in proportion to its gravity weight
      for (const p of picks) {
        const j = jobNodes[p], T = (C * w[p]) / wsum;
        if (!(T > 0)) continue;
        byOriginSum += T;
        const km = dKm[j], carMin = tMin[j] + TRAFFIC.carFixedMin;
        const pWalk = 1 / (1 + Math.exp((km - TRAFFIC.walkHalfKm) / TRAFFIC.walkSlopeKm));
        let pMetro = 0, metroMin = Infinity;
        if (metro && metro.nearest[o] >= 0 && metro.nearest[j] >= 0 && metro.nearest[o] !== metro.nearest[j]) {
          const tunnel = metro.D[metro.nearest[o]][metro.nearest[j]];
          if (Number.isFinite(tunnel)) {
            metroMin = ((metro.walk[o] + metro.walk[j]) / 1000 / TRAFFIC.walkSpeedKmh) * 60 + TRAFFIC.metroWaitMin + (tunnel / 1000 / TRAFFIC.metroSpeedKmh) * 60;
            pMetro = (1 - pWalk) / (1 + Math.exp(TRAFFIC.logitPerMin * (metroMin - carMin)));
          }
        }
        const pCar = 1 - pWalk - pMetro;
        trips += T; tripKm += T * km;
        tripMin += T * (pWalk * (km / TRAFFIC.walkSpeedKmh) * 60 + (pMetro > 0 ? pMetro * metroMin : 0) + pCar * carMin);
        walkTrips += T * pWalk; metroTrips += T * pMetro; carTrips += T * pCar; carKm += T * pCar * km;
        // cars in the peak hour on the path
        const veh = (T * pCar * TRAFFIC.peakShare) / TRAFFIC.occupancy;
        for (let v = j; parent[v] >= 0; v = parent[v]) aon[pedge[v]] += veh;
      }
      onProgress(it, k + 1, origins.length);
    }
    const a = 1 / it;
    for (let e = 0; e < E; e++) { flow[e] = (1 - a) * flow[e] + a * aon[e]; edgeMin[e] = bprMinutes(graph.edges[e], flow[e]); }
  }

  // ---- traffic outputs
  const vc = new Float64Array(E), speedKmh = new Float64Array(E), lanesNeeded = new Int8Array(E);
  let congestedKm = 0, vkt = 0, underbuiltKm = 0, overbuiltKm = 0, streetKm = 0, maxVC = 0;
  for (let e = 0; e < E; e++) {
    const ed = graph.edges[e];
    vc[e] = flow[e] / capacity[e];
    speedKmh[e] = (ed.len / 1000) / (edgeMin[e] / 60);
    lanesNeeded[e] = Math.max(1, Math.ceil(flow[e] / (TRAFFIC.laneCapacity * 0.9)));
    vkt += flow[e] * ed.len / 1000;
    if (ed.kind === 'service' || ed.kind === 'corridor') continue;
    streetKm += ed.len / 1000; maxVC = Math.max(maxVC, vc[e]);
    if (vc[e] > 1) congestedKm += ed.len / 1000;
    if (lanesNeeded[e] > lanes[e]) underbuiltKm += ed.len / 1000;
    if (lanes[e] > lanesNeeded[e] + 2) overbuiltKm += ed.len / 1000;
  }

  // ---- accessibility for every node and building: the sampled origin nearest by street (same cell)
  // accessibility is reported relative to the city: 0 at its least connected origin, 1 at its best
  const accessNode = new Float64Array(N);
  let accMax = 0, accMin = Infinity; for (const o of origins) { accMax = Math.max(accMax, access[o]); accMin = Math.min(accMin, access[o]); }
  const span = accMax - accMin;
  for (let i = 0; i < N; i++) accessNode[i] = originOf[i] >= 0 ? (span > 0 ? (access[origins[originOf[i]]] - accMin) / span : 1) : 0;

  // ---- land value: accessibility, amplitude and metro proximity, normalised to the best lot
  const B = layout.buildings, nodeOfBuilding = new Int32Array(B.length).fill(-1);
  for (const l of infra.laterals) nodeOfBuilding[l.building] = l.node;
  const landValue = new Float64Array(B.length);
  let vmax = 0;
  B.forEach((b, i) => {
    const n = nodeOfBuilding[i];
    const acc = n >= 0 ? accessNode[n] : 0;
    const near = metro && n >= 0 && metro.nearest[n] >= 0 ? 1 - metro.walk[n] / TRAFFIC.metroAccessM : 0;
    landValue[i] = LAND.accessWeight * Math.pow(acc, 0.7) + LAND.ampWeight * b.amp + LAND.metroWeight * near;
    vmax = Math.max(vmax, landValue[i]);
  });
  if (vmax > 0) for (let i = 0; i < B.length; i++) landValue[i] /= vmax;
  // emergent zoning by value rank (green stays green)
  const ranked = B.map((b, i) => i).filter((i) => B[i].zone !== 'green').sort((a, b) => landValue[b] - landValue[a]);
  const emergentZone = B.map((b) => (b.zone === 'green' ? 'green' : 'residential'));
  ranked.forEach((i, r) => { const q = r / Math.max(1, ranked.length); emergentZone[i] = q < LAND.coreShare ? 'core' : q < LAND.coreShare + LAND.mixedShare ? 'mixed' : 'residential'; });
  let agree = 0; for (const i of ranked) if (emergentZone[i] === B[i].zone) agree++;
  const zoneAgreement = ranked.length ? agree / ranked.length : 0;

  const meanKm = trips ? tripKm / trips : 0, meanMin = trips ? tripMin / trips : 0;
  const modeShare = { walk: trips ? walkTrips / trips : 0, metro: trips ? metroTrips / trips : 0, car: trips ? carTrips / trips : 0 };
  const stats = {
    residents: Math.round(residents), jobs: Math.round(jobs), commuters: Math.round(commutersTotal), sampledOrigins: origins.length,
    meanTripKm: meanKm, meanTripMin: meanMin, modeShare, peakVehicles: Math.round((carTrips * TRAFFIC.peakShare) / TRAFFIC.occupancy),
    vkt, congestedKm, streetKm, underbuiltKm, overbuiltKm, maxVC,
    metroDaily: Math.round(metroTrips * 2), carKmPerCommuter: carTrips ? carKm / carTrips : 0,
    zoneAgreement, meanLandValue: B.length ? landValue.reduce((s, x) => s + x, 0) / B.length : 0,
  };
  const checks = [];
  const check = (id, label, value, status, basis) => checks.push({ id, label, value, status, basis });
  const congShare = streetKm ? congestedKm / streetKm : 0;
  check('street-capacity', 'Streets over capacity at the peak', `${(100 * congShare).toFixed(1)} % of street length (v/c > 1)`, congShare <= 0.1 ? 'pass' : congShare <= 0.25 ? 'warn' : 'fail', 'Lanes = (width − 6 m) / 3.5 m at 1,800 veh/h; BPR delay α 0.15, β 4; cars carry the trips that neither walk nor ride');
  check('street-width', 'Street widths vs. the flow they carry', `${underbuiltKm.toFixed(1)} km need more lanes, ${overbuiltKm.toFixed(1)} km have 3+ spare`, underbuiltKm / Math.max(1e-9, streetKm) <= 0.1 ? 'pass' : 'warn', 'Lanes needed = peak flow / (1,800 × 0.9); widths come from the preset, so this is the plan judged by its traffic');
  check('commute', 'Mean commute', `${meanKm.toFixed(1)} km · ${meanMin.toFixed(0)} min door to door`, meanMin >= 10 && meanMin <= 45 ? 'pass' : 'warn', 'Gravity destination choice with a 5 km decay on street distance; 15–35 min is typical of cities this size');
  check('mode-share', 'Mode share', `walk ${(100 * modeShare.walk).toFixed(0)} % · metro ${(100 * modeShare.metro).toFixed(0)} % · car ${(100 * modeShare.car).toFixed(0)} %`, 'info', 'Walk by distance (half at 1.2 km); metro vs. car by door-to-door time (logit, 0.12/min)');
  check('zoning', 'Zoning the land market would produce', `${(100 * zoneAgreement).toFixed(0)} % of lots agree with the wave's zoning`, zoneAgreement >= 0.5 ? 'pass' : 'info', 'Value = 0.6 × accessibility^0.7 + 0.25 × amplitude + 0.15 × metro proximity, accessibility relative to the city; top 15 % core, next 35 % mixed');
  return {
    sample: { origins, commuters: originCommuters },
    trips: { total: trips, meanKm, meanMin, modeShare, assigned: byOriginSum },
    traffic: { edgeFlow: flow, vc, speedKmh, lanes: Int8Array.from(lanes), lanesNeeded, capacity: Float64Array.from(capacity), congestedKm, vkt, underbuiltKm, overbuiltKm },
    access: accessNode, landValue, emergentZone, zoneAgreement, stats, checks, timingMs: Date.now() - t0,
  };
}
