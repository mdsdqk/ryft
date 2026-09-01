/**
 * WU-E · E4 — the contextual "Open merge request" action.
 *   node scripts/shoot-open-mr.mjs http://localhost:5180 ../.impeccable/review
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

async function page(w, h) {
  const pg = await browser.newPage();
  await pg.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await pg.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: "light" },
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  await pg.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  await pg.evaluate(() => localStorage.setItem("ryft.user", "grace"));
  return pg;
}

// 1 — a diverged branch with no open MR: the title strip offers "Open merge request"
{
  const pg = await page(1440, 900);
  await pg.goto(`${BASE}/branch/contact-fields?nomr`, { waitUntil: "networkidle0" });
  await pg.evaluate(() => document.fonts.ready);
  await wait(200);
  await pg.screenshot({ path: `${OUT}/e4-open-action.png`, fullPage: true });
  console.log("wrote e4-open-action.png");

  // 2 — click it → POST → land on the new review
  await pg.evaluate(() =>
    [...document.querySelectorAll(".kit-sheet__action button")].find((b) =>
      /open merge request/i.test(b.textContent),
    )?.click(),
  );
  await wait(600);
  await pg.evaluate(() => document.fonts.ready);
  await pg.screenshot({ path: `${OUT}/e4-after-open.png`, fullPage: true });
  console.log("wrote e4-after-open.png  (url:", pg.url(), ")");
  await pg.close();
}

await browser.close();
