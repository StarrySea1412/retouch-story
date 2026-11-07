
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
