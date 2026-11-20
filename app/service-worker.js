const assets = __PRECACHE__;
const version = __CACHE_VERSION__;
const scope = self.registration.scope;
const prefix = `dwv-pwa-${ encodeURIComponent(scope) }-`;
const cacheName = prefix + version;
const assetURLs = assets.map((asset) => new URL(asset, scope).href);
const indexURL = new URL('index.html', scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName)
    .then((cache) => cache.addAll(assetURLs)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((names) => Promise.all(
    names.filter((name) => name.startsWith(prefix) && name !== cacheName)
      .map((name) => caches.delete(name))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || request.headers.has('Authorization') ||
    request.headers.has('Range')) {
    return;
  }
  const root = new URL(scope);
  const isAppNavigation = request.mode === 'navigate' &&
    url.origin === root.origin &&
    (url.pathname === root.pathname ||
      url.pathname === new URL(indexURL).pathname);
  const isAsset = url.search === '' && assetURLs.includes(url.href);
  if (!isAppNavigation && !isAsset) {
    return;
  }
  const key = isAppNavigation ? indexURL : url.href;
  event.respondWith(caches.open(cacheName).then(async (cache) => {
    const cached = await cache.match(key);
    return cached || fetch(request);
  }));
});
/* global __PRECACHE__, __CACHE_VERSION__ */
