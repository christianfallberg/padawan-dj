# Padawan DJ — V6 PWA

A local-first, Rekordbox-inspired two-deck DJ web application built with plain HTML, CSS and JavaScript.

## What is included

- Two playable audio decks
- Large interactive jog wheels
- Click/drag main waveforms and full-track overview waveforms
- Waveform zoom controls
- Hot Cues A–D saved per track
- Beatgrid, tempo, Sync, EQ, channel volume and crossfader
- Drag tracks from Collection directly onto a jog wheel
- MP3 album artwork extraction with generated fallback covers
- Local Collection, playlists and history
- IndexedDB storage for audio files, artwork and track metadata
- PWA installation
- Offline app shell and offline demo tracks
- Storage usage meter
- Persistent-storage request
- Metadata/playlist/Hot Cue JSON export
- Firebase Hosting configuration

## Run locally

Double-click `start.command`, or run:

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

Port `8080` is only used by the local development server. The deployed app uses the normal HTTPS port on your domain.

## Local storage model

The interface can be hosted online while the music library remains local.

- Audio files, embedded artwork and track metadata are stored in IndexedDB.
- Playlists and history are stored in localStorage.
- Music is not uploaded to the hosting server.
- Storage belongs to the exact origin: protocol + domain + port.

These therefore have separate libraries:

```text
http://localhost:8080
https://dj.example.com
https://www.example.com
```

The library is also separate per browser and browser profile. Clearing site data removes it.

Open **LOCAL** in the top bar to see storage usage and request persistent storage. Persistent storage reduces the chance that the browser evicts app data automatically, although manually clearing site data still removes it.

## Install as a PWA

The **INSTALL APP** button appears in supported browsers after the service worker and manifest are ready. Installation requires HTTPS, except that browsers treat `localhost` as a secure development origin.

After the first successful load, the interface and bundled demo tracks can start offline. Imported music remains available offline because it is stored locally in IndexedDB.

## Deploy to Firebase Hosting

The folder already contains `firebase.json`.

Install and sign in to Firebase CLI if needed:

```bash
npm install -g firebase-tools
firebase login
```

From this folder, connect the intended Firebase project:

```bash
firebase use --add
```

Then deploy:

```bash
firebase deploy --only hosting
```

You can also double-click `deploy-firebase.command` after the project has been selected.

For a custom domain, add it under **Firebase Console → Hosting → Add custom domain**. Keep the final domain stable because changing origin creates a new, empty local browser library.

## Updating the deployed app

Deploy new HTML, CSS and JavaScript to the same domain. Existing IndexedDB and localStorage data normally remain untouched.

When changing cached application assets, increment `CACHE_VERSION` in `service-worker.js`. V6 currently uses:

```js
const CACHE_VERSION = 'padawan-dj-v6.1.0';
```

Users with an older service worker receive an update message and can refresh when convenient.

## Export button

**EXPORT LIBRARY DATA** downloads JSON containing:

- Track metadata
- BPM, key and beatgrid offset
- Hot Cues
- Playlists
- History

It intentionally does not include original audio files or binary album artwork.

## Browser recommendation

Chrome or Edge on desktop gives the most consistent Web Audio, PWA installation and persistent-storage behavior. Safari can run the core app, but browser capabilities and installation behavior differ.
