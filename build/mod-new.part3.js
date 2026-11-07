
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
        "<span>白平衡</span><b" + (S.t !== 0 ? " class=\"fix\"" : "") + ">" + (S.t === 0 ? "未动" : S.t < 0 ? "加蓝 " + (-S.t * 2.8) + "%" : "加暖 " + (S.t * 2.8) + "%") + "</b>";
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
