/**
 * The signed-out backdrop — the two provenance fronts woven into one band.
 *
 * `ours` (prussian) owns the upper half, `theirs` (oxide) the lower; through a
 * turbulence swell just past centre their paths cross, and that weave reads as
 * the merge. The field drifts continuously at low amplitude.
 *
 * Purely decorative: `aria-hidden`, `pointer-events: none`, and it never blocks
 * the gate. Performance guards — DPR capped at 2, the frame throttled to ~40fps,
 * the loop paused while the tab is hidden, and a single static frame (no loop)
 * under `prefers-reduced-motion`.
 */

import { useEffect, useRef } from "react";

const TAU = Math.PI * 2;
const NP = 84; // points per strand
const COUNT = 156; // strands across the band
const BAND_T = 0.055;
const BAND_B = 0.945;
const FRAME_MS = 24;

type Strand = {
  fam: "ours" | "theirs";
  s: number;
  w1: number;
  w2: number;
  ph1: number;
  ph2: number;
  seed: number;
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const frac = (x: number) => x - Math.floor(x);
const rnd = (i: number) => frac(Math.sin(i * 127.1 + 11.3) * 43758.5);

export function SignInField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const darkMq = window.matchMedia("(prefers-color-scheme: dark)");

    let W = 0;
    let H = 0;
    let DPR = 1;
    let strands: Strand[] = [];
    let raf = 0;
    let driftStart = 0;
    let lastTs = 0;
    let resizeTimer = 0;

    const col = { ours: "#153a5e", theirs: "#9a3c0b", line: "#a89a78" };

    const readColors = () => {
      const cs = getComputedStyle(document.documentElement);
      col.ours = cs.getPropertyValue("--ours").trim() || col.ours;
      col.theirs = cs.getPropertyValue("--theirs").trim() || col.theirs;
      col.line = cs.getPropertyValue("--line-strong").trim() || col.line;
    };

    const build = () => {
      strands = [];
      for (let i = 0; i < COUNT; i++) {
        const s = i / (COUNT - 1);
        let fam: Strand["fam"];
        if (s < 0.455) fam = "ours";
        else if (s > 0.545) fam = "theirs";
        else fam = i % 2 === 0 ? "ours" : "theirs";
        strands.push({
          fam,
          s,
          w1: 0.7 + 1.5 * rnd(i * 2 + 1),
          w2: 2.1 + 3.6 * rnd(i * 2 + 7),
          ph1: s * 13 + rnd(i) * TAU + (fam === "ours" ? 0 : 1.7),
          ph2: rnd(i * 3 + 4) * TAU,
          seed: (fam === "ours" ? 0 : 200) + i * 1.3,
        });
      }
    };

    // quiet at the left edge, swelling to a turbulence peak past centre, never flat
    const ampEnv = (k: number) => {
      let m = 0.14 + 0.94 * Math.sin(Math.pow(clamp(k, 0, 1), 0.82) * Math.PI);
      if (k > 0.55) m = Math.max(m, 0.4);
      return m;
    };

    const pointAt = (st: Strand, k: number, dT: number): [number, number] => {
      const x = k * W;
      const amp = ampEnv(k) * H * 0.042;
      // `- dT` on every phase term makes constant-phase points travel toward
      // higher k — i.e. the field drifts left → right
      const dy =
        Math.sin(k * TAU * st.w1 + st.ph1 - dT * 0.45) * amp +
        Math.sin(k * TAU * st.w2 + st.ph2 - dT * 0.9) * amp * 0.42 +
        Math.sin(k * TAU * 0.6 + st.s * 3.0 - dT * 0.18) * amp * 0.55;
      return [x, lerp(BAND_T, BAND_B, st.s) * H + dy];
    };

    // fade strands toward the top and bottom lips of the band
    const dens = (st: Strand) => {
      const e = smoothstep(0, 0.12, st.s) * smoothstep(0, 0.12, 1 - st.s);
      return 0.1 + 0.2 * e;
    };

    const guides = () => {
      ctx.save();
      ctx.strokeStyle = col.line;
      ctx.lineWidth = 1;
      const gap = 154;
      const r = 3;
      for (let gx = gap * 0.8; gx < W; gx += gap) {
        for (let gy = gap * 0.7; gy < H; gy += gap) {
          const seed = frac(Math.sin(gx * 12.9 + gy * 78.2) * 43758.5);
          if (seed > 0.42) continue;
          ctx.globalAlpha = 0.26 + 0.2 * seed;
          ctx.beginPath();
          ctx.moveTo(gx - r, gy);
          ctx.lineTo(gx + r, gy);
          ctx.moveTo(gx, gy - r);
          ctx.lineTo(gx, gy + r);
          ctx.stroke();
        }
      }
      ctx.restore();
    };

    const render = (dT: number) => {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, W, H);
      guides();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let n = 0; n < strands.length; n++) {
        const st = strands[n];
        ctx.beginPath();
        for (let j = 0; j < NP; j++) {
          const [px, py] = pointAt(st, j / (NP - 1), dT);
          if (j === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = st.fam === "ours" ? col.ours : col.theirs;
        ctx.globalAlpha = dens(st);
        ctx.lineWidth = 0.75;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    const resize = () => {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = cv.clientWidth;
      H = cv.clientHeight;
      cv.width = Math.round(W * DPR);
      cv.height = Math.round(H * DPR);
      build();
    };

    const loop = (ts: number) => {
      if (!driftStart) driftStart = ts;
      if (ts - lastTs >= FRAME_MS) {
        lastTs = ts;
        render((ts - driftStart) / 1000);
      }
      raf = requestAnimationFrame(loop);
    };

    const startLoop = () => {
      cancelAnimationFrame(raf);
      if (reduceMq.matches) {
        render(0);
        return;
      }
      driftStart = 0;
      lastTs = 0;
      raf = requestAnimationFrame(loop);
    };

    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        cancelAnimationFrame(raf);
        resize();
        if (reduceMq.matches) render(0);
        else startLoop();
      }, 150);
    };

    const onVisibility = () => {
      if (reduceMq.matches) return;
      if (document.hidden) cancelAnimationFrame(raf);
      else startLoop();
    };

    const onThemeChange = () => {
      readColors();
      if (reduceMq.matches) render(0);
    };

    // theme switches by toggling `data-theme` on <html>; system changes come
    // through the media query — either way, re-read the palette
    const themeObserver = new MutationObserver(onThemeChange);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    darkMq.addEventListener("change", onThemeChange);
    reduceMq.addEventListener("change", startLoop);
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);

    readColors();
    resize();
    startLoop();

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(resizeTimer);
      themeObserver.disconnect();
      darkMq.removeEventListener("change", onThemeChange);
      reduceMq.removeEventListener("change", startLoop);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} className="si-field" aria-hidden="true" />;
}
