// 逐屏截图：Chromium 在超高页面上的 fullPage 有渲染上限（>21000 CSS px 会空白），
// 所以按视口滚动逐屏抓取，再报告每屏是否真的有内容（用于发现真实空白）。
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire("D:/project/machine-skill/node_modules/");
const { chromium } = require("playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "shots", "scroll");
await mkdir(out, { recursive: true });
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".webp": "image/webp", ".woff2": "font/woff2", ".png": "image/png" };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(req.url.split("?")[0]);
    const file = join(root, p === "/" ? "index.html" : p);
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(base, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const total = await page.evaluate(() => document.documentElement.scrollHeight);
console.log("page height:", total);
const rows = [];
for (let i = 0, y = 0; y < total; i++, y += 850) {
  await page.evaluate((yy) => window.scrollTo(0, yy), y);
  await page.waitForTimeout(120);
  const name = `s${String(i).padStart(2, "0")}.png`;
  await page.screenshot({ path: join(out, name) });
  const stats = await page.evaluate(() => {
    // 统计视口内文字量与非背景像素比例，判断这一屏是不是真的空白
    const text = (document.body.innerText || "").length;
    const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return { textLen: text, center: el ? (el.className || el.tagName).toString().slice(0, 40) : "none" };
  });
  rows.push({ name, y, ...stats });
}
for (const r of rows) console.log(r.name, r.y, r.center);
console.log("errors:", errors.length ? errors : "none");
await browser.close();
server.close();
