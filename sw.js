// Service worker: guarda os ficheiros da app para funcionar sem internet.
// NAO toca nos teus dados — esses vivem no IndexedDB e nunca passam por aqui.
const CACHE = 'roupeiro-v9';
const FICHEIROS = [
  './',
  './index.html',
  './style.css',
  './seguranca.js',
  './perfis.js',
  './nuvem.js',
  './conta.js',
  './app.js',
  './icon.svg',
  './icon-180.png',
  './icon-512.png',
  './manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(FICHEIROS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(chaves => Promise.all(chaves.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Rede primeiro (para apanhares atualizacoes), cache como rede de seguranca.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copia = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copia)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
