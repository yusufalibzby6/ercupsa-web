import QRCode from "qrcode";
import { TICKET_DESIGN_WIDTH, TICKET_DESIGN_HEIGHT, validateStoredDesign } from "./ticket-template.js";

export const DIGITAL_TICKET_QR = Object.freeze({ x: 792, y: 60, size: 288 });
export const validDigitalTicketCode = code => typeof code === "string" && /^ERC-[A-F0-9]{24}$/.test(code);

function ticketOrigin(origin = globalThis.location?.origin) {
  const url = new URL(origin);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Bilet bağlantısının adresi geçersiz.");
  return url.origin;
}

function requireCode(code) {
  if (!validDigitalTicketCode(code)) throw new Error("Bilet kodu geçersiz.");
  return code;
}

export function ticketClaimUrl(code, { origin } = {}) {
  return `${ticketOrigin(origin)}/biletler.html?ticket=${requireCode(code)}`;
}

export function ticketPublicUrl(code, { origin } = {}) {
  return `${ticketOrigin(origin)}/bilet.html#${requireCode(code)}`;
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Bilet görseli hazırlanamadı. Lütfen yeniden deneyin."));
    image.src = source;
  });
}

function linesFor(context, text, width) {
  const lines = [];
  let line = "";
  for (const word of String(text || "").replace(/\s+/g, " ").trim().split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= width) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    // Keep ordinary words intact; break an unusually long word only when it
    // cannot fit on a line by itself, so it never covers the QR.
    for (const character of word) {
      if (context.measureText(line + character).width > width && line) {
        lines.push(line);
        line = "";
      }
      line += character;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

function drawText(context, text, { x, y, width, size, minSize = size, maxLines = 1, lineHeight = 1.22, weight = "400", color = "#232a35" }) {
  let lines;
  do {
    context.font = `${weight} ${size}px Arial, sans-serif`;
    lines = linesFor(context, text, width);
    if (lines.length <= maxLines || size <= minSize) break;
    size -= 2;
  } while (true);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    let last = lines.at(-1);
    while (last && context.measureText(last + "…").width > width) last = last.slice(0, -1);
    lines[maxLines - 1] = last + "…";
  }
  context.fillStyle = color;
  lines.forEach((line, index) => context.fillText(line, x, y + index * size * lineHeight));
}

export function ticketDateLabel(event = {}) {
  let date = "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(event.date || "")) {
    const parsed = new Date(`${event.date}T12:00:00+03:00`);
    if (Number.isFinite(parsed.valueOf())) date = parsed.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" });
  }
  const time = /^\d{2}:\d{2}$/.test(event.time || "") ? event.time : "";
  return [date, time].filter(Boolean).join(" · ");
}

async function drawStandardTicket(context, { code, eventTitle, event, origin }) {
  context.fillStyle = "#fffaf6";
  context.fillRect(0, 0, TICKET_DESIGN_WIDTH, TICKET_DESIGN_HEIGHT);
  context.fillStyle = "#982727";
  context.fillRect(0, 0, TICKET_DESIGN_WIDTH, 15);
  const logo = await loadImage(new URL("/ercupsa.PNG", ticketOrigin(origin)).href);
  const ratio = Math.min(130 / logo.naturalWidth, 130 / logo.naturalHeight);
  context.drawImage(logo, 42, 50, logo.naturalWidth * ratio, logo.naturalHeight * ratio);
  drawText(context, "ERCUPSA", { x: 193, y: 109, width: 480, size: 50, weight: "700", color: "#982727" });
  drawText(context, "Etkinlik katılım bileti", { x: 195, y: 150, width: 480, size: 26, color: "#6b6570" });
  drawText(context, eventTitle || "ERCUPSA etkinliği", { x: 45, y: 261, width: 650, size: 53, minSize: 27, maxLines: 3, weight: "700", color: "#7d2323" });
  drawText(context, ticketDateLabel(event), { x: 45, y: 431, width: 645, size: 28, weight: "700", color: "#45414b" });
  drawText(context, event?.location || "", { x: 45, y: 469, width: 645, size: 26, minSize: 22, maxLines: 2, color: "#6b6570" });
  drawText(context, "Sürpriz hediyeler sizi bekliyor.", { x: 45, y: 553, width: 645, size: 25, weight: "700", color: "#982727" });
  context.strokeStyle = "#d5b5aa";
  context.lineWidth = 2;
  context.setLineDash([8, 9]);
  context.beginPath();
  context.moveTo(744, 35);
  context.lineTo(744, 553);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = "#393443";
  context.font = "23px monospace";
  context.textAlign = "center";
  context.fillText(code.slice(0, 16), 930, 413);
  context.fillText(code.slice(16), 930, 445);
  context.font = "700 21px Arial, sans-serif";
  context.fillText("KATILIM BİLETİ", 930, 531);
  context.textAlign = "left";
}

export async function renderTicketImage({ code, eventTitle, design = null, event = {}, origin, scale = 2 }) {
  requireCode(code);
  if (!Number.isInteger(scale) || scale < 1 || scale > 3) throw new Error("Bilet görselinin boyutu geçersiz.");
  const artwork = validateStoredDesign(design);
  const canvas = document.createElement("canvas");
  canvas.width = TICKET_DESIGN_WIDTH * scale;
  canvas.height = TICKET_DESIGN_HEIGHT * scale;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Tarayıcın bilet görselini hazırlayamıyor. Başka bir tarayıcıyla deneyebilirsin.");
  context.scale(scale, scale);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, TICKET_DESIGN_WIDTH, TICKET_DESIGN_HEIGHT);
  if (artwork) {
    const image = await loadImage(artwork.dataUrl);
    if (image.naturalWidth !== TICKET_DESIGN_WIDTH || image.naturalHeight !== TICKET_DESIGN_HEIGHT) throw new Error("Bilet tasarımının boyutları geçersiz. Organizatörle iletişime geçebilirsin.");
    context.drawImage(image, 0, 0, TICKET_DESIGN_WIDTH, TICKET_DESIGN_HEIGHT);
  } else await drawStandardTicket(context, { code, eventTitle, event, origin });
  const qr = document.createElement("canvas");
  await QRCode.toCanvas(qr, ticketClaimUrl(code, { origin }), { width: DIGITAL_TICKET_QR.size * scale, margin: 4, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
  context.imageSmoothingEnabled = false;
  context.drawImage(qr, DIGITAL_TICKET_QR.x, DIGITAL_TICKET_QR.y, DIGITAL_TICKET_QR.size, DIGITAL_TICKET_QR.size);
  return canvas;
}

export function ticketCanvasBlob(canvas, type = "image/png", quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Bilet dosyası hazırlanamadı. Lütfen yeniden deneyin.")), type, quality));
}

// One A4 landscape page. JPEG bytes are embedded as an image, with byte-accurate
// PDF offsets; no remote service, browser print dialog or font dependency.
export function createTicketPdf(jpegBytes, { width, height }) {
  if (!(jpegBytes instanceof Uint8Array) || jpegBytes.length < 4 || jpegBytes[0] !== 255 || jpegBytes[1] !== 216 || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 10000 || height > 10000) throw new Error("PDF görseli geçersiz.");
  const encoder = new TextEncoder();
  const chunks = [];
  const offsets = [0];
  let length = 0;
  const append = value => {
    const bytes = typeof value === "string" ? encoder.encode(value) : value;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (number, body) => {
    offsets[number] = length;
    append(`${number} 0 obj\n`);
    append(body);
    append("\nendobj\n");
  };
  const pageWidth = 841.89, pageHeight = 595.28, margin = 24;
  const fit = Math.min((pageWidth - margin * 2) / width, (pageHeight - margin * 2) / height);
  const imageWidth = width * fit, imageHeight = height * fit;
  const position = [imageWidth, 0, 0, imageHeight, (pageWidth - imageWidth) / 2, (pageHeight - imageHeight) / 2].map(number => number.toFixed(3)).join(" ");
  const content = `q\n${position} cm\n/Im0 Do\nQ\n`;
  append("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = length;
  append(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`);
  append(jpegBytes);
  append("\nendstream\nendobj\n");
  object(5, `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`);
  const xref = length;
  append(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: "application/pdf" });
}

export function ticketFileBase(code, title = "Etkinlik") {
  requireCode(code);
  const safe = String(title).normalize("NFC").replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, " ").replace(/\s+/g, " ").trim().slice(0, 70).trim().replace(/[. ]+$/, "") || "Etkinlik";
  return `ERCUPSA - ${safe} - ${code.slice(-8)}`;
}

export async function createTicketFiles(options) {
  const canvas = options.canvas || await renderTicketImage(options);
  const [image, jpeg] = await Promise.all([ticketCanvasBlob(canvas), ticketCanvasBlob(canvas, "image/jpeg", 0.97)]);
  const pdf = createTicketPdf(new Uint8Array(await jpeg.arrayBuffer()), { width: canvas.width, height: canvas.height });
  const name = ticketFileBase(options.code, options.eventTitle);
  return { canvas, image: new File([image], name + ".png", { type: "image/png" }), pdf: new File([pdf], name + ".pdf", { type: "application/pdf" }) };
}

export function downloadTicketFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name || "ERCUPSA-bilet";
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Mobile browsers may start reading after click returns.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
