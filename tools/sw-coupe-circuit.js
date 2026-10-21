// Service worker « coupe-circuit » — à n'utiliser qu'en cas d'incident (voir SECURITY.md).
// Publié à la place d'un service worker compromis (MÊME chemin), il efface tous les caches,
// se désinstalle et recharge les pages ouvertes : les appareils repartent de la version saine.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) await caches.delete(k);
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
  })());
});
