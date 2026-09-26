const CACHE_NAME = 'bigstore-pro-v21';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './style.css?v=3.5.1',
    './app.js',
    './app.js?v=3.5.2',
    './db.js',
    './db.js?v=2.4',
    './manifest.json',
    './icon-192x192.png',
    './icon-512x512.png',
    './jspdf.umd.min.js',
    './html5-qrcode.min.js',
    'https://cdn.jsdelivr.net/npm/chart.js'
];

// Install Event
self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('Caching app shell');
            return cache.addAll(ASSETS);
        })
    );
});

// Activate Event
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch Event
self.addEventListener('fetch', (event) => {
    // Only handle HTTP/HTTPS requests
    if (!event.request.url.startsWith('http')) return;

    event.respondWith(
        caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(event.request).then((networkResponse) => {
                // Runtime cache successful GET responses for libraries / assets
                if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return networkResponse;
            }).catch(() => {
                // If offline and request is for page navigation, fallback to cached index.html
                if (event.request.mode === 'navigate') {
                    return caches.match('./index.html', { ignoreSearch: true });
                }
            });
        })
    );
});
