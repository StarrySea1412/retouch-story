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
  makeHd({
    cv: "#hd-cv2", hist: "#hd-hist2", defaults: { ev: 0.7, con: 8, hr: 4 },
    inputs: [
      { id: "#hd-e2", key: "ev", out: "#hd-ev2", def: 0.7, fmt: fmtEV, scale: 10 },
      { id: "#hd-c2", key: "con", out: "#hd-cv3", def: 8, fmt: (v) => String(v) },
      { id: "#hd-h", key: "hr", out: "#hd-hv", def: 4, fmt: (v) => String(v) },
    ],
    spreadEl: "#hd-spread", diagEl: "#hd-diag2", after: true,
    outIds: ["#hd-med2"],
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

  /* ═══ D3 白平衡 + HSL ═══ */
  (() => {
    const cv = $("#wb-cv");
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const CASES = {
      cafe: { img: "cafe", t: -7, g: -2, s: 0, name: "病人乙 · 咖啡馆偏橙", note: "<b>处方逻辑：</b>钨丝灯把白杯染成橙黄——色温滑杆往冷侧走（加蓝减红），整张退潮归位；色调微降找回杯身的中性。看白杯子：它变灰白了，全图就归位了。" },
      still: { img: "still", t: 1, g: 0, s: 3, name: "病人甲 · 绿色发闷", note: "<b>处方逻辑：</b>闷绿不是饱和不够，是明度混了白。绿色饱和 +3、明度微降（HSL 通道处理），叶子沉下去，粉花枝凸出来——全局饱和度一根手指都没碰。" },
    };
    const S = { case: "cafe", t: -7, g: -2, s: 0 };
    function applyPix(d, t, g, sGreen) {
      const tr = 1 + t * 0.028, tb = 1 - t * 0.028, tg = 1 - Math.abs(g) * 0.012 * (g < 0 ? 1 : -0.5);
      for (let p = 0; p < d.length; p += 4) {
        d[p] = Math.max(0, Math.min(255, d[p] * tr));
        d[p + 2] = Math.max(0, Math.min(255, d[p + 2] * tb));
        d[p + 1] = Math.max(0, Math.min(255, d[p + 1] * tg));
        if (sGreen !== 0) {
          const r = d[p], gg = d[p + 1], b = d[p + 2];
          if (gg > 52 && gg > r * 1.06 && gg > b * 1.06) {   // 绿色区间
            const m = (r + gg + b) / 3;
            d[p + 1] = Math.max(0, Math.min(255, m + (gg - m) * (1 + sGreen * 0.09)));
            d[p + 1] = Math.max(0, Math.min(255, d[p + 1] - sGreen * 1.4));
          }
        }
      }
    }
    function render() {
      const c = CASES[S.case];
      const W = cv.width, H = cv.height;
      ctx.fillStyle = "#121116"; ctx.fillRect(0, 0, W, H);
      const img = IMGS[c.img];
      if (!img) return;
      const sc = Math.max(W / img.width, H / img.height);
      const w = img.width * sc, h = img.height * sc;
      ctx.save();
      ctx.filter = c.img === "still" ? BASE_FILTER : "brightness(0.9)";
      ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
      ctx.restore();
      const im = ctx.getImageData(0, 0, W, H);
      applyPix(im.data, S.t, S.g, S.s);
      ctx.putImageData(im, 0, 0);
      $("#wb-tv").textContent = (S.t > 0 ? "+" : "") + S.t;
      $("#wb-gv").textContent = (S.g > 0 ? "+" : "") + S.g;
      $("#wb-sv").textContent = (S.s > 0 ? "+" : "") + S.s;
      $("#wb-kv").innerHTML =
        "<span>当前病例</span><b>" + c.name + "</b>" +
        "<span>色温处方</span><b>" + (S.t === 0 ? "已归位" : S.t < 0 ? "加蓝 " + (-S.t * 2.8) + "%" : "加暖 " + (S.t * 2.8) + "%") + "</b>" +
        "<span>HSL 通道</span><b>" + (S.s === 0 ? "未动" : "绿色饱和 " + (S.s > 0 ? "+" : "") + S.s + " · 明度 −" + Math.round(S.s * 1.4)) + "</b>";
      $("#wb-note").innerHTML = c.note;
    }
    function loadCase(key = "cafe") {
      const c = CASES[key];
      S.case = key; S.t = c.t; S.g = c.g; S.s = c.s;
      $("#wb-t").value = S.t; $("#wb-g").value = S.g; $("#wb-s").value = S.s;
      $("#wb-case1").setAttribute("aria-pressed", String(key === "cafe"));
      $("#wb-case2").setAttribute("aria-pressed", String(key === "still"));
      render();
    }
    $("#wb-t").addEventListener("input", () => { S.t = +$("#wb-t").value; render(); });
    $("#wb-g").addEventListener("input", () => { S.g = +$("#wb-g").value; render(); });
    $("#wb-s").addEventListener("input", () => { S.s = +$("#wb-s").value; render(); });
    $("#wb-case1").addEventListener("click", () => loadCase("cafe"));
    $("#wb-case2").addEventListener("click", () => loadCase("still"));
    $("#wb-reset").addEventListener("click", () => loadCase(S.case));
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
