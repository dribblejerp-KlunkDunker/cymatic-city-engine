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
    const lat = needs.has('infra') ? new Map(city.infra.laterals.map((l) => [l.building, l])) : null;
    const P = needs.has('people') ? city.people : null;
    return L.buildings.map((b, i) => {
      const r = { index: i, district: b.district, zone: b.zone, era: b.era ?? null, floors: b.floors, h: round(b.h, 2), w: round(b.w, 2), d: round(b.d, 2), amp: round(b.amp, 4), landmark: !!b.landmark, x: round(b.pos[0], 1), z: round(b.pos[2], 1), elevation: round(b.elevation ?? 0, 2) };
      if (lat) { const l = lat.get(i); r.residents = l ? round(l.residents, 2) : 0; r.jobs = l ? round(l.jobs, 2) : 0; r.node = l ? l.node : -1; }
      if (P) { r.landValue = round(P.landValue[i], 4); r.access = r.node >= 0 ? round(P.access[r.node], 4) : 0; r.marketZone = P.emergentZone[i]; }
      if (failed) r.status = failed.lost.has(i) ? 'lost' : failed.degraded.has(i) ? 'degraded' : 'ok';
      return r;
    });
  }
  if (coll === 'streets') {
    const G = city.infra.graph, P = needs.has('people') ? city.people : null;
    return G.edges.map((e, i) => {
      const r = { index: i, kind: e.kind, w: e.w, length: round(e.len, 2), era: e.era ?? null, bridge: !!e.bridge };
      if (P) { const T = P.traffic; r.flow = round(T.edgeFlow[i], 1); r.vc = round(T.vc[i], 4); r.speed = round(T.speedKmh[i], 2); r.lanes = T.lanes[i]; r.lanesNeeded = T.lanesNeeded[i]; }
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
      r.buildings++; r.tallest = Math.max(r.tallest, round(b.h, 2)); r.meanAmp += b.amp; if (b.landmark) r.landmark = i;
      const l = lat?.get(i);
      if (lat && l) { r.residents += l.residents; r.jobs += l.jobs; }
      if (failed) { if (failed.lost.has(i)) { r.lost++; r.lostPeople += l ? l.residents : 0; } else if (failed.degraded.has(i)) r.degraded++; }
    });
    return [...by.values()].sort((a, b) => a.district - b.district).map((r) => ({ ...r, meanAmp: round(r.meanAmp / r.buildings, 4), ...(lat ? { residents: round(r.residents, 1), jobs: round(r.jobs, 1) } : {}), ...(failed ? { lostPeople: round(r.lostPeople, 1) } : {}) }));
  }
  const I = city.infra, xz = (p) => ({ x: round(p[0], 1), z: round(p[2], 1) });
  if (coll === 'towers') return I.water.towers.map((t, i) => ({ index: i, height: round(t.height, 2), served: t.served, storageM3: round(t.storageM3, 1), ...xz(t.pos) }));
  if (coll === 'substations') return I.power.substations.map((s, i) => ({ index: i, loadMVA: round(s.loadMVA, 2), ratingMVA: s.ratingMVA, loading: round(s.loadMVA / s.ratingMVA, 4), ...xz(s.pos) }));
  if (coll === 'stations') return I.transit.stations.map((s, i) => ({ index: i, district: s.district, name: s.name, ...xz(s.pos) }));
  if (coll === 'liftStations') return I.sewer.liftStations.map((s, i) => ({ index: i, flow: round(s.flow, 5), fromDepth: round(s.fromDepth, 2), ...xz(s.pos) }));
  if (coll === 'treatment') return I.sewer.plants.map((p, i) => ({ index: i, flowM3Day: round(p.flowM3Day, 1), served: p.served, ...xz(p.pos) }));
  if (coll === 'pipes') return I.sewer.pipes.map((p, i) => ({ index: i, diameter: p.diameter, slope: round(p.slope, 6), upDepth: round(p.upDepth, 2), downDepth: round(p.downDepth, 2), length: round(p.length, 2), forceMain: !!p.forceMain, flow: round(p.flow, 6) }));
  throw new Error(`Unknown collection "${coll}". Collections: ${COLLECTIONS.join(', ')}`);
}

const OPS = {
  '=': (a, b) => a === b, '!=': (a, b) => a !== b, '>': (a, b) => a > b, '>=': (a, b) => a >= b, '<': (a, b) => a < b, '<=': (a, b) => a <= b,
  in: (a, b) => Array.isArray(b) && b.includes(a),
};
export const QUERY_OPS = Object.keys(OPS);
const AGGS = ['count', 'sum', 'mean', 'min', 'max'];

// Run a structured query. q = { from, where?: [{field, op, value}], fail?: {kind, index}, groupBy?, aggregate?: {name: 'count' | 'sum:field' | ...},
// orderBy?: [{field, dir}], limit?, fields? }. Returns { query, rows, count, total, computed[] }.
export function query(cityLike, q) {
  if (!q || typeof q !== 'object') throw new Error('A query is an object: { from, where, groupBy, aggregate, orderBy, limit }');
  const city = cityOf(cityLike), coll = q.from;
  if (!FIELDS[coll]) throw new Error(`Unknown collection "${coll}". Collections: ${COLLECTIONS.join(', ')}`);
  const where = q.where ?? [], fields = FIELDS[coll];
  const touched = new Set([...where.map((w) => w.field), ...(q.groupBy ? [q.groupBy] : []), ...(q.orderBy ?? []).map((o) => o.field), ...(q.fields ?? [])]);
  const aggregate = q.aggregate ?? null;
  if (aggregate) for (const spec of Object.values(aggregate)) { const [fn, f] = String(spec).split(':'); if (!AGGS.includes(fn)) throw new Error(`Unknown aggregate "${fn}" (${AGGS.join(', ')})`); if (f) touched.add(f); }
  for (const f of touched) if (!(f in fields) && !(aggregate && f in aggregate)) throw new Error(`"${coll}" has no field "${f}". Fields: ${Object.keys(fields).join(', ')}`);
  for (const w of where) if (!OPS[w.op]) throw new Error(`Unknown operator "${w.op}" (${QUERY_OPS.join(' ')})`);
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
    for (const r of rows) { const k = r[q.groupBy]; (groups.get(k) ?? groups.set(k, []).get(k)).push(r); }
    const agg = aggregate ?? { count: 'count' };
    rows = [...groups].map(([k, rs]) => {
      const o = { [q.groupBy]: k };
      for (const [name, spec] of Object.entries(agg)) {
        const [fn, f] = String(spec).split(':'), vals = f ? rs.map((r) => r[f]).filter((v) => typeof v === 'number') : [];
        o[name] = fn === 'count' ? rs.length : fn === 'sum' ? round(vals.reduce((s, v) => s + v, 0), 3) : fn === 'mean' ? round(vals.reduce((s, v) => s + v, 0) / (vals.length || 1), 4) : fn === 'min' ? Math.min(...vals) : Math.max(...vals);
      }
      return o;
    });
  } else if (aggregate) {
    const o = {};
    for (const [name, spec] of Object.entries(aggregate)) {
      const [fn, f] = String(spec).split(':'), vals = f ? rows.map((r) => r[f]).filter((v) => typeof v === 'number') : [];
      o[name] = fn === 'count' ? rows.length : fn === 'sum' ? round(vals.reduce((s, v) => s + v, 0), 3) : fn === 'mean' ? round(vals.reduce((s, v) => s + v, 0) / (vals.length || 1), 4) : vals.length ? (fn === 'min' ? Math.min(...vals) : Math.max(...vals)) : null;
    }
    rows = [o];
  }
  for (const o of [...(q.orderBy ?? [])].reverse()) { const s = o.dir === 'asc' ? 1 : -1; rows = rows.slice().sort((a, b) => (a[o.field] > b[o.field] ? s : a[o.field] < b[o.field] ? -s : 0)); }
  const count = rows.length;
  if (q.limit != null) rows = rows.slice(0, Math.max(0, q.limit | 0));
  if (q.fields && !q.groupBy && !aggregate) rows = rows.map((r) => Object.fromEntries(q.fields.map((f) => [f, r[f]])));
  return { query: q, rows, count, total: all.length, computed: [...needs].filter((n) => n !== 'fail'), ...(failed ? { failure: { kind: q.fail.kind, index: q.fail.index, summary: failed.result.summary, people: failed.result.people } } : {}) };
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
  // candidates: uncovered demand nodes (thinned) far enough from every station and from each other's picks
  const cand = uncovered.filter((_, i) => i % Math.max(1, Math.floor(uncovered.length / 600)) === 0);
  const picks = [], taken = [];
  for (let r = 0; r < k; r++) {
    let best = null;
    for (const c of cand) {
      if (st.some((s) => dist(s.pos, c.P) < minSpacing) || taken.some((t) => dist(t, c.P) < minSpacing)) continue;
      let gain = 0; for (const u of uncovered) if (dist(u.P, c.P) <= R && !taken.some((t) => dist(t, u.P) <= R)) gain += u.w;
      if (!best || gain > best.gain) best = { node: c.n, P: c.P, gain };
    }
    if (!best || best.gain <= 0) break;
    taken.push(best.P);
    let link = null;
    if (st.length) { const { d } = dijkstra(G, st.map((s) => s.node)); link = Number.isFinite(d[best.node]) ? d[best.node] : null; }
    picks.push({ node: best.node, x: round(best.P[0], 1), z: round(best.P[2], 1), pos: best.P, gain: round(best.gain, 1), share: round(best.gain / total, 4), tunnelM: link == null ? null : round(link, 1), perKm: link ? round(best.gain / (link / 1000), 1) : null });
  }
  const p0 = picks[0];
  return {
    what, candidates: picks, uncovered: round(uncoveredTotal, 1), total: round(total, 1),
    text: p0 ? `A station at street node ${p0.node} (${p0.x}, ${p0.z}) would bring ${Math.round(p0.gain).toLocaleString('en-US')} residents and jobs (${(100 * p0.share).toFixed(1)} % of the city) within ${R} m of the metro${p0.tunnelM != null ? `, ${(p0.tunnelM / 1000).toFixed(2)} km of street from the nearest station` : ''}.` : 'No site at the minimum spacing gains anyone.',
  };
}

// ---------------------------------------------------------------- plain-English front end
const ASSET_WORDS = [
  [/^(?:water )?(?:tank|tower|cistern)s?$/, 'tower'], [/^(?:water )?(?:treatment )?(?:water ?)?plant$|^water ?works$/, 'waterplant'], [/^(?:sewage |sewer |wastewater )?treatment(?: plant)?$/, 'treatment'],
  [/^lift(?: station)?|pump(?:ing)? station$/, 'lift'], [/^(?:power )?(?:plant|station)$|^power ?station$/, 'plant'], [/^substation$/, 'substation'], [/^(?:metro |subway )?station$/, 'station'],
];
function assetKind(word) {
  const w = word.trim().toLowerCase();
  if (/metro|subway/.test(w)) return 'station';
  if (/sub ?station/.test(w)) return 'substation';
  if (/lift|pump/.test(w)) return 'lift';
  if (/treatment|sewage|sewer|wastewater/.test(w)) return 'treatment';
  if (/water ?(?:plant|works)/.test(w)) return 'waterplant';
  if (/power/.test(w)) return 'plant';
  for (const [re, k] of ASSET_WORDS) if (re.test(w)) return k;
  return null;
}
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
  const t = String(text ?? '').trim().toLowerCase().replace(/[?.!]+$/, '').replace(/\s+/g, ' ');
  const city = cityOf(cityLike);
  const fmtN = (x) => Math.round(x).toLocaleString('en-US');
  let m;
  // failures by district
  if ((m = t.match(/^(?:which|what) districts? (?:lose|lost|would lose|loses) (?:their |its )?(?:water|power|electricity|sewer|sewage|sewerage|metro|transit)?(?: service)?(?: supply)? (?:if|when) (?:the )?(.+?) (?:no\.? |number |#)?(\d+) (?:fails|failed|goes down|breaks|is lost|goes out)$/))) {
    const kind = assetKind(m[1]), index = +m[2] - 1;
    if (!kind) throw new Error(`I don't know the asset "${m[1]}" (tank, water plant, treatment plant, lift station, power plant, substation, metro station)`);
    const q = { from: 'districts', fail: { kind, index }, where: [{ field: 'lost', op: '>', value: 0 }], orderBy: [{ field: 'lostPeople', dir: 'desc' }], fields: ['district', 'lost', 'lostPeople', 'degraded'] };
    const r = query(city, q);
    const list = r.rows.map((x) => `district ${x.district} (${x.lost} buildings, ${fmtN(x.lostPeople)} people)`);
    return { understood: q, rows: r.rows, failure: r.failure, answer: r.rows.length ? `${r.rows.length} district${r.rows.length === 1 ? '' : 's'} lose service: ${list.slice(0, 6).join(', ')}${list.length > 6 ? ', …' : ''}. ${r.failure.summary}` : `No district loses service outright. ${r.failure.summary}` };
  }
  // counts by height
  if ((m = t.match(/^how many buildings (?:are |have )?(over|above|more than|taller than|higher than|under|below|less than|shorter than|lower than) (\d+(?:\.\d+)?) ?(floors?|storeys?|stories|m|metres?|meters?)(?: tall| high)?$/))) {
    const above = /over|above|more|taller|higher/.test(m[1]), field = /floor|stor/.test(m[3]) ? 'floors' : 'h';
    const q = { from: 'buildings', where: [{ field, op: above ? '>' : '<', value: +m[2] }], aggregate: { count: 'count' } };
    const r = query(city, q);
    return { understood: q, rows: r.rows, answer: `${fmtN(r.rows[0].count)} of ${fmtN(r.total)} buildings are ${above ? 'over' : 'under'} ${m[2]} ${field === 'floors' ? 'floors' : 'm'}.` };
  }
  if ((m = t.match(/^(?:what|which) is the (tallest|highest|shortest|lowest) building$|^(?:the )?(tallest|highest) building$/))) {
    const tall = /tallest|highest/.test(m[1] ?? m[2]);
    const q = { from: 'buildings', orderBy: [{ field: 'h', dir: tall ? 'desc' : 'asc' }], limit: 1, fields: ['index', 'h', 'floors', 'district', 'zone', 'x', 'z'] };
    const r = query(city, q), b = r.rows[0];
    return { understood: q, rows: r.rows, answer: `Building ${b.index}: ${b.h} m, ${b.floors} floors, district ${b.district} (${b.zone}).` };
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
    return { understood: q, rows: r.rows, answer: `${fmtN(r.rows[0].count)} ${m[1]}.` };
  }
  if ((m = t.match(/^(?:what|which) is the (busiest|most congested|most crowded) (?:street|road)$|^(?:the )?(busiest|most congested) (?:street|road)$/))) {
    const q = { from: 'streets', where: [{ field: 'kind', op: 'in', value: ['boulevard', 'ring', 'spoke', 'wall'] }], orderBy: [{ field: 'vc', dir: 'desc' }], limit: 1, fields: ['index', 'kind', 'flow', 'vc', 'speed', 'lanes', 'lanesNeeded'] };
    const r = query(city, q), s = r.rows[0];
    return { understood: q, rows: r.rows, answer: `Street edge ${s.index} (${s.kind}): ${fmtN(s.flow)} cars in the peak hour, ${Math.round(100 * s.vc)} % of capacity, ${s.speed.toFixed(0)} km/h on ${s.lanes} lane${s.lanes === 1 ? '' : 's'}.` };
  }
  if (/^where (?:would|should|could) (?:a |an )?(?:new |fourth |third |another |extra |next )?(?:metro |subway )?(?:station|stop|line) (?:pay off|help most|go|be built|do the most good)|^where to (?:put|build) (?:a |the )?(?:new |next )?(?:metro )?station/.test(t)) {
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
  nodalDiameters: { stage: 'physics', label: 'Nodal diameters', doc: 'nodal diameters of the dominant mode (disk: m)' },
  nodalCircles: { stage: 'physics', label: 'Nodal circles', doc: 'nodal circles of the dominant mode, rim included (disk: n)' },
  radialBoulevards: { stage: 'physics', label: 'Radial boulevards', doc: 'boulevards radiating from the centre (disk: 2m)' },
  buildings: { stage: 'plan', label: 'Buildings', doc: 'buildings' },
  population: { stage: 'plan', label: 'Residents', doc: 'residents' },
  jobs: { stage: 'plan', label: 'Jobs', doc: 'jobs' },
  tallest: { stage: 'plan', label: 'Tallest (m)', doc: 'tallest building (m)' },
  streetKm: { stage: 'plan', label: 'Streets (km)', doc: 'street length (km)' },
  districts: { stage: 'plan', label: 'Districts', doc: 'districts' },
  greenShare: { stage: 'plan', label: 'Green share', doc: 'share of lots left green' },
  densityPerHa: { stage: 'plan', label: 'Residents / ha', doc: 'residents per hectare' },
  centralPlaza: { stage: 'plan', label: 'Central plaza', doc: 'no building near the plate centre (plane plates)' },
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
  const constraints = (spec.constraints ?? []).map((c) => { if (!METRICS[c.metric]) throw new Error(`Unknown metric "${c.metric}". Metrics: ${Object.keys(METRICS).join(', ')}`); violation(1, c); return c; });
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
      if (stage === 'plan') { try { city = cityOf(generateCity(cand.profile)); } catch (e) { return { ...cand, error: String(e.message), feasible: false, violation: Infinity, metrics }; } Object.assign(metrics, planOf(city.layout)); }
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
    const f = Math.min(fhi, Math.max(flo, p.frequency * (1 + (rng() - 0.5) * 0.06)));
    const Q = vary.Q ? Math.min(vary.Q[1], Math.max(vary.Q[0], p.Q * Math.pow(1.5, rng() * 2 - 1))) : p.Q;
    const prof = { ...p, frequency: round(f, 2), Q: round(Q, 2) };
    const phys = physicsOf(resolvedProfile(prof));
    if (byStage('physics').some((c) => violation(phys[c.metric], c) > 0)) continue;
    evaluate({ profile: prof, physics: phys, dominant: phys.dominant });
  }
  const feasible = tried.filter((t) => t.feasible).sort((a, b) => score(a) - score(b) || a.profile.frequency - b.profile.frequency);
  const misses = tried.filter((t) => !t.feasible).sort((a, b) => a.violation - b.violation);
  return { candidates: distinctFirst(feasible, top).map(clean), nearMisses: distinctFirst(misses, 3).map(clean), evaluated: tried.length, scanned, budget, patterns: new Set(feasible.map(patternOf)).size, text: summaryText(feasible.length, tried.length, scanned, new Set(feasible.map(patternOf)).size) };
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
  const constraint = { type: 'object', properties: { metric: { type: 'string', enum: Object.keys(METRICS) }, op: { type: 'string', enum: ['=', '!=', '>', '>=', '<', '<=', 'between'] }, value: {}, value2: { type: 'number' } }, required: ['metric', 'op', 'value'] };
  return [
    { name: 'generate_city', description: `Generate a city (Cymatic City Engine ${ENGINE_VERSION}) from a profile and make it the current city. Returns its headline stats and failing checks.`,
      input_schema: { type: 'object', properties: { profile: profileSchema }, required: ['profile'] },
      run: ({ profile }, state) => { state.city = cityOf(generateCity(profile)); const L = state.city.layout; return { meta: { frequency: L.meta.frequency, chord: L.meta.chord?.map((v) => v.hz) ?? null, plate: L.meta.plate, preset: L.meta.preset, dominant: L.meta.dominant }, stats: planOf(L), failingChecks: L.checks.filter((c) => c.status === 'fail').map((c) => c.id) }; } },
    { name: 'query_city', description: `Structured query over the current city. Collections and fields: ${COLLECTIONS.map((c) => `${c}(${Object.keys(FIELDS[c]).join(',')})`).join('; ')}. Operators: ${QUERY_OPS.join(' ')}. Aggregates: count, sum:f, mean:f, min:f, max:f. \`fail: {kind, index}\` (0-based) adds per-building status and per-district losses.`,
      input_schema: { type: 'object', properties: { from: { type: 'string', enum: COLLECTIONS }, where: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, op: { type: 'string', enum: QUERY_OPS }, value: {} }, required: ['field', 'op', 'value'] } }, fail: { type: 'object', properties: { kind: { type: 'string' }, index: { type: 'integer' } } }, groupBy: { type: 'string' }, aggregate: { type: 'object', additionalProperties: { type: 'string' } }, orderBy: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, dir: { type: 'string', enum: ['asc', 'desc'] } } } }, limit: { type: 'integer' }, fields: { type: 'array', items: { type: 'string' } } }, required: ['from'] },
      run: (q, state) => { if (!state.city) throw new Error('Generate a city first'); const r = query(state.city, q); return { rows: r.rows.slice(0, 200), count: r.count, total: r.total, failure: r.failure ?? null }; } },
    { name: 'ask_city', description: `Ask the current city a question in plain English (template parser). Examples: ${ASK_EXAMPLES.join(' | ')}`,
      input_schema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
      run: ({ question }, state) => { if (!state.city) throw new Error('Generate a city first'); const r = ask(state.city, question); return { answer: r.answer, understood: r.understood, rows: (r.rows ?? []).slice(0, 50) }; } },
    { name: 'suggest_metro_station', description: 'Where a new metro station would bring the most residents and jobs within 1.2 km of the metro, at the minimum spacing, with the street length to the nearest station.',
      input_schema: { type: 'object', properties: { top: { type: 'integer' } } },
      run: ({ top }, state) => { if (!state.city) throw new Error('Generate a city first'); const s = suggest(state.city, 'metro-station', { top }); return { text: s.text, candidates: s.candidates.map(({ pos, ...c }) => c), uncovered: s.uncovered, total: s.total }; } },
    { name: 'search_plans', description: `Inverse problem: find frequencies (optionally Q, drive point, plate) whose city meets constraints. Metrics: ${Object.entries(METRICS).map(([k, v]) => `${k} (${v.stage}: ${v.doc})`).join('; ')}. Deterministic for a seed; budget = cities built.`,
      input_schema: { type: 'object', properties: { base: profileSchema, vary: { type: 'object', properties: { frequency: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, Q: { type: 'array', items: { type: 'number' } }, driveOffset: { type: 'array', items: { type: 'number' } }, plate: { type: 'array', items: { type: 'string', enum: ['circle', 'square', 'sphere'] } } } }, constraints: { type: 'array', items: constraint }, objective: { type: 'object', properties: { metric: { type: 'string', enum: Object.keys(METRICS) }, dir: { type: 'string', enum: ['min', 'max'] } } }, budget: { type: 'integer' }, top: { type: 'integer' }, seed: { type: 'integer' } }, required: ['constraints'] },
      run: (spec) => search(spec) },
  ];
}

export { toJSON };
