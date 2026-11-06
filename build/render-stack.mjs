// 渲染 docs/tech-stack.html → assets/tech-stack.png（2x DPR，宽度对齐 900px 设计稿）
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire("D:/project/machine-skill/node_modules/");
const { chromium } = require("playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".woff2": "font/woff2", ".webp": "image/webp", ".png": "image/png" };
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
const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 2 });
await page.goto(base + "docs/tech-stack.html", { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const height = await page.evaluate(() => document.body.scrollHeight);
await page.setViewportSize({ width: 900, height });
await page.waitForTimeout(150);
const buf = await page.screenshot({ fullPage: true });
await writeFile(join(root, "assets", "tech-stack.png"), buf);
console.log("tech-stack.png", Math.round(buf.length / 1024) + "KB", "height", height);
await browser.close();
server.close();
