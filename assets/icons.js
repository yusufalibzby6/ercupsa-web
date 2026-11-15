/* Eczacılık SVG ikon seti: Font Awesome web fontunun (~100 KB CSS + fontlar)
   yerine geçer. Sayfadaki <i class="fa-..."> öğeleri aynı adlarla satır içi
   SVG ile değiştirilir; sınıflar (renk, boyut, chev gibi) korunur.
   Sonradan eklenen içerik için MutationObserver kullanılır. */
(() => {
  "use strict";
  const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

  const ICONS = {
    "arrow-left": `<path ${STROKE} d="M19 12H5m7-7-7 7 7 7"/>`,
    "arrow-right": `<path ${STROKE} d="M5 12h14m-7-7 7 7-7 7"/>`,
    "arrow-up-from-bracket": `<path ${STROKE} d="M12 15V3m-5 5 5-5 5 5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>`,
    "arrow-up-right-from-square": `<path ${STROKE} d="M14 4h6v6M20 4 10 14M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>`,
    "calendar": `<rect ${STROKE} x="3" y="5" width="18" height="16" rx="3"/><path ${STROKE} d="M16 3v4M8 3v4M3 11h18"/>`,
    "calendar-day": `<rect ${STROKE} x="3" y="5" width="18" height="16" rx="3"/><path ${STROKE} d="M16 3v4M8 3v4M3 11h18M12 15v4m-2-2h4"/>`,
    "calendar-plus": `<rect ${STROKE} x="3" y="5" width="18" height="16" rx="3"/><path ${STROKE} d="M16 3v4M8 3v4M3 11h18M12 14v5m-2.5-2.5h5"/>`,
    "calendar-xmark": `<rect ${STROKE} x="3" y="5" width="18" height="16" rx="3"/><path ${STROKE} d="M16 3v4M8 3v4M3 11h18m-3.5 1.5-4 4m0-4 4 4"/>`,
    "chevron-down": `<path ${STROKE} d="m6 9 6 6 6-6"/>`,
    "clock": `<circle ${STROKE} cx="12" cy="12" r="9"/><path ${STROKE} d="M12 7v5l3 2"/>`,
    "compass": `<circle ${STROKE} cx="12" cy="12" r="9"/><path ${STROKE} d="m15.5 8.5-2 5-5 2 2-5Z"/>`,
    "flask": `<path ${STROKE} d="M9 3h6M10 3v5.5L4.8 18a2 2 0 0 0 1.7 3h11a2 2 0 0 0 1.7-3L14 8.5V3M7.5 14h9"/>`,
    "hand-holding-heart": `<path ${STROKE} d="M11 13.5S6.8 11 5.9 9A2.8 2.8 0 0 1 11 7.6 2.8 2.8 0 0 1 16.1 9c-.9 2-5.1 4.5-5.1 4.5Z"/><path ${STROKE} d="M4 17.5c2 1.7 4.5 2.3 8 2.3s6-.6 8-2.3"/>`,
    "hands-holding-circle": `<circle ${STROKE} cx="12" cy="7.5" r="3.5"/><path ${STROKE} d="M5 13.5c-.7 1.2-1 2.3-1 3.5 1.6 1.7 4 2.5 8 2.5s6.4-.8 8-2.5c0-1.2-.3-2.3-1-3.5"/><path ${STROKE} d="M5 13.5c1.4-.9 3-1.5 4-1.7M19 13.5c-1.4-.9-3-1.5-4-1.7"/>`,
    "images": `<rect ${STROKE} x="3" y="7" width="16" height="13" rx="2"/><path ${STROKE} d="M8 3h11a2 2 0 0 1 2 2v11"/><circle ${STROKE} cx="8" cy="12" r="1.6"/><path ${STROKE} d="m4 18 5-5 4 4 2.5-2.5L19 17"/>`,
    "instagram": `<rect ${STROKE} x="3" y="3" width="18" height="18" rx="5"/><circle ${STROKE} cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none"/>`,
    "linkedin-in": `<path fill="currentColor" stroke="none" d="M6.9 8.6v11.6H3.5V8.6h3.4Zm.2-3.4a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM20.5 14v6.2h-3.4v-5.8c0-1.3-.5-2.2-1.7-2.2-.9 0-1.5.6-1.7 1.3-.1.2-.1.6-.1.9v5.8h-3.4s.1-10.5 0-11.6h3.4v1.6c.4-.7 1.3-1.7 3-1.7 2.2 0 3.9 1.4 3.9 4.5Z"/>`,
    "location-dot": `<path ${STROKE} d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z"/><circle ${STROKE} cx="12" cy="10" r="2.5"/>`,
    "microscope": `<path ${STROKE} d="M6 21h12M3 21h18"/><path ${STROKE} d="M9 14h2M9 12.5V6h4v6.5M9 12.5a2 2 0 0 1-1-1.7V6M13 12.5a2 2 0 0 0 1-1.7V6"/><path ${STROKE} d="m12.5 6 4.6 2.6a4.2 4.2 0 0 1-4.6 7"/><path ${STROKE} d="M11 17.5a3 3 0 0 0 5.9.8"/>`,
    "paper-plane": `<path ${STROKE} d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"/>`,
    "people-group": `<circle ${STROKE} cx="9" cy="8" r="3.2"/><path ${STROKE} d="M3 20a6 6 0 0 1 12 0M16.5 5a3.2 3.2 0 0 1 0 6.4M17 14.2A6 6 0 0 1 21 20"/>`,
    "rotate-right": `<path ${STROKE} d="M21 12a9 9 0 1 1-9-9c2.6 0 4.9 1.1 6.6 2.8L21 8"/><path ${STROKE} d="M21 3v5h-5"/>`,
    "route": `<circle ${STROKE} cx="6" cy="19" r="2.5"/><circle ${STROKE} cx="18" cy="5" r="2.5"/><path ${STROKE} d="M8.5 19H14a4 4 0 0 0 0-8h-4a4 4 0 0 1 0-8h1.5"/>`,
    "share-nodes": `<circle ${STROKE} cx="6" cy="12" r="2.5"/><circle ${STROKE} cx="18" cy="6" r="2.5"/><circle ${STROKE} cx="18" cy="18" r="2.5"/><path ${STROKE} d="m8.3 10.8 7.4-3.6M8.3 13.2l7.4 3.6"/>`,
    "spinner": `<path ${STROKE} d="M12 3a9 9 0 1 0 9 9"/>`,
    "whatsapp": `<path ${STROKE} d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3Z"/><path fill="currentColor" stroke="none" d="M8.9 7.7c.3 0 .5.2.7.6l.7 1.6c.1.3 0 .6-.2.8l-.6.7c.5 1.2 1.6 2.3 2.8 2.8l.7-.6c.2-.2.5-.3.8-.2l1.6.7c.4.2.6.4.6.7 0 1.6-1.3 2.4-2.6 2.3-3.5-.3-6.4-3.2-6.7-6.7-.1-1.3.7-2.7 2.2-2.7Z"/>`,
  };

  const replace = (element) => {
    // fa-solid/fa-brands/fa-regular ön ekleri ve fa-spin gibi yardımcı
    // sınıflar da fa- ile başlar; yalnızca kayıtlı ikon adını seç.
    const candidates = [...element.classList].filter((cls) => /^fa-[a-z0-9-]+$/.test(cls)).map((cls) => cls.slice(3));
    const name = candidates.find((candidate) => Object.prototype.hasOwnProperty.call(ICONS, candidate));
    if (!name) return;
    const icon = ICONS[name];
    const holder = document.createElement("span");
    const keep = [...element.classList].filter((cls) => cls !== `fa-${name}` && !["fa-solid", "fa-brands", "fa-regular"].includes(cls));
    holder.className = `ercupsa-icon ${keep.join(" ").trim()}`;
    holder.setAttribute("aria-hidden", "true");
    holder.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`;
    element.replaceWith(holder);
  };

  const enhance = (root) => {
    if (!root || typeof root.querySelectorAll !== "function") return;
    if (root.matches?.("i.fa-solid, i.fa-brands, i.fa-regular")) replace(root);
    for (const element of root.querySelectorAll("i.fa-solid, i.fa-brands, i.fa-regular")) replace(element);
  };

  enhance(document.body);
  new MutationObserver((records) => {
    for (const record of records)
      for (const node of record.addedNodes) if (node.nodeType === 1) enhance(node);
  }).observe(document.body, { childList: true, subtree: true });
})();
