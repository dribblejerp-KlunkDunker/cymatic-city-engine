// Inlines the engine into the viewer: once as text (for the Web Worker) and once as module code.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const engine = readFileSync(new URL('./src/cymatic-engine.js', import.meta.url), 'utf8');
const viewer = readFileSync(new URL('./src/viewer.html', import.meta.url), 'utf8');
if (/<\/script/i.test(engine)) throw new Error('engine source must not contain a closing script tag');
const stripped = engine.replace(/^export /gm, '');
const out = viewer
  .replace('@@ENGINE_TEXT@@', () => engine)
  .replace('/*@@ENGINE@@*/', () => stripped);
mkdirSync(new URL('./dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('./dist/cymatic-city.html', import.meta.url), out);
console.log(`dist/cymatic-city.html ${(out.length / 1024).toFixed(1)} KB`);
