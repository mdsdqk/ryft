/**
 * Capture /branch/:name for the WU-E · E1 inspection round.
 *
 *   node scripts/shoot-branch.mjs http://localhost:5180 ../.impeccable/review
 *
 * Needs the dev server running with VITE_DATA_SOURCE=fixture.
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

async function signedPage(width, height, scheme = "light") {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: scheme },
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  await page.evaluate(() => localStorage.setItem("ryft.user", "grace"));
  return page;
}

async function shoot(name, width, height, path, scheme) {
  const page = await signedPage(width, height, scheme);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file, fullPage: true });
  console.log(`wrote ${file}`);
  await page.close();
}

const P = "/branch/contact-fields";

await shoot("e1-desktop", 1440, 1400, P);
await shoot("e1-mobile", 390, 844, P);
await shoot("e1-dark", 1440, 1400, P, "dark");
await shoot("e1-desktop-empty", 1440, 1200, `${P}?empty`);
await shoot("e1-desktop-wide", 1440, 1600, `${P}?wide`);
await shoot("e1-mobile-wide", 390, 844, `${P}?wide`);
await shoot("e1-desktop-loading", 1440, 900, `${P}?loading`);
await shoot("e1-desktop-error", 1440, 900, `${P}?error`);
await shoot("e1-notfound", 1440, 900, "/branch/no-such-branch");
await shoot("e1-main", 1440, 1400, "/branch/main");

await browser.close();
