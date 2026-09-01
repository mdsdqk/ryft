/**
 * Refinement-pass inspection (critique + audit follow-up).
 *   node scripts/shoot-refine.mjs http://localhost:5180 ../.impeccable/review
 */
import { mkdir } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const BASE = (process.argv[2] ?? "http://localhost:5180").replace(/\/$/, "");
const OUT = process.argv[3] ?? "../.impeccable/review";
const CHROME =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--hide-scrollbars", "--force-device-scale-factor=1"],
});

async function page(w, h, scheme = "light", reduced = false) {
  const pg = await browser.newPage();
  await pg.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await pg.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: scheme },
    { name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" },
  ]);
  await pg.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  await pg.evaluate(() => localStorage.setItem("ryft.user", "grace"));
  return pg;
}
async function shot(pg, path, name) {
  await pg.goto(`${BASE}${path}`, { waitUntil: "networkidle0" });
  await pg.evaluate(() => document.fonts.ready);
  await wait(250);
  const title = await pg.evaluate(() => document.title);
  await pg.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log(`${name.padEnd(26)} title="${title}"`);
}

const D = [1440, 1500];
const M = [390, 900];

// desktop
{
  const pg = await page(...D);
  await shot(pg, "/merge/1", "rf-merge");
  await shot(pg, "/branch/contact-fields", "rf-schema");
  await shot(pg, "/branch/contact-fields?sheet=divergence", "rf-divergence");
  await shot(pg, "/branch/main", "rf-trunk");
  await shot(pg, "/db", "rf-db");
  await shot(pg, "/db?empty", "rf-db-empty");
  await shot(pg, "/merges", "rf-merges");
  await shot(pg, "/branches", "rf-branches");
  await pg.close();
}
// signed-out
{
  const pg = await browser.newPage();
  await pg.setViewport({ width: 1440, height: 900 });
  await pg.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  await pg.evaluate(() => localStorage.removeItem("ryft.user"));
  await pg.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  await pg.evaluate(() => document.fonts.ready);
  await wait(200);
  console.log(`rf-signin              title="${await pg.evaluate(() => document.title)}"`);
  await pg.screenshot({ path: `${OUT}/rf-signin.png`, fullPage: true });
  await pg.close();
}
// mobile 390
{
  const pg = await page(...M);
  await shot(pg, "/merge/1", "rf-merge-m");
  await shot(pg, "/branch/contact-fields", "rf-schema-m");
  await shot(pg, "/merges", "rf-merges-m");
  await pg.close();
}
// dark merge
{
  const pg = await page(...D, "dark");
  await shot(pg, "/merge/1", "rf-merge-dark");
  await pg.close();
}

await browser.close();
