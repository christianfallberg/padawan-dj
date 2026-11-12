// Browser regression check for the performance workspace. Uses synthetic WAVs only.
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
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    serviceWorkers: "block",
    deviceScaleFactor: 1.5,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // Any Content-Security-Policy violation across the whole UI run fails the check.
  page.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) errors.push(m.text()); });
  await page.goto(baseURL);
  await page.mouse.move(600, 450);
  await delay(900);
  await page
    .locator("#fileInput")
    .setInputFiles(
      Array.from({ length: 8 }, (_, i) => ({
        name: `Test Artist ${i + 1} - ${i ? "Night Drive " + i : "Long track title to check safe truncation and spacing"}.wav`,
        mimeType: "audio/wav",
        buffer: wav(),
      })),
    );
  await page.waitForFunction(
    () => state.tracks.length === 8 && !state.importing,
  );
  await page.evaluate(async () => {
    state.tracks[0].bpm = 128;
    state.tracks[0].key = "10A";
    state.tracks[1].bpm = 126;
    state.tracks[1].key = "F♯m";
    await dbPut(state.tracks[0]);
    await dbPut(state.tracks[1]);
    await loadTrackToDeck(state.tracks[0].id, "A");
    await loadTrackToDeck(state.tracks[1].id, "B");
  });
  await delay(150);
  const sizes = [
    [2560, 1440],
    [1920, 1200],
    [1920, 1080],
    [1600, 900],
    [1536, 864],
    [1440, 900],
    [1366, 768],
    [1280, 800],
    [1280, 720],
    [1024, 768],
    [1024, 640],
    [960, 620],
    [900, 700],
    [800, 600],
    [760, 700],
    [600, 800],
    [390, 844],
    [320, 640],
  ];
  const reports = [];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await delay(160);
    await page.mouse.move(width / 2, Math.min(height - 10, 450));
    await delay(10);
    const report = await page.evaluate(() => {
      const rect = (s) => {
        const r = document.querySelector(s).getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
          right: r.right,
          bottom: r.bottom,
        };
      };
      const issues = [];
      for (const deck of [".deck-a", ".deck-b"]) {
        const panel = rect(deck);
        for (const selector of [
          ".deck-display",
          ".hotcue-strip",
          ".jogwheel",
          ".eq-bank",
          ".tempo-slot",
          ".cue-button",
          ".play-button",
          ".sync-button",
          ".reset-tempo",
        ]) {
          const r = rect(deck + " " + selector);
          if (
            r.x < panel.x - 1 ||
            r.right > panel.right + 1 ||
            r.y < panel.y - 1 ||
            r.bottom > panel.bottom + 1
          )
            issues.push(
              deck +
                " " +
                selector +
                " outside panel " +
                JSON.stringify({ r, panel }),
            );
        }
        const k = rect(deck + " .deck-key"),
          m = rect(deck + " .master-button");
        if (m.x - k.right < 8)
          issues.push(deck + " KEY/MASTER gap " + (m.x - k.right));
      }
      for (const selector of [
        ".cue-level-control",
        ".level-meter",
        ".master-volume",
        ".crossfader-area",
      ]) {
        for (const e of document.querySelectorAll(".mixer-panel " + selector)) {
          const r = e.getBoundingClientRect(),
            m = rect(".mixer-panel");
          if (r.bottom > m.bottom + 1 || r.y < m.y - 1)
            issues.push("Mixer " + selector + " clipped");
        }
      }
      const fit = innerWidth > 900 && innerHeight >= 600
        && !document.querySelector('.app-shell').classList.contains('workspace-scroll');
      if (document.documentElement.scrollWidth > innerWidth + 1)
        issues.push(
          "page horizontal overflow " + document.documentElement.scrollWidth,
        );
      if (fit && document.documentElement.scrollHeight > innerHeight + 1)
        issues.push(
          "page vertical overflow " + document.documentElement.scrollHeight,
        );
      const t = rect(".track-table-wrap"),
        header = rect(".track-table thead");
      const rowHeight =
        document.querySelector("#trackTableBody tr")?.getBoundingClientRect()
          .height || 32;
      const rows = Math.floor((t.h - header.h) / rowHeight);
      return {
        viewport: [innerWidth, innerHeight],
        issues,
        platter: rect("#jogA").w,
        rows,
        library: rect(".library-section").h,
        fit,
      };
    });
    reports.push(report);
    if (report.issues.length) console.log("FAIL", JSON.stringify(report));
    else
      console.log(
        "PASS",
        width + "x" + height,
        "platter",
        report.platter,
        "rows",
        report.rows,
      );
    if (width === 1280 && height === 800) {
      assert(
        report.rows >= 4,
        "HP laptop must show at least four complete tracks",
      );
      assert(
        report.platter >= 200,
        "HP laptop platter should use the available height",
      );
      if (process.env.PADAWAN_LAYOUT_SCREENSHOT) {
        await delay(800);
        await page.screenshot({
          path: process.env.PADAWAN_LAYOUT_SCREENSHOT,
          type: "jpeg",
          quality: 88,
        });
      }
    }
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await delay(200);
  assert.equal(
    reports.filter((x) => x.issues.length).length,
    0,
    "layout boundaries must fit",
  );
  const workspace = () => page.locator(".workspace").boundingBox();
  const before = await workspace();
  await page.mouse.move(640, 2);
  await delay(400);
  assert(
    await page
      .locator("#appToolbar")
      .evaluate((e) => e.getBoundingClientRect().y >= 0),
  );
  assert.deepEqual(
    await workspace(),
    before,
    "hover toolbar must not move workspace",
  );
  await page.mouse.move(640, 400);
  await delay(950);
  assert(
    await page
      .locator("#appToolbar")
      .evaluate((e) => e.getBoundingClientRect().bottom <= 1),
  );
  await page.keyboard.press("Alt+t");
  assert.equal(
    await page
      .locator("#topbarPinButton")
      .evaluate((e) => document.activeElement === e),
    true,
  );
  await page.locator("#topbarPinButton").click();
  assert.equal(
    await page.locator("#topbarPinButton").getAttribute("aria-pressed"),
    "true",
  );
  await page.reload();
  await page.waitForFunction(() => state.tracks.length === 8);
  assert.equal(
    await page.locator("#topbarPinButton").getAttribute("aria-pressed"),
    "true",
  );
  await page.locator("#topbarPinButton").click();
  await page.locator("#jogA").click();
  await delay(900);
  const divider = page.locator("#libraryResizer");
  await divider.focus();
  const original = await page
    .locator("#musicLibrary")
    .evaluate((e) => e.getBoundingClientRect().height);
  await page.keyboard.press("ArrowUp");
  await delay(150);
  const increased = await page
    .locator("#musicLibrary")
    .evaluate((e) => e.getBoundingClientRect().height);
  assert(increased > original, "arrow up increases library");
  await page.keyboard.press("End");
  await delay(150);
  const maximum = await page
    .locator("#musicLibrary")
    .evaluate((e) => e.getBoundingClientRect().height);
  assert(maximum >= increased);
  await page.keyboard.press("Home");
  await delay(150);
  const minimum = await page
    .locator("#musicLibrary")
    .evaluate((e) => e.getBoundingClientRect().height);
  assert(minimum < maximum);
  const box = await divider.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 30, { steps: 5 });
  await page.mouse.up();
  await delay(150);
  const dragged = await page
    .locator("#musicLibrary")
    .evaluate((e) => e.getBoundingClientRect().height);
  assert(dragged > minimum, "drag increases library");
  await page.reload();
  await page.waitForFunction(() => state.tracks.length === 8);
  await delay(150);
  assert.equal(
    await page
      .locator("#musicLibrary")
      .evaluate((e) => e.getBoundingClientRect().height),
    dragged,
    "library size persists",
  );
  await page.locator("#libraryResizer").dblclick();
  await delay(150);
  await page.locator("#libraryMaximizeButton").click();
  assert.equal(await page.locator(".decks-section").isVisible(), false);
  assert(
    await page
      .locator("#musicLibrary")
      .evaluate((e) => e.getBoundingClientRect().height > 600),
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".decks-section").isVisible(), true);
  await delay(150);
  await page.locator('#trackTableBody button[data-load="A"]').first().click();
  await page.locator('#trackTableBody button[data-load="B"]').nth(1).click();
  await page.locator("#playA").click();
  await delay(100);
  assert.equal(
    await page.locator("#playA").getAttribute("aria-pressed"),
    "true",
  );
  await page.locator("#playA").click();
  await page.locator("#playB").click();
  await page.locator("#playB").click();
  await page.keyboard.press("Alt+t");
  await page.locator("#helpButton").click();
  assert(await page.locator("#helpDialog").isVisible());
  await page.keyboard.press("Escape");
  await page.keyboard.press("Alt+t");
  await page.locator("#audioOutputButton").click();
  assert(await page.locator("#audioOutputDialog").isVisible());
  await page.keyboard.press("Escape");
  await page.keyboard.press("Alt+t");
  await page.locator("#storageButton").click();
  assert(await page.locator("#storageDialog").isVisible());
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  console.log(
    "PASS toolbar hover/focus/pin/persistence, divider drag/keys/persistence/reset, library maximize/restore, imports, dual-deck playback and dialogs",
  );
  // A pinned toolbar must never consume the space needed by deck controls.
  await page.setViewportSize({ width: 901, height: 600 });
  await page.keyboard.press("Alt+t");
  if (await page.locator("#topbarPinButton").getAttribute("aria-pressed") !== "true")
    await page.locator("#topbarPinButton").click();
  await delay(200);
  assert.equal(await page.locator("#libraryResizer").getAttribute("aria-disabled"), "true");
  assert(await page.evaluate(() => [...document.querySelectorAll(".deck-panel")].every(panel => {
    const bounds = panel.getBoundingClientRect();
    return [...panel.querySelectorAll(".cue-button,.play-button,.sync-button,.reset-tempo")]
      .every(button => button.getBoundingClientRect().bottom <= bounds.bottom);
  })), "short pinned window keeps transport controls inside decks");

  // Include the conditional install action when checking wrapped toolbar rows.
  await page.setViewportSize({ width: 320, height: 640 });
  await page.locator("#installButton").evaluate(e => { e.hidden = false; });
  await delay(200);
  assert(await page.evaluate(() => {
    const toolbar = document.querySelector("#appToolbar").getBoundingClientRect();
    const actions = document.querySelector(".topbar-right").getBoundingClientRect();
    return actions.bottom <= toolbar.bottom
      && document.querySelector(".workspace").getBoundingClientRect().top >= toolbar.bottom;
  }), "wrapped toolbar contains all actions without overlapping waveforms");
  await page.locator("#topbarPinButton").click();
  await page.mouse.click(200, 400);
  await delay(950);
  assert(await page.locator("#appToolbar").evaluate(e => e.getBoundingClientRect().bottom <= 1),
    "wrapped toolbar fully hides");
  console.log("PASS short pinned window and mobile toolbar with install action");

  // Touch-only users open the same toolbar through a full-size reveal control.
  const touch = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
    serviceWorkers: "block",
  });
  const tp = await touch.newPage();
  await tp.goto(baseURL);
  await tp.touchscreen.tap(500, 450);
  await delay(300);
  assert(await tp.locator("#topbarReveal").evaluate(e => e.getBoundingClientRect().height >= 44),
    "touch toolbar reveal has a 44px target");
  await tp.locator("#topbarReveal").tap();
  await delay(250);
  assert(
    await tp
      .locator("#appToolbar")
      .evaluate((e) => e.getBoundingClientRect().y >= 0),
  );
  console.log("PASS touch toolbar reveal");

  // First-install precaching must also cover the versioned URLs in index.html.
  const offline = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const op = await offline.newPage();
  const offlineErrors = [];
  op.on("pageerror", (e) => offlineErrors.push(String(e)));
  await op.goto(baseURL);
  await op.evaluate(() => navigator.serviceWorker.ready);
  await op.waitForFunction(() => !!navigator.serviceWorker.controller);
  const version = await op.evaluate(() => APP_VERSION);
  assert(await op.evaluate(() => caches.has(`padawan-dj-v${APP_VERSION}`)));
  await offline.setOffline(true);
  await op.reload();
  await op.waitForFunction(
    () => document.querySelector(".app-shell.toolbar-autohide") && state.db,
  );
  await op.keyboard.press("Alt+t");
  assert.equal(
    await op.locator("#topbarPinButton").evaluate((e) => e === document.activeElement),
    true,
  );
  assert.equal(await op.evaluate(() => APP_VERSION), version);
  assert.deepEqual(offlineErrors, []);
  console.log("PASS first-install PWA cache and offline startup/toolbar");
  await browser.close();
  server.close();
})().catch((e) => {
  console.error(e);
  server.close();
  process.exit(1);
});
