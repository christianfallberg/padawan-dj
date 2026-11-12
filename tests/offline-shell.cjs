// Offline shell check: a server error page must never replace the cached app for offline startup.
const { chromium } = require("playwright");
const assert = require("assert/strict"), fs = require("fs"), http = require("http"), path = require("path");
const root = path.resolve(__dirname, "..");
let broken = false;
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(req.url.split("?")[0]);
  if (broken && (name === "/" || name === "/index.html")) { res.writeHead(500, { "Content-Type": "text/html" }); return res.end("<h1>SERVER ERROR</h1>"); }
  const file = path.join(root, name === "/" ? "index.html" : name);
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.setHeader("Content-Type", { ".js": "text/javascript", ".css": "text/css", ".html": "text/html" }[path.extname(file)] || "application/octet-stream");
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForFunction(() => state.serviceWorkerReady && navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(async () => { await page.reload(); await page.waitForFunction(() => navigator.serviceWorker.controller); });
  await page.reload(); // controlled navigation caches index.html
  broken = true;
  await page.reload();
  assert.match(await page.content(), /SERVER ERROR/, "error passes through online");
  await ctx.setOffline(true);
  await page.reload();
  assert.ok(await page.$("#importButton"), "offline start still shows the app, not the cached error page");
  console.log("PASS offline shell: server error pages are not cached for offline startup");
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
