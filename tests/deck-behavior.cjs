// Deck behavior checks: decoded-audio release and shared decoding, CUE point kept apart from the
// beatgrid, keyboard shortcuts, the embedded-artwork type allowlist, startup with corrupt or blocked
// localStorage, Hot Cue labels, Sync and arrow seeking before metadata, changed external files, clearing the library,
// the BPM ½×/2× editor, idle redraw skipping and the Content-Security-Policy.
const { chromium } = require("playwright");
const assert = require("assert/strict"), fs = require("fs"), http = require("http"), path = require("path");
const root = path.resolve(__dirname, "..");
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(req.url.split("?")[0]);
  const file = path.join(root, name === "/" ? "index.html" : name);
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.setHeader("Content-Type", { ".js": "text/javascript", ".css": "text/css", ".html": "text/html" }[path.extname(file)] || "application/octet-stream");
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
  const page = await browser.newPage();
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", e => window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => state.db);
  await page.setInputFiles("#fileInput", ["one", "two", "three"].map((n, i) => ({ name: `Artist - ${n}.wav`, mimeType: "audio/wav", buffer: wav(220 + i * 110) })));
  await page.waitForFunction(() => state.tracks.length === 3 && !state.importing);
  const ids = await page.evaluate(() => state.tracks.map(t => t.id));

  // 1: decoded buffers released when a track leaves the decks; shared track kept.
  await page.evaluate(async ([a, b, c]) => { await loadTrackToDeck(a, "A"); await loadTrackToDeck(a, "B"); await loadTrackToDeck(b, "A"); }, ids);
  let r = await page.evaluate(([a, b]) => { const t = id => state.tracks.find(x => x.id === id); return { a: !!t(a).buffer, b: !!t(b).buffer }; }, ids);
  assert.deepEqual(r, { a: true, b: true }, "track still on deck B keeps its buffer");
  await page.evaluate(async ([a, b, c]) => { await loadTrackToDeck(c, "B"); }, ids);
  r = await page.evaluate(([a]) => { const t = state.tracks.find(x => x.id === a); return { buffer: !!t.buffer, peaks: !!t.peaks }; }, ids);
  assert.deepEqual(r, { buffer: false, peaks: true }, "unloaded track drops buffer, keeps peaks");
  await page.evaluate(async ([a]) => { await loadTrackToDeck(a, "A"); }, ids);
  assert.ok(await page.evaluate(() => !!decks.A.track.buffer), "reloading re-decodes");
  // Concurrent load of one track decodes once.
  const calls = await page.evaluate(async ([, , c]) => {
    const t = state.tracks.find(x => x.id === c); t.buffer = null; t.peaks = null;
    let n = 0; const orig = audioContext.decodeAudioData.bind(audioContext);
    audioContext.decodeAudioData = (...a) => { n++; return orig(...a); };
    await Promise.all([ensureTrackDecoded(t), ensureTrackDecoded(t)]);
    audioContext.decodeAudioData = orig; return n;
  }, ids);
  assert.equal(calls, 1, "shared decode");

  // 3: cue point separate from beatgrid; persists.
  await page.evaluate(() => { decks.A.track.gridOffset = 0.25; decks.A.audio.currentTime = 2; });
  await page.waitForFunction(() => Math.abs(decks.A.audio.currentTime - 2) < 0.05);
  await page.evaluate(() => decks.A.cue());
  r = await page.evaluate(async () => { const t = decks.A.track; await new Promise(r => setTimeout(r, 200)); const stored = (await dbGetAll()).find(x => x.id === t.id); return { grid: t.gridOffset, cue: Math.round(t.cuePoint), storedCue: Math.round(stored.cuePoint), storedGrid: stored.gridOffset }; });
  assert.deepEqual(r, { grid: 0.25, cue: 2, storedCue: 2, storedGrid: 0.25 });

  // 2: modifier shortcuts ignored; plain C still works.
  await page.evaluate(() => { document.activeElement.blur(); decks.A.audio.currentTime = 4; setSelectedDeck("A"); });
  await page.waitForFunction(() => Math.abs(decks.A.audio.currentTime - 4) < 0.05);
  await page.keyboard.press("Meta+c"); await page.keyboard.press("Control+s"); await page.keyboard.press("Meta+l");
  r = await page.evaluate(() => ({ cue: Math.round(decks.A.track.cuePoint), max: $(".workspace").classList.contains("library-maximized"), tempo: decks.A.tempoPercent }));
  assert.deepEqual(r, { cue: 2, max: false, tempo: 0 }, "modifier shortcuts ignored");
  await page.keyboard.press("c");
  assert.equal(await page.evaluate(() => Math.round(decks.A.track.cuePoint)), 4, "plain C still sets cue");

  // 4: Enter on a focused button does not load the selected track.
  await page.evaluate(([, b]) => { state.selectedTrackId = b; setSelectedDeck("B"); }, ids);
  const before = await page.evaluate(() => decks.B.track.id);
  await page.focus("#cueB"); await page.keyboard.press("Enter"); await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => decks.B.track.id), before, "Enter on button does not load");
  await page.evaluate(() => document.activeElement.blur()); await page.keyboard.press("Enter");
  await page.waitForFunction(([, b]) => decks.B.track?.id === b, ids);

  // 5: SVG artwork rejected, JPEG accepted, stored SVG covers not turned into blob URLs.
  r = await page.evaluate(() => {
    const tag = (mime) => {
      const img = new Uint8Array(64).fill(7), enc = new TextEncoder();
      const body = [0, ...enc.encode(mime), 0, 3, 0, ...img];
      const frame = [...enc.encode("APIC"), 0, 0, 0, body.length, 0, 0, ...body];
      const size = frame.length;
      return new Uint8Array([...enc.encode("ID3"), 3, 0, 0, 0, 0, (size >> 7) & 0x7f, size & 0x7f, ...frame]).buffer;
    };
    const svgTrack = { title: "x", artist: "y", coverBlob: new Blob(["<svg/>"], { type: "image/svg+xml" }) };
    return { svg: readId3Metadata(tag("image/svg+xml")).coverBlob?.type ?? null, jpg: readId3Metadata(tag("image/jpg")).coverBlob?.type, stored: getTrackCoverUrl(svgTrack).slice(0, 14) };
  });
  assert.deepEqual(r, { svg: null, jpg: "image/jpeg", stored: "data:image/sv" + "g" });
  // Double-clicking a track loads it on the selected deck (the row must survive the first click).
  await page.evaluate(() => { decks.A.pause(); decks.B.pause(); setSelectedDeck("B"); state.source = "collection"; renderTable(); });
  await page.dblclick(`tr[data-id="${ids[0]}"] .track-title-text`);
  await page.waitForFunction(([a]) => decks.B.track?.id === a, ids);
  assert.equal(await page.evaluate(([a]) => $(`tr[data-id="${a}"]`).classList.contains("selected"), ids), true, "row highlighted");

  // BPM editor: ½× and 2× presets, disabled outside 40–260, two-decimal values accepted.
  await page.evaluate(([a]) => { const t = state.tracks.find(x => x.id === a); t.bpm = 135.5; state.source = "collection"; renderTable(); }, ids);
  await page.dblclick(`tr[data-id="${ids[0]}"] td[data-field="bpm"]`);
  await page.waitForSelector("#actionDialogPresets:not([hidden]) button");
  r = await page.evaluate(() => [...$$("#actionDialogPresets button")].map(b => ({ label: b.textContent, disabled: b.disabled })));
  assert.deepEqual(r, [{ label: "½×", disabled: false }, { label: "2×", disabled: true }], "2× of 135.5 exceeds 260");
  await page.click("#actionDialogPresets button[aria-label='Halve BPM']");
  assert.equal(await page.inputValue("#actionDialogInput"), "67.75");
  r = await page.evaluate(() => [...$$("#actionDialogPresets button")].map(b => b.disabled));
  assert.deepEqual(r, [true, false], "½× of 67.75 is below 40; 2× allowed");
  await page.click("#actionDialogConfirm");
  await page.waitForFunction(() => !$("#actionDialog").open);
  r = await page.evaluate(async ([a]) => { await new Promise(r => setTimeout(r, 200)); return [state.tracks.find(x => x.id === a).bpm, (await dbGetAll()).find(x => x.id === a).bpm]; }, ids);
  assert.deepEqual(r, [67.75, 67.75]);
  // Dialogs without presets keep the group hidden.
  await page.evaluate(() => { requestDialog({ title: "t", message: "m", label: "NAME" }); });
  assert.equal(await page.evaluate(() => $("#actionDialogPresets").hidden), true);
  await page.click("#actionDialogCancel");

  // Idle decks are not redrawn every frame; a playing deck is.
  r = await page.evaluate(async () => {
    decks.A.pause(); decks.B.pause();
    await new Promise(r => setTimeout(r, 300));
    const orig = window.drawWaveform; let idle = 0;
    window.drawWaveform = (deck) => { idle++; return orig(deck); };
    await new Promise(r => setTimeout(r, 600));
    let playing = 0;
    window.drawWaveform = (deck) => { playing++; return orig(deck); };
    await decks.A.audio.play();
    await new Promise(r => setTimeout(r, 600));
    decks.A.pause();
    window.drawWaveform = orig;
    return { idle, playing: playing > 5 };
  });
  assert.deepEqual(r, { idle: 0, playing: true }, "redraw only while something changes");

  // Waveform Hot Cue markers are numbered like the pads.
  r = await page.evaluate(() => {
    const t = decks.A.track; t.hotCues = { D: decks.A.audio.currentTime };
    const labels = [], orig = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) { if (this.fillStyle === "#071018") labels.push(text); return orig.call(this, text, ...rest); };
    drawWaveform(decks.A);
    CanvasRenderingContext2D.prototype.fillText = orig;
    t.hotCues = {};
    return labels;
  });
  assert.deepEqual(r, ["4"], "Hot Cue 4 marker labelled 4");

  // Arrow seeking and Sync use the stored length while the element's duration is unknown.
  r = await page.evaluate(() => {
    decks.A.pause(); decks.A.audio.currentTime = 1; setSelectedDeck("A");
    Object.defineProperty(decks.A.audio, "duration", { get: () => NaN, configurable: true });
    document.activeElement.blur();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight", key: "ArrowRight", bubbles: true }));
    const afterArrow = decks.A.audio.currentTime;
    setMasterDeck("B");
    let syncError = null;
    try { decks.A.syncTo(decks.B); } catch (error) { syncError = error.message; }
    delete decks.A.audio.duration;
    return { afterArrow: Math.round(afterArrow), syncError, rate: decks.A.audio.playbackRate > 0 };
  });
  assert.deepEqual(r, { afterArrow: 6, syncError: null, rate: true }, "arrow and sync before duration is known");
  r = await page.evaluate(() => {
    decks.A.setTempo(0);
    const bpm = decks.B.track.bpm; decks.B.track.bpm = 0;
    decks.A.syncTo(decks.B); const zeroBpm = { tempo: decks.A.tempoPercent, toast: ui.toast.textContent };
    decks.B.track.bpm = bpm;
    decks.B.syncTo(decks.B); const self = ui.toast.textContent;
    setMasterDeck("A");
    return { zeroBpm, self };
  });
  assert.deepEqual(r, { zeroBpm: { tempo: 0, toast: "Set a BPM on both tracks before syncing" }, self: "Deck 2 is the master deck" });

  // A failed history save does not report the track as undecodable.
  r = await page.evaluate(async ([, , c]) => {
    decks.A.pause();
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new DOMException("full", "QuotaExceededError"); };
    await loadTrackToDeck(c, "A");
    Storage.prototype.setItem = orig;
    return { loaded: decks.A.track.id === c, toast: ui.toast.textContent };
  }, ids);
  assert.ok(r.loaded && /loaded into Deck 1/.test(r.toast), `history save failure toast: ${r.toast}`);

  // A changed external file: length saved, size/date kept for rescans, other deck's waveform kept.
  r = await page.evaluate(async () => {
    const dir = await navigator.storage.getDirectory();
    const handle = await dir.getFileHandle("changed.wav", { create: true });
    const writer = await handle.createWritable(); await writer.write(state.tracks[0].blob); await writer.close();
    const file = await handle.getFile();
    const track = { ...state.tracks[0], id: crypto.randomUUID(), title: "Changed", blob: null, buffer: null, peaks: null, decoding: null,
      fileHandle: handle, sourceRoot: null, fileSize: file.size - 1, lastModified: 1, duration: 0, cuePoint: null, hotCues: {} };
    await dbPut(track); state.tracks.push(track);
    decks.B.pause();
    await loadTrackToDeck(track.id, "B");
    const peaksOnB = decks.B.track.peaks;
    let decodes = 0; const orig = audioContext.decodeAudioData.bind(audioContext);
    audioContext.decodeAudioData = (...a) => { decodes++; return orig(...a); };
    decks.A.pause();
    await loadTrackToDeck(track.id, "A");
    audioContext.decodeAudioData = orig;
    await new Promise(r => setTimeout(r, 200));
    const stored = (await dbGetAll()).find(x => x.id === track.id);
    return { duration: Math.round(stored.duration), staleSize: stored.fileSize === file.size - 1, decodes, peaksKept: decks.B.track.peaks === peaksOnB && !!peaksOnB };
  });
  assert.deepEqual(r, { duration: 6, staleSize: true, decodes: 0, peaksKept: true }, "changed external file");

  // Clearing the library fully unloads both decks.
  await page.evaluate(() => { clearLocalLibrary(); });
  await page.click("#actionDialogConfirm");
  await page.waitForFunction(() => state.tracks.length === 0);
  r = await page.evaluate(() => ["A", "B"].map(id => ({ track: decks[id].track, src: decks[id].audio.getAttribute("src"), url: decks[id].objectUrl })));
  assert.deepEqual(r, [{ track: null, src: null, url: null }, { track: null, src: null, url: null }], "decks unloaded");
  assert.deepEqual(errors, []);

  // The CSP is enforced (a third-party image is refused) and nothing the app did above violated it.
  r = await page.evaluate(async () => {
    const before = [...window.__cspViolations];
    const img = new Image(); img.src = "https://example.com/blocked.png"; document.body.append(img);
    await new Promise(r => setTimeout(r, 300)); img.remove();
    return { before, blocked: window.__cspViolations.slice(before.length).some(v => v.startsWith("img-src")) };
  });
  assert.deepEqual(r, { before: [], blocked: true }, "CSP enforced without violations");

  // Startup survives corrupt, malformed or blocked localStorage.
  const base = `http://127.0.0.1:${server.address().port}/`;
  for (const [name, setup, expected] of [
    ["corrupt JSON", () => { localStorage.setItem("dualDeckHistory", "{"); localStorage.setItem("dualDeckPlaylists", "["); }, ["Warm Up", "Peak Time", "Closing"]],
    ["malformed playlists", () => { localStorage.setItem("dualDeckHistory", '{"a":1}'); localStorage.setItem("dualDeckPlaylists", '[{"id":"x","name":"Mine","trackIds":"bad"},{"bad":1},null]'); }, ["Mine"]],
    ["blocked storage", () => { Object.defineProperty(window, "localStorage", { get() { throw new DOMException("blocked", "SecurityError"); } }); }, ["Warm Up", "Peak Time", "Closing"]],
  ]) {
    const context = await browser.newContext();
    await context.addInitScript(setup);
    const startPage = await context.newPage();
    const startErrors = []; startPage.on("pageerror", e => startErrors.push(e.message));
    await startPage.goto(base);
    await startPage.waitForFunction(() => state.db && document.querySelector("#libraryStatus").textContent.endsWith("TRACKS"));
    const result = await startPage.evaluate(() => ({ playlists: state.playlists.map(p => p.name), history: state.history, rows: $$(".playlist-row").length }));
    assert.deepEqual(result, { playlists: expected, history: [], rows: expected.length }, name);
    assert.deepEqual(startErrors, [], name);
    await context.close();
  }

  console.log("PASS deck behavior: decoded-audio release, shared decoding, separate CUE point, shortcuts, artwork allowlist, BPM ½×/2×, idle redraw skipping, Hot Cue labels, Sync/arrows before metadata, storage failures, changed external files, clear library, CSP");
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
