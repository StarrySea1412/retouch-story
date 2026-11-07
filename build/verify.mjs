// 本地无头验收（VOL.10）：四枚小样逐状态、错误收集、移动端溢出
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire("D:/project/machine-skill/node_modules/");
const { chromium } = require("playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shots = join(root, "shots");
await mkdir(shots, { recursive: true });
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".woff2": "font/woff2", ".webp": "image/webp", ".png": "image/png", ".mp4": "video/mp4" };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(req.url.split("?")[0]);
    const file = join(root, p === "/" ? "index.html" : p);
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;
console.log("serving", base);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
page.on("requestfailed", (r) => errors.push("requestfailed: " + r.url()));
await page.goto(base, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const font = await page.evaluate(() => document.fonts.check('16px "LXGW WenKai"'));
const imgs = await page.evaluate(() => [...document.images].map((i) => ({ src: i.getAttribute("src"), ok: i.naturalWidth > 0 })));
console.log("font:", font, "| images:", imgs.length, "| broken:", imgs.filter((i) => !i.ok).map((i) => i.src).join(",") || "none");
await page.screenshot({ path: join(shots, "00-hero.png"), clip: { x: 0, y: 0, width: 1440, height: 900 } });

async function shot(sel, name, fn) {
  const el = await page.$(sel);
  if (!el) { errors.push("missing " + sel); return; }
  await el.scrollIntoViewIfNeeded();
  if (fn) await fn();
  await page.waitForTimeout(240);
  const box = await el.boundingBox();
  await page.screenshot({ path: join(shots, name), clip: { x: Math.max(0, box.x - 6), y: Math.max(0, box.y - 6), width: Math.min(1440, box.width + 12), height: Math.min(2400, box.height + 12) } });
}

/* D1 直方图诊断台 */
await shot("#d1", "01-d1-sooc.png");
await shot("#d1", "02-d1-lift.png", async () => {
  await page.$eval("#hd-e", (e) => { e.value = 12; e.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.$eval("#hd-c", (e) => { e.value = 14; e.dispatchEvent(new Event("input", { bubbles: true })); });
});

/* D2 裁剪台 */
await shot("#d2", "03-d2-thirds.png", async () => {
  await page.locator('#cr-preset button[data-i="1"]').click();
});

/* D3 色阶台：黑场拖动 + 自动 */
await shot("#dlv", "04-lv-default.png");
await shot("#dlv", "05-lv-auto.png", async () => {
  await page.click("#lv-auto");
});

/* D4 曲线台：哑光预设 + G 通道 */
await shot("#dcv", "06-cv-matte.png", async () => {
  await page.locator('#cvc-presets button[data-i="2"]').click();
});
await shot("#dcv", "07-cv-green.png", async () => {
  await page.locator('#cvc-tabs button[data-ch="g"]').click();
});

/* D5 HSL：绿带压明度（病人甲） */
await shot("#dhsl", "08-hsl-green.png", async () => {
  await page.locator("#hs-case2").click();
});
await shot("#dhsl", "09-hsl-orange.png", async () => {
  await page.locator("#hs-case1").click();
});

/* D6 局部光台 */
await shot("#d4", "10-d4-local.png", async () => {
  await page.$eval("#lg-v", (e) => { e.value = 22; e.dispatchEvent(new Event("input", { bubbles: true })); });
});

/* D7 Before/After：拖分割线 */
await shot("#d5", "11-ba-half.png", async () => {
  const box = await (await page.$("#ba-stage")).boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
});

/* 移动端溢出 */
const mp = await browser.newPage({ viewport: { width: 375, height: 720 }, deviceScaleFactor: 2 });
mp.on("pageerror", (e) => errors.push("m-pageerror: " + e.message));
await mp.goto(base, { waitUntil: "networkidle" });
await mp.evaluate(() => document.fonts.ready);
const overflow = await mp.evaluate(() => {
  const bad = [];
  const dw = document.documentElement.clientWidth;
  document.querySelectorAll("body *").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > dw + 1 || r.left < -1)) {
      if (el.closest(".tablewrap, .code, .hd-hist, .lv-histbox, .cv2-editor")) return;
      const cls = (el.className && el.className.toString().slice(0, 40)) || el.tagName;
      bad.push(cls + " right=" + Math.round(r.right));
    }
  });
  return { scrollW: document.documentElement.scrollWidth, clientW: dw, bad: [...new Set(bad)].slice(0, 12) };
});
console.log("mobile overflow:", JSON.stringify(overflow));
await mp.screenshot({ path: join(shots, "12-mobile.png") });
console.log("errors:", errors.length ? errors : "none");
await browser.close(); server.close();
