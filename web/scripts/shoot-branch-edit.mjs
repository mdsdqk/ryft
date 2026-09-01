/**
 * Interaction captures for WU-E · E2 (the structured editor).
 *
 *   node scripts/shoot-branch-edit.mjs http://localhost:5180 ../.impeccable/review
 *
 * Needs the dev server on VITE_DATA_SOURCE=fixture. The fixture log is module
 * state, so shots that mutate run last and undo themselves.
 */
import { mkdir } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const BASE = (process.argv[2] ?? "http://localhost:5180").replace(/\/$/, "");
const OUT = process.argv[3] ?? "../.impeccable/review";
const CHROME =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const P = `${BASE}/branch/contact-fields`;
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
  await pg.goto(P, { waitUntil: "networkidle0" });
  await pg.evaluate(() => document.fonts.ready);
  return pg;
}
async function shot(pg, name) {
  await pg.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log(`wrote ${OUT}/${name}.png`);
}

// 1 — a column row opened into its editor
{
  const pg = await page(1440, 1400);
  await pg.click(".bw-card .bw-row--btn"); // users.email_address (first changed row)
  await wait(150);
  await shot(pg, "e2-row-editor");
  await pg.close();
}

// 2 — the inline "+ column" blank editor
{
  const pg = await page(1440, 1400);
  await pg.evaluate(() => {
    const mini = [...document.querySelectorAll(".bw-card .bw-mini")].find((b) =>
      b.textContent.includes("+ column"),
    );
    mini?.click();
  });
  await wait(150);
  await shot(pg, "e2-add-column");
  await pg.close();
}

// 3 — drop refused, dependents listed
{
  const pg = await page(1440, 1400);
  await pg.click(".bw-card .bw-row--btn"); // email_address — backed by a unique + the branch index
  await wait(150);
  await pg.evaluate(() =>
    [...document.querySelectorAll(".bw-ed .mr-btn")].find((b) => b.textContent.trim() === "Drop")?.click(),
  );
  await wait(120);
  await pg.evaluate(() =>
    [...document.querySelectorAll(".bw-ed .mr-btn")].find((b) => /Drop column/.test(b.textContent))?.click(),
  );
  await wait(300);
  await shot(pg, "e2-drop-blocked");
  await pg.close();
}

// 4 — a rename applied: △N on the row, a new entry in the log, undo offered
{
  const pg = await page(1440, 1400);
  // open the display_name row (3rd column row in users) via keyboard-free path
  await pg.evaluate(() => {
    const rows = [...document.querySelectorAll(".bw-card .bw-row--btn")];
    const row = rows.find((r) => r.querySelector(".bw-row__name")?.textContent.startsWith("display_name"));
    row?.click();
  });
  await wait(150);
  await pg.click(".bw-ed .bw-in"); // name input
  await pg.evaluate(() => {
    const i = document.querySelector(".bw-ed input.bw-in");
    i.value = "";
  });
  await pg.type(".bw-ed input.bw-in", "display_label");
  await pg.keyboard.press("Enter");
  await wait(500);
  await shot(pg, "e2-renamed");

  // 5 — undo it
  await pg.evaluate(() => document.querySelector(".bw-undo")?.click());
  await wait(500);
  await shot(pg, "e2-after-undo");
  await pg.close();
}

// 6 — dark, row editor open
{
  const pg = await page(1440, 1400, "dark");
  await pg.click(".bw-card .bw-row--btn");
  await wait(150);
  await shot(pg, "e2-dark");
  await pg.close();
}

// 7 — mobile, row editor open
{
  const pg = await page(390, 900);
  await pg.click(".bw-card .bw-row--btn");
  await wait(150);
  await shot(pg, "e2-mobile");
  await pg.close();
}

await browser.close();
