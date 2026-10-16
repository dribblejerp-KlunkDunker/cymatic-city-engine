import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipStore, crc32, fieldPreview, generateCity } from '../src/cymatic-engine.js';

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
});

test('zipStore writes an archive that Python zipfile validates and reads back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  const path = join(dir, 'a.zip');
  writeFileSync(path, zipStore([{ name: 'city.obj', text: 'v 0 0 0\n' }, { name: 'notes/ré.txt', text: 'hé' }]));
  const out = execFileSync('python3', ['-c',
    'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip()); print(z.read("notes/ré.txt").decode())', path]).toString();
  assert.equal(out.trim(), 'None\nhé');
});

test('fieldPreview reproduces the field the city was built from', () => {
  const params = { plate: 'circle', preset: 'town', frequency: 432 };
  const L = generateCity(params), F = fieldPreview(params);
  for (const [u, v] of [[0.1, 0.2], [-0.5, 0.3], [0.7, -0.1]]) {
    assert.ok(Math.abs(L.field.at(u, v).S - F.at(u, v).S) < 1e-12);
  }
});
