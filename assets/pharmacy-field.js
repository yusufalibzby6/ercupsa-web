/* Eczacılık sahnesi kurucu: molekül halkaları, kapsüller, haçlar ve bağ noktaları
   içeren üç katmanlı, kaydırmayla kayan (paralaks) bir arka plan üretir.
   Görüntü dosyası yüklemez; tüm formlar satır içi SVG'dir.
   Mevcut hareket sistemine saygı duyar: reduced/paused modda paralaks dursa da
   sahne statik olarak görünür kalır. */
(() => {
  "use strict";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");

  // Eklemeli SVG formları — her biri viewBox 0 0 100 100 içinde tanımlı.
  const HEX_RING = `<svg viewBox="0 0 100 100" fill="none" stroke="var(--field-ink)" stroke-width="2" aria-hidden="true"><path d="M50 12 82 31v38L50 88 18 69V31Z"/><circle cx="50" cy="12" r="5" fill="var(--field-ink-soft)" stroke="none"/><circle cx="82" cy="31" r="5" fill="var(--field-ink-soft)" stroke="none"/><circle cx="82" cy="69" r="5" fill="var(--field-ink-soft)" stroke="none"/><circle cx="50" cy="88" r="5" fill="var(--field-ink-soft)" stroke="none"/><circle cx="18" cy="69" r="5" fill="var(--field-ink-soft)" stroke="none"/><circle cx="18" cy="31" r="5" fill="var(--field-ink-soft)" stroke="none"/></svg>`;
  const CAPSULE = `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true"><rect x="18" y="38" width="64" height="24" rx="12" fill="var(--field-ink-soft)" opacity=".28"/><path d="M50 38h20a12 12 0 0 1 0 24H50Z" fill="var(--field-ink)" opacity=".4"/><rect x="18" y="38" width="64" height="24" rx="12" stroke="var(--field-ink)" stroke-width="2"/></svg>`;
  const CROSS = `<svg viewBox="0 0 100 100" fill="none" stroke="var(--field-ink)" stroke-width="7" stroke-linecap="round" aria-hidden="true"><path d="M50 26v48M26 50h48"/></svg>`;
  const MOLECULE = `<svg viewBox="0 0 100 100" fill="none" stroke="var(--field-line)" stroke-width="2" aria-hidden="true"><path d="M22 66 50 22l28 20-16 34Z"/><circle cx="22" cy="66" r="7" fill="var(--field-ink-soft)" stroke="none"/><circle cx="50" cy="22" r="7" fill="var(--field-ink)" opacity=".5" stroke="none"/><circle cx="78" cy="42" r="7" fill="var(--field-ink-soft)" stroke="none"/><circle cx="62" cy="76" r="7" fill="var(--field-ink-soft)" stroke="none"/></svg>`;
  const DROP = `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true"><path d="M50 16c14 18 22 28 22 39a22 22 0 1 1-44 0c0-11 8-21 22-39Z" fill="var(--field-ink)" opacity=".18" stroke="var(--field-ink)" stroke-width="2"/></svg>`;

  // Konumlar yüzde cinsinden; katmanlar görsel doğruluk için elle yerleştirildi.
  const SCENE = [
    { layer: "back", form: HEX_RING, top: "6%", left: "4%", size: 130, drift: "a", delay: -4 },
    { layer: "back", form: MOLECULE, top: "58%", left: "78%", size: 160, drift: "b", delay: -9 },
    { layer: "back", form: CROSS, top: "74%", left: "12%", size: 60, drift: "c", delay: -2 },
    { layer: "back", form: DROP, top: "22%", left: "86%", size: 70, drift: "c", delay: -6 },
    { layer: "mid", form: HEX_RING, top: "68%", left: "42%", size: 90, drift: "b", delay: -12 },
    { layer: "mid", form: CAPSULE, top: "16%", left: "58%", size: 110, drift: "a", delay: -7, rotate: -18 },
    { layer: "mid", form: MOLECULE, top: "38%", left: "8%", size: 100, drift: "c", delay: -15 },
    { layer: "mid", form: CROSS, top: "84%", left: "68%", size: 54, drift: "a", delay: -3 },
    { layer: "front", form: CAPSULE, top: "78%", left: "22%", size: 84, drift: "b", delay: -5, rotate: 24 },
    { layer: "front", form: HEX_RING, top: "12%", left: "30%", size: 66, drift: "c", delay: -11, spin: "slow" },
    { layer: "front", form: MOLECULE, top: "46%", left: "64%", size: 120, drift: "a", delay: -8 },
    { layer: "front", form: DROP, top: "60%", left: "92%", size: 46, drift: "b", delay: -1, pulse: "1" },
    { layer: "front", form: CROSS, top: "34%", left: "88%", size: 40, drift: "c", delay: -13 },
  ];

  const field = document.createElement("div");
  field.className = "pharmacy-field";
  field.setAttribute("aria-hidden", "true");
  const layers = {};
  for (const name of ["back", "mid", "front"]) {
    const layer = document.createElement("div");
    layer.className = `pharmacy-layer pharmacy-layer-${name}`;
    layers[name] = layer;
    field.append(layer);
  }
  for (const item of SCENE) {
    const shape = document.createElement("div");
    shape.className = "pharmacy-shape";
    shape.dataset.drift = item.drift;
    if (item.spin) shape.dataset.spin = item.spin;
    if (item.pulse) shape.dataset.pulse = item.pulse;
    shape.style.top = item.top;
    shape.style.left = item.left;
    shape.style.width = shape.style.height = `${item.size}px`;
    shape.style.animationDelay = `${item.delay}s`;
    if (item.rotate) shape.style.rotate = `${item.rotate}deg`;
    shape.innerHTML = item.form;
    layers[item.layer].append(shape);
  }
  document.body.append(field);

  // Kaydırmayla paralaks: her katman farklı hızda kayar, istek animasyon
  // çerçevesiyle sınırlandırılır. reduced-motion ve duraklatılmış modda kapalı.
  const factors = { back: 0.012, mid: 0.03, front: 0.055 };
  let frame = 0;
  const prefersMotion = () =>
    !reduced.matches && (!document.body.dataset.motionMode || document.body.dataset.motionMode === "full");
  const apply = () => {
    frame = 0;
    const y = Math.min(window.scrollY, 4000);
    for (const [name, layer] of Object.entries(layers))
      layer.style.transform = `translate3d(0, ${(-y * factors[name]).toFixed(1)}px, 0)`;
  };
  const onScroll = () => {
    if (!prefersMotion() || frame) return;
    frame = requestAnimationFrame(apply);
  };
  if (typeof requestAnimationFrame === "function") {
    addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", () => { if (document.hidden && frame) { cancelAnimationFrame(frame); frame = 0; } });
    if (window.scrollY) apply();
  }
})();
