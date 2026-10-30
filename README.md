# Padawan DJ — v6.2.54

Two decks. One flow. Padawan DJ is a local-first DJ web application with hands-on mixing, interactive jog wheels, smooth waveforms and a music library that stays on your device. Built with plain HTML, CSS and JavaScript, it runs in your browser and can be installed as a PWA.

## What is included

- Two playable audio decks
- Large interactive jog wheels
- Click/drag main waveforms and full-track overview waveforms
- Smooth, antialiased waveforms with zoom controls and a matching time ruler
- Four illuminated Hot Cue pads (1–4), saved per track
- Beatgrid, tempo, Sync, EQ, channel volume and master volume
- Large hardware-style crossfader with deck-colored rail, center marks and center snapping
- Separate headphone output selection and independent per-deck CUE levels
- Exclusive headphone CUE: selecting one deck turns off the other; click again to disable
- Segmented master level meter
- Drag tracks from Collection directly onto a jog wheel
- MP3 album artwork extraction with generated fallback covers
- Local Collection, playlists and history
- Maximizable music library (MAXIMIZE button or `L`; `Esc` restores) that keeps the waveform strip visible
- IndexedDB storage for audio files, artwork and track metadata
- PWA installation
- Offline app shell and offline demo tracks
- Refreshed deck controls, library, top-bar tools and app branding
- Audio, Local Storage and Help/About dialogs with outside-click dismissal
- Fixed-size About/Shortcuts dialog with scrollable shortcuts
- Fullscreen control where supported
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

For the existing development session on port 8081, run `python3 -m http.server 8081` and open `http://localhost:8081` instead. Keep using the same port to retain access to that origin’s library.

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

Open **LOCAL STORAGE** in the top bar to see storage usage and request persistent storage. Persistent storage reduces the chance that the browser evicts app data automatically, although manually clearing site data still removes it.

## Headphone monitoring

Open **AUDIO** in the top bar to detect and select a separate headphone output. Master audio uses the system default output; select a different device for headphones, then enable headphone monitoring. Device detection may request temporary microphone permission to reveal output names; the app immediately releases the microphone and does not record it.

Use the mixer’s **CUE** buttons to preview one deck at a time. Selecting the other deck switches monitoring to it; clicking the selected CUE again turns monitoring off. Each deck has its own CUE LEVEL, and the Audio dialog controls overall headphone volume.

Separate routing requires two audio outputs and browser support for `setSinkId()`. The app keeps headphone audio muted until a separate output is configured.

## Latest release: 6.2.54

This release adds a maximized music library view: the MAXIMIZE button in the library toolbar (or the `L` key) folds the decks away so the library and playlists fill the screen, while the waveform strip stays visible. `RESTORE`, `L` or `Esc` brings the decks back. The jog wheels get a new deck-coloured vinyl centre with a true-centre spindle, BPM above and pitch below it, and strobe ticks that turn with the platter. It also darkens the top bar and library surfaces and scales the deck controls up on large displays. Existing track data and saved Hot Cues keep their storage format.

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

When changing cached application assets, increment `CACHE_VERSION` in `service-worker.js`. Version 6.2.54 uses:

```js
const CACHE_VERSION = 'padawan-dj-v6.2.54';
```

Keep `APP_VERSION` in `app.js`, asset version query strings in `index.html`, and this README in sync with the release version.

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
