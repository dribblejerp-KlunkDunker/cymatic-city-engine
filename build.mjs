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
// artifact page (the host adds doctype, charset and viewport) and a standalone copy that opens anywhere
writeFileSync(new URL('./dist/cymatic-city.html', import.meta.url), out);
const standalone = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body style="margin:0">${out}</body></html>`;
writeFileSync(new URL('./dist/cymatic-city-standalone.html', import.meta.url), standalone);
console.log(`dist/cymatic-city.html ${(out.length / 1024).toFixed(1)} KB (+ standalone copy)`);
