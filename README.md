# Padawan DJ — v1.3.1

Two decks. One flow. Padawan DJ is a local-first DJ web application with hands-on mixing, interactive jog wheels, smooth waveforms and a music library that stays on your device. Built with plain HTML, CSS and JavaScript, it runs in your browser and can be installed as a PWA.

![Padawan DJ: two loaded decks with waveforms, jog wheels, mixer and music library](docs/screenshot.jpg)

Try it on **[GitHub Pages](https://christianfallberg.github.io/padawan-dj/)**.

Padawan DJ is just static files, so you can also host your own copy anywhere: fork this repo and enable GitHub Pages, or upload the files to any web host. See [Host it yourself](#host-it-yourself).

## What is included

- Two playable audio decks
- Large interactive jog wheels
- Click/drag main waveforms and full-track overview waveforms
- Smooth, antialiased waveforms with zoom controls and a matching time ruler
- Four illuminated Hot Cue pads (1–4), saved per track
- Beatgrid, tempo, Sync, EQ, channel volume and master volume
- Channel volume faders, and a large hardware-style crossfader with deck-colored rail, center marks and center snapping
- Separate headphone output selection and independent per-deck CUE levels (LEVEL knobs in the mixer, also in AUDIO)
- Exclusive headphone CUE: selecting one deck turns off the other; click again to disable
- Segmented master level meter
- Drag tracks from Collection directly onto a jog wheel
- MP3 album artwork extraction with generated fallback covers
- Local Collection, playlists and history: add tracks from a row menu or by dragging, remove, reorder and rename playlists, and undo removals
- Keyboard control: browse the library with the arrow keys, load to either deck, per-deck play, cue and Hot Cue keys
- Maximizable music library (MAXIMIZE button or `L`; `Esc` restores) that keeps the waveform strip visible
- IndexedDB storage for audio files, artwork and track metadata
- PWA installation
- Offline app shell
- Refreshed deck controls, library, top-bar tools and app branding
- Audio, Local Storage and Help/About dialogs with outside-click dismissal
- Fixed-size About/Shortcuts dialog with scrollable shortcuts
- Fullscreen control where supported
- Storage usage meter
- Persistent-storage request
- Metadata/playlist/Hot Cue JSON export
- No build step and no backend: static files that can be hosted anywhere

## Run locally

Double-click `start.command`, or run:

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

Any static file server works, for example `npx serve .`. Opening `index.html` directly from disk (`file://`) is not supported, because service workers and some storage APIs need an HTTP origin.

Keep using the same port: the browser stores the library per origin, so `localhost:8080` and `localhost:8081` have separate libraries.

## Local storage model

The interface can be hosted online while the music library remains local.

- Imported audio copies, embedded artwork, track metadata and external file references are stored in IndexedDB.
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

## Music folders and USB drives

Open **ADD TRACKS** and choose how to add your music:

- **PLAY FROM FOLDER** links a folder, including its subfolders, on your computer or USB drive. Tracks marked **EXTERNAL** need the drive connected. Only file references, metadata, artwork and cues are stored in the browser; audio is read from the drive when loading a deck.
- **COPY FOLDER** imports audio into browser storage, so it remains available after disconnecting the drive.
- **CHOOSE FILES** imports individual files as before. Dropped files are also copied.

Direct folder access requires a browser with `showDirectoryPicker` (desktop Chrome or Edge), on HTTPS or localhost. Other browsers can copy folders instead. After reopening the app, loading an external track may ask for read permission again. Reconnect the drive and select the same folder with **PLAY FROM FOLDER** to rescan. Unchanged tracks are skipped, preserving cues and playlist assignments. Hidden files and macOS resource-fork files are ignored. Unsupported or unreadable audio files are counted as failures without stopping the rest of the import.

Removing tracks or clearing the library only removes app data, never files on the drive. External audio is excluded from the local library size. The app never writes to your selected music folder.

## Headphone monitoring

Open **AUDIO** in the top bar to detect and select a separate headphone output. Master audio uses the system default output; select a different device for headphones, then enable headphone monitoring. Device detection may request temporary microphone permission to reveal output names; the app immediately releases the microphone and does not record it.

Use the mixer’s **CUE** buttons to preview one deck at a time. Selecting the other deck switches monitoring to it; clicking the selected CUE again turns monitoring off. Each deck’s CUE level is set with the LEVEL knob under its CUE button (also in the Audio dialog), and the overall headphone volume is in the Audio dialog; the mixer’s vertical faders control each deck’s volume in the master mix.

Separate routing requires two audio outputs and browser support for `setSinkId()`. The app keeps headphone audio muted until a separate output is configured.

## Latest release: 1.3.1

See [release notes](CHANGELOG.md) for the version history.

- **Headphone levels back in the mixer:** a LEVEL knob under each mixer CUE button sets that deck’s headphone level. It stays in sync with the sliders in AUDIO.

Also new in 1.3.0:

- **Mixer:** the two vertical faders now set each deck’s volume in the master mix.
- **First run:** an empty library shows ADD MUSIC, and the toolbar stays visible until the first track is imported.
- **Playlists:** add a track from the playlist button at the end of its row, remove it from a playlist without deleting it, drag rows to reorder and double-click a playlist to rename it.
- **Undo:** removing a track, a playlist entry or a Hot Cue shows UNDO (or press Ctrl/Cmd+Z).
- **Keyboard:** ↑/↓ browse the library, Shift+←/→ load to Deck 1/2, Q W E R and U I O P trigger Hot Cues, Z/X and N/M cue and play each deck, `/` jumps to search.
- **Decks:** taller mixing waveforms on tall screens, a cleaner platter centre, SYNC lights when tempos match, and larger labels.

The layout adapts to the browser viewport, including Windows display scaling. Narrow or very short windows allow scrolling. Large displays keep expanded controls, and the library can still be maximized with `L`.

## Install as a PWA

The **INSTALL APP** button appears in supported browsers after the service worker and manifest are ready. Installation requires HTTPS, except that browsers treat `localhost` as a secure development origin.

After the first successful load, the interface can start offline. Imported music remains available offline because it is stored locally in IndexedDB. Linked external music also needs its drive connected and read access granted.

## Host it yourself

Padawan DJ is a static site. There is no build step, no server-side code and no database on the server, so it runs on any web host that serves files: shared hosting (FTP or a control-panel file manager), GitHub Pages, Netlify, Cloudflare Pages, Vercel, Firebase Hosting, an S3 bucket, nginx, Apache and so on.

**Quickest: GitHub Pages.** Fork this repository, then open **Settings → Pages**, choose **Deploy from a branch**, select `main` and `/ (root)`, and save. After a minute your copy is live at `https://<your-username>.github.io/padawan-dj/`, over HTTPS, and every push to `main` updates it.

**Any other host:**

1. Upload the contents of this folder to your web root (or a subfolder):

   ```text
   index.html
   app.js
   styles.css
   service-worker.js
   manifest.webmanifest
   icons/
   ```

   On Apache hosts (including GoDaddy shared hosting), also upload `.htaccess`; see below. `README.md`, `docs/`, `tests/`, `start.command` and other dotfiles are not needed on the server.

2. Serve the site over **HTTPS**. Service workers, PWA installation, persistent storage and headphone output selection (`setSinkId()`) only work in a secure context. Most hosts provide free certificates.

3. Open the URL. The app uses relative paths, so it works both at a domain root and in a subfolder (for example `https://example.com/dj/`).

Optional server settings:

- Serve `.webmanifest` as `application/manifest+json` if your server doesn't already.
- Avoid long cache lifetimes on `service-worker.js` so browsers notice updates quickly. Other assets are versioned with `?v=` query strings and can be cached.
- `index.html` already sets a Content-Security-Policy in a `<meta>` tag. To also stop other sites from framing the app, send the policy as an HTTP header with `frame-ancestors 'none'` added; that directive only works as a header. On Apache, the included `.htaccess` does this (it needs `mod_headers`, which most hosts enable). On other hosts, copy the policy from `.htaccess` into the host's header settings. Keep the header and the `<meta>` tag in sync: browsers enforce both.

Keep the final domain stable: each origin (protocol + domain + port) has its own local library, so moving the app to a new address starts users with an empty library.

## Updating the deployed app

Upload the new HTML, CSS and JavaScript to the same address, replacing the old files. Existing IndexedDB and localStorage data normally remain untouched.

When changing cached application assets, increment `CACHE_VERSION` in `service-worker.js`. Version 1.3.1 uses:

```js
const CACHE_VERSION = 'padawan-dj-v1.3.1';
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

## Layout regression check

The app still requires no build step. Its optional browser check uses Playwright as a development tool:

```bash
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node tests/workspace.cjs
```

The check imports generated test audio, loads both decks and verifies 18 viewport sizes, toolbar hover/touch/keyboard access and pin persistence, library divider drag/keyboard/reset/persistence, maximize/restore, playback, dialogs and the first offline PWA restart. It uses a temporary local server and a separate browser profile. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select an existing Chromium executable.

## License

Padawan DJ is released under the [MIT License](LICENSE).

The folder-library integration check runs with the same Playwright setup:

```bash
node tests/music-library.cjs
```

It tests nested folders, saved file handles, duplicates, cues, playback after reload, missing files, denied access, independent local copies and storage failures. Its native folder picker is simulated using browser test files and real serializable file handles. Set `MUSIC_TEST_USB=/Volumes/DJ-2027` to read two MP3s from that drive as test audio; the test never modifies the drive. Native folder selection and permission prompts still need a manual browser check.

`library-ux.cjs` checks the first-run empty state, channel volume faders, the playlist menu, removing, reordering and renaming playlist entries, undo, keyboard browsing and per-deck keys:

```bash
node tests/library-ux.cjs
```

The pure functions also have Node checks that need no browser or Playwright:

```bash
node tests/id3.cjs
node tests/analysis.cjs
```

`id3.cjs` covers ID3 tag and artwork parsing, including the artwork type allowlist; `analysis.cjs` covers filename parsing, BPM detection, Hot Cue normalisation and validation of saved playlists and history.

Two further browser checks use the Playwright setup:

```bash
node tests/deck-behavior.cjs
node tests/offline-shell.cjs
```

`deck-behavior.cjs` checks that decoded audio is released when a track leaves the decks, that the CUE point is stored separately from the beatgrid, that shortcuts with Cmd/Ctrl/Alt and Enter on focused buttons are ignored, that only raster artwork types are accepted, and that the app starts with corrupt or blocked localStorage. It also covers Hot Cue labels, Sync and arrow seeking before a track's length is known, changed external files clearing the library, double-click loading, the BPM ½×/2× editor, idle redraw skipping and the Content-Security-Policy. `offline-shell.cjs` checks that a server error page never replaces the cached app for offline startup.
