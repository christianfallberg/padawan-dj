# Release notes

## 1.2.0 — 2026-11-12

- Add ½× and 2× buttons to the BPM editor (double-click a track's BPM) for tracks detected at half or double tempo. BPM can now be set to two decimals.
- Fix double-click on a library track in Chrome, which did nothing: loading a track and editing its BPM or key by double-click work again. Selecting a row no longer rebuilds the whole table.
- Redraw waveforms, deck times, the jog wheel and the level meter only when they change, and stop looking up page elements on every frame. Idle decks no longer use CPU for drawing.
- Add a Content-Security-Policy that only allows the app's own scripts, styles and workers, plus local blob and data images/audio.
- Detect BPM to within about 0.1 BPM instead of reading up to 2.5 BPM low: the tempo search now refines the beat length over four beats and uses the true analysis rate. Applies to newly imported tracks; saved BPMs are unchanged.
- Add Node tests for filename parsing, BPM detection, Hot Cue normalisation, saved-data validation and the artwork type allowlist.
- Fix the ID3 Node test, which could not run since 1.1.3 because the artwork allowlist sat outside the code it tests.
- Update app, asset URLs and offline cache to 1.2.0.

## 1.1.4 — 2026-11-12

- Start normally when saved playlists or history are corrupt or browser storage is blocked; invalid entries are ignored.
- Show a message when playlists cannot be saved, and no longer report a successfully loaded track as undecodable when its history entry cannot be saved.
- Fully unload both decks when clearing the library, releasing their audio.
- Arrow-key seeking can no longer jump to the start before a track's length is known.
- Number Hot Cue markers 1–4 on the main waveform, matching the pads and the overview.
- Sync no longer fails before a track's length is known, needs a valid BPM on both tracks, and explains when the deck is already the master.
- Save the real length of a USB/folder file that changed since import, and no longer blank the waveform on one deck when the other deck loads the same file.
- Update app, asset URLs and offline cache to 1.1.4.

## 1.1.3 — 2026-11-12

- Release a track's decoded audio when it leaves the decks, so long sessions no longer build up memory. Loading one track on both decks shares a single decode.
- Store the CUE point separately from the beatgrid offset, so setting a cue no longer shifts Sync or the beat lines. Existing tracks keep their current cue.
- Ignore keyboard shortcuts combined with Cmd, Ctrl or Alt (for example Cmd+C no longer sets a cue).
- Enter on a focused button only activates that button and no longer also loads the selected track.
- Accept only JPEG, PNG, WebP and GIF embedded artwork; other types, including SVG, use the generated cover.
- Cache the offline app shell only from successful page loads, never from error or captive-portal pages.
- Update app, asset URLs and offline cache to 1.1.3.

## 1.1.2 — 2026-11-03

- Read only the ID3 tag, not the whole file, when recovering missing artwork during folder rescans.
- Count tracks as skipped, not failed, when their recovered artwork cannot be saved during a rescan.
- Update app, asset URLs and offline cache to 1.1.2.

## 1.1.1 — 2026-11-03

- Read ID3v2.2 artwork (PIC), title, artist, album and key, including MP3 files tagged by Apple Music.
- Recover missing artwork for existing local and linked tracks when loaded into a deck or imported/rescanned again, preserving cues and track identity.
- Respect tag boundaries and skip ID3v2.3/v2.4 extended headers.
- Update app, asset URLs and offline cache to 1.1.1.

## 1.1.0 — 2026-11-03

- Add a choice of direct folder playback or local folder copying, including USB drives and subfolders.
- Persist external file references, show EXTERNAL tracks, and request read access again when needed.
- Skip hidden files and duplicates, preserve cues on rescans, and report import failures accurately.
- Exclude external audio from local storage totals and avoid retaining decoded imports in memory.
- Preserve individual file import and drag-and-drop copying.
- Update app, asset URLs and offline cache to 1.1.0.

## 1.0.4 — 2026-11-02

- Enlarge the desktop toolbar reveal strip to 20px with a wider, brighter grip and hover feedback.
- Keep the 44px touch target and reserve space so the handle does not cover waveforms.
- Update the app, asset URLs and offline cache to 1.0.4.

## 1.0.3 — 2026-11-02

- Allow scrolling when a pinned toolbar leaves insufficient room for the decks and library.
- Fit the mobile toolbar to its wrapped contents, including the Install App button.
- Provide a labelled, 44px toolbar reveal target on touch devices.
- Update the app, asset URLs and offline cache to 1.0.3.

## 1.0.2 — 2026-11-02

### Adaptive performance workspace

- Size jog wheels from each deck’s available width and height without shrinking control labels or button targets.
- Give KEY and MASTER separate columns and consistent spacing.
- Align hot cues, jog wheels, EQ, tempo and transport controls with compact, consistent insets.
- Group mixer controls more closely and align headphone faders with the output level meter.
- Increase the number of visible library rows with denser browsing and a draggable divider.
- Support divider keyboard controls, double-click reset and saved library height.
- Add an auto-hiding toolbar: hover the top edge, tap its reveal strip, or press Alt+T.
- Reveal the toolbar as an overlay, keep it open during keyboard use, and offer a persistent “keep visible” pin.
- Use quieter deck-selection borders and retain narrow-window stacking and library maximize/restore.

### App update

- Update the app, asset URLs and offline cache to 1.0.2.
- Resolve versioned app-shell assets from the active cache so the first offline restart works.

## 1.0.1 — 2026-11-02

### Responsive DJ console

- Remove the fixed 1580 × 1070 minimum workspace so the app can adapt to laptop screens.
- Size the console for the available browser width and height, including Windows display scaling.
- Use more compact jog wheels, EQ/tempo controls and mixer at smaller viewport sizes.
- Keep track information and library text readable while scaling the hardware controls.
- Reserve space for the music library, with independent scrolling for tracks and playlists.
- Stack the decks and mixer in narrow windows; allow page scrolling in very short windows.
- Retain the library maximize/restore controls and expanded hardware controls on large displays.

### App update

- Update the app version, README, asset URLs and offline cache to 1.0.1.

## 1.0.0

- First public release.
