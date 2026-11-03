/* Service worker: precaches every file the app needs and serves them
 * cache-first, so Ear Gym works offline after the first visit.
 *
 * BUMP CACHE_VERSION WHENEVER ANY PRECACHED FILE CHANGES (or a file is added
 * or removed). Installed copies only pick up new files when this name changes.
 *
 * All paths are relative to this file, so it works from any subfolder
 * (for example https://<user>.github.io/eargym/).
 *
 * The sample files are not listed here: they come from every instrument
 * registered in js/instruments.js, so a new instrument's samples are
 * precached as soon as it is registered there (still bump CACHE_VERSION).
 */
'use strict';

var CACHE_VERSION = 'eargym-v4';

// Defines Instruments. The version in the URL makes every new CACHE_VERSION
// fetch a fresh copy: without it a new worker could be handed the previous
// instruments.js from the HTTP cache and precache the old sample list.
importScripts('js/instruments.js?v=' + CACHE_VERSION);

var PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'vendor/tone/Tone.js',
  'js/instruments.js',
  'js/data.js',
  'js/guitar.js',
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

// Every instrument's vendored samples: the 20 Salamander piano files and the
// 18 Iowa guitar files.
PRECACHE = PRECACHE.concat(Instruments.localSamplePaths());

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
