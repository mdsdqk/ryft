/**
 * Interaction captures for the finish-review verdict pass — states that a
 * static full-page shot can't show.
 *
 *   node scripts/shoot-interactions.mjs <url> <outdir>
 *
 *   resolved.png    every conflict resolved → dial advanced to CLEARED,
 *                   Zone D status green, queue rows framed in --ok
 *   hover.png       pointer over the "Conflicts only" filter chip
 */
import { mkdir } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const URL = process.argv[2] ?? "http://localhost:5180/";
const OUT = process.argv[3] ?? "../.impeccable/review";
const CHROME =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--hide-scrollbars", "--force-device-scale-factor=1"],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1200, deviceScaleFactor: 1 });
await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
await page.goto(URL, { waitUntil: "networkidle0" });
await page.evaluate(() => document.fonts.ready);

// resolve every conflict by taking "ours" on whichever card is active
for (let i = 0; i < 6; i++) {
  const done = await page.evaluate(() => {
    const btn = document.querySelector(".mr-cf--active .mr-btn--primary");
    if (!btn) return true;
    btn.click();
    return false;
  });
  await new Promise((r) => setTimeout(r, 250));
  if (done) break;
}
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: `${OUT}/resolved.png`, fullPage: true });
console.log(`wrote ${OUT}/resolved.png`);

// reload clean, then hover a chip
await page.goto(URL, { waitUntil: "networkidle0" });
await page.evaluate(() => document.fonts.ready);
const chips = await page.$$(".mr-chip");
if (chips[1]) await chips[1].hover();
await new Promise((r) => setTimeout(r, 250));
await page.screenshot({
  path: `${OUT}/hover.png`,
  clip: { x: 80, y: 250, width: 1000, height: 220 },
});
console.log(`wrote ${OUT}/hover.png`);

await browser.close();
