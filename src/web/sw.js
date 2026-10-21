/* To do list — service worker : l'application fonctionne hors ligne, et les rappels arrivent
   en notification même application fermée. Le texte des rappels arrive chiffré et n'est déchiffré
   que sur l'appareil, avec la clé gardée localement. */
const VERSION = '{{VERSION}}+{{BUILD}}';
const CACHE = `todo-${VERSION}`;
const ASSETS = ['./', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png', './icons/badge-96.png', './jsqr.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
  // Pas de skipWaiting automatique : une nouvelle version s'installe en attente
  // et s'applique à la prochaine ouverture, ou tout de suite si l'utilisateur le demande.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('todo-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
  if (event.data === 'version' && event.source) event.source.postMessage({ version: VERSION });
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // L'application elle-même : toujours depuis le cache (instantané, et indépendant du réseau de l'entreprise).
    event.respondWith(caches.match('./', { cacheName: CACHE }).then((r) => r || fetch(req)));
    return;
  }
  event.respondWith(caches.match(req, { ignoreSearch: true, cacheName: CACHE }).then((r) => r || fetch(req)));
});

/* ---------- Rappels reçus du serveur ---------- */
function readKey() {
  return new Promise((resolve) => {
    let r;
    try { r = indexedDB.open('odj', 1); } catch (e) { resolve(null); return; }
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onerror = () => resolve(null);
    r.onsuccess = () => {
      try {
        const tx = r.result.transaction('kv', 'readonly');
        const g = tx.objectStore('kv').get('cryptoKey');
        g.onsuccess = () => resolve(g.result || null);
        g.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    };
  });
}
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function decrypt(key, text, aad) {
  const [v, iv, ct] = String(text).split('.');
  if (v !== 'v1') throw new Error('format');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(iv), additionalData: new TextEncoder().encode(aad) }, key, b64d(ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
    let title = 'Rappel', body = 'Ouvrez To do list pour voir la tâche.';
    try {
      const key = await readKey();
      if (key && data.c && data.t) {
        const p = await decrypt(key, data.c, `rem:${data.t}`);
        title = p.title || title;
        body = p.body || '';
      }
    } catch (e) { /* clé absente ou ancienne : notification générique */ }
    // Toujours afficher (exigé par les navigateurs). Même étiquette que les rappels affichés par
    // l'application ouverte : la notification remplace l'autre au lieu de faire doublon.
    await self.registration.showNotification(title, {
      body,
      tag: `odj-${data.t || 'rappel'}`,
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-96.png',
      timestamp: data.at || Date.now(),
      data: { t: data.t || null },
    });
    for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) c.postMessage({ type: 'push', t: data.t });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const t = (event.notification.data && event.notification.data.t) || '';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).pathname.startsWith(new URL(self.registration.scope).pathname)) {
        c.postMessage({ type: 'open', t });
        return c.focus();
      }
    }
    return self.clients.openWindow(new URL(t ? `./?tache=${encodeURIComponent(t)}` : './', self.registration.scope).href);
  })());
});
