import { fail } from "./security.mjs";

export const TICKET_DESIGN_WIDTH = 1116;
export const TICKET_DESIGN_HEIGHT = 588;
export const TICKET_DESIGN_MAX_BYTES = 3 * 1024 * 1024;

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const JPEG_FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2]);

function invalidImage() {
  fail(400, "Görsel dosyası bozuk veya eksik. Yeniden PNG ya da JPG olarak dışa aktarın.");
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngDimensions(bytes) {
  let offset = PNG_SIGNATURE.length;
  let dimensions;
  let hasImageData = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) invalidImage();
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) invalidImage();
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (!/^[a-zA-Z]{4}$/.test(type)) invalidImage();
    if (
      crc32(bytes.subarray(offset + 4, end - 4)) !==
      bytes.readUInt32BE(end - 4)
    ) invalidImage();
    if (!dimensions && type !== "IHDR") invalidImage();
    if (type === "IHDR") {
      if (dimensions || length !== 13) invalidImage();
      const depth = bytes[offset + 16];
      const color = bytes[offset + 17];
      const allowedDepths = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        !allowedDepths[color]?.includes(depth) ||
        bytes[offset + 18] !== 0 ||
        bytes[offset + 19] !== 0 ||
        bytes[offset + 20] > 1
      ) invalidImage();
      dimensions = {
        width: bytes.readUInt32BE(offset + 8),
        height: bytes.readUInt32BE(offset + 12),
      };
    }
    if (type === "IDAT" && length > 0) hasImageData = true;
    if (type === "IEND") {
      if (length !== 0 || !hasImageData || end !== bytes.length) invalidImage();
      return dimensions;
    }
    offset = end;
  }
  invalidImage();
}

function jpegDimensions(bytes) {
  let offset = 2;
  let dimensions;
  let hasImageData = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) invalidImage();
    while (bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) invalidImage();
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (!dimensions || !hasImageData || offset !== bytes.length) invalidImage();
      return dimensions;
    }
    if (marker === 0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7))
      invalidImage();
    if (marker === 0x01) continue;
    if (offset + 2 > bytes.length) invalidImage();
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) invalidImage();
    if (JPEG_FRAME_MARKERS.has(marker)) {
      if (dimensions || length < 8 || bytes[offset + 2] !== 8) invalidImage();
      const components = bytes[offset + 7];
      if (![1, 3, 4].includes(components) || length !== 8 + components * 3)
        invalidImage();
      dimensions = {
        width: bytes.readUInt16BE(offset + 5),
        height: bytes.readUInt16BE(offset + 3),
      };
    } else if (
      marker >= 0xc0 && marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    ) {
      fail(415, "Bu JPG biçimi desteklenmiyor. Görseli standart JPG veya PNG olarak dışa aktarın.");
    }
    offset += length;
    if (marker === 0xda) {
      if (!dimensions || length < 6) invalidImage();
      hasImageData = true;
      // Entropy-coded bytes escape FF as FF00; restart markers do not end a scan.
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset++;
          continue;
        }
        const markerStart = offset;
        while (bytes[offset] === 0xff) offset++;
        const next = bytes[offset];
        if (next === 0 || (next >= 0xd0 && next <= 0xd7)) {
          offset++;
          continue;
        }
        offset = markerStart;
        break;
      }
    }
  }
  invalidImage();
}

export function validateTicketDesign(bytes, declaredMime) {
  if (bytes.length > TICKET_DESIGN_MAX_BYTES)
    fail(413, "Bilet tasarımı en fazla 3 MB olabilir.");
  const mime = (declaredMime || "").split(";")[0].trim().toLowerCase();
  if (!["image/png", "image/jpeg"].includes(mime))
    fail(415, "Bilet tasarımını PNG veya JPG olarak yükleyin.");
  let dimensions;
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    if (mime !== "image/png")
      fail(415, "Dosyanın içeriği belirtilen görsel türüyle uyuşmuyor.");
    dimensions = pngDimensions(bytes);
  } else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    if (mime !== "image/jpeg")
      fail(415, "Dosyanın içeriği belirtilen görsel türüyle uyuşmuyor.");
    dimensions = jpegDimensions(bytes);
  } else {
    fail(415, "Dosya geçerli bir PNG veya JPG görseli değil.");
  }
  if (
    dimensions.width !== TICKET_DESIGN_WIDTH ||
    dimensions.height !== TICKET_DESIGN_HEIGHT
  ) fail(400, "Bilet tasarımı tam olarak 1116 × 588 piksel olmalı.");
  return { mime, ...dimensions };
}

export async function readTicketDesignBody(req) {
  const declaredLength = req.headers.get("content-length");
  if (declaredLength != null) {
    if (!/^\d+$/.test(declaredLength)) fail(400, "Geçersiz dosya boyutu.");
    if (Number(declaredLength) > TICKET_DESIGN_MAX_BYTES)
      fail(413, "Bilet tasarımı en fazla 3 MB olabilir.");
  }
  if (!req.body) fail(400, "Yüklenecek bilet görselini seçin.");
  const reader = req.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > TICKET_DESIGN_MAX_BYTES) {
        await reader.cancel();
        fail(413, "Bilet tasarımı en fazla 3 MB olabilir.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (!total) fail(400, "Yüklenecek bilet görselini seçin.");
  return Buffer.concat(chunks, total);
}
