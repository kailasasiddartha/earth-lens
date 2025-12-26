const CACHE_NAME = 'earthlens-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/css/style.css',
  '/js/app.js',
  '/js/dashboard.js',
  '/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(resp => resp || fetch(e.request)));
});

self.addEventListener('sync', e => {
  if (e.tag === 'upload-queue') {
    e.waitUntil(uploadQueuedSubmissions());
  }
});

async function uploadQueuedSubmissions() {
  const db = await indexedDB.databases().then(dbs => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('earthlens-queue');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });

  const tx = db.transaction('submissions', 'readwrite');
  const store = tx.objectStore('submissions');
  const all = await store.getAll();

  for (const submission of all) {
    // In SW, we can't directly call Cloud Functions with auth.
    // Instead, wake the client to handle it.
    self.clients.matchAll().then(clients => {
      clients.forEach(client => client.postMessage({ type: 'SYNC_SUBMISSION', submission }));
    });
    await store.delete(submission.id); // optimistic
  }
}
