import { chromium } from "/Users/dotta/paperclip/.paperclip/worktrees/PAP-3631-agent-permissions-and-controls-plan/node_modules/.pnpm/playwright@1.58.2/node_modules/playwright/index.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const fileUrl = "file://" + path.join(here, "index.html");

const captures = [
  { name: "01-access-desktop", anchor: "#s1", viewport: { width: 1440, height: 900 }, fullPage: false },
  { name: "01-access-mobile", anchor: "#s1", viewport: { width: 390, height: 844 }, fullPage: false, isMobile: true },
  { name: "03-agent-desktop", anchor: "#s3", viewport: { width: 1440, height: 900 }, fullPage: false },
  { name: "03-agent-mobile", anchor: "#s3", viewport: { width: 390, height: 844 }, fullPage: false, isMobile: true },
  { name: "02-scope-desktop", anchor: "#s2", viewport: { width: 1440, height: 900 }, fullPage: false },
  { name: "04-denied-desktop", anchor: "#s4", viewport: { width: 1440, height: 900 }, fullPage: false },
  { name: "05-privacy-desktop", anchor: "#s5", viewport: { width: 1440, height: 900 }, fullPage: false },
  { name: "overview-desktop", anchor: "#summary", viewport: { width: 1440, height: 900 }, fullPage: true },
];

const browser = await chromium.launch();
for (const cap of captures) {
  const ctx = await browser.newContext({
    viewport: cap.viewport,
    deviceScaleFactor: 2,
    isMobile: cap.isMobile ?? false,
    hasTouch: cap.isMobile ?? false,
  });
  const page = await ctx.newPage();
  await page.goto(fileUrl + cap.anchor, { waitUntil: "networkidle" });
  await page.waitForTimeout(200);
  const out = path.join(here, "screenshots", `${cap.name}.png`);
  await page.screenshot({ path: out, fullPage: !!cap.fullPage });
  console.log("wrote", out);
  await ctx.close();
}
await browser.close();
