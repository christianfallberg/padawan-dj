// Music-library integration tests. Synthetic audio by default; MUSIC_TEST_USB opts into reading two MP3s from a mounted test drive.
// Folder picker is simulated with real, serializable OPFS handles; native picker permissions need a manual check.
const { chromium } = require("playwright");
const assert = require("assert/strict"),
  fs = require("fs"),
  http = require("http"),
  path = require("path");
const root = path.resolve(__dirname, "..");
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(req.url.split("?")[0]);
  const file = path.join(root, name === "/" ? "index.html" : name);
  if (!fs.existsSync(file)) {
    res.writeHead(404);
    return res.end();
  }
  const ext = path.extname(file);
  res.setHeader(
    "Content-Type",
    {
      ".js": "text/javascript",
      ".css": "text/css",
      ".html": "text/html",
      ".png": "image/png",
      ".webmanifest": "application/manifest+json",
    }[ext] || "application/octet-stream",
  );
  res.end(fs.readFileSync(file));
});
function wav() {
  const sr = 22050,
    n = sr * 6,
    b = Buffer.alloc(44 + n * 2);
  b.write("RIFF");
  b.writeUInt32LE(36 + n * 2, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / sr,
      beat = Math.exp(-((t * 2) % 1) * 10);
    b.writeInt16LE(
      Math.round(
        (Math.sin(t * 2 * Math.PI * 110) * 0.12 +
          Math.sin(t * 2 * Math.PI * 660) * beat * 0.07) *
          32767,
      ),
      44 + i * 2,
    );
  }
  return b;
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const context = await browser.newContext({serviceWorkers:'block'});
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => state.db && document.querySelector('#clock').textContent !== '--:--');
    const usb = process.env.MUSIC_TEST_USB;
    const samples = usb ? fs.readdirSync(usb).filter(name => !name.startsWith('.') && /\.mp3$/i.test(name)).slice(0,2)
      .map(name => ({ name, data:fs.readFileSync(path.join(usb,name)).toString('base64') }))
      : [{name:'First.wav',data:wav().toString('base64')},{name:'Second.wav',data:wav().toString('base64')}];
    assert.equal(samples.length,2);
    await page.evaluate(async samples => {
      const root = await navigator.storage.getDirectory();
      const folder = await root.getDirectoryHandle('DJ-test', {create:true});
      const sub = await folder.getDirectoryHandle('Nested', {create:true});
      for (let i=0;i<samples.length;i++) {
        const handle = await (i ? sub : folder).getFileHandle(samples[i].name,{create:true});
        const writer = await handle.createWritable();
        await writer.write(Uint8Array.from(atob(samples[i].data), c => c.charCodeAt(0)));
        await writer.close();
      }
      for (const name of ['._hidden.mp3','notes.txt','broken.mp3']) {
        const handle = await folder.getFileHandle(name,{create:true});
        const writer = await handle.createWritable(); await writer.write('not audio'); await writer.close();
      }
      window.showDirectoryPicker = async () => folder;
    },samples);
    async function choose(button) {
      if (await page.locator('#topbarReveal').getAttribute('aria-expanded') !== 'true') await page.locator('#topbarReveal').click();
      await page.locator('#importButton').click();
      await page.locator(button).click();
      await page.waitForFunction(() => !state.importing);
    }
    await choose('#linkFolderButton');
    assert.equal(await page.locator('.track-source').count(),2);
    assert.match(await page.locator('#toast').textContent(), /2 linked.*1 failed/);
    assert.deepEqual(await page.evaluate(async () => (await dbGetAll()).map(t => ({blob:t.blob,handle:t.fileHandle.kind}))),
      [{blob:null,handle:'file'},{blob:null,handle:'file'}]);
    const cueId = await page.evaluate(async () => {
      state.tracks[0].hotCues = {A:1.25}; await dbPut(state.tracks[0]); return state.tracks[0].id;
    });
    await choose('#linkFolderButton');
    assert.equal(await page.evaluate(() => state.tracks.length),2);
    assert.match(await page.locator('#toast').textContent(), /0 linked.*2 already/);
    await page.reload();
    await page.waitForFunction(() => state.tracks.length===2);
    assert.equal(await page.evaluate(id => state.tracks.find(t=>t.id===id).hotCues.A,cueId),1.25);
    await page.locator('button[data-load="A"]').first().click();
    await page.waitForFunction(() => decks.A.track && decks.A.track.buffer !== null);
    await page.locator('#playA').click();
    await page.waitForFunction(() => decks.A.audio.currentTime > 0.1);
    await page.locator('#playA').click();
    assert.equal(await page.evaluate(() => localLibraryBytes() === state.tracks.reduce((n,t)=>n+(t.coverBlob?.size||0),0)),true);
    // Persisting a cue after loading must not accidentally copy external audio.
    await page.evaluate(async () => dbPut(decks.A.track));
    assert.equal(await page.evaluate(async () => (await dbGetAll()).every(t=>t.blob===null)),true);
    // Missing file leaves the already loaded deck alone and gives recovery instructions.
    await page.evaluate(async () => {
      const t=state.tracks.find(t=>t.id!==decks.A.track.id);
      await t.fileHandle.remove();
    });
    await page.evaluate(async () => loadTrackToDeck(state.tracks.find(t=>t.id!==decks.A.track.id).id,'B'));
    assert.match(await page.locator('#toast').textContent(), /Connect the drive/);
    assert.equal(await page.evaluate(() => decks.B.track),null);
    // Copy the still-present file, verify no handles and playback after deleting its source.
    await page.evaluate(async () => {
      const root=await navigator.storage.getDirectory();
      window.showDirectoryPicker=async()=>root.getDirectoryHandle('DJ-test');
    });
    await choose('#copyFolderButton');
    assert.equal(await page.evaluate(() => state.tracks.filter(t=>!t.fileHandle).length),1);
    const copied = await page.evaluate(() => state.tracks.find(t=>!t.fileHandle).id);
    await choose('#copyFolderButton');
    assert.equal(await page.evaluate(() => state.tracks.length),3);
    await page.evaluate(async () => {
      await decks.A.track.fileHandle.remove();
    });
    await page.reload();
    await page.waitForFunction(() => state.tracks.length===3);
    await page.evaluate(id=>loadTrackToDeck(id,'B'),copied);
    await page.locator('#playB').click();
    await page.waitForFunction(() => decks.B.audio.currentTime > 0.1);
    await page.locator('#playB').click();
    // Permission denial is surfaced without replacing a deck.
    await page.evaluate(async () => {
      const t=state.tracks.find(t=>t.fileHandle);
      t.sourceRoot={queryPermission:async()=> 'prompt',requestPermission:async()=> 'denied'};
      await loadTrackToDeck(t.id,'A');
    });
    assert.match(await page.locator('#toast').textContent(),/Allow read access/);
    // Cancel picker and unsupported API leave import available.
    await page.evaluate(() => {window.showDirectoryPicker=async()=>{throw new DOMException('Cancelled','AbortError');};});
    await choose('#linkFolderButton');
    assert.equal(await page.locator('#importButton').isEnabled(),true);
    await page.evaluate(() => {window.showDirectoryPicker=undefined;});
    if (await page.locator('#topbarReveal').getAttribute('aria-expanded') !== 'true') await page.locator('#topbarReveal').click(); await page.locator('#importButton').click();
    assert.equal(await page.locator('#linkFolderButton').isDisabled(),true);
    const chooserPromise=page.waitForEvent('filechooser');
    await page.locator('#copyFolderButton').click();
    const chooser=await chooserPromise;
    assert.equal(await chooser.element().getAttribute('webkitdirectory'),'');
    // Save failures must not create phantom rows or leave import locked.
    await page.evaluate(async () => {
      const original=dbPut; dbPut=async()=>{throw new DOMException('Full','QuotaExceededError');};
      const file=await state.tracks.find(t=>!t.fileHandle).blob.arrayBuffer();
      await addFiles([new File([file],'Quota-test.wav')]); dbPut=original;
    });
    assert.equal(await page.evaluate(()=>state.tracks.length),3);
    assert.match(await page.locator('#toast').textContent(),/0 imported.*1 failed/);
    assert.equal(await page.locator('#importButton').isEnabled(),true);
    assert.deepEqual(errors,[]);
    console.log(`PASS music folders: recursion, hidden files, corrupt audio, persisted handles, reload/playback, cues, deduplication, missing files, denied permission, local copies, picker cancellation, fallback and storage failures${usb ? ' using audio read from '+usb : ''}`);
    await context.close();
  } finally { await browser.close(); server.close(); }
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
