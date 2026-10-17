// Inlines the engine into the viewer: once as text (for the Web Worker) and once as module code.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const engine = readFileSync(new URL('./src/cymatic-engine.js', import.meta.url), 'utf8');
const infra = readFileSync(new URL('./src/infrastructure.js', import.meta.url), 'utf8');
const viewer = readFileSync(new URL('./src/viewer.html', import.meta.url), 'utf8');
if (/<\/script/i.test(engine + infra + readFileSync(new URL('./src/simulation.js', import.meta.url), 'utf8') + readFileSync(new URL('./src/people.js', import.meta.url), 'utf8'))) throw new Error('sources must not contain a closing script tag');
// The infrastructure module shares helper names with the engine, so it is wrapped in its own scope.
const INFRA_EXPORTS = ['buildInfrastructure', 'buildStreetGraph', 'infraToOBJ', 'underground', 'foundationDepth', 'sewerMinSlope', 'dijkstra', 'SEWER', 'WATER', 'POWER', 'TRANSIT', 'UTILIDOR'];
const combined = engine.replace(/^export /gm, '') + '\n' +
  `const { ${INFRA_EXPORTS.join(', ')} } = (() => {\n` +
  infra.replace(/^import .*$/gm, '').replace(/^export /gm, '') +
  `\nreturn { ${INFRA_EXPORTS.join(', ')} };\n})();\n`;
const sim = readFileSync(new URL('./src/simulation.js', import.meta.url), 'utf8');
const SIM_EXPORTS = ['simulate', 'flows', 'impact', 'resilience', 'cityStats', 'PROFILES', 'PEAK_HOUR', 'GROWTH', 'LIFETIMES', 'hazenWilliams', 'voltageDrop', 'partialFlowDepth', 'cableFor'];
const combinedAll = combined + '\n' +
  `const { ${SIM_EXPORTS.join(', ')} } = (() => {\n` +
  sim.replace(/^import .*$/gm, '').replace(/^export /gm, '') +
  `\nreturn { ${SIM_EXPORTS.join(', ')} };\n})();\n`;
const ppl = readFileSync(new URL('./src/people.js', import.meta.url), 'utf8');
const PEOPLE_EXPORTS = ['people', 'TRAFFIC', 'LAND', 'laneCount', 'edgeCapacity', 'freeFlowMinutes', 'bprMinutes'];
const combinedAll2 = combinedAll + '\n' +
  `const { ${PEOPLE_EXPORTS.join(', ')} } = (() => {\n` +
  ppl.replace(/^import .*$/gm, '').replace(/^export /gm, '') +
  `\nreturn { ${PEOPLE_EXPORTS.join(', ')} };\n})();\n`;
const out = viewer
  .replace('@@ENGINE_TEXT@@', () => combinedAll2)
  .replace('/*@@ENGINE@@*/', () => combinedAll2);
mkdirSync(new URL('./dist/', import.meta.url), { recursive: true });
// artifact page (the host adds doctype, charset and viewport) and a standalone copy that opens anywhere
writeFileSync(new URL('./dist/cymatic-city.html', import.meta.url), out);
const standalone = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body style="margin:0">${out}</body></html>`;
writeFileSync(new URL('./dist/cymatic-city-standalone.html', import.meta.url), standalone);
console.log(`dist/cymatic-city.html ${(out.length / 1024).toFixed(1)} KB (+ standalone copy)`);
