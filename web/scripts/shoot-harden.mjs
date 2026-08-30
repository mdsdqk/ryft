/** Capture the hardened states for review. node scripts/shoot-harden.mjs [url] [outdir] */
import { mkdir } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] ?? "http://localhost:5180/";
const OUT = process.argv[3] ?? "../.impeccable/review";
const CHROME =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const scenarios = ["clean", "unclassified", "unchanged", "loading", "error"];

await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--hide-scrollbars", "--force-device-scale-factor=1"],
});

for (const s of scenarios) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1200, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: "light" },
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  await page.goto(`${BASE}?scenario=${s}`, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 200));
  await page.screenshot({ path: `${OUT}/harden-${s}.png`, fullPage: true });
  console.log(`wrote ${OUT}/harden-${s}.png`);
  await page.close();
}

// long-identifier stress: inject a monstrous column name + type into the DOM
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1400, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: "networkidle0" });
await page.evaluate(() => document.fonts.ready);
await page.evaluate(() => {
  const nm = document.querySelector(".mr-row__nm");
  if (nm) nm.textContent = "orders." + "supercalifragilistic_" .repeat(4) + "column_name";
  const d = document.querySelector(".mr-cell__detail");
  if (d) d.textContent = "varchar(2147483647) → numeric(1000, 999) NOT NULL DEFAULT 'x'".repeat(2);
});
await new Promise((r) => setTimeout(r, 150));
await page.screenshot({
  path: `${OUT}/harden-longtext.png`,
  clip: { x: 60, y: 220, width: 1120, height: 360 },
});
console.log(`wrote ${OUT}/harden-longtext.png`);

await browser.close();
