import { chromium } from "/Users/dotta/paperclip/.paperclip/worktrees/PAP-3631-agent-permissions-and-controls-plan/node_modules/.pnpm/playwright@1.58.2/node_modules/playwright/index.mjs";
import path from "node:path";

const URL = "https://lunar-tundra-9n2h.here.now/";
const here = "/Users/dotta/paperclip/.paperclip/worktrees/PAP-3631-agent-permissions-and-controls-plan/design/PAP-9447";

const browser = await chromium.launch();

const captures = [
  { name: "live-desktop", viewport: { width: 1440, height: 900 }, isMobile: false },
  { name: "live-mobile", viewport: { width: 390, height: 844 }, isMobile: true },
];

for (const cap of captures) {
  const ctx = await browser.newContext({
    viewport: cap.viewport,
    deviceScaleFactor: 2,
    isMobile: cap.isMobile,
    hasTouch: cap.isMobile,
  });
  const page = await ctx.newPage();
  const resp = await page.goto(URL, { waitUntil: "networkidle" });
  console.log(cap.name, "status=", resp.status());
  await page.waitForTimeout(500);
  const out = path.join(here, "screenshots", `${cap.name}.png`);
  await page.screenshot({ path: out, fullPage: false });
  console.log("wrote", out);
  await ctx.close();
}
await browser.close();
