import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {describe, test, assert, expect, vi} from 'vitest';

const scope = 'https://viewer.example/dwv/';
const currentCache =
  'dwv-pwa-https%3A%2F%2Fviewer.example%2Fdwv%2F-v2';
const assets = [
  'index.html',
  'viewer.a1b2.js',
  'viewer.c3d4.css',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'jpegbaseline.1234.worker.js',
  'jpegloss.5678.worker.js',
  'jpeg2000.9abc.worker.js',
  'rle.def0.worker.js'
];

/**
 * Convert Cache API inputs to an absolute URL.
 *
 * @param {string|Request} input Cache API input.
 * @returns {string} Absolute URL.
 */
function requestUrl(input) {
  return new URL(typeof input === 'string' ? input : input.url, scope).href;
}

/**
 * Run the emitted classic worker against browser-shaped event/cache doubles.
 * Cache.addAll commits only after every response succeeds, like the browser.
 *
 * @param {object} [options] Worker options.
 * @returns {object} Worker event driver and browser state.
 */
function createWorker(options = {}) {
  const workerScope = options.scope || scope;
  const handlers = new Map();
  const stores = new Map();
  const fetch = vi.fn(async (input) => {
    const url = requestUrl(input);
    if (url === options.failedUrl) {
      return new Response('Unavailable', {status: 503});
    }
    return new Response(`asset:${url}`);
  });
  const caches = {
    open: vi.fn(async (name) => {
      if (!stores.has(name)) {
        stores.set(name, new Map());
      }
      const entries = stores.get(name);
      return {
        addAll: async (inputs) => {
          const additions = await Promise.all(Array.from(inputs,
            async (input) => {
              const response = await fetch(input);
              if (!response.ok) {
                throw new TypeError('Cache.addAll request failed');
              }
              return [requestUrl(input), response.clone()];
            }));
          for (const [url, response] of additions) {
            entries.set(url, response);
          }
        },
        match: async (input) => entries.get(requestUrl(input))?.clone(),
        put: async (input, response) => {
          entries.set(requestUrl(input), response.clone());
        },
        keys: async () => Array.from(entries.keys(), (url) => new Request(url))
      };
    }),
    keys: vi.fn(async () => Array.from(stores.keys())),
    delete: vi.fn(async (name) => stores.delete(name)),
    match: async (input, matchOptions = {}) => {
      const names = matchOptions.cacheName
        ? [matchOptions.cacheName] : Array.from(stores.keys());
      for (const name of names) {
        const response = stores.get(name)?.get(requestUrl(input));
        if (response) {
          return response.clone();
        }
      }
    }
  };
  const self = {
    registration: {scope: workerScope},
    location: new URL('service-worker.js', workerScope),
    clients: {claim: vi.fn(async () => {})},
    skipWaiting: vi.fn(),
    addEventListener: (type, handler) => handlers.set(type, handler)
  };
  const source = readFileSync(
    new URL('../../app/service-worker.js', import.meta.url), 'utf8'
  )
    .replaceAll('__PRECACHE__', JSON.stringify(assets))
    .replaceAll('__CACHE_VERSION__', JSON.stringify('v2'));
  runInNewContext(source, {
    self, caches, fetch, URL, Request, Response, Headers
  }, {filename: 'service-worker.js'});

  return {
    self,
    caches,
    stores,
    fetch,
    dispatch: async (type, eventRequest) => {
      const pending = [];
      let response;
      const respondWith = vi.fn((value) => {
        response = Promise.resolve(value);
      });
      assert.isFunction(handlers.get(type), `${type} handler registered`);
      handlers.get(type)({
        request: eventRequest,
        waitUntil: (promise) => pending.push(promise),
        respondWith
      });
      await Promise.all(pending);
      return {response: await response, respondWith};
    }
  };
}

/**
 * Create a request with the browser navigation mode.
 *
 * @param {string} path URL relative to the application scope.
 * @param {object} [options] Request options.
 * @returns {Request} Browser-shaped request.
 */
function request(path, options = {}) {
  const {navigate, ...init} = options;
  const result = new Request(new URL(path, scope), init);
  if (navigate) {
    Object.defineProperty(result, 'mode', {value: 'navigate'});
  }
  return result;
}

describe('PWA service worker', () => {
  test.each([
    [scope, currentCache, 'https://viewer.example/dwv/index.html'],
    ['https://viewer.example/tools/dwv/',
      'dwv-pwa-https%3A%2F%2Fviewer.example%2Ftools%2Fdwv%2F-v2',
      'https://viewer.example/tools/dwv/index.html']
  ])('install prevents missing assets or root-relative URLs at %s',
    async (workerScope, cacheName, indexUrl) => {
      const worker = createWorker({scope: workerScope});
      await worker.dispatch('install');
      assert.deepEqual(Array.from(worker.stores.keys()), [cacheName]);
      const urls = Array.from(worker.stores.get(cacheName).keys());
      assert.deepEqual(urls, assets.map((asset) =>
        new URL(asset, workerScope).href));
      assert.equal(urls[0], indexUrl);
      assert.equal(worker.fetch.mock.calls.length, assets.length);
    });

  test('install prevents partial precache when a decoder download fails',
    async () => {
      const worker = createWorker({
        failedUrl: 'https://viewer.example/dwv/jpeg2000.9abc.worker.js'
      });
      await expect(worker.dispatch('install'))
        .rejects.toBeInstanceOf(TypeError);
      const entries = Array.from(worker.stores.values(), (cache) =>
        Array.from(cache.keys())).flat();
      assert.deepEqual(entries, []);
      assert.equal(worker.self.clients.claim.mock.calls.length, 0);
      assert.equal(worker.self.skipWaiting.mock.calls.length, 0);
    });

  test('activate prevents deletion of another scope or unrelated caches',
    async () => {
      const worker = createWorker();
      const oldCache =
        'dwv-pwa-https%3A%2F%2Fviewer.example%2Fdwv%2F-v1';
      const otherScope =
        'dwv-pwa-https%3A%2F%2Fviewer.example%2Fdwv%2Fnested%2F-v1';
      const otherApp = 'other-application-v1';
      for (const name of [oldCache, currentCache, otherScope, otherApp]) {
        worker.stores.set(name, new Map());
      }
      await worker.dispatch('activate');
      assert.deepEqual(worker.caches.delete.mock.calls, [[oldCache]]);
      assert.deepEqual(Array.from(worker.stores.keys()),
        [currentCache, otherScope, otherApp]);
      assert.equal(worker.self.clients.claim.mock.calls.length, 1);
    });

  test('lifecycle prevents forced updates while existing clients are open',
    async () => {
      const worker = createWorker();
      await worker.dispatch('install');
      await worker.dispatch('activate');
      assert.equal(worker.self.skipWaiting.mock.calls.length, 0);
    });

  test.each(assets)('fetch prevents offline loss of precached %s',
    async (asset) => {
      const worker = createWorker();
      await worker.dispatch('install');
      worker.fetch.mockRejectedValue(new TypeError('Offline'));
      const result = await worker.dispatch('fetch', request(asset));
      assert.equal(result.respondWith.mock.calls.length, 1);
      assert.equal(await result.response.text(),
        `asset:https://viewer.example/dwv/${asset}`);
      assert.equal(worker.fetch.mock.calls.length, assets.length);
    });

  test.each(['./',
    './?input=private-study',
    'index.html',
    'index.html?input=private-study'])(
    'navigation prevents offline shell loss and query persistence for %s',
    async (path) => {
      const worker = createWorker();
      await worker.dispatch('install');
      worker.fetch.mockRejectedValue(new TypeError('Offline'));
      const result = await worker.dispatch('fetch',
        request(path, {navigate: true}));
      assert.equal(result.respondWith.mock.calls.length, 1);
      assert.equal(await result.response.text(),
        'asset:https://viewer.example/dwv/index.html');
      assert.deepEqual(Array.from(worker.stores.get(currentCache).keys()),
        assets.map((asset) => new URL(asset, scope).href));
      assert.equal(worker.fetch.mock.calls.length, assets.length);
    });

  test.each([
    ['scan', 'studies/patient.dcm', {}],
    ['ZIP', 'studies/patient.zip', {}],
    ['image', 'studies/patient.png', {}],
    ['unknown navigation', 'studies/patient.dcm', {navigate: true}],
    ['unknown route', 'studies/', {navigate: true}],
    ['asset query', 'viewer.a1b2.js?patient=123', {}],
    ['index query without navigation', 'index.html?patient=123', {}],
    ['cross origin', 'https://scans.example/dwv/viewer.a1b2.js', {}],
    ['outside scope', '../viewer.a1b2.js', {}],
    ['similar scope', '../dwv-other/viewer.a1b2.js', {}],
    ['authorization',
      'viewer.a1b2.js',
      {headers: {Authorization: 'Bearer private'}}],
    ['empty authorization',
      'index.html',
      {headers: {Authorization: ''}, navigate: true}],
    ['range', 'viewer.a1b2.js', {headers: {Range: 'bytes=0-99'}}],
    ['navigation range',
      './',
      {headers: {Range: 'bytes=0-99'}, navigate: true}],
    ['POST', 'index.html', {method: 'POST'}],
    ['HEAD', 'viewer.a1b2.js', {method: 'HEAD'}],
    ['DELETE', 'index.html', {method: 'DELETE'}],
    ['blob', 'blob:https://viewer.example/patient', {}]
  ])('fetch prevents interception and persistence of %s',
    async (_label, path, options) => {
      const worker = createWorker();
      await worker.dispatch('install');
      const result = await worker.dispatch('fetch', request(path, options));
      assert.equal(result.respondWith.mock.calls.length, 0);
      assert.isUndefined(result.response);
      assert.equal(worker.fetch.mock.calls.length, assets.length);
      assert.deepEqual(Array.from(worker.stores.get(currentCache).keys()),
        assets.map((asset) => new URL(asset, scope).href));
    });

  test('fetch prevents runtime cache writes on an application asset miss',
    async () => {
      const worker = createWorker();
      await worker.dispatch('install');
      const url = 'https://viewer.example/dwv/viewer.a1b2.js';
      worker.stores.get(currentCache).delete(url);
      worker.fetch.mockResolvedValue(new Response('network response'));
      const result = await worker.dispatch('fetch', request('viewer.a1b2.js'));
      assert.equal(result.respondWith.mock.calls.length, 1);
      assert.equal(await result.response.text(), 'network response');
      assert.equal(worker.fetch.mock.calls.length, assets.length + 1);
      assert.isFalse(worker.stores.get(currentCache).has(url));
    });
});
