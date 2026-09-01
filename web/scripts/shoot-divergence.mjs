/**
 * WU-E · E3 captures — the Divergence sub-sheet, plus a /merge/:id regression
 * frame so the ComparisonGrid extraction can be diffed.
 *
 *   node scripts/shoot-divergence.mjs http://localhost:5180 ../.impeccable/review [tag]
 *
 * `tag` (default "e3") names the merge frame: merge-<tag>.png. Run once before
 * the refactor with tag "before", once after with "after".
 */
import { mkdir } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const BASE = (process.argv[2] ?? "http://localhost:5180").replace(/\/$/, "");
const OUT = process.argv[3] ?? "../.impeccable/review";
const TAG = process.argv[4] ?? "e3";
const CHROME =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--hide-scrollbars", "--force-device-scale-factor=1"],
});

async function page(w, h, scheme = "light") {
  const pg = await browser.newPage();
  await pg.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await pg.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: scheme },
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  await pg.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  await pg.evaluate(() => localStorage.setItem("ryft.user", "grace"));
  return pg;
}
async function shot(pg, path, name) {
  await pg.goto(`${BASE}${path}`, { waitUntil: "networkidle0" });
  await pg.evaluate(() => document.fonts.ready);
  await wait(300);
  await pg.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log(`wrote ${OUT}/${name}.png`);
}

{
  const pg = await page(1440, 1600);
  await shot(pg, "/merge/1", `merge-${TAG}`);
  await pg.close();
}
{
  const pg = await page(1440, 1400);
  await shot(pg, "/branch/contact-fields?sheet=divergence", "e3-divergence");
  await pg.close();
}
{
  const pg = await page(1440, 1400, "dark");
  await shot(pg, "/branch/contact-fields?sheet=divergence", "e3-divergence-dark");
  await pg.close();
}
{
  const pg = await page(390, 900);
  await shot(pg, "/branch/contact-fields?sheet=divergence", "e3-divergence-mobile");
  await pg.close();
}
{
  const pg = await page(1440, 1000);
  await shot(pg, "/branch/contact-fields?sheet=divergence&empty", "e3-divergence-empty");
  await pg.close();
}

await browser.close();
