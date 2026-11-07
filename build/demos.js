/* 四枚确定性小样 + 阅读进度条（VOL.13 · 零依赖，真实像素运算，确定性可复现）。 */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let seed = 20261113;
  const srand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  const prog = $("#progress");
  if (prog) {
    const paint = () => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      prog.style.transform = "scaleX(" + (max > 0 ? h.scrollTop / max : 0) + ")";
    };
    addEventListener("scroll", paint, { passive: true });
    addEventListener("resize", paint, { passive: true });
    paint();
  }


  /* ═══ 共享照片引擎：两张 AI 生成底片 ═══ */
  const IMGS = {};
  window.__rr = [];
  function loadImg(key, src) {
    const im = new Image();
    im.onload = () => { IMGS[key] = im; window.__rr.forEach((f) => { try { f(); } catch (e) { console.log('rr-err:', e.stack.split('|')[0] + ' @@ ' + (e.stack.match(/:\d+:\d+/) || [''])[0]); } }); };
    im.src = src;
    return im;
  }
  loadImg("still", "assets/img/base-still.jpg");
  loadImg("cafe", "assets/img/base-cafe.jpg");
  const BASE_FILTER = "brightness(0.84) saturate(0.72) contrast(0.9)";
  function coverTo(ctx, img, W, H, filterStr) {
    const sc = Math.max(W / img.width, H / img.height);
    const w = img.width * sc, h = img.height * sc;
    ctx.save();
    if (filterStr) ctx.filter = filterStr;
    ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    ctx.restore();
  }
  /* 像素级影调管线：曝光(×2^ev) → 对比(S曲线) → 高光回收 */
  function tonePixels(d, ev, con, hr) {
    const mul = Math.pow(1.4, ev);
    const k = 1 + con * 0.02;
    for (let p = 0; p < d.length; p += 4) {
      for (let c = 0; c < 3; c++) {
        let v = d[p + c] * mul;
        v = 128 + (v - 128) * k;
        if (hr > 0 && v > 200) v = v - (v - 200) * hr * 0.04;
        d[p + c] = Math.max(0, Math.min(255, v));
      }
    }
  }
  function histogram(ctx, W, H) {
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const bins = new Array(64).fill(0);
    for (let p = 0; p < d.length; p += 8) {
      const lum = (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) / 4;
      bins[Math.min(63, lum | 0)]++;
    }
    return { bins, img };
  }
  function drawHist(canvas, bins, marks) {
    const c2 = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    c2.fillStyle = "#121116"; c2.fillRect(0, 0, W, H);
    const max = Math.max.apply(null, bins);
    for (let i = 0; i < 64; i++) {
      const h = bins[i] / max * (H - 14);
      c2.fillStyle = "#8a879c";
      c2.fillRect(i / 64 * W, H - h - 2, W / 64 - 1, h);
    }
    c2.fillStyle = "#6a6772";
    for (let e = 0; e <= 4; e++) c2.fillRect(e / 4 * W, H - 10, 1, 8);
    if (marks && marks.med !== undefined) {
      c2.fillStyle = "#a8365e";
      c2.fillRect(marks.med / 64 * W - 1, 0, 2, H);
    }
  }
  /* ═══ D1/D1b 直方图诊断台 ═══ */
  function makeHd(cfg) {
    const cv = $(cfg.cv);
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const hist = $(cfg.hist);
    const S = Object.assign({}, cfg.defaults);
    function render() {
      const W = cv.width, H = cv.height;
      ctx.fillStyle = "#121116"; ctx.fillRect(0, 0, W, H);
      if (!IMGS.still) return;
      const sc = Math.max(W / IMGS.still.width, H / IMGS.still.height);
      const w = IMGS.still.width * sc, h = IMGS.still.height * sc;
      ctx.save();
      ctx.filter = BASE_FILTER;
      ctx.drawImage(IMGS.still, (W - w) / 2, (H - h) / 2, w, h);
      ctx.restore();
      const img = ctx.getImageData(0, 0, W, H);
      tonePixels(img.data, S.ev, S.con, S.hr);
      ctx.putImageData(img, 0, 0);
      const hb = histogram(ctx, W, H);
      const total = hb.bins.reduce((a, b) => a + b, 0);
      let acc = 0, med = 0;
      for (let i = 0; i < 64; i++) { acc += hb.bins[i]; if (acc >= total / 2) { med = i; break; } }
      const clipHi = hb.bins[63], clipLo = hb.bins[0];
      drawHist(hist, hb.bins, { med });
      if (cfg.outIds[0]) $(cfg.outIds[0]).textContent = (med * 4) + " / 255";
      if (cfg.outIds[1]) $(cfg.outIds[1]).textContent = clipHi + " px";
      if (cfg.outIds[2]) $(cfg.outIds[2]).textContent = clipLo + " px";
      const spread = (() => { const mx = Math.max.apply(null, hb.bins); let lo = 0, hi2 = 63; const th = mx * 0.04; while (hb.bins[lo] < th && lo < 63) lo++; while (hb.bins[hi2] < th && hi2 > 0) hi2--; return hi2 - lo; })();
      if (cfg.spreadEl) $(cfg.spreadEl).textContent = spread + " / 63 档";
      if (cfg.diagEl) $(cfg.diagEl).innerHTML =
        med < 22 ? "<b>诊断：</b>中位亮度 " + (med * 4) + "，整体欠曝发闷——正好是直方图左半边堆山的形状。药方：曝光 +0.7EV 起，对比度 +8 两翼展开。" :
        med > 34 ? "<b>诊断：</b>中位亮度 " + (med * 4) + "，偏亮。静物小品仍在安全区，但留意高光剪切。" :
        "<b>诊断：</b>中位亮度 " + (med * 4) + "，落入 110–130 目标带——影调骨架立住了。两翼若还挤着，加对比度。";
      if (cfg.after) {
        const sp = $("#hd-spread");
        const ok = Math.abs(med * 4 - 125) <= 20;
        if (sp) sp.className = ok ? "okc" : "";
      }
    }
    for (const id of cfg.inputs) {
      const read = () => { const raw = +$(id.id).value; return id.scale ? raw / id.scale : raw; };
      $(id.id).addEventListener("input", () => {
        S[id.key] = read();
        $(id.out).textContent = id.fmt(read());
        render();
      });
      S[id.key] = read();
      $(id.out).textContent = id.fmt(read());
    }
    if (cfg.resetId) $(cfg.resetId).addEventListener("click", () => {
      for (const id of cfg.inputs) { $(id.id).value = id.def; S[id.key] = id.def; $(id.out).textContent = id.fmt(id.def); }
      render();
    });
    render();
    window.__rr.push(render);
  }
  const fmtEV = (v) => (v / 10 >= 0 ? "+" : "") + (v / 10).toFixed(1);
  makeHd({
    cv: "#hd-cv", hist: "#hd-hist", defaults: { ev: 0, con: 0, hr: 0 },
    inputs: [
      { id: "#hd-e", key: "ev", out: "#hd-ev", def: 0, fmt: fmtEV, scale: 10 },
      { id: "#hd-c", key: "con", out: "#hd-c1v", def: 0, fmt: (v) => String(v) },
    ],
    resetId: "#hd-reset", diagEl: "#hd-diag",
    outIds: ["#hd-med", "#hd-clip", "#hd-dark"],
  });


  /* ═══ D2 裁剪台 ═══ */
  (() => {
    const cv = $("#cr-cv");
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const pv = document.createElement("canvas");
    pv.width = 260; pv.height = 173;
    const PRESETS = [
      { key: "sooc", name: "原片直出", desc: "什么都先不动——先看清病人", x: 0.5, w: 1.0, note: "原片：花瓶偏右下、左边空桌占三分之一，主体占比偏小。" },
      { key: "thirds", name: "三分版（推荐）", desc: "花瓶压右交点，花枝延伸留左", x: 0.58, w: 0.62, note: "裁掉左侧空桌，花瓶落在右下三分交点上，花枝的延伸方向留在画面里——视线有处可去。" },
      { key: "tight", name: "收紧特写", desc: "只留花瓶与花枝", x: 0.6, w: 0.4, note: "特写版：细节说话，木桌纹理全让出去。代价：裁掉约六成像素，放大后画质在消耗——锐化要补。" },
    ];
    const S = { sel: 1, x: 0.58 };
    function render() {
      const pre = PRESETS[S.sel];
      const W = cv.width, H = cv.height;
      ctx.fillStyle = "#121116"; ctx.fillRect(0, 0, W, H);
      if (IMGS.still) coverTo(ctx, IMGS.still, W, H, BASE_FILTER);
      // 裁剪框：比例 3:2
      const cw = W * pre.w, ch = cw * 2 / 3;
      if (ch > H) { const c2 = H / (cw * 2 / 3); cw *= c2; }
      const cx = Math.min(W - cw, Math.max(0, (W - cw) * S.x));
      const cy = (H - ch) / 2;
      ctx.fillStyle = "rgba(10,9,12,.62)";
      ctx.fillRect(0, 0, W, cy); ctx.fillRect(0, cy + ch, W, H - cy - ch);
      ctx.fillRect(0, cy, cx, ch); ctx.fillRect(cx + cw, cy, W - cx - cw, ch);
      ctx.strokeStyle = "#a8365e"; ctx.lineWidth = 2;
      ctx.strokeRect(cx, cy, cw, ch);
      ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = 1;
      for (let i = 1; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(cx + cw / 3 * i, cy); ctx.lineTo(cx + cw / 3 * i, cy + ch); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, cy + ch / 3 * i); ctx.lineTo(cx + cw, cy + ch / 3 * i); ctx.stroke();
      }
      // 预览
      if (IMGS.still) {
        const pctx = pv.getContext("2d");
        pctx.fillStyle = "#121116"; pctx.fillRect(0, 0, pv.width, pv.height);
        const sx = (cx / W) * IMGS.still.width, sy = (cy / H) * IMGS.still.height;
        const sw = (cw / W) * IMGS.still.width, sh = (ch / H) * IMGS.still.height;
        pctx.drawImage(IMGS.still, sx, sy, sw, sh, 0, 0, pv.width, pv.height);
      }
      $("#cr-xv").textContent = pre.key === "sooc" ? "全幅" : (S.x < 0.42 ? "偏左" : S.x > 0.62 ? "偏右" : "居中");
      $("#cr-out").innerHTML = "<b>" + pre.name + "：</b>" + pre.note + (pre.key !== "sooc" ? " 裁后有效像素 ≈ 全幅的 " + Math.round(pre.w * pre.w * 100) + "%。" : "");
      $$("#cr-preset button").forEach((b, i) => b.setAttribute("aria-pressed", String(i === S.sel)));
    }
    $("#cr-preset").innerHTML = PRESETS.map((p, i) => '<button data-i="' + i + '"><b>' + p.name + "</b>" + p.desc + "</button>").join("");
    $$("#cr-preset button").forEach((b) => { b.onclick = () => { S.sel = +b.dataset.i; S.x = PRESETS[S.sel].x; $("#cr-x").value = S.x * 100; render(); }; });
    $("#cr-x").addEventListener("input", () => { S.x = +$("#cr-x").value / 100; render(); });
    render();
    window.__rr.push(render);
  })();

  /* ═══ LUT 管线与 HSV 工具（高级影调/色彩模块共用）═══ */
  function makeLUT(fn) {
    const lut = new Uint8Array(256);
    for (let i = 0; i < 256; i++) lut[i] = Math.max(0, Math.min(255, Math.round(fn(i))));
    return lut;
  }
  function applyLUT(img, lr, lg, lb) {
    const d = img.data;
    for (let p = 0; p < d.length; p += 4) {
      d[p] = lr[d[p]]; d[p + 1] = lg[d[p + 1]]; d[p + 2] = lb[d[p + 2]];
    }
  }
  function rgb2hsv(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d !== 0) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return [h, mx === 0 ? 0 : d / mx, mx / 255];
  }
  function hsv2rgb(h, s, v) {
    const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }
  /* 色带定义：中心角 / 半宽（含羽化在权重函数里做） */
  const BANDS = [
    { key: "red", name: "红", center: 0 },
    { key: "orange", name: "橙", center: 30 },
    { key: "yellow", name: "黄", center: 58 },
    { key: "green", name: "绿", center: 115 },
    { key: "cyan", name: "青", center: 180 },
    { key: "blue", name: "蓝", center: 230 },
    { key: "purple", name: "紫", center: 275 },
    { key: "magenta", name: "品", center: 320 },
  ];
  function bandWeight(hue, center) {
    let d = Math.abs(hue - center);
    if (d > 180) d = 360 - d;
    const half = 24, feather = 16;
    if (d <= half) return 1;
    if (d >= half + feather) return 0;
    return 1 - (d - half) / feather;
  }

  /* ═══ DEMO 03 · 色阶台（黑场/伽马/白场手柄直拖直方图）═══ */
  (() => {
    const cv = $("#lv-cv");
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const histCv = $("#lv-hist"), hctx = histCv.getContext("2d");
    const hcCv = $("#lv-hc"), hc = hcCv.getContext("2d");
    const S = { black: 0, gamma: 1, white: 255 };
    let baseBins = null, baseImg = null;
    function stats() {
      const W = cv.width, H = cv.height;
      if (!IMGS.still) return;
      ctx.fillStyle = "#121116"; ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.filter = BASE_FILTER;
      const sc = Math.max(W / IMGS.still.width, H / IMGS.still.height);
      ctx.drawImage(IMGS.still, (W - sc * IMGS.still.width) / 2, (H - sc * IMGS.still.height) / 2, sc * IMGS.still.width, sc * IMGS.still.height);
      ctx.restore();
      const img = ctx.getImageData(0, 0, W, H);
      const d = img.data;
      const bins = new Array(64).fill(0);
      for (let p = 0; p < d.length; p += 8) {
        const lum = (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) / 4;
        bins[Math.min(63, lum | 0)]++;
      }
      baseBins = bins; baseImg = img;
      const lut = makeLUT((v) => {
        const t = Math.max(0, Math.min(1, (v - S.black) / Math.max(1, S.white - S.black)));
        return 255 * Math.pow(t, 1 / S.gamma);
      });
      applyLUT(img, lut, lut, lut);
      ctx.putImageData(img, 0, 0);
      // 直方图重算（应用后）
      const nb = new Array(64).fill(0);
      for (let p = 0; p < d.length; p += 8) {
        const lum = (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) / 4;
        nb[Math.min(63, lum | 0)]++;
      }
      drawHist2(hctx, histCv, baseBins, nb);
      drawHandles();
      const med = (() => { const total = nb.reduce((a, b) => a + b, 0); let acc = 0; for (let i = 0; i < 64; i++) { acc += nb[i]; if (acc >= total / 2) return i * 4; } return 255; })();
      const clipHi = nb[63], clipLo = nb[0];
      $("#lv-kv").innerHTML =
        "<span>黑场 / 白场</span><b>" + S.black + " / " + S.white + "</b>" +
        "<span>伽马</span><b>" + S.gamma.toFixed(2) + "</b>" +
        "<span>中位亮度</span><b>" + med + "</b>" +
        "<span>剪切</span><b" + (clipHi + clipLo > total0() * 0.02 ? " style=\"color:var(--alarm)\"" : "") + ">" + (clipHi + clipLo) + " px</b>";
    }
    let _total = 0;
    function total0() { if (!_total && baseBins) _total = baseBins.reduce((a, b) => a + b, 0); return _total || 1; }
    function drawHist2(hc2, canvas, before, after) {
      const W = canvas.width, H = canvas.height;
      hc2.fillStyle = "#121116"; hc2.fillRect(0, 0, W, H);
      const mx = Math.max.apply(null, after);
      for (let i = 0; i < 64; i++) {
        const h = after[i] / mx * (H - 12);
        hc2.fillStyle = "#9a97a6";
        hc2.fillRect(i / 64 * W, H - h - 2, W / 64 - 1, h);
      }
    }
    function drawHandles() {
      const W = hcCv.width, H = hcCv.height;
      hc.clearRect(0, 0, W, H);
      hc.fillStyle = "#121116"; hc.fillRect(0, 0, W, H);
      hc.strokeStyle = "#43424a"; hc.lineWidth = 1;
      hc.strokeRect(0.5, 0.5, W - 1, H - 1);
      const x = (v255) => 6 + (v255 / 255) * (W - 12);
      // 三个手柄：黑方块 / γ三角 / 白方块
      hc.fillStyle = "#1d1d21";
      hc.fillRect(x(S.black) - 5, 6, 10, H - 14);
      hc.fillStyle = "#fbf9f2"; hc.strokeStyle = "#26262b";
      hc.beginPath(); hc.moveTo(x(S.black) - 6, 8); hc.lineTo(x(S.black) + 6, 8); hc.lineTo(x(S.black), 20); hc.closePath(); hc.fill(); hc.stroke();
      hc.beginPath(); hc.moveTo(x(S.white) - 6, 8); hc.lineTo(x(S.white) + 6, 8); hc.lineTo(x(S.white), 20); hc.closePath(); hc.fill(); hc.stroke();
      hc.beginPath(); hc.moveTo(x(128) - 7, 20); hc.lineTo(x(128) + 7, 20); hc.lineTo(x(S.black + (S.white - S.black) * (1 - Math.pow(0.5, S.gamma))), H - 8); hc.lineTo(x(S.black + (S.white - S.black) * Math.pow(0.5, S.gamma)), H - 8); hc.closePath();
      hc.fillStyle = "#a8365e"; hc.fill();
      hc.beginPath(); hc.arc(x(S.black + (S.white - S.black) * Math.pow(0.5, S.gamma)), H - 10, 5, 0, 7); hc.fillStyle = "#fbf9f2"; hc.fill(); hc.stroke();
    }
    function toVal(px) {
      const r = hcCv.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (px - r.left - 6) / (r.width - 12)));
      return Math.round(t * 255);
    }
    let drag = null;
    hcCv.style.cursor = "pointer";
    hcCv.addEventListener("pointerdown", (e) => {
      const v = toVal(e.clientX);
      const dBlack = Math.abs(v - S.black), dWhite = Math.abs(v - S.white);
      drag = dBlack < dWhite ? "black" : "white";
      if (drag === "black") S.black = Math.min(v, S.white - 2);
      else S.white = Math.max(v, S.black + 2);
      stats();
    });
    hcCv.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const v = toVal(e.clientX);
      if (drag === "black") S.black = Math.max(0, Math.min(v, S.white - 2));
      else S.white = Math.min(255, Math.max(v, S.black + 2));
      stats();
    });
    addEventListener("pointerup", () => { drag = null; });
    $("#lv-reset").addEventListener("click", () => { S.black = 0; S.gamma = 1; S.white = 255; stats(); });
    $("#lv-auto").addEventListener("click", () => {
      if (!baseBins) return;
      const total = baseBins.reduce((a, b) => a + b, 0);
      let lo = 0, hi = 63, acc = 0;
      for (let i = 0; i < 64; i++) { acc += baseBins[i]; if (acc >= total * 0.005) { lo = i; break; } }
      acc = 0;
      for (let i = 63; i >= 0; i--) { acc += baseBins[i]; if (acc >= total * 0.005) { hi = i; break; } }
      S.black = lo * 4; S.white = Math.min(255, hi * 4 + 4); S.gamma = 1.05;
      stats();
    });
    window.__rr.push(stats);
    stats();
  })();


  /* ═══ DEMO 04 · 曲线台（可拖控制点 + 单通道 + LUT）═══ */
  (() => {
    const cv = $("#cvc-cv");
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const ed = $("#cvc-editor");
    const ec = ed.getContext("2d");
    const CH = ["rgb", "r", "g", "b"];
    const S = {
      ch: "rgb",
      pts: { rgb: [], r: [], g: [], b: [] },   // {x, y} 0..1
      histBase: null,
    };
    function resetPts() {
      S.pts = { rgb: [], r: [], g: [], b: [] };
    }
    const PRESETS = [
      { name: "柔 S", pts: [[0.28, 0.22], [0.72, 0.78]] },
      { name: "胶片提亮", pts: [[0, 0.09], [0.3, 0.38], [1, 0.96]] },
      { name: "哑光", pts: [[0, 0.12], [0.25, 0.34], [0.75, 0.8], [1, 0.93]] },
      { name: "硬对比", pts: [[0.38, 0.16], [0.62, 0.84]] },
    ];
    function splineLUT(pts) {
      // 单调三次插值（Fritsch–Carlson 简化）→ 256 格 LUT
      const P = pts.map((p) => [p.x, p.y]).sort((a, b) => a[0] - b[0]);
      const full = [[0, 0], ...P, [1, 1]].filter((p, i, arr) => i === 0 || p[0] > arr[i - 1][0]);
      if (full.length < 2) full.push([1, 1]);
      const n = full.length;
      const dx = [], dy = [], slope = [], m = new Array(n);
      for (let i = 0; i < n - 1; i++) { dx.push(full[i + 1][0] - full[i][0]); dy.push(full[i + 1][1] - full[i][1]); slope.push(dy[i] / (dx[i] || 1e-6)); }
      m[0] = slope[0]; m[n - 1] = slope[n - 2];
      for (let i = 1; i < n - 1; i++) m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
      for (let i = 0; i < n - 1; i++) {
        if (slope[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
        const a = m[i] / slope[i], b2 = m[i + 1] / slope[i];
        const s2 = a * a + b2 * b2;
        if (s2 > 9) { const tk = 3 / Math.sqrt(s2); m[i] = a * tk * slope[i]; m[i + 1] = b2 * tk * slope[i]; }
      }
      return makeLUT((v) => {
        const x = v / 255;
        if (x <= full[0][0]) return full[0][1] * 255;
        if (x >= full[n - 1][0]) return full[n - 1][1] * 255;
        let i = 0;
        while (i < n - 2 && x > full[i + 1][0]) i++;
        const t = (x - full[i][0]) / dx[i];
        const h00 = (1 + 2 * t) * (1 - t) * (1 - t), h10 = t * (1 - t) * (1 - t), h01 = t * t * (3 - 2 * t), h11 = t * t * (t - 1);
        return (h00 * full[i][1] + h10 * dx[i] * m[i] + h01 * full[i + 1][1] + h11 * dx[i] * m[i + 1]) * 255;
      });
    }
    function lutFor(ch) {
      const pts = S.pts[ch];
      if (!pts || !pts.length) return null;
      return splineLUT(pts);
    }
    let baseSnapshot = null;
    function render() {
      const W = cv.width, H = cv.height;
      ctx.fillStyle = "#121116"; ctx.fillRect(0, 0, W, H);
      if (!IMGS.still) return;
      if (!baseSnapshot) {
        const sc = Math.max(W / IMGS.still.width, H / IMGS.still.height);
        ctx.save(); ctx.filter = BASE_FILTER;
        ctx.drawImage(IMGS.still, (W - sc * IMGS.still.width) / 2, (H - sc * IMGS.still.height) / 2, sc * IMGS.still.width, sc * IMGS.still.height);
        ctx.restore();
        baseSnapshot = ctx.getImageData(0, 0, W, H);
      }
      const img = new ImageData(new Uint8ClampedArray(baseSnapshot.data), W, H);
      const lr = lutFor("rgb") || lutFor("r"), lg = lutFor("rgb") || lutFor("g"), lb = lutFor("rgb") || lutFor("b");
      if (S.ch === "rgb") {
        if (lutFor("rgb")) applyLUT(img, lr, lg, lb);
      } else if (S.ch === "r") {
        applyLUT(img, lutFor("r") || ID_LUT, ID_LUT, ID_LUT);
      } else if (S.ch === "g") {
        applyLUT(img, ID_LUT, lutFor("g") || ID_LUT, ID_LUT);
      } else {
        applyLUT(img, ID_LUT, ID_LUT, lutFor("b") || ID_LUT);
      }
      ctx.putImageData(img, 0, 0);
      drawEditor();
    }
    const ID_LUT = makeLUT((v) => v);
    function drawEditor() {
      const W = ed.width, H = ed.height, PAD = 26;
      ec.fillStyle = "#141318"; ec.fillRect(0, 0, W, H);
      const gx = (t) => PAD + t * (W - PAD * 2);
      const gy = (t) => H - PAD - t * (H - PAD * 2);
      ec.strokeStyle = "#2c2b33";
      for (let i = 0; i <= 4; i++) {
        ec.beginPath(); ec.moveTo(gx(i / 4), gy(0)); ec.lineTo(gx(i / 4), gy(1)); ec.stroke();
        ec.beginPath(); ec.moveTo(gx(0), gy(i / 4)); ec.lineTo(gx(1), gy(i / 4)); ec.stroke();
      }
      ec.strokeStyle = "#3f3e46";
      ec.beginPath(); ec.moveTo(gx(0), gy(0)); ec.lineTo(gx(1), gy(1)); ec.stroke();
      // 直方图底纹
      if (S.histBase) {
        const mx = Math.max.apply(null, S.histBase);
        ec.fillStyle = "rgba(154,151,166,.28)";
        for (let i = 0; i < 64; i++) {
          const h = S.histBase[i] / mx * (H - PAD * 2);
          ec.fillRect(gx(i / 64), gy(0) - h, W / 64 - 1, h);
        }
      }
      const col = { rgb: "#e8e4d8", r: "#d06a5a", g: "#7fae6a", b: "#6a8fd0" }[S.ch];
      const lut = lutFor(S.ch);
      if (lut) {
        ec.strokeStyle = col; ec.lineWidth = 2.2;
        ec.beginPath();
        for (let v = 0; v <= 255; v += 2) {
          const px = gx(v / 255), py = gy(lut[v] / 255);
          v === 0 ? ec.moveTo(px, py) : ec.lineTo(px, py);
        }
        ec.stroke();
      }
      for (const p of (S.pts[S.ch] || [])) {
        ec.beginPath(); ec.arc(gx(p.x), gy(p.y), 5.5, 0, 7);
        ec.fillStyle = col; ec.fill();
        ec.strokeStyle = "#141318"; ec.lineWidth = 2; ec.stroke();
      }
      ec.fillStyle = "#8a879c"; ec.font = "9px monospace";
      ec.fillText("输入 →", W - 52, H - 8);
      ec.save(); ec.translate(10, 40); ec.rotate(-Math.PI / 2); ec.fillText("输出 →", 0, 0); ec.restore();
    }
    function hitPoint(mx, my) {
      const W = ed.width, H = ed.height, PAD = 26;
      const gx = (t) => PAD + t * (W - PAD * 2);
      const gy = (t) => H - PAD - t * (H - PAD * 2);
      let best = -1, bd = 14;
      (S.pts[S.ch] || []).forEach((p, i) => {
        const d = Math.hypot(mx - gx(p.x), my - gy(p.y));
        if (d < bd) { bd = d; best = i; }
      });
      return best;
    }
    function toNorm(e) {
      const r = ed.getBoundingClientRect();
      return [Math.max(0, Math.min(1, (e.clientX - r.left - 26) / (r.width - 52))),
              Math.max(0, Math.min(1, 1 - (e.clientY - r.top - 26) / (r.height - 52)))];
    }
    let dragIdx = -1;
    ed.addEventListener("pointerdown", (e) => {
      const [nx, ny] = toNorm(e);
      const i = hitPoint(e.clientX, e.clientY);
      if (i >= 0) { dragIdx = i; return; }
      S.pts[S.ch].push({ x: nx, y: ny });
      dragIdx = S.pts[S.ch].length - 1;
      render();
    });
    ed.addEventListener("pointermove", (e) => {
      if (dragIdx < 0) return;
      const [nx, ny] = toNorm(e);
      const arr = S.pts[S.ch];
      arr[dragIdx] = { x: nx, y: ny };
      render();
    });
    ed.addEventListener("dblclick", (e) => {
      const i = hitPoint(e.clientX, e.clientY);
      if (i >= 0) { S.pts[S.ch].splice(i, 1); render(); }
    });
    addEventListener("pointerup", () => { dragIdx = -1; });
    $("#cvc-tabs").addEventListener("click", (e) => {
      const b = e.target.closest("[data-ch]");
      if (!b) return;
      S.ch = b.dataset.ch;
      $$("#cvc-tabs .chip").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.ch === S.ch)));
      render();
    });
    $("#cvc-presets").innerHTML = PRESETS.map((p, i) => '<button class="ghost" data-i="' + i + '">' + p.name + "</button>").join("");
    $$("#cvc-presets button").forEach((b) => {
      b.onclick = () => {
        resetPts();
        S.pts[S.ch] = PRESETS[+b.dataset.i].pts.map((p) => ({ x: p[0], y: p[1] }));
        render();
      };
    });
    window.__rr.push(render);
    render();
  })();


  /* ═══ DEMO 05 · HSL 全通道台（8 色带 + 羽化权重 + 全局白平衡）═══ */
  (() => {
    const cv = $("#hs-cv");
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const CASES = {
      cafe: { img: "cafe", band: "orange", h: 0, s: 0, l: 0, t: -7, note: "<b>病人乙：</b>钨丝灯把整张染橙——先用底部「白平衡」全局归位（−7），再选「橙」色带微降饱和，木质桌面退后，拉花与书凸出。" },
      still: { img: "still", band: "green", h: 0, s: 8, l: -12, t: 1, note: "<b>病人甲：</b>闷绿的病根是明度混白——选「绿」带：饱和 +8、明度 −12，叶子沉下去，粉花枝与青瓷瓶凸出。全局饱和度没动过。" },
    };
    const S = { case: "cafe", band: "orange", h: 0, s: 0, l: 0, t: -7 };
    let hsvCache = null, cacheKey = "";
    function buildHsv() {
      const W = cv.width, H = cv.height;
      const key = S.case;
      if (cacheKey === key && hsvCache) return;
      const img = IMGS[S.case];
      if (!img) return;
      const sc = Math.max(W / img.width, H / img.height);
      const tmp = document.createElement("canvas");
      tmp.width = W; tmp.height = H;
      const t2 = tmp.getContext("2d");
      t2.save();
      t2.filter = S.case === "still" ? BASE_FILTER : "brightness(0.9)";
      t2.drawImage(img, (W - sc * img.width) / 2, (H - sc * img.height) / 2, sc * img.width, sc * img.height);
      t2.restore();
      const d = t2.getImageData(0, 0, W, H).data;
      const n = W * H;
      const Hh = new Float32Array(n), Ss = new Float32Array(n), Vv = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const hsv = rgb2hsv(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
        Hh[i] = hsv[0]; Ss[i] = hsv[1]; Vv[i] = hsv[2];
      }
      hsvCache = { Hh, Ss, Vv };
      cacheKey = key;
    }
    function render() {
      const c = CASES[S.case];
      const W = cv.width, H = cv.height;
      ctx.fillStyle = "#121116"; ctx.fillRect(0, 0, W, H);
      buildHsv();
      if (!hsvCache) return;
      const { Hh, Ss, Vv } = hsvCache;
      const n = W * H;
      const out = ctx.createImageData(W, H);
      const d = out.data;
      const band = BANDS.find((b) => b.key === S.band);
      const satK = 1 + S.s / 100, lumK = 1 + S.l / 100;
      const tr = 1 + S.t * 0.028, tb = 1 - S.t * 0.028;
      for (let i = 0; i < n; i++) {
        const w = bandWeight(Hh[i], band.center) * (Ss[i] > 0.08 ? 1 : Ss[i] / 0.08);
        let h = Hh[i] + S.h * w;
        let s = Math.min(1, Math.max(0, Ss[i] * (1 + (satK - 1) * w)));
        let v = Math.min(1, Math.max(0, Vv[i] * (1 + (lumK - 1) * w)));
        const rgb = hsv2rgb(((h % 360) + 360) % 360, s, v);
        d[i * 4] = Math.min(255, rgb[0] * tr);
        d[i * 4 + 1] = Math.min(255, rgb[1]);
        d[i * 4 + 2] = Math.min(255, rgb[2] * tb);
        d[i * 4 + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
      $("#hs-hv").textContent = (S.h > 0 ? "+" : "") + S.h;
      $("#hs-sv").textContent = (S.s > 0 ? "+" : "") + S.s;
      $("#hs-lv").textContent = (S.l > 0 ? "+" : "") + S.l;
      $("#hs-tv").textContent = (S.t > 0 ? "+" : "") + S.t;
      $("#hs-kv").innerHTML =
        "<span>当前色带</span><b>" + band.name + "（" + band.center + "°）</b>" +
        "<span>色相 / 饱和 / 明度</span><b>" + (S.h || 0) + "° / " + (S.s > 0 ? "+" : "") + S.s + " / " + (S.l > 0 ? "+" : "") + S.l + "</b>" +
        "<span>白平衡</span><b" + (S.t !== 0 ? " class=\"fix\"" : "") + ">" + (S.t === 0 ? "未动" : S.t < 0 ? "加蓝 " + (-S.t * 2.8).toFixed(1) + "%" : "加暖 " + (S.t * 2.8).toFixed(1) + "%") + "</b>";
      $("#hs-note").innerHTML = c.note;
    }
    function loadCase(key) {
      const c = CASES[key];
      S.case = key; S.band = c.band; S.h = c.h; S.s = c.s; S.l = c.l; S.t = c.t;
      $("#hs-h").value = S.h; $("#hs-s").value = S.s; $("#hs-l").value = S.l; $("#hs-t").value = S.t;
      $$("#hs-bands .chip").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === S.band)));
      $("#hs-hv").textContent = (S.h > 0 ? "+" : "") + S.h;
      $("#hs-sv").textContent = (S.s > 0 ? "+" : "") + S.s;
      $("#hs-lv").textContent = (S.l > 0 ? "+" : "") + S.l;
      render();
    }
    $("#hs-bands").innerHTML = BANDS.map((b) => '<button class="chip" data-k="' + b.key + '">' + b.name + "</button>").join("");
    $$("#hs-bands .chip").forEach((b) => { b.onclick = () => { S.band = b.dataset.k; $$("#hs-bands .chip").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.k === S.band))); render(); }; });
    $("#hs-h").addEventListener("input", () => { S.h = +$("#hs-h").value; render(); });
    $("#hs-s").addEventListener("input", () => { S.s = +$("#hs-s").value; render(); });
    $("#hs-l").addEventListener("input", () => { S.l = +$("#hs-l").value; render(); });
    $("#hs-t").addEventListener("input", () => { S.t = +$("#hs-t").value; render(); });
    $("#hs-case1").addEventListener("click", () => loadCase("cafe"));
    $("#hs-case2").addEventListener("click", () => loadCase("still"));
    $("#hs-reset").addEventListener("click", () => loadCase(S.case));
    loadCase("cafe");
    window.__rr.push(loadCase);
  })();

  /* ═══ D4 局部光台 ═══ */
  (() => {
    const cv = $("#lg-cv");
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const S = { v: 14, l: 12 };
    function render() {
      const W = cv.width, H = cv.height;
      ctx.fillStyle = "#121116"; ctx.fillRect(0, 0, W, H);
      if (!IMGS.still) return;
      const sc = Math.max(W / IMGS.still.width, H / IMGS.still.height);
      const w = IMGS.still.width * sc, h = IMGS.still.height * sc;
      ctx.save();
      ctx.filter = BASE_FILTER;
      ctx.drawImage(IMGS.still, (W - w) / 2, (H - h) / 2, w, h);
      ctx.restore();
      const img = ctx.getImageData(0, 0, W, H);
      tonePixels(img.data, 0.7, 8, 4);
      ctx.putImageData(img, 0, 0);
      // 渐晕：径向暗角
      const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.72);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(8,7,10," + (S.v / 100).toFixed(2) + ")");
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
      // 主体提亮：中心径向亮斑（soft-light 近似）
      const lg = ctx.createRadialGradient(W * 0.6, H * 0.62, 30, W * 0.6, H * 0.62, W * 0.3);
      lg.addColorStop(0, "rgba(255,238,205," + (S.l / 100 * 0.5).toFixed(2) + ")");
      lg.addColorStop(1, "rgba(255,238,205,0)");
      ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);
      $("#lg-vv").textContent = S.v + "%";
      $("#lg-lv").textContent = S.l + "%";
      $("#lg-kv").innerHTML =
        "<span>渐晕强度</span><b>" + (S.v > 24 ? "过猛（一眼假）" : S.v >= 10 ? "自然区间" : "几乎不可见") + "</b>" +
        "<span>主体提亮</span><b>" + (S.l > 22 ? "灯感过重" : S.l >= 8 ? "柔和聚焦" : "未起效") + "</b>" +
        "<span>视线引导</span><b>" + (S.v + S.l >= 18 ? "舞台感成立" : "还很平") + "</b>";
    }
    $("#lg-v").addEventListener("input", () => { S.v = +$("#lg-v").value; render(); });
    $("#lg-l").addEventListener("input", () => { S.l = +$("#lg-l").value; render(); });
    render();
    window.__rr.push(render);
  })();

  /* ═══ D5 Before/After 总装 ═══ */
  (() => {
    const cv = $("#ba-cv");
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const STEPS = [
      { key: "tone", name: "影调", desc: "曝光 +0.7EV · 对比 +8 · 高光回收" },
      { key: "green", name: "绿色 HSL", desc: "饱和 +3 · 明度微降" },
      { key: "local", name: "局部光", desc: "渐晕 14% · 主体提亮 12%" },
    ];
    const S = { on: { tone: true, green: true, local: true }, split: 0.5 };
    const off = document.createElement("canvas");
    off.width = cv.width; off.height = cv.height;
    function pipeline(onSteps) {
      const W = off.width, H = off.height;
      const octx = off.getContext("2d");
      octx.fillStyle = "#121116"; octx.fillRect(0, 0, W, H);
      if (!IMGS.still) return;
      const sc = Math.max(W / IMGS.still.width, H / IMGS.still.height);
      octx.save();
      octx.filter = BASE_FILTER;
      octx.drawImage(IMGS.still, (W - sc * IMGS.still.width) / 2, (H - sc * IMGS.still.height) / 2, sc * IMGS.still.width, sc * IMGS.still.height);
      octx.restore();
      const img = octx.getImageData(0, 0, W, H);
      if (onSteps.tone) tonePixels(img.data, 0.7, 8, 4);
      if (onSteps.green) applyGreen(img.data);
      octx.putImageData(img, 0, 0);
      if (onSteps.local) {
        const vg = octx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.72);
        vg.addColorStop(0, "rgba(0,0,0,0)");
        vg.addColorStop(1, "rgba(8,7,10,.14)");
        octx.fillStyle = vg; octx.fillRect(0, 0, W, H);
        const lg2 = octx.createRadialGradient(W * 0.6, H * 0.62, 30, W * 0.6, H * 0.62, W * 0.3);
        lg2.addColorStop(0, "rgba(255,238,205,.24)");
        lg2.addColorStop(1, "rgba(255,238,205,0)");
        octx.fillStyle = lg2; octx.fillRect(0, 0, W, H);
      }
      return octx;
    }
    function applyGreen(d) {
      for (let p = 0; p < d.length; p += 4) {
        const r = d[p], g = d[p + 1], b = d[p + 2];
        if (g > 52 && g > r * 1.06 && g > b * 1.06) {
          const m = (r + g + b) / 3;
          d[p + 1] = Math.max(0, Math.min(255, m + (g - m) * 1.27) - 4);
        }
      }
    }
    function render() {
      const W = cv.width, H = cv.height;
      ctx.fillStyle = "#121116"; ctx.fillRect(0, 0, W, H);
      if (!IMGS.still) return;
      pipeline(S.on);                      // 成片
      ctx.drawImage(off, 0, 0);
      // 左侧：直出（从原始照片直接采样）
      const sc = Math.max(W / IMGS.still.width, H / IMGS.still.height);
      const w = IMGS.still.width * sc, h = IMGS.still.height * sc;
      const split = W * S.split;
      ctx.save();
      ctx.filter = BASE_FILTER;
      ctx.beginPath(); ctx.rect(0, 0, split, H); ctx.clip();
      ctx.drawImage(IMGS.still, (W - w) / 2, (H - h) / 2, w, h);
      ctx.restore();
      $("#ba-divider").style.left = (S.split * 100) + "%";
      const active = STEPS.filter((s2) => S.on[s2.key]).map((s2) => s2.name);
      $("#ba-read").innerHTML = active.length
        ? "当前成片管线：<b>" + active.join(" → ") + "</b>（右半边）。左半边是同一张底片的直出。关掉任意步骤，对比它的贡献。"
        : "所有步骤都关掉了——右边也回到了直出。这就是「全管线」的权重：一步一个台阶。";
    }
    $("#ba-steps").innerHTML = STEPS.map((s2) => '<button class="chip" data-k="' + s2.key + '" aria-pressed="true" title="' + s2.desc + '">' + s2.name + "</button>").join("");
    $$("#ba-steps .chip").forEach((b) => { b.onclick = () => { S.on[b.dataset.k] = !S.on[b.dataset.k]; b.setAttribute("aria-pressed", String(S.on[b.dataset.k])); render(); }; });
    const stage = $("#ba-stage");
    let dragging = false;
    function setSplit(clientX) {
      const r = stage.getBoundingClientRect();
      S.split = Math.max(0.05, Math.min(0.95, (clientX - r.left) / r.width));
      render();
    }
    stage.addEventListener("pointerdown", (e) => { dragging = true; setSplit(e.clientX); });
    window.addEventListener("pointermove", (e) => { if (dragging) setSplit(e.clientX); });
    window.addEventListener("pointerup", () => { dragging = false; });
    render();
    window.__rr.push(render);
  })();
})();
