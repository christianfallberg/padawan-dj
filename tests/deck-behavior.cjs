// Deck behavior checks: decoded-audio release and shared decoding, CUE point kept apart from the
// beatgrid, keyboard shortcuts with modifiers or on focused buttons, and the embedded-artwork type allowlist.
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
  assert.deepEqual(errors, []);
  console.log("PASS deck behavior: decoded-audio release, shared decoding, separate CUE point, modifier shortcuts, Enter on buttons, artwork type allowlist");
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
