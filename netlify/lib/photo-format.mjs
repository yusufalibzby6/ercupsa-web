import { receiptFormat } from "./receipt-format.mjs";

function webpEnd(bytes) {
  if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "RIFF" ||
      bytes.toString("ascii", 8, 12) !== "WEBP") return 0;
  const end = bytes.readUInt32LE(4) + 8;
  if (end < 20 || end > bytes.length || end % 2) return 0;
  let offset = 12, frame = false, extended = false;
  while (offset + 8 <= end) {
    const type = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4), start = offset + 8;
    const next = start + size + (size % 2);
    if (next > end) return 0;
    if (type === "VP8X") {
      if (offset !== 12 || size !== 10 || extended || bytes[start] & 0xc3 ||
          bytes.readUIntLE(start + 1, 3)) return 0;
      extended = true;
    } else if (type === "VP8 ") {
      if (frame || size < 11 || bytes[start] & 1 ||
          bytes.toString("hex", start + 3, start + 6) !== "9d012a" ||
          !(bytes.readUInt16LE(start + 6) & 0x3fff) ||
          !(bytes.readUInt16LE(start + 8) & 0x3fff)) return 0;
      frame = true;
    } else if (type === "VP8L") {
      if (frame || size < 6 || bytes[start] !== 0x2f || bytes[start + 4] & 0xe0) return 0;
      frame = true;
    } else if (!["ICCP", "ALPH", "EXIF", "XMP "].includes(type) || !extended || !size) return 0;
    offset = next;
  }
  return offset === end && frame ? end : 0;
}

// Use the decoded container, never the extension or Android picker's MIME hint.
export function photoFormat(bytes) {
  const image = receiptFormat(bytes);
  if (image && image.mime !== "application/pdf") return image;
  const end = webpEnd(bytes);
  return end ? { mime: "image/webp", extension: "webp", bytes: bytes.subarray(0, end) } : null;
}
