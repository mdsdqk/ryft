/**
 * Screenshot helper for design review. Not part of the app build.
 *
 *   node scripts/shoot.mjs <url> <outdir>
 *
 * Captures desktop (1440) + mobile (390), each in light and dark, full-page.
 */
import { mkdir } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const URL = process.argv[2] ?? "http://localhost:5180/";
const OUT = process.argv[3] ?? "../.impeccable/review";

const CHROME =
  process.env.CHROME_PATH ??
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

const shots = [
  { name: "desktop", width: 1440, height: 1200, scheme: "light" },
  { name: "desktop-dark", width: 1440, height: 1200, scheme: "dark" },
  { name: "mobile", width: 390, height: 844, scheme: "light" },
  { name: "mobile-dark", width: 390, height: 844, scheme: "dark" },
];

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--hide-scrollbars", "--force-device-scale-factor=1"],
});

for (const s of shots) {
  const page = await browser.newPage();
  await page.setViewport({ width: s.width, height: s.height, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: s.scheme },
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  await page.goto(URL, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  const file = `${OUT}/${s.name}.png`;
  await page.screenshot({ path: file, fullPage: true });
  console.log(`wrote ${file}`);
  await page.close();
}

await browser.close();
