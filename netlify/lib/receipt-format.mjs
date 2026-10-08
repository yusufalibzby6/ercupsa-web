const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const JPEG_FRAMES = new Set([0xc0, 0xc1, 0xc2]);

function pngEnd(bytes) {
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 0;
  let offset = 8, dimensions = false, imageData = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), end = offset + length + 12;
    if (end > bytes.length) return 0;
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (!/^[a-zA-Z]{4}$/.test(type) || (!dimensions && type !== 'IHDR')) return 0;
    if (type === 'IHDR') {
      if (dimensions || length !== 13 || !bytes.readUInt32BE(offset + 8) || !bytes.readUInt32BE(offset + 12)) return 0;
      dimensions = true;
    }
    if (type === 'IDAT' && length > 0) imageData = true;
    if (type === 'IEND') {
      if (length !== 0 || !imageData || bytes.readUInt32BE(end - 4) !== 0xae426082) return 0;
      return end;
    }
    offset = end;
  }
  return 0;
}

function jpegEnd(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 0;
  let offset = 2, components = 0, imageData = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) return 0;
    while (bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) return 0;
    const marker = bytes[offset++];
    if (marker === 0xd9) return components && imageData ? offset : 0;
    if (marker === 0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) return 0;
    if (marker === 0x01) continue;
    if (offset + 2 > bytes.length) return 0;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return 0;
    if (JPEG_FRAMES.has(marker)) {
      if (components || length < 8 || ![8, 12].includes(bytes[offset + 2]) ||
          !bytes.readUInt16BE(offset + 3) || !bytes.readUInt16BE(offset + 5)) return 0;
      components = bytes[offset + 7];
      if (components < 1 || components > 4 || length !== 8 + components * 3) return 0;
    }
    if (marker === 0xda && (!components || length < 6 || bytes[offset + 2] < 1 ||
        bytes[offset + 2] > components || length !== 6 + bytes[offset + 2] * 2)) return 0;
    offset += length;
    if (marker !== 0xda) continue;
    // Metadata segments may contain FF D9 too. Only accept EOI reached after
    // an actual scan, respecting byte stuffing and JPEG restart markers.
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) { imageData = true; offset++; continue; }
      const start = offset;
      while (bytes[offset] === 0xff) offset++;
      const next = bytes[offset];
      if (next === 0 || (next >= 0xd0 && next <= 0xd7)) { imageData = true; offset++; continue; }
      offset = start;
      break;
    }
  }
  return 0;
}

// Android pickers may omit MIME information, use aliases, or report a JPG name
// for PNG screenshot bytes. Never let those hints determine the stored type.
export function receiptFormat(bytes) {
  const png = pngEnd(bytes);
  if (png) return { mime: 'image/png', extension: 'png', bytes: bytes.subarray(0, png) };
  const jpeg = jpegEnd(bytes);
  if (jpeg) return { mime: 'image/jpeg', extension: 'jpg', bytes: bytes.subarray(0, jpeg) };
  if (/^%PDF-(?:1\.[0-7]|2\.0)(?:\s|$)/.test(bytes.subarray(0, 16).toString('ascii')) &&
      /%%EOF\s*$/.test(bytes.subarray(-1024).toString('ascii')))
    return { mime: 'application/pdf', extension: 'pdf', bytes };
  return null;
}
