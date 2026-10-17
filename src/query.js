// Query layer and the inverse problem (Phase 5).
// - query(city, q): structured questions over a city (buildings, streets, districts, network assets), with
//   filters, grouping, aggregates, ordering and an optional failed asset; every answer is computed from the same
//   layout, networks and models the rest of the engine uses, and says what it computed.
// - ask(city, text): a small, deterministic English front end that turns common questions into structured
//   queries and shows the query it understood. It is a template parser, not a language model.
// - suggest(city, 'metro-station'): where a new station would serve the most people not yet near one.
// - search(spec): the inverse problem. Find frequencies (and Q, drive point, plate) whose city meets a list of
//   constraints, cheapest checks first: physics constraints prune thousands of frequencies before any city is
//   built; plan, network and commute constraints are evaluated only as far as needed. Deterministic for a seed.
// - agentTools(): the engine as JSON-schema tools an agent can call.
import { generateCity, enumerateModes, drivenResponse, frequencyRange, modeLabel, PLATES, PRESETS, mulberry32, toJSON, ENGINE_VERSION } from './cymatic-engine.js';
import { buildInfrastructure, TRANSIT, dijkstra } from './infrastructure.js';
import { impact as failImpact } from './simulation.js';
import { people as runPeople } from './people.js';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const round = (x, k = 3) => (Number.isFinite(x) ? Math.round(x * 10 ** k) / 10 ** k : x);

// ---------------------------------------------------------------- the city bundle
// A city is a layout plus what has been computed on it. Networks and the commute are computed on first use and
// kept, so a run of questions pays for each model once.
export function cityOf(x) {
  if (x && x.__city) return x;
  const layout = x && x.meta && x.roads ? x : generateCity(x ?? {});
  let infra = layout.infra ?? null, ppl = null;
  return {
    __city: true, layout,
    get infra() { if (!infra) { infra = buildInfrastructure(layout); layout.infra = infra; } return infra; },
    get people() { if (!ppl) ppl = runPeople(layout, this.infra); return ppl; },
    hasPeople: () => ppl != null,
    adoptPeople(P) { ppl = P; }, // a commute already run on this layout (the page runs it with progress)
  };
}

// ---------------------------------------------------------------- collections
// Each collection lists its fields; fields marked `needs` pull in a model only when a query touches them.
const FIELDS = {
  buildings: {
    index: 'position in layout.buildings', district: 'district id', zone: 'core | mixed | residential | green', era: 'chord voice (0-based) or null',
    floors: 'floors', h: 'height (m)', w: 'width (m)', d: 'depth (m)', amp: 'plate amplitude under it (0–1)', landmark: 'district landmark',
    x: 'east (m)', z: 'south (m)', elevation: 'ground elevation (m)',
    residents: { doc: 'residents', needs: 'infra' }, jobs: { doc: 'jobs', needs: 'infra' }, node: { doc: 'street node it connects to', needs: 'infra' },
    landValue: { doc: 'land-value index (0–1)', needs: 'people' }, access: { doc: 'accessibility to jobs (0–1)', needs: 'people' }, marketZone: { doc: 'zone the land market would produce', needs: 'people' },
    status: { doc: 'with `fail`: lost | degraded | ok', needs: 'fail' },
  },
  streets: {
    index: 'graph edge index', kind: 'boulevard | ring | spoke | wall | service | corridor', w: 'width (m)', length: 'length (m)', era: 'chord voice or null', bridge: 'over water',
    flow: { doc: 'peak-hour cars, both ways', needs: 'people' }, vc: { doc: 'volume / capacity at the peak', needs: 'people' }, speed: { doc: 'peak speed (km/h)', needs: 'people' },
    lanes: { doc: 'lanes provided', needs: 'people' }, lanesNeeded: { doc: 'lanes the peak flow needs', needs: 'people' },
  },
  districts: {
    district: 'district id', buildings: 'buildings', residents: { doc: 'residents', needs: 'infra' }, jobs: { doc: 'jobs', needs: 'infra' },
    tallest: 'tallest building (m)', meanAmp: 'mean amplitude', landmark: 'index of its landmark building',
    lost: { doc: 'with `fail`: buildings that lose service', needs: 'fail' }, lostPeople: { doc: 'with `fail`: residents that lose service', needs: 'fail' },
    degraded: { doc: 'with `fail`: buildings with degraded service', needs: 'fail' },
  },
  towers: { index: 'tank index (0-based; the page shows index + 1)', height: 'tank height (m)', served: 'people served', storageM3: 'storage (m³)', x: 'east (m)', z: 'south (m)' },
  substations: { index: 'substation index', loadMVA: 'load (MVA)', ratingMVA: 'rating (MVA)', loading: 'load / rating', x: 'east (m)', z: 'south (m)' },
  stations: { index: 'metro station index', district: 'district (−1 for an extra stop)', name: 'name', x: 'east (m)', z: 'south (m)' },
  liftStations: { index: 'lift station index', flow: 'peak flow (m³/s)', fromDepth: 'depth it lifts from (m)', x: 'east (m)', z: 'south (m)' },
  treatment: { index: 'treatment plant index', flowM3Day: 'flow (m³/day)', served: 'population equivalent', x: 'east (m)', z: 'south (m)' },
  pipes: { index: 'sewer pipe index', diameter: 'diameter (m)', slope: 'slope (m/m)', upDepth: 'upstream depth (m)', downDepth: 'downstream depth (m)', length: 'length (m)', forceMain: 'pumped', flow: 'peak flow (m³/s)' },
};
export const COLLECTIONS = Object.keys(FIELDS);
const needOf = (coll, f) => { const d = FIELDS[coll]?.[f]; return d && typeof d === 'object' ? d.needs : null; };

function rowsOf(city, coll, needs, failed) {
  const L = city.layout;
  if (coll === 'buildings') {
    const lat = needs.has('infra') || needs.has('people') ? new Map(city.infra.laterals.map((l) => [l.building, l])) : null; // access is read at the building's street node
    const P = needs.has('people') ? city.people : null;
    return L.buildings.map((b, i) => {
      const r = { index: i, district: b.district, zone: b.zone, era: b.era ?? null, floors: b.floors, h: b.h, w: b.w, d: b.d, amp: b.amp, landmark: !!b.landmark, x: b.pos[0], z: b.pos[2], elevation: b.elevation ?? 0 };
      const l = lat?.get(i), node = l ? l.node : -1;
      if (needs.has('infra')) { r.residents = l ? l.residents : 0; r.jobs = l ? l.jobs : 0; r.node = node; }
      if (P) { r.landValue = P.landValue[i]; r.access = node >= 0 ? P.access[node] : null; r.marketZone = P.emergentZone[i]; }
      if (failed) r.status = failed.lost.has(i) ? 'lost' : failed.degraded.has(i) ? 'degraded' : 'ok';
      return r;
    });
  }
  if (coll === 'streets') {
    const G = city.infra.graph, P = needs.has('people') ? city.people : null;
    return G.edges.map((e, i) => {
      const r = { index: i, kind: e.kind, w: e.w, length: e.len, era: e.era ?? null, bridge: !!e.bridge };
      if (P) { const T = P.traffic; r.flow = T.edgeFlow[i]; r.vc = T.vc[i]; r.speed = T.speedKmh[i]; r.lanes = T.lanes[i]; r.lanesNeeded = T.lanesNeeded[i]; }
      return r;
    });
  }
  if (coll === 'districts') {
    const lat = needs.has('infra') ? new Map(city.infra.laterals.map((l) => [l.building, l])) : null;
    const by = new Map();
    L.buildings.forEach((b, i) => {
      if (b.district == null || b.district < 0) return;
      let r = by.get(b.district);
      if (!r) { r = { district: b.district, buildings: 0, tallest: 0, meanAmp: 0, landmark: -1 }; if (lat) { r.residents = 0; r.jobs = 0; } if (failed) { r.lost = 0; r.lostPeople = 0; r.degraded = 0; } by.set(b.district, r); }
      r.buildings++; r.tallest = Math.max(r.tallest, b.h); r.meanAmp += b.amp; if (b.landmark) r.landmark = i;
      const l = lat?.get(i);
      if (lat && l) { r.residents += l.residents; r.jobs += l.jobs; }
      if (failed) { if (failed.lost.has(i)) { r.lost++; r.lostPeople += l ? l.residents : 0; } else if (failed.degraded.has(i)) r.degraded++; }
    });
    return [...by.values()].sort((a, b) => a.district - b.district).map((r) => ({ ...r, meanAmp: r.meanAmp / r.buildings, ...(lat ? { residents: r.residents, jobs: r.jobs } : {}), ...(failed ? { lostPeople: r.lostPeople } : {}) }));
  }
  const I = city.infra, xz = (p) => ({ x: p[0], z: p[2] });
  if (coll === 'towers') return I.water.towers.map((t, i) => ({ index: i, height: t.height, served: t.served, storageM3: t.storageM3, ...xz(t.pos) }));
  if (coll === 'substations') return I.power.substations.map((s, i) => ({ index: i, loadMVA: s.loadMVA, ratingMVA: s.ratingMVA, loading: s.loadMVA / s.ratingMVA, ...xz(s.pos) }));
  if (coll === 'stations') return I.transit.stations.map((s, i) => ({ index: i, district: s.district, name: s.name, ...xz(s.pos) }));
  if (coll === 'liftStations') return I.sewer.liftStations.map((s, i) => ({ index: i, flow: s.flow, fromDepth: s.fromDepth, ...xz(s.pos) }));
  if (coll === 'treatment') return I.sewer.plants.map((p, i) => ({ index: i, flowM3Day: p.flowM3Day, served: p.served, ...xz(p.pos) }));
  if (coll === 'pipes') return I.sewer.pipes.map((p, i) => ({ index: i, diameter: p.diameter, slope: p.slope, upDepth: p.upDepth, downDepth: p.downDepth, length: p.length, forceMain: !!p.forceMain, flow: p.flow }));
  throw new Error(`Unknown collection "${coll}". Collections: ${COLLECTIONS.join(', ')}`);
}

// A missing value (null: no chord voice, no lateral) satisfies no ordering and equals only null.
const known = (a, b) => a != null && b != null;
const OPS = {
  '=': (a, b) => (a ?? null) === (b ?? null), '!=': (a, b) => (a ?? null) !== (b ?? null),
  '>': (a, b) => known(a, b) && a > b, '>=': (a, b) => known(a, b) && a >= b, '<': (a, b) => known(a, b) && a < b, '<=': (a, b) => known(a, b) && a <= b,
  in: (a, b) => Array.isArray(b) && b.includes(a ?? null),
};
export const QUERY_OPS = Object.keys(OPS);
const AGGS = ['count', 'sum', 'mean', 'min', 'max'];
// Aggregate over the rows; mean, min and max of no numbers are null (not 0 or ±Infinity).
function aggregateOf(rs, spec) {
  const [fn, f] = String(spec).split(':');
  if (fn === 'count') return rs.length;
  const vals = rs.map((r) => r[f]).filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (fn === 'sum') return vals.reduce((s, v) => s + v, 0);
  if (!vals.length) return null;
  if (fn === 'mean') return vals.reduce((s, v) => s + v, 0) / vals.length;
  return vals.reduce((m, v) => (fn === 'min' ? Math.min(m, v) : Math.max(m, v)), fn === 'min' ? Infinity : -Infinity);
}
// Values are compared at full precision and rounded only for the answer: 4 significant figures below 1, 3 decimals above.
const shown = (v) => (typeof v !== 'number' || Number.isInteger(v) || !Number.isFinite(v) ? v : Math.abs(v) < 1 ? +v.toPrecision(4) : round(v, 3));
const shownRow = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, shown(v)]));

// Run a structured query. q = { from, where?: [{field, op, value}], fail?: {kind, index}, groupBy?, aggregate?: {name: 'count' | 'sum:field' | ...},
// orderBy?: [{field, dir}], limit?, fields? }. Returns { query, rows, count, total, computed[] }.
// `count` is the number of result rows before `limit`: matching rows, groups with groupBy, 1 with an aggregate.
// With groupBy or aggregate, `orderBy` and `fields` may name the output columns (the group field and the aggregate names).
export function query(cityLike, q) {
  if (!q || typeof q !== 'object') throw new Error('A query is an object: { from, where, groupBy, aggregate, orderBy, limit }');
  const city = cityOf(cityLike), coll = q.from;
  if (!FIELDS[coll]) throw new Error(`Unknown collection "${coll}". Collections: ${COLLECTIONS.join(', ')}`);
  const where = q.where ?? [], fields = FIELDS[coll];
  const aggregate = q.aggregate ?? null, grouped = !!(q.groupBy || aggregate);
  const outCols = new Set(grouped ? [...(q.groupBy ? [q.groupBy] : []), ...Object.keys(aggregate ?? { count: 'count' })] : []);
  const noField = (f) => new Error(`"${coll}" has no field "${f}". Fields: ${Object.keys(fields).join(', ')}`);
  const input = new Set([...where.map((w) => w.field), ...(q.groupBy ? [q.groupBy] : [])]);
  if (aggregate) for (const spec of Object.values(aggregate)) {
    const [fn, f] = String(spec).split(':');
    if (!AGGS.includes(fn)) throw new Error(`Unknown aggregate "${fn}" (${AGGS.join(', ')})`);
    if (fn !== 'count' && !f) throw new Error(`Aggregate "${fn}" needs a field: "${fn}:<field>"`);
    if (f) input.add(f);
  }
  for (const f of input) if (!(f in fields)) throw noField(f);
  const output = [...(q.orderBy ?? []).map((o) => o.field), ...(q.fields ?? [])];
  for (const f of output) if (grouped ? !outCols.has(f) : !(f in fields)) throw grouped ? new Error(`With groupBy or aggregate, order and fields name the output columns: ${[...outCols].join(', ')}`) : noField(f);
  for (const w of where) if (!OPS[w.op]) throw new Error(`Unknown operator "${w.op}" (${QUERY_OPS.join(' ')})`);
  const touched = new Set([...input, ...(grouped ? [] : output)]);
  const needs = new Set([...touched].map((f) => needOf(coll, f)).filter(Boolean));
  if (coll !== 'buildings' && coll !== 'districts') needs.add('infra');
  let failed = null;
  if (q.fail) {
    if (coll !== 'buildings' && coll !== 'districts') throw new Error('`fail` applies to buildings and districts');
    const r = failImpact(city.layout, city.infra, q.fail);
    failed = { lost: new Set(r.affected), degraded: new Set(r.degraded), result: r };
    needs.add('fail');
  }
  if (needs.has('fail') && !failed) throw new Error('Fields `status`, `lost`, `lostPeople` and `degraded` need a `fail: {kind, index}`');
  if (coll === 'districts') needs.add('infra');
  const all = rowsOf(city, coll, needs, failed);
  let rows = all.filter((r) => where.every((w) => OPS[w.op](r[w.field], w.value)));
  if (q.groupBy) {
    const groups = new Map();
    for (const r of rows) { const k = r[q.groupBy] ?? null; (groups.get(k) ?? groups.set(k, []).get(k)).push(r); }
    const agg = aggregate ?? { count: 'count' };
    rows = [...groups].map(([k, rs]) => ({ [q.groupBy]: k, ...Object.fromEntries(Object.entries(agg).map(([name, spec]) => [name, aggregateOf(rs, spec)])) }));
  } else if (aggregate) {
    rows = [Object.fromEntries(Object.entries(aggregate).map(([name, spec]) => [name, aggregateOf(rows, spec)]))];
  }
  // stable sorts applied last key first; nulls sort last either way
  for (const o of [...(q.orderBy ?? [])].reverse()) {
    const s = o.dir === 'asc' ? 1 : -1;
    rows = rows.slice().sort((a, b) => { const x = a[o.field] ?? null, y = b[o.field] ?? null; return x === y ? 0 : x === null ? 1 : y === null ? -1 : x > y ? s : x < y ? -s : 0; });
  }
  const count = rows.length;
  if (q.limit != null) rows = rows.slice(0, Math.max(0, q.limit | 0));
  if (q.fields) rows = rows.map((r) => Object.fromEntries(q.fields.map((f) => [f, r[f] ?? null])));
  return { query: q, rows: rows.map(shownRow), count, total: all.length, computed: [...needs].filter((n) => n !== 'fail'), ...(failed ? { failure: { kind: q.fail.kind, index: q.fail.index ?? 0, summary: failed.result.summary, people: failed.result.people } } : {}) };
}

// ---------------------------------------------------------------- suggestions
// A new metro station: the street node that would bring the most residents and jobs within walking reach
// (TRANSIT catchment, 1.2 km) of a station, at least the minimum spacing from existing stations, with the
// street length to the nearest station that a tunnel would follow.
export function suggest(cityLike, what = 'metro-station', opts = {}) {
  if (what !== 'metro-station') throw new Error(`Nothing to suggest for "${what}" yet (metro-station)`);
  const city = cityOf(cityLike), I = city.infra, G = I.graph, st = I.transit.stations;
  const R = opts.catchment ?? 1200, minSpacing = TRANSIT.minSpacing ?? 700, k = opts.top ?? 3;
  const weight = new Map(); // node → residents + jobs
  for (const l of I.laterals) weight.set(l.node, (weight.get(l.node) ?? 0) + l.residents + l.jobs);
  const covered = (P) => st.some((s) => dist(s.pos, P) <= R);
  const uncovered = [...weight].filter(([n]) => !covered(G.nodes[n].pos)).map(([n, w]) => ({ n, w, P: G.nodes[n].pos }));
  const uncoveredTotal = uncovered.reduce((s, x) => s + x.w, 0);
  const total = [...weight.values()].reduce((s, x) => s + x, 0);
  if (!uncovered.length) return { what, candidates: [], uncovered: 0, total: round(total, 1), text: 'Every resident and job is already within reach of a station.' };
  // candidate sites: street nodes (thinned to ~1500) at the minimum spacing from every station; a site need not carry demand itself
  const sites = G.nodes.map((nd, n) => ({ n, P: nd.pos })).filter((c) => !st.some((x) => dist(x.pos, c.P) < minSpacing));
  const cand = sites.filter((_, i) => i % Math.max(1, Math.floor(sites.length / 1500)) === 0);
  const picks = [], taken = [];
  for (let r = 0; r < k; r++) {
    let best = null;
    for (const c of cand) {
      if (taken.some((t) => dist(t, c.P) < minSpacing)) continue;
      let gain = 0; for (const u of uncovered) if (dist(u.P, c.P) <= R && !taken.some((t) => dist(t, u.P) <= R)) gain += u.w;
      if (!best || gain > best.gain) best = { node: c.n, P: c.P, gain };
    }
    if (!best || best.gain <= 0) break;
    // the tunnel runs along the streets to the nearest station, or to an earlier pick (built first)
    let link = null;
    const sources = [...st.map((x) => x.node), ...picks.map((x) => x.node)];
    if (sources.length) { const { d } = dijkstra(G, sources); link = Number.isFinite(d[best.node]) ? d[best.node] : null; }
    taken.push(best.P);
    picks.push({ node: best.node, x: round(best.P[0], 1), z: round(best.P[2], 1), pos: best.P, gain: round(best.gain, 1), share: round(best.gain / total, 4), tunnelM: link == null ? null : round(link, 1), perKm: link ? round(best.gain / (link / 1000), 1) : null });
  }
  const p0 = picks[0];
  return {
    what, candidates: picks, uncovered: round(uncoveredTotal, 1), total: round(total, 1),
    text: p0 ? `A station at street node ${p0.node} (${p0.x}, ${p0.z}) would bring ${Math.round(p0.gain).toLocaleString('en-US')} residents and jobs (${(100 * p0.share).toFixed(1)} % of the city) within ${R} m of the metro${p0.tunnelM != null ? `, ${(p0.tunnelM / 1000).toFixed(2)} km of street from the nearest station` : ''}.` : 'No site at the minimum spacing gains anyone.',
  };
}

// ---------------------------------------------------------------- plain-English front end
// An asset word, read with the service the question names: "plant" alone is the power plant in a question
// about power, the water treatment plant in one about water, the sewage plant in one about sewers.
const SERVICE_OF = (t) => (/\b(?:water)\b/.test(t) ? 'water' : /\b(?:power|electricity)\b/.test(t) ? 'power' : /\b(?:sewer|sewage|sewerage|wastewater)\b/.test(t) ? 'sewer' : /\b(?:metro|transit|subway|trains?)\b/.test(t) ? 'transit' : null);
const ASSET_HELP = 'tank, water plant, water main, sewage treatment plant, lift station, sewer pipe, power plant, substation, feeder, transmission line, metro station, metro tunnel';
function assetKind(word, service = null) {
  const w = word.trim().toLowerCase();
  if (/metro|subway/.test(w)) return /tunnel|line|link/.test(w) ? 'transit' : 'station';
  if (/tunnel/.test(w)) return 'transit';
  if (/sub ?station/.test(w)) return 'substation';
  if (/lift|pump/.test(w)) return 'lift';
  if (/tank|tower|cistern|reservoir/.test(w)) return 'tower';
  if (/feeder|cable/.test(w)) return 'power';
  if (/transmission|pylon/.test(w)) return 'transmission';
  if (/main/.test(w)) return 'water';
  if (/sewage|sewer|wastewater/.test(w)) return /pipe|sewer$/.test(w) && !/plant|works|treatment/.test(w) ? 'sewer' : 'treatment';
  if (/pipe/.test(w)) return service === 'water' ? 'water' : 'sewer';
  if (/water/.test(w) && /plant|works|treatment/.test(w)) return 'waterplant';
  if (/water ?works/.test(w)) return 'waterplant';
  if (/power|generat/.test(w)) return 'plant';
  if (/treatment/.test(w)) return service === 'water' ? 'waterplant' : 'treatment';
  if (/^(?:the )?(?:plant|works)$/.test(w)) {
    const k = { power: 'plant', water: 'waterplant', sewer: 'treatment' }[service];
    if (!k) throw new Error(`Which plant? Say "power plant", "water plant" or "sewage treatment plant".`);
    return k;
  }
  if (/^(?:the )?station$/.test(w)) return service === 'power' ? 'plant' : service === 'water' || service === 'sewer' ? 'lift' : 'station';
  return null;
}
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, first: '1st', second: '2nd', third: '3rd', fourth: '4th', fifth: '5th', sixth: '6th', seventh: '7th', eighth: '8th', ninth: '9th', tenth: '10th' };
const plural = (n, one, many) => (Math.round(n) === 1 ? one : many);
export const ASK_EXAMPLES = [
  'Which districts lose water if tank 3 fails?',
  'Which districts lose power if substation 2 fails?',
  'How many buildings are over 20 floors?',
  'What is the tallest building?',
  'Which district has the most residents?',
  'How many people live in district 4?',
  'How many lift stations are there?',
  'What is the busiest street?',
  'Where would a new metro station pay off?',
];
// Turn a question into a structured query (or a suggestion) and answer it. Returns { understood, answer, rows, ... }.
export function ask(cityLike, text) {
  const t = String(text ?? '').trim().toLowerCase().replace(/\s*[?.!]+$/, '').replace(/\s+/g, ' ')
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/g, (w) => String(NUMBER_WORDS[w]));
  const city = cityOf(cityLike);
  const fmtN = (x) => Math.round(x).toLocaleString('en-US');
  let m;
  // failures by district
  if ((m = t.match(/^(?:which|what) districts? (?:lose|lost|would lose|loses|go without) (?:their |its )?((?:water|power|electricity|sewer|sewage|sewerage|metro|transit|train) )?(?:service |supply )?(?:if|when) (?:the )?(?:(\d+)(?:st|nd|rd|th) )?(.+?)(?: (?:no\.? |number |#)?(\d+))? (?:fails|failed|goes down|breaks|is lost|goes out|is out|is closed|closes|shuts down)$/))) {
    const service = SERVICE_OF(m[1] ?? ''), kind = assetKind(m[3], service);
    if (!kind) throw new Error(`I don't know the asset "${m[3]}" (${ASSET_HELP})`);
    const n = +(m[4] ?? m[2] ?? 1), index = n - 1;
    if (!Number.isInteger(n) || n < 1) throw new Error(`Assets are numbered from 1, as in the page: "${m[3]} 1" is the first`);
    const q = { from: 'districts', fail: { kind, index }, where: [{ field: 'lost', op: '>', value: 0 }], orderBy: [{ field: 'lostPeople', dir: 'desc' }], fields: ['district', 'lost', 'lostPeople', 'degraded'] };
    const r = query(city, q);
    const list = r.rows.map((x) => `district ${x.district} (${fmtN(x.lost)} ${plural(x.lost, "building", "buildings")}, ${fmtN(x.lostPeople)} people)`);
    return { understood: q, rows: r.rows, failure: r.failure, answer: r.rows.length ? `${r.rows.length} district${r.rows.length === 1 ? '' : 's'} lose service: ${list.slice(0, 6).join(', ')}${list.length > 6 ? ', …' : ''}. ${r.failure.summary}` : `No district loses service outright. ${r.failure.summary}` };
  }
  // counts by height
  if ((m = t.match(/^how many buildings (?:are |have )?(over|above|more than|taller than|higher than|under|below|less than|shorter than|lower than|at least|at most|no more than|no less than) (\d+(?:\.\d+)?) ?(floors?|storeys?|stories|m|metres?|meters?)(?: tall| high)?(?: or (?:more|higher|taller|less|fewer|lower))?$/))) {
    const atLeast = /at least|no less/.test(m[1]) || /or (?:more|higher|taller)$/.test(t), atMost = /at most|no more/.test(m[1]) || /or (?:less|fewer|lower)$/.test(t);
    const above = atLeast || (!atMost && /over|above|more|taller|higher/.test(m[1])), field = /floor|stor/.test(m[3]) ? 'floors' : 'h';
    const op = atLeast ? '>=' : atMost ? '<=' : above ? '>' : '<';
    const q = { from: 'buildings', where: [{ field, op, value: +m[2] }], aggregate: { count: 'count' } };
    const r = query(city, q);
    return { understood: q, rows: r.rows, answer: `${fmtN(r.rows[0].count)} of ${fmtN(r.total)} buildings ${plural(r.rows[0].count, 'is', 'are')} ${{ '>': 'over', '<': 'under', '>=': 'at least', '<=': 'at most' }[op]} ${m[2]} ${field === 'floors' ? plural(+m[2], 'floor', 'floors') : 'm'}.` };
  }
  if ((m = t.match(/^(?:what|which) is the (tallest|highest|shortest|lowest) building$|^(?:the )?(tallest|highest) building$/))) {
    const tall = /tallest|highest/.test(m[1] ?? m[2]);
    const q = { from: 'buildings', orderBy: [{ field: 'h', dir: tall ? 'desc' : 'asc' }], limit: 1, fields: ['index', 'h', 'floors', 'district', 'zone', 'x', 'z'] };
    const r = query(city, q), b = r.rows[0];
    return { understood: q, rows: r.rows, answer: `Building ${b.index}: ${b.h} m, ${b.floors} ${plural(b.floors, 'floor', 'floors')}, district ${b.district} (${b.zone}).` };
  }
  if ((m = t.match(/^which district (?:has|is home to) the (most|fewest|least|largest number of|smallest number of) (people|residents|jobs|buildings|workers)$/))) {
    const field = /job|work/.test(m[2]) ? 'jobs' : /build/.test(m[2]) ? 'buildings' : 'residents', most = /most|largest/.test(m[1]);
    const q = { from: 'districts', orderBy: [{ field, dir: most ? 'desc' : 'asc' }], limit: 1, fields: ['district', field, 'buildings'] };
    const r = query(city, q), d = r.rows[0];
    return { understood: q, rows: r.rows, answer: `District ${d.district}: ${fmtN(d[field])} ${field}.` };
  }
  if ((m = t.match(/^(?:how many (?:people|residents) live in|what is the population of|population of) district (\d+)$/))) {
    const q = { from: 'buildings', where: [{ field: 'district', op: '=', value: +m[1] }], aggregate: { residents: 'sum:residents', jobs: 'sum:jobs', buildings: 'count' } };
    const r = query(city, q), d = r.rows[0];
    if (!d.buildings) throw new Error(`There is no district ${m[1]} (districts ${Math.min(...city.layout.buildings.map((b) => b.district).filter((x) => x >= 0))}–${Math.max(...city.layout.buildings.map((b) => b.district))})`);
    return { understood: q, rows: r.rows, answer: `District ${m[1]}: ${fmtN(d.residents)} residents and ${fmtN(d.jobs)} jobs in ${fmtN(d.buildings)} buildings.` };
  }
  if ((m = t.match(/^how many (lift stations|pumping stations|water tanks|tanks|towers|substations|metro stations|stations|treatment plants|sewer pipes|pipes)(?: are there)?$/))) {
    const coll = /lift|pump/.test(m[1]) ? 'liftStations' : /tank|tower/.test(m[1]) ? 'towers' : /substation/.test(m[1]) ? 'substations' : /station/.test(m[1]) ? 'stations' : /treatment/.test(m[1]) ? 'treatment' : 'pipes';
    const q = { from: coll, aggregate: { count: 'count' } };
    const r = query(city, q);
    const n = r.rows[0].count, noun = n === 1 ? m[1].replace(/s$/, '').replace(/ies$/, 'y') : m[1];
    return { understood: q, rows: r.rows, answer: `${fmtN(n)} ${noun}.` };
  }
  // busiest = most cars; most congested = highest volume over capacity
  if ((m = t.match(/^(?:what|which) is the (busiest|most congested|most crowded) (?:street|road)$|^(?:the )?(busiest|most congested|most crowded) (?:street|road)$/))) {
    const byLoad = /congested|crowded/.test(m[1] ?? m[2]);
    const q = { from: 'streets', where: [{ field: 'flow', op: '>', value: 0 }], orderBy: [{ field: byLoad ? 'vc' : 'flow', dir: 'desc' }], limit: 1, fields: ['index', 'kind', 'flow', 'vc', 'speed', 'lanes', 'lanesNeeded'] };
    const r = query(city, q), s = r.rows[0];
    if (!s) return { understood: q, rows: [], answer: 'No street carries peak-hour cars in this city.' };
    return { understood: q, rows: r.rows, answer: `Street edge ${s.index} (${s.kind}): ${fmtN(s.flow)} cars in the peak hour, ${Math.round(100 * s.vc)} % of capacity, ${s.speed.toFixed(0)} km/h on ${s.lanes} lane${s.lanes === 1 ? '' : 's'}.` };
  }
  if (/^where (?:would|should|could) (?:a |an )?(?:new |another |extra |next |\d+(?:st|nd|rd|th) )?(?:metro |subway )?(?:station|stop|line) (?:pay off|help most|go|be built|do the most good)|^where to (?:put|build) (?:a |the )?(?:new |next )?(?:metro )?station/.test(t)) {
    const s = suggest(city, 'metro-station');
    return { understood: { suggest: 'metro-station' }, rows: s.candidates.map(({ pos, ...c }) => c), answer: s.text + (city.infra.transit.stations.length ? '' : ' (This city has no metro yet.)') };
  }
  throw new Error(`I didn't understand that. Try one of: ${ASK_EXAMPLES.join(' · ')} — or send a structured query.`);
}

// ---------------------------------------------------------------- metrics for the inverse problem
// stage: physics (from the plate's response alone), plan (generateCity), infra (networks), people (commute).
export const METRICS = {
  frequency: { stage: 'physics', label: 'Frequency (Hz)', doc: 'drive frequency (Hz)' },
  sharpness: { stage: 'physics', label: 'Sharpness', doc: 'pattern sharpness (0–1)' },
  nodalDiameters: { stage: 'physics', circleOnly: true, label: 'Nodal diameters', doc: 'nodal diameters of the dominant mode (disk: m)' },
  nodalCircles: { stage: 'physics', circleOnly: true, label: 'Nodal circles', doc: 'nodal circles of the dominant mode, rim included (disk: n)' },
  radialBoulevards: { stage: 'physics', circleOnly: true, label: 'Radial boulevards', doc: 'boulevards radiating from the centre (disk: 2m)' },
  buildings: { stage: 'plan', label: 'Buildings', doc: 'buildings' },
  population: { stage: 'plan', label: 'Residents', doc: 'residents' },
  jobs: { stage: 'plan', label: 'Jobs', doc: 'jobs' },
  tallest: { stage: 'plan', label: 'Tallest (m)', doc: 'tallest building (m)' },
  streetKm: { stage: 'plan', label: 'Streets (km)', doc: 'street length (km)' },
  districts: { stage: 'plan', label: 'Districts', doc: 'districts' },
  greenShare: { stage: 'plan', label: 'Green share', doc: 'share of the plate area in green and unreachable lots (the open-space check)' },
  densityPerHa: { stage: 'plan', label: 'Residents / ha', doc: 'residents per hectare' },
  centralPlaza: { stage: 'plan', boolean: true, label: 'Central plaza', doc: 'no building within max(2 lots, 3 % of the plate) of the centre (plane plates; false on the sphere)' },
  failingChecks: { stage: 'plan', label: 'Failing checks', doc: 'plan checks that fail' },
  liftStations: { stage: 'infra', label: 'Lift stations', doc: 'sewer lift stations' },
  substations: { stage: 'infra', label: 'Substations', doc: 'substations' },
  metroStations: { stage: 'infra', label: 'Metro stations', doc: 'metro stations' },
  waterTanks: { stage: 'infra', label: 'Water tanks', doc: 'water tanks' },
  excavationMm3: { stage: 'infra', label: 'Excavation (M m³)', doc: 'excavation (million m³)' },
  meanCommuteMin: { stage: 'people', label: 'Commute (min)', doc: 'mean door-to-door commute (min)' },
  metroShare: { stage: 'people', label: 'Metro share', doc: 'commuters by metro' },
  congestedKm: { stage: 'people', label: 'Congested km', doc: 'street length over capacity at the peak (km)' },
};
const STAGES = ['physics', 'plan', 'infra', 'people'];
function physicsOf(p) {
  const modes = enumerateModes({ plate: p.plate, fundamentalHz: p.fundamentalHz, driveOffset: p.driveOffset, azimuthal: p.azimuthal });
  const r = drivenResponse(modes, p.frequency, p.Q ?? 100), d = r.active[0];
  const circle = p.plate === 'circle';
  return { frequency: p.frequency, sharpness: r.sharpness, nodalDiameters: circle ? d.m : NaN, nodalCircles: circle ? d.n : NaN, radialBoulevards: circle ? 2 * d.m : NaN, dominant: modeLabel(d) };
}
function planOf(L) {
  const s = L.stats, plane = L.meta.plate !== 'sphere';
  const r0 = Math.max(2 * (L.meta.presetSpec?.lot ?? PRESETS[L.meta.preset]?.lot ?? 40), 0.03 * L.meta.world.extent);
  const centre = plane ? [0, 0, 0] : null;
  return {
    buildings: s.buildings, population: s.population, jobs: s.jobs, tallest: s.maxHeight, streetKm: s.roadLengthKm, districts: s.districts,
    greenShare: s.greenShare ?? (s.lots ? s.greenLots / s.lots : NaN), densityPerHa: s.densityPerHa,
    centralPlaza: plane ? !L.buildings.some((b) => Math.hypot(b.pos[0] - centre[0], b.pos[2] - centre[2]) < r0) : false,
    failingChecks: L.checks.filter((c) => c.status === 'fail').length,
  };
}
const infraOf = (I) => ({ liftStations: I.stats.liftStations, substations: I.stats.substations, metroStations: I.stats.stations, waterTanks: I.stats.towers, excavationMm3: I.stats.excavationM3 / 1e6 });
const peopleOf = (P) => ({ meanCommuteMin: P.stats.meanTripMin, metroShare: P.stats.modeShare.metro, congestedKm: P.stats.congestedKm });

// Evaluate the named metrics of a profile, building only the stages they need.
export function metricsOf(profile, names) {
  const want = new Set(names), stages = new Set([...want].map((n) => { if (!METRICS[n]) throw new Error(`Unknown metric "${n}". Metrics: ${Object.keys(METRICS).join(', ')}`); return METRICS[n].stage; }));
  const out = {};
  if (stages.has('physics')) Object.assign(out, physicsOf(resolvedProfile(profile)));
  if (stages.has('plan') || stages.has('infra') || stages.has('people')) {
    const city = cityOf(generateCity(profile));
    Object.assign(out, planOf(city.layout));
    if (stages.has('infra') || stages.has('people')) Object.assign(out, infraOf(city.infra));
    if (stages.has('people')) Object.assign(out, peopleOf(city.people));
  }
  return Object.fromEntries([...want].map((n) => [n, out[n]]));
}
const resolvedProfile = (p) => ({ plate: p.plate ?? 'circle', fundamentalHz: p.fundamentalHz ?? PLATES[p.plate ?? 'circle'].defaultFundamental, driveOffset: p.driveOffset ?? ((p.plate ?? 'circle') === 'square' ? 0 : 0.37), azimuthal: p.azimuthal, frequency: p.frequency ?? 432, Q: p.Q ?? 100 });

// How far a value is from satisfying a constraint, relative to the constraint's scale (0 = satisfied).
function violation(v, c) {
  if (typeof c.value === 'boolean' || typeof v === 'boolean') return (c.op === '!=' ? v !== c.value : v === c.value) ? 0 : 1;
  if (!Number.isFinite(v)) return Infinity;
  const scale = Math.max(1e-9, Math.abs(c.value), Math.abs(c.value2 ?? 0), 1e-3);
  switch (c.op) {
    case '=': return Math.abs(v - c.value) / scale;
    case '!=': return v !== c.value ? 0 : 1;
    case '>': return v > c.value ? 0 : (c.value - v) / scale + 1e-9;
    case '>=': return v >= c.value ? 0 : (c.value - v) / scale;
    case '<': return v < c.value ? 0 : (v - c.value) / scale + 1e-9;
    case '<=': return v <= c.value ? 0 : (v - c.value) / scale;
    case 'between': return v < c.value ? (c.value - v) / scale : v > c.value2 ? (v - c.value2) / scale : 0;
    default: throw new Error(`Unknown constraint operator "${c.op}" (= != > >= < <= between)`);
  }
}
export const satisfies = (v, c) => violation(v, c) === 0;

// The inverse problem. spec = { base: profile, vary: { frequency: [lo, hi] | true, Q: [lo, hi], driveOffset: [lo, hi], plate: [..] },
// constraints: [{ metric, op, value, value2? }], objective?: { metric, dir: 'min' | 'max' }, budget = 24 cities, top = 5, seed = 1, scan = 600 }.
export function search(spec, onProgress = () => {}) {
  const base = { plate: 'circle', preset: 'city', ...(spec.base ?? {}) };
  delete base.frequency; delete base.chord; // the search sets the frequency; chords are not searched
  const vary = spec.vary ?? { frequency: true };
  const plates0 = Array.isArray(spec.vary?.plate) ? spec.vary.plate : [base.plate];
  const constraints = (spec.constraints ?? []).map((c0) => {
    if (!METRICS[c0.metric]) throw new Error(`Unknown metric "${c0.metric}". Metrics: ${Object.keys(METRICS).join(', ')}`);
    const c = { ...c0 };
    if (METRICS[c.metric].boolean) { if (c.value === 'true' || c.value === 'yes') c.value = true; if (c.value === 'false' || c.value === 'no') c.value = false; if (typeof c.value !== 'boolean') throw new Error(`"${c.metric}" is yes or no (true / false)`); if (!['=', '!='].includes(c.op)) throw new Error(`"${c.metric}" takes = or !=`); }
    else { if (typeof c.value !== 'number' || !Number.isFinite(c.value)) throw new Error(`"${c.metric}" needs a number`); }
    if (c.op === 'between' && !(Number.isFinite(c.value2) && c.value2 >= c.value)) throw new Error(`"between" needs value ≤ value2 (got ${c.value} and ${c.value2})`);
    if (METRICS[c.metric].circleOnly && !plates0.includes('circle')) throw new Error(`"${c.metric}" is defined on the circular membrane only (searching ${plates0.join(', ')})`);
    violation(1, c); return c;
  });
  const objective = spec.objective ?? null;
  if (objective && !METRICS[objective.metric]) throw new Error(`Unknown objective metric "${objective.metric}"`);
  const budget = Math.max(1, spec.budget ?? 24), top = Math.max(1, spec.top ?? 5), scan = Math.max(20, spec.scan ?? 600);
  const rng = mulberry32((spec.seed ?? 1) >>> 0);
  const plates = Array.isArray(vary.plate) ? vary.plate : [base.plate];
  const range = (v, def) => (Array.isArray(v) ? v : def);
  const byStage = (s) => constraints.filter((c) => METRICS[c.metric].stage === s);
  const needed = new Set([...constraints.map((c) => METRICS[c.metric].stage), ...(objective ? [METRICS[objective.metric].stage] : [])]);
  const deepest = STAGES.filter((s) => needed.has(s)).pop() ?? 'physics';

  // 1. physics scan: many frequencies, no cities; keep one representative per dominant mode (the sharpest)
  const pool = [];
  for (const plate of plates) {
    const fund = base.fundamentalHz ?? PLATES[plate].defaultFundamental, [flo, fhi] = frequencyRange(plate, fund);
    const [lo, hi] = vary.frequency === true || vary.frequency == null ? [flo, fhi] : [Math.max(flo, vary.frequency[0]), Math.min(fhi, vary.frequency[1])];
    if (!(hi > lo) && vary.frequency) throw new Error(`No frequencies between ${vary.frequency[0]} and ${vary.frequency[1]} Hz on the ${plate} plate (${flo.toFixed(1)}–${fhi.toFixed(1)} Hz)`);
    const Qr = range(vary.Q, null), Dr = range(vary.driveOffset, null);
    const modes = enumerateModes({ plate, fundamentalHz: fund, driveOffset: base.driveOffset, azimuthal: base.azimuthal });
    const best = new Map();
    for (let i = 0; i < scan; i++) {
      const f = lo * Math.pow(hi / lo, (i + rng()) / scan);
      const Q = Qr ? Qr[0] * Math.pow(Qr[1] / Qr[0], rng()) : base.Q ?? 100;
      const driveOffset = Dr ? Dr[0] + (Dr[1] - Dr[0]) * rng() : base.driveOffset;
      const md = Dr ? enumerateModes({ plate, fundamentalHz: fund, driveOffset, azimuthal: base.azimuthal }) : modes;
      let r; try { r = drivenResponse(md, f, Q); } catch { continue; }
      const d = r.active[0], circle = plate === 'circle';
      const phys = { frequency: f, sharpness: r.sharpness, nodalDiameters: circle ? d.m : NaN, nodalCircles: circle ? d.n : NaN, radialBoulevards: circle ? 2 * d.m : NaN };
      const v = byStage('physics').reduce((s, c) => s + violation(phys[c.metric], c), 0);
      if (v > 0) continue;
      const key = `${plate}|${modeLabel(d)}|${Dr ? Math.round(driveOffset * 10) : ''}`;
      const cand = { profile: { ...base, plate, frequency: round(f, 2), Q: round(Q, 2), ...(Dr ? { driveOffset: round(driveOffset, 3) } : {}) }, physics: phys, dominant: modeLabel(d) };
      if (!best.has(key) || phys.sharpness > best.get(key).physics.sharpness) best.set(key, cand);
    }
    pool.push(...best.values());
  }
  const scanned = pool.length;
  // physics-only searches are answered without building anything
  const score = (c) => (objective ? (objective.dir === 'max' ? -1 : 1) * c.metrics[objective.metric] : -c.physics.sharpness);
  if (deepest === 'physics') {
    const done = pool.map((c) => ({ ...c, metrics: Object.fromEntries([...constraints.map((x) => x.metric), ...(objective ? [objective.metric] : [])].map((n) => [n, c.physics[n]])), feasible: true, violation: 0 }));
    done.sort((a, b) => score(a) - score(b) || a.profile.frequency - b.profile.frequency);
    return { candidates: done.slice(0, top).map(clean), nearMisses: [], evaluated: 0, scanned, budget, patterns: done.length, text: summaryText(done.length, 0, scanned) };
  }
  // 2. order the pool (sharp patterns first, seeded jitter), then build cities stage by stage within the budget
  const order = pool.map((c) => ({ c, k: c.physics.sharpness + 0.05 * rng() })).sort((a, b) => b.k - a.k).map((x) => x.c);
  const tried = [], seen = new Set();
  const evaluate = (cand) => {
    const sig = JSON.stringify(cand.profile); if (seen.has(sig)) return null; seen.add(sig);
    const metrics = { ...cand.physics };
    let viol = 0, city = null;
    for (const stage of ['plan', 'infra', 'people']) {
      if (!STAGES.slice(1, STAGES.indexOf(deepest) + 1).includes(stage)) break;
      if (stage === 'plan') {
        try { city = cityOf(generateCity(cand.profile)); } catch (e) { const r = { ...cand, error: String(e.message), feasible: false, violation: Infinity, metrics: {} }; tried.push(r); onProgress(tried.length, budget, r); return r; } // a failed build still spends the budget
        Object.assign(metrics, planOf(city.layout));
      }
      if (stage === 'infra') Object.assign(metrics, infraOf(city.infra));
      if (stage === 'people') Object.assign(metrics, peopleOf(city.people));
      const v = byStage(stage).reduce((s, c) => s + violation(metrics[c.metric], c), 0);
      viol += v;
      if (v > 0 && !(objective && METRICS[objective.metric].stage === stage)) break; // stop paying for stages a failed candidate cannot pass
    }
    const keep = [...constraints.map((x) => x.metric), ...(objective ? [objective.metric] : [])];
    const r = { ...cand, metrics: Object.fromEntries(keep.map((n) => [n, typeof metrics[n] === 'number' ? round(metrics[n], 4) : metrics[n]])), feasible: viol === 0, violation: round(viol, 6) };
    tried.push(r); onProgress(tried.length, budget, r);
    return r;
  };
  // first pass over distinct modes, then refine the closest misses by nudging frequency and Q
  let i = 0;
  const firstPass = Math.max(1, Math.ceil(budget * 0.7));
  while (tried.length < firstPass && i < order.length) evaluate(order[i++]);
  const refineFrom = () => tried.filter((t) => Number.isFinite(t.violation)).sort((a, b) => a.violation - b.violation || score(a) - score(b)).slice(0, 3);
  let guard = 0;
  while (tried.length < budget && guard++ < budget * 4) {
    const seeds = refineFrom(); if (!seeds.length) { if (i < order.length) { evaluate(order[i++]); continue; } break; }
    const s = seeds[guard % seeds.length], p = s.profile, plate = p.plate;
    const [flo, fhi] = frequencyRange(plate, p.fundamentalHz ?? PLATES[plate].defaultFundamental);
    const [vlo, vhi] = Array.isArray(vary.frequency) ? [Math.max(flo, vary.frequency[0]), Math.min(fhi, vary.frequency[1])] : [flo, fhi];
    const f = Math.min(vhi, Math.max(vlo, p.frequency * (1 + (rng() - 0.5) * 0.06)));
    const Q = vary.Q ? Math.min(vary.Q[1], Math.max(vary.Q[0], p.Q * Math.pow(1.5, rng() * 2 - 1))) : p.Q;
    const prof = { ...p, frequency: round(f, 2), Q: round(Q, 2) };
    const phys = physicsOf(resolvedProfile(prof));
    if (byStage('physics').some((c) => violation(phys[c.metric], c) > 0)) continue;
    evaluate({ profile: prof, physics: phys, dominant: phys.dominant });
  }
  if (tried.length && tried.every((t) => t.error)) throw new Error(`Every city in the search failed to build: ${tried[0].error}`);
  const feasible = tried.filter((t) => t.feasible).sort((a, b) => score(a) - score(b) || a.profile.frequency - b.profile.frequency);
  const misses = tried.filter((t) => !t.feasible).sort((a, b) => a.violation - b.violation);
  return { candidates: distinctFirst(feasible, top).map(clean), nearMisses: distinctFirst(misses, 3).map(clean), evaluated: tried.length, scanned, budget, patterns: new Set(feasible.map(patternOf)).size, failed: tried.filter((t) => t.error).length, text: summaryText(feasible.length, tried.length, scanned, new Set(feasible.map(patternOf)).size) + (tried.some((t) => t.error) ? ` ${tried.filter((t) => t.error).length} failed to build (${tried.find((t) => t.error).error}).` : '') };
}
const clean = (c) => ({ profile: c.profile, dominant: c.dominant, metrics: c.metrics, feasible: c.feasible, violation: c.violation, ...(c.error ? { error: c.error } : {}) });
// one result per pattern (plate + dominant mode) first, in rank order; then the rest, so near-copies come last
const patternOf = (c) => `${c.profile.plate}|${c.dominant}`;
function distinctFirst(list, n) {
  const seen = new Set(), first = [], rest = [];
  for (const c of list) (seen.has(patternOf(c)) ? rest : (seen.add(patternOf(c)), first)).push(c);
  return [...first, ...rest].slice(0, n);
}
const summaryText = (n, evaluated, scanned, patterns = n) => `${n} plan${n === 1 ? '' : 's'} (${patterns} distinct pattern${patterns === 1 ? '' : 's'}) meet every constraint; ${scanned} patterns passed the physics constraints${evaluated ? `, ${evaluated} cities built` : ''}.`;

// ---------------------------------------------------------------- the engine as agent tools
// JSON-schema tools with run(input, state): state.city holds the current city between calls.
export function agentTools() {
  const profileSchema = { type: 'object', description: 'generateCity input: frequency or chord, plate, preset, seed, Q, gravity, material, terrain, enforce …', additionalProperties: true };
  const constraint = { type: 'object', properties: { metric: { type: 'string', enum: Object.keys(METRICS) }, op: { type: 'string', enum: ['=', '!=', '>', '>=', '<', '<=', 'between'] }, value: { type: ['number', 'boolean'] }, value2: { type: 'number', description: 'upper bound for between' } }, required: ['metric', 'op', 'value'] };
  return [
    { name: 'generate_city', description: `Generate a city (Cymatic City Engine ${ENGINE_VERSION}) from a profile and make it the current city. Returns its headline stats and failing checks.`,
      input_schema: { type: 'object', properties: { profile: profileSchema }, required: ['profile'] },
      run: ({ profile }, state) => { state.city = cityOf(generateCity(profile)); const L = state.city.layout; return { meta: { frequency: L.meta.frequency, chord: L.meta.chord?.map((v) => v.hz) ?? null, plate: L.meta.plate, preset: L.meta.preset, dominant: L.meta.dominant }, stats: planOf(L), failingChecks: L.checks.filter((c) => c.status === 'fail').map((c) => c.id) }; } },
    { name: 'query_city', description: `Structured query over the current city. Collections and fields: ${COLLECTIONS.map((c) => `${c}(${Object.keys(FIELDS[c]).join(',')})`).join('; ')}. Operators: ${QUERY_OPS.join(' ')}. Aggregates: count, sum:f, mean:f, min:f, max:f. \`fail: {kind, index}\` (0-based) adds per-building status and per-district losses.`,
      input_schema: { type: 'object', properties: { from: { type: 'string', enum: COLLECTIONS }, where: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, op: { type: 'string', enum: QUERY_OPS }, value: {} }, required: ['field', 'op', 'value'] } }, fail: { type: 'object', properties: { kind: { type: 'string', enum: ['tower', 'waterplant', 'water', 'treatment', 'lift', 'sewer', 'plant', 'substation', 'power', 'transmission', 'transit', 'station'] }, index: { type: 'integer', minimum: 0, description: '0-based' } }, required: ['kind', 'index'] }, groupBy: { type: 'string' }, aggregate: { type: 'object', additionalProperties: { type: 'string' } }, orderBy: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, dir: { type: 'string', enum: ['asc', 'desc'] } } } }, limit: { type: 'integer' }, fields: { type: 'array', items: { type: 'string' } } }, required: ['from'] },
      run: (q, state) => { if (!state.city) throw new Error('Generate a city first'); const r = query(state.city, q); return { rows: r.rows.slice(0, 200), count: r.count, total: r.total, failure: r.failure ?? null }; } },
    { name: 'ask_city', description: `Ask the current city a question in plain English (template parser). Examples: ${ASK_EXAMPLES.join(' | ')}`,
      input_schema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
      run: ({ question }, state) => { if (!state.city) throw new Error('Generate a city first'); const r = ask(state.city, question); return { answer: r.answer, understood: r.understood, rows: (r.rows ?? []).slice(0, 50) }; } },
    { name: 'suggest_metro_station', description: 'Where a new metro station would bring the most residents and jobs within 1.2 km of the metro, at the minimum spacing, with the street length to the nearest station.',
      input_schema: { type: 'object', properties: { top: { type: 'integer' } } },
      run: ({ top }, state) => { if (!state.city) throw new Error('Generate a city first'); const s = suggest(state.city, 'metro-station', { top }); return { text: s.text, candidates: s.candidates.map(({ pos, ...c }) => c), uncovered: s.uncovered, total: s.total }; } },
    { name: 'search_plans', description: `Inverse problem: find frequencies (optionally Q, drive point, plate) whose city meets constraints. Metrics: ${Object.entries(METRICS).map(([k, v]) => `${k} (${v.stage}: ${v.doc})`).join('; ')}. Deterministic for a seed; budget = cities built.`,
      input_schema: { type: 'object', properties: { base: profileSchema, vary: { type: 'object', properties: { frequency: { anyOf: [{ type: 'boolean' }, { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }], description: 'true (the plate\'s whole range, the default) or [lo, hi] Hz' }, Q: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, driveOffset: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, plate: { type: 'array', items: { type: 'string', enum: ['circle', 'square', 'sphere'] } } } }, constraints: { type: 'array', items: constraint }, objective: { type: 'object', properties: { metric: { type: 'string', enum: Object.keys(METRICS) }, dir: { type: 'string', enum: ['min', 'max'] } } }, budget: { type: 'integer' }, top: { type: 'integer' }, seed: { type: 'integer' } }, required: ['constraints'] },
      run: (spec) => search(spec) },
  ];
}

export { toJSON };
