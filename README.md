# Ear Gym

An ear-training web app: name single notes, chords (root and type) and intervals. Plain HTML, CSS and JavaScript, with no build step. Your practice history stays in your browser.

Open `index.html` by double-clicking it, or use the hosted copy at `https://fadimarounfarah.github.io/eargym/`.

## Install on your phone

Open `https://fadimarounfarah.github.io/eargym/` on your phone once while online, so the app and its piano and guitar samples can download. Then:

- **Android (Chrome):** tap the **⋮** menu, then **Install app** (or **Add to Home screen**).
- **iPhone / iPad (Safari):** tap **Share**, then **Add to Home Screen**.

Ear Gym then opens from its own icon, full screen, and works offline, piano and guitar samples included. Updates arrive the next time you open it online; close and reopen it to switch to the new version.

Your history lives in that browser's storage on that device. Use **Stats → Export** to back it up or move it to another device.

## Opening from disk

Double-clicking `index.html` still works, but it does not install or work offline. The piano and guitar samples are then fetched from the internet. Without internet, the app falls back to a built-in synth.

## Credits

Tone.js (MIT), the Salamander Grand Piano samples by Alexander Holm (CC BY 3.0) and the University of Iowa acoustic guitar samples as published in nbrosowsky/tonejs-instruments (CC BY 3.0) are bundled in `vendor/`. See `vendor/README.md`.
