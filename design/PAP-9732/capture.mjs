import { chromium } from "/Users/dotta/paperclip/.paperclip/worktrees/PAP-3631-agent-permissions-and-controls-plan/node_modules/.pnpm/playwright@1.58.2/node_modules/playwright/index.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";

const here = path.dirname(fileURLToPath(import.meta.url));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const fsPath = path.join(here, urlPath === "/" ? "/index.html" : urlPath);
  try {
    const info = await stat(fsPath);
    if (info.isDirectory()) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const body = await readFile(fsPath);
    const ext = path.extname(fsPath).toLowerCase();
    res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}/index.html`;

const sections = [
  { name: "01-missing-company", anchor: "#state-missing-company" },
  { name: "02-loading", anchor: "#state-loading" },
  { name: "03-unlicensed", anchor: "#state-unlicensed" },
  { name: "04-empty", anchor: "#state-empty" },
  { name: "05-populated", anchor: "#state-populated" },
  { name: "06-pending-join", anchor: "#state-pending-join" },
  { name: "07-denied", anchor: "#state-denied" },
  { name: "08-stale", anchor: "#state-stale" },
  { name: "09-error", anchor: "#state-error" },
  { name: "10-deny", anchor: "#state-decision-deny" },
];

const browser = await chromium.launch();

async function captureViewport(viewport, label, isMobile) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    isMobile,
    hasTouch: isMobile,
  });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => console.error("pageerror", err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("[console.error]", msg.text());
  });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__readyForCapture === true, null, { timeout: 15000 });
  await page.waitForTimeout(400);

  for (const section of sections) {
    const sectionEl = await page.$(section.anchor);
    if (!sectionEl) continue;
    const out = path.join(here, "screenshots", `${section.name}-${label}.png`);
    await sectionEl.screenshot({ path: out });
    console.log("wrote", out);
  }
  await ctx.close();
}

await captureViewport({ width: 1440, height: 900 }, "desktop", false);
await captureViewport({ width: 390, height: 844 }, "mobile", true);

await browser.close();
server.close();
console.log("done");
