/* Generated with an exhaustive application asset list. No project files enter this cache. */
const buildId = __BUILD_ID__;
const assetNames = __ASSETS__;
const root = new URL('./', self.location.href);
const prefix = 'rocos-shell:' + root.href + ':';
const cacheName = prefix + buildId;
const assets = assetNames.map(name => new URL(name, root).href);
const allowed = new Set(assets);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    try {
      await cache.addAll(assets.map(url => new Request(url, { cache: 'reload' })));
    } catch (error) {
      await caches.delete(cacheName);
      throw error;
    }
  })());
  // Never skipWaiting: a running editor must retain its matching application code.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(prefix) && name !== cacheName) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const shellNavigation = event.request.mode === 'navigate' &&
    url.origin === root.origin && (url.pathname === root.pathname || url.pathname === root.pathname + 'index.html');
  const key = shellNavigation ? new URL('index.html', root).href : url.href;
  if (!allowed.has(key)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    return (await cache.match(key)) || fetch(event.request);
  })());
});
self.addEventListener('message', event => {
  if (!['CHECK_OFFLINE', 'REPAIR_OFFLINE'].includes(event.data?.type) || !event.ports[0]) return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(cacheName);
      if (event.data.type === 'REPAIR_OFFLINE') {
        const missing = [];
        for (const url of assets) if (!(await cache.match(url))) missing.push(new Request(url, { cache: 'reload' }));
        await cache.addAll(missing);
      }
      const complete = (await Promise.all(assets.map(url => cache.match(url)))).every(Boolean);
      event.ports[0].postMessage({ complete, buildId });
    } catch {
      event.ports[0].postMessage({ complete: false });
    }
  })());
});
