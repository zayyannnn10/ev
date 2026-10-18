/* Phone E.V. offline copy: everything the app needs is kept on the iPhone, so it opens with the laptop
   off. When the laptop is reachable, newer files are fetched in the background for next time. */
const VERSION = '1.0.2610182149';
const CACHE = 'ev-phone-' + VERSION;
const FILES = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/store.js', 'js/gemini.js', 'js/voice.js', 'js/prompt.js', 'js/docs.js', 'js/spotify.js', 'js/tools.js', 'js/agent.js', 'js/live.js', 'js/ui.js',
  'vendor/jspdf.umd.min.js', 'vendor/pptxgen.bundle.js', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('ev-phone-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;   // Gemini, Spotify… go straight out
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = e.request.mode === 'navigate' ? 'index.html' : e.request;
    const hit = await cache.match(key, { ignoreSearch: true });
    const fresh = fetch(e.request).then(r => { if (r.ok && e.request.mode !== 'navigate') cache.put(e.request, r.clone()); return r; }).catch(() => null);
    if (hit) { e.waitUntil(fresh); return hit; }
    return (await fresh) || new Response('Phone E.V. is offline and this file was not saved yet.', { status: 503 });
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(cs => cs.length ? cs[0].focus() : self.clients.openWindow('./')));
});
