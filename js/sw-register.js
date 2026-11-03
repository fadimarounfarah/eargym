/* Registers the service worker (sw.js) so the app installs and works offline.
 *
 * Only over https or on localhost: service workers are not allowed on file://
 * or plain http, and the app must still open by double-clicking index.html.
 * A failed registration is ignored; the app simply runs online-only.
 *
 * Defines no global.
 */
(function () {
  'use strict';

  if (!('serviceWorker' in navigator)) return;
  var loc = window.location;
  var local = loc.hostname === 'localhost' || loc.hostname === '127.0.0.1' || loc.hostname === '[::1]';
  if (loc.protocol !== 'https:' && !(loc.protocol === 'http:' && local)) return;

  window.addEventListener('load', function () {
    try {
      // updateViaCache 'none': update checks always ask the server for sw.js
      // and the scripts it imports, never the HTTP cache.
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(function () {});
    } catch (e) {
      // Ignore: offline support is optional.
    }
  });
})();
