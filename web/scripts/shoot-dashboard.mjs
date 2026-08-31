/**
 * Capture /db for the WU-D inspection round.
 *
 *   node scripts/shoot-dashboard.mjs http://localhost:5180 ../.impeccable/review
 */
import { mkdir } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const BASE = (process.argv[2] ?? "http://localhost:5180").replace(/\/$/, "");
const OUT = process.argv[3] ?? "../.impeccable/review";
const CHROME =
  process.env.CHROME_PATH ??
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--hide-scrollbars", "--force-device-scale-factor=1"],
});

async function signedPage(width, height) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: "light" },
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  await page.evaluate(() => localStorage.setItem("ryft.user", "grace"));
  return page;
}

async function shoot(name, width, height, path) {
  const page = await signedPage(width, height);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file, fullPage: true });
  console.log(`wrote ${file}`);
  await page.close();
}

await shoot("desktop", 1440, 1200, "/db");
await shoot("mobile", 390, 844, "/db");
await shoot("desktop-empty", 1440, 1200, "/db?empty");
await shoot("mobile-empty", 390, 844, "/db?empty");
await shoot("desktop-error", 1440, 1200, "/db?error");
await shoot("desktop-loading", 1440, 1200, "/db?loading");
await shoot("desktop-busy", 1440, 1200, "/db?busy");
await shoot("desktop-long", 1440, 1200, "/db?long");
await shoot("mobile-long", 390, 844, "/db?long");

await browser.close();
