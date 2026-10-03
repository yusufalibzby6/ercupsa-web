export const TICKET_DESIGN_WIDTH = 1116;
export const TICKET_DESIGN_HEIGHT = 588;
export const TICKET_DESIGN_MAX_BYTES = 3 * 1024 * 1024;
const validatedDesigns = new WeakSet();
const artworkByDesign = new WeakMap();
const artworkByUrl = new Map();

// A raster background only: SVG and remote URLs never enter printable markup.
export function validateStoredDesign(design) {
  if (design == null) return null;
  if (typeof design !== "object") throw new Error("Bilet tasarımı geçersiz.");
  if (validatedDesigns.has(design)) return design;
  if (
    design.width !== TICKET_DESIGN_WIDTH ||
    design.height !== TICKET_DESIGN_HEIGHT ||
    !["image/png", "image/jpeg"].includes(design.mime) ||
    typeof design.dataUrl !== "string" ||
    !design.dataUrl.startsWith(`data:${design.mime};base64,`) ||
    !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(design.dataUrl) ||
    design.dataUrl.length > Math.ceil(TICKET_DESIGN_MAX_BYTES * 4 / 3) + 32
  ) {
    throw new Error("Kaydedilmiş bilet tasarımı geçersiz. Tasarımı yeniden yükleyin veya standart tasarıma dönün.");
  }
  // Immutable records let repeated cards reuse validation and one small URL.
  Object.freeze(design);
  validatedDesigns.add(design);
  return design;
}

export function ticketArtworkSource(design) {
  validateStoredDesign(design);
  let entry = artworkByDesign.get(design);
  if (!entry) {
    const binary = atob(design.dataUrl.slice(design.dataUrl.indexOf(",") + 1));
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: design.mime }));
    entry = { design, url, printHolds: 0, released: false };
    artworkByDesign.set(design, entry);
    artworkByUrl.set(url, entry);
  }
  return entry.url;
}

function revokeArtwork(entry) {
  URL.revokeObjectURL(entry.url);
  artworkByUrl.delete(entry.url);
  artworkByDesign.delete(entry.design);
}

export function releaseTicketArtwork(design) {
  if (!design) return;
  const entry = artworkByDesign.get(design);
  if (!entry) return;
  entry.released = true;
  if (!entry.printHolds) revokeArtwork(entry);
}

// Keep a source alive while the print dialog still owns its images.
export function holdTicketArtwork(url) {
  const entry = artworkByUrl.get(url);
  if (!entry) return () => {};
  entry.printHolds++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    entry.printHolds--;
    if (entry.released && !entry.printHolds) revokeArtwork(entry);
  };
}

export async function readTicketDesign(file) {
  if (!file || !["image/png", "image/jpeg"].includes(file.type)) {
    throw new Error("Lütfen PNG veya JPEG seçin. SVG ve PDF yüklenemez.");
  }
  if (!file.size || file.size > TICKET_DESIGN_MAX_BYTES) {
    throw new Error("Tasarım en fazla 3 MB olmalı.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const png = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
  const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if ((file.type === "image/png" && !png) || (file.type === "image/jpeg" && !jpeg)) {
    throw new Error("Dosya içeriği PNG/JPEG biçimiyle eşleşmiyor.");
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Tasarım dosyası okunamadı."));
    reader.readAsDataURL(file);
  });
  const image = new Image();
  image.src = dataUrl;
  try {
    await image.decode();
  } catch {
    throw new Error("Tasarım görseli açılamadı. Geçerli bir PNG/JPEG ile tekrar deneyin.");
  }
  if (image.naturalWidth !== TICKET_DESIGN_WIDTH || image.naturalHeight !== TICKET_DESIGN_HEIGHT) {
    throw new Error(`Tasarım 1116 × 588 piksel olmalı. Seçilen görsel ${image.naturalWidth} × ${image.naturalHeight}; boyutları değiştirmeden şablonu dışa aktarın.`);
  }
  return { dataUrl, mime: file.type, width: image.naturalWidth, height: image.naturalHeight };
}
