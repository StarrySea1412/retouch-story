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
