/* Service worker: precaches every file the app needs and serves them
 * cache-first, so Ear Gym works offline after the first visit.
 *
 * BUMP CACHE_VERSION WHENEVER ANY PRECACHED FILE CHANGES (or a file is added
 * or removed). Installed copies only pick up new files when this name changes.
 *
 * All paths are relative to this file, so it works from any subfolder
 * (for example https://<user>.github.io/eargym/).
 */
'use strict';

var CACHE_VERSION = 'eargym-v2';

var PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'vendor/tone/Tone.js',
  'js/data.js',
  'js/audio.js',
  'js/storage.js',
  'js/keyboard.js',
  'js/game.js',
  'js/setup.js',
  'js/learn.js',
  'js/stats.js',
  'js/app.js',
  'js/sw-register.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];

// The 20 Salamander samples: C, D#, F# and A in octaves 3 to 7.
['C', 'Ds', 'Fs', 'A'].forEach(function (n) {
  for (var oct = 3; oct <= 7; oct++) PRECACHE.push('vendor/salamander/' + n + oct + '.mp3');
});

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // `reload` skips the HTTP cache so a new version never stores stale files.
      .then(function (cache) {
        return cache.addAll(PRECACHE.map(function (url) { return new Request(url, { cache: 'reload' }); }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (key) {
          if (key !== CACHE_VERSION) return caches.delete(key);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

// Cache first, then the network. Only same-origin GETs are handled; anything
// else goes straight to the network as usual.
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE_VERSION).then(function (cache) {
      // ignoreSearch so "index.html?source=pwa" style URLs still hit the cache.
      return cache.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        return fetch(req).catch(function () {
          // Offline and not cached: fall back to the app shell for page loads.
          if (req.mode === 'navigate') return cache.match('index.html');
          return Response.error();
        });
      });
    })
  );
});
