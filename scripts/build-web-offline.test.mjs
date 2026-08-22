import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { buildWebOffline } from './build-web-offline.mjs';

test('precache is versioned, reload works without the host, and APIs never enter the cache', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recallx-offline-test-'));
  try {
    await writeFile(join(directory, 'index.html'), '<html>app</html>');
    await writeFile(join(directory, 'flashcard.html'), '<html>review</html>');
    await writeFile(join(directory, 'app.js'), 'app');
    await writeFile(join(directory, 'sql-wasm-browser.wasm'), 'wasm');
    const first = await buildWebOffline(directory);
    assert.equal(first.assets.length, 4);
    assert.ok(first.assets.includes('/sql-wasm-browser.wasm'));
    assert.equal((await buildWebOffline(directory)).version, first.version);
    await writeFile(join(directory, 'app.js'), 'updated app');
    assert.notEqual((await buildWebOffline(directory)).version, first.version);
    const handlers = {}; const matches = [];
    vm.runInNewContext(await readFile(join(directory, 'sw.js'), 'utf8'), {
      self: { location: { origin: 'https://example.test' }, addEventListener: (event, handler) => { handlers[event] = handler; } },
      URL, Response, caches: { open: async () => ({ match: async path => { matches.push(path); return path === '/flashcard.html' ? 'cached review shell' : undefined; } }) },
      fetch: async () => { throw new Error('network offline'); },
    });
    const request = (path, extra = {}) => ({ url: `https://example.test${path}`, method: 'GET', mode: 'cors', headers: new Headers(), ...extra });
    let intercepted = false;
    for (const path of ['/sync/snapshot', '/reviews', '/export', '/ingestion/jobs', '/settings', '/items/a/rubrics']) handlers.fetch({ request: request(path), respondWith: () => { intercepted = true; } });
    handlers.fetch({ request: request('/index.html', { headers: new Headers({ Authorization: 'Bearer secret' }) }), respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false);
    let result;
    handlers.fetch({ request: request('/flashcard?fcMode=self-rated', { mode: 'navigate' }), respondWith: response => { result = response; } });
    assert.equal(await result, 'cached review shell'); assert.deepEqual(matches, ['/flashcard.html']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
