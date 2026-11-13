// Library and mixer UX checks (1.3.0): first-run empty state, channel volume faders, playlist
// menu / remove / rename / reorder, undo for removals, keyboard browsing and per-deck keys,
// KEY column visibility and the SYNC tempo-match state.
const { chromium } = require("playwright");
const assert = require("assert/strict"), fs = require("fs"), http = require("http"), path = require("path");
const root = path.resolve(__dirname, "..");
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(req.url.split("?")[0]);
  const file = path.join(root, name === "/" ? "index.html" : name);
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.setHeader("Content-Type", { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png" }[path.extname(file)] || "application/octet-stream");
  res.end(fs.readFileSync(file));
});
function wav(freq) {
  const sr = 22050, n = sr * 6, b = Buffer.alloc(44 + n * 2);
  b.write("RIFF"); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / sr * 2 * Math.PI * freq) * 8000), 44 + i * 2);
  return b;
}
(async () => {
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ["--autoplay-policy=no-user-gesture-required"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => state.db);

  // First run: an empty-library panel with ADD MUSIC that opens the import dialog, and a visible toolbar.
  assert.ok(await page.locator("[data-empty-add]").isVisible(), "empty library offers ADD MUSIC");
  assert.ok(await page.locator("#importButton").evaluate(e => e.getBoundingClientRect().y >= 0), "toolbar visible on first run");
  await page.click("[data-empty-add]");
  assert.equal(await page.evaluate(() => $("#importDialog").open), true, "ADD MUSIC opens the import dialog");
  await page.evaluate(() => $("#importDialog").close());

  await page.setInputFiles("#fileInput", ["Alpha", "Bravo", "Charlie", "Delta"].map((n, i) => ({ name: `Artist ${n} - ${n}.wav`, mimeType: "audio/wav", buffer: wav(220 + i * 55) })));
  await page.waitForFunction(() => state.tracks.length === 4 && !state.importing);
  await page.evaluate(() => { state.sort = { field: "title", direction: "asc" }; renderTable(); });
  const ids = await page.evaluate(() => getVisibleTracks().map(t => t.id));
  const title = (id) => page.evaluate((x) => state.tracks.find(t => t.id === x)?.title, id);

  // KEY column hidden while no track has a key, shown once one does.
  assert.equal(await page.locator('th[data-sort="key"]').isVisible(), false, "KEY column hidden without keys");
  await page.evaluate(([a]) => { state.tracks.find(t => t.id === a).key = "8A"; renderTable(); }, ids);
  assert.equal(await page.locator('th[data-sort="key"]').isVisible(), true, "KEY column shown once a key exists");

  // Channel volume: the vertical fader sets the master-mix gain only; CUE level lives in AUDIO.
  const gains = await page.evaluate(async () => {
    const fader = $("#volumeA"); fader.value = "0.5"; fader.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    return { channel: decks.A.channelGain.gain.value, cue: decks.A.cueLevelGain.gain.value, cueInDialog: !!$("#audioOutputDialog #cueLevelA") };
  });
  assert.ok(Math.abs(gains.channel - 0.9 * 0.25) < 0.01, `channel gain follows the fader (${gains.channel})`);
  assert.ok(Math.abs(gains.cue - 0.9) < 0.01, "CUE level unchanged by the channel fader");
  assert.equal(gains.cueInDialog, true, "per-deck CUE level is in the Audio dialog");

  // Mixer CUE level knob and the AUDIO dialog slider share one value, in both directions.
  const cueSync = await page.evaluate(async () => {
    const knob = $("#cueKnobA"), slider = $("#cueLevelA");
    knob.value = "0.4"; knob.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    const fromKnob = { slider: slider.value, gain: decks.A.cueLevelGain.gain.value, dial: knob.closest(".eq-knob-unit").querySelector(".eq-knob-face").style.getPropertyValue("--dial-angle") };
    slider.value = "0.7"; slider.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    return { fromKnob, knob: knob.value, gain: decks.A.cueLevelGain.gain.value, dial: knob.closest(".eq-knob-unit").querySelector(".eq-knob-face").style.getPropertyValue("--dial-angle"), channel: decks.A.channelGain.gain.value };
  });
  assert.equal(cueSync.fromKnob.slider, "0.4", "knob moves the AUDIO slider");
  assert.ok(Math.abs(cueSync.fromKnob.gain - 0.4) < 0.01, "knob sets the CUE gain");
  assert.equal(cueSync.knob, "0.7", "AUDIO slider moves the knob");
  assert.ok(Math.abs(cueSync.gain - 0.7) < 0.01, "slider sets the CUE gain");
  assert.notEqual(cueSync.dial, cueSync.fromKnob.dial, "knob dial redraws when the slider changes");
  assert.ok(Math.abs(cueSync.channel - 0.9 * 0.25) < 0.01, "CUE level leaves channel volume alone");

  // Playlist menu: add a track to a playlist from its row, then untick it.
  const menuTrigger = `tr[data-id="${ids[1]}"] [data-playlist-menu]`;
  const menuOpen = () => page.evaluate(() => $("#playlistMenu").matches(":popover-open"));
  await page.click(menuTrigger);
  await page.waitForSelector("#playlistMenu:popover-open");
  assert.equal(await page.getAttribute(menuTrigger, "aria-expanded"), "true", "open menu marks its button expanded");
  const placement = await page.evaluate((sel) => {
    const button = document.querySelector(sel).getBoundingClientRect(), menu = $("#playlistMenu").getBoundingClientRect();
    return { rightGap: Math.abs(menu.right - button.right), below: menu.top >= button.bottom - 1, above: menu.bottom <= button.top + 1 };
  }, menuTrigger);
  assert.ok(placement.below || placement.above, "menu sits directly above or below its button");
  assert.ok(placement.rightGap < 12, "menu is right-aligned with its button");
  await page.click("#playlistMenu [role=menuitemcheckbox]:first-child");
  assert.deepEqual(await page.evaluate(() => state.playlists[0].trackIds), [ids[1]], "added via the row menu");
  assert.equal(await page.getAttribute("#playlistMenu [role=menuitemcheckbox]:first-child", "aria-checked"), "true");
  await page.keyboard.press("Escape");
  assert.equal(await menuOpen(), false, "Escape closes the menu");
  assert.equal(await page.getAttribute(menuTrigger, "aria-expanded"), "false", "closing resets aria-expanded");
  assert.equal(await page.evaluate((sel) => document.activeElement === document.querySelector(sel), menuTrigger), true, "Escape returns focus to the button");
  await page.click(menuTrigger);
  await page.waitForSelector("#playlistMenu:popover-open");
  await page.click(menuTrigger);
  assert.equal(await menuOpen(), false, "clicking the open menu's button closes it");
  await page.click(menuTrigger);
  await page.waitForSelector("#playlistMenu:popover-open");
  await page.mouse.click(5, 5);
  assert.equal(await menuOpen(), false, "an outside click closes the menu");
  assert.equal(await page.getAttribute(menuTrigger, "aria-expanded"), "false", "outside click resets aria-expanded");

  // Inside a playlist: remove one entry (the track stays in the library), then UNDO puts it back in place.
  await page.evaluate(([, b, c, d]) => { const p = state.playlists[0]; p.trackIds = [b, c, d]; savePlaylists(); renderPlaylistList(); }, ids);
  await page.click(".playlist-select >> nth=0");
  await page.click(`tr[data-id="${ids[2]}"] [data-remove-from-playlist]`);
  await page.waitForSelector(".toast.show .toast-action");
  assert.deepEqual(await page.evaluate(() => state.playlists[0].trackIds), [ids[1], ids[3]]);
  assert.equal(await page.evaluate(() => state.tracks.length), 4, "removing from a playlist keeps the track");
  await page.click(".toast .toast-action");
  assert.deepEqual(await page.evaluate(() => state.playlists[0].trackIds), [ids[1], ids[2], ids[3]], "UNDO restores the position");

  // Reorder by dragging a row onto another.
  await page.locator(`tr[data-id="${ids[3]}"] .track-title-text`).dragTo(page.locator(`tr[data-id="${ids[1]}"]`), { targetPosition: { x: 40, y: 4 } });
  assert.deepEqual(await page.evaluate(() => state.playlists[0].trackIds), [ids[3], ids[1], ids[2]], "drag reorders the playlist");
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("dualDeckPlaylists"))[0].trackIds), [ids[3], ids[1], ids[2]], "new order saved");

  // Rename by double-clicking the playlist name.
  await page.dblclick(".playlist-select >> nth=0");
  await page.waitForFunction(() => $("#actionDialog").open);
  await page.fill("#actionDialogInput", "Opening Set");
  await page.click("#actionDialogConfirm");
  await page.waitForFunction(() => state.playlists[0].name === "Opening Set");
  assert.equal(await page.textContent("#browserHeading"), "Opening Set");

  // Removing a track that is not loaded happens at once and can be undone with Ctrl/Cmd+Z.
  await page.click('.source-item[data-source="collection"]');
  await page.hover(`tr[data-id="${ids[2]}"]`);
  await page.click(`tr[data-id="${ids[2]}"] [data-remove-track]`);
  assert.equal(await page.evaluate(() => $("#actionDialog").open), false, "no confirmation for an unloaded track");
  assert.equal(await page.evaluate((x) => state.tracks.some(t => t.id === x), ids[2]), false);
  assert.deepEqual(await page.evaluate(() => state.playlists[0].trackIds), [ids[3], ids[1]]);
  await page.waitForSelector(".toast.show .toast-action");
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("Control+z");
  await page.waitForFunction((x) => state.tracks.some(t => t.id === x), ids[2]);
  assert.deepEqual(await page.evaluate(() => state.playlists[0].trackIds), [ids[3], ids[1], ids[2]], "undo restores playlist entries");
  assert.equal(await page.evaluate(async (x) => (await dbGetAll()).some(t => t.id === x), ids[2]), true, "undo restores storage");

  // Keyboard: arrows browse, Shift+←/→ load to a deck, "/" focuses search.
  await page.evaluate(() => { state.selectedTrackId = null; renderTable(); document.activeElement.blur(); });
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown");
  const order = await page.evaluate(() => getVisibleTracks().map(t => t.id));
  assert.equal(await page.evaluate(() => state.selectedTrackId), order[1], "↓ moves the selection");
  assert.equal(await page.evaluate((x) => $(`tr[data-id="${x}"]`).classList.contains("selected"), order[1]), true);
  await page.keyboard.press("Shift+ArrowLeft");
  await page.waitForFunction((x) => decks.A.track?.id === x, order[1]);
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Shift+ArrowRight");
  await page.waitForFunction((x) => decks.B.track?.id === x, order[2]);
  await page.keyboard.press("/");
  assert.equal(await page.evaluate(() => document.activeElement.id), "searchInput", "/ focuses search");
  await page.keyboard.type("charlie");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  assert.equal(await page.inputValue("#searchInput"), "", "Esc clears the search");
  await page.keyboard.press("Escape");
  assert.notEqual(await page.evaluate(() => document.activeElement.id), "searchInput", "second Esc leaves the field");

  // Per-deck keys: Q sets Deck 1 Hot Cue 1, Shift+Q deletes it (with UNDO); X plays Deck 1; M plays Deck 2.
  await page.evaluate(() => { decks.A.audio.currentTime = 2; setSelectedDeck("B"); });
  await page.waitForFunction(() => Math.abs(decks.A.audio.currentTime - 2) < 0.1);
  await page.keyboard.press("q");
  await page.waitForFunction(() => Number.isFinite(decks.A.track.hotCues.A));
  await page.keyboard.press("Shift+Q");
  await page.waitForFunction(() => !Number.isFinite(decks.A.track.hotCues.A));
  await page.waitForSelector(".toast.show .toast-action");
  await page.click(".toast .toast-action");
  await page.waitForFunction(() => Number.isFinite(decks.A.track.hotCues.A));
  await page.keyboard.press("x");
  await page.waitForFunction(() => !decks.A.audio.paused);
  await page.keyboard.press("m");
  await page.waitForFunction(() => !decks.B.audio.paused);
  await page.evaluate(() => { decks.A.pause(); decks.B.pause(); });

  // SYNC lights when both decks run at the same tempo.
  const r = await page.evaluate(() => {
    decks.A.track.bpm = 124; decks.B.track.bpm = 128; decks.A.setTempo(0); decks.B.setTempo(0);
    const before = $("#syncA").classList.contains("is-matched");
    setMasterDeck("B"); decks.A.syncTo(decks.B);
    return { before, after: $("#syncA").classList.contains("is-matched") && $("#syncB").classList.contains("is-matched"), title: $("#syncA").title };
  });
  assert.deepEqual(r, { before: false, after: true, title: "Tempo matches Deck 2" });

  // Removing a loaded track still asks first.
  await page.evaluate(() => { state.source = "collection"; renderTable(); });
  await page.hover(`tr[data-id="${order[1]}"]`);
  await page.click(`tr[data-id="${order[1]}"] [data-remove-track]`);
  await page.waitForFunction(() => $("#actionDialog").open);
  await page.click("#actionDialogCancel");
  assert.equal(await page.evaluate((x) => decks.A.track?.id === x, order[1]), true, "cancel keeps the loaded track");

  assert.deepEqual(errors, []);
  console.log("PASS library UX: first-run empty state, channel volume, mixer CUE level knob, playlist menu/remove/undo/reorder/rename, track removal undo, keyboard browsing and deck keys, KEY column, SYNC match");
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
