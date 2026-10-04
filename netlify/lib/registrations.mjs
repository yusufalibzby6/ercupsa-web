import { fail, identifier, text } from "./security.mjs";

export const REGISTRATION_STORE = "ercupsa-registrations";
export const REGISTRATION_RECEIPT_STORE = "ercupsa-registration-receipts";
export const RECEIPT_MAX_BYTES = 4 * 1024 * 1024;
export const REGISTRATION_MAX_BYTES = RECEIPT_MAX_BYTES + 128 * 1024;
export const CLASS_OPTIONS = [
  "Hazırlık", "1. Sınıf", "2. Sınıf", "3. Sınıf", "4. Sınıf",
  "5. Sınıf", "Mezun", "Diğer",
];
const TYPES = new Set(["text", "textarea", "email", "tel", "select", "radio", "checkboxes"]);
const CHOICES = new Set(["select", "radio", "checkboxes"]);
const CORE_TYPES = { full_name: "text", class_year: "select", phone: "tel" };
const UNSAFE_IDS = new Set(["__proto__", "constructor", "prototype"]);

export const formKey = (eventId) => `forms/${identifier(eventId)}.json`;
export const entryPrefix = (eventId) => `entries/${identifier(eventId)}/`;
export const entryKey = (eventId, id) => `${entryPrefix(eventId)}${identifier(id)}.json`;

export function defaultRegistrationForm(eventId) {
  return {
    eventId: identifier(eventId),
    enabled: false,
    description: "",
    fields: [
      { id: "full_name", type: "text", label: "Ad soyad", required: true },
      { id: "class_year", type: "select", label: "Sınıf", required: true, options: [...CLASS_OPTIONS] },
      { id: "phone", type: "tel", label: "Telefon numarası", required: true },
    ],
    receipt: { enabled: true, required: false },
  };
}

export function normalizeRegistrationForm(input, eventId, updatedAt) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail(400, "Kayıt formu gerekli.");
  if (input.eventId != null && input.eventId !== eventId)
    fail(400, "Kayıt formunun etkinliği uyuşmuyor.");
  if (typeof input.enabled !== "boolean") fail(400, "Geçersiz form durumu.");
  if (!Array.isArray(input.fields) || input.fields.length < 3 || input.fields.length > 25)
    fail(400, "Formda temel alanlarla birlikte en fazla 25 soru olabilir.");
  const seen = new Set();
  const fields = input.fields.map((field) => {
    if (!field || typeof field !== "object" || Array.isArray(field))
      fail(400, "Geçersiz form alanı.");
    const id = text(field.id, 60, true);
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,59}$/.test(id) || UNSAFE_IDS.has(id) || seen.has(id))
      fail(400, "Soru kimlikleri geçerli ve benzersiz olmalı.");
    seen.add(id);
    if (!TYPES.has(field.type) || (Object.hasOwn(CORE_TYPES, id) && field.type !== CORE_TYPES[id]))
      fail(400, "Geçersiz soru türü.");
    if (typeof field.required !== "boolean") fail(400, "Zorunlu alan ayarı geçersiz.");
    if (id === "full_name" && !field.required) fail(400, "Ad soyad alanı zorunlu olmalı.");
    const result = { id, type: field.type, label: text(field.label, 160, true), required: field.required };
    if (CHOICES.has(field.type)) {
      if (!Array.isArray(field.options) || !field.options.length || field.options.length > 40)
        fail(400, "Seçenekli sorularda 1 ile 40 arasında seçenek olmalı.");
      const options = field.options.map((option) => text(option, 160, true));
      if (new Set(options).size !== options.length) fail(400, "Soru seçenekleri tekrarlanmamalı.");
      result.options = options;
    }
    return result;
  });
  for (const id of Object.keys(CORE_TYPES)) {
    if (!seen.has(id)) fail(400, "Ad soyad, sınıf ve telefon alanları formda bulunmalı.");
  }
  const receipt = input.receipt;
  if (!receipt || typeof receipt.enabled !== "boolean" || typeof receipt.required !== "boolean")
    fail(400, "Dekont ayarı geçersiz.");
  if (receipt.required && !receipt.enabled) fail(400, "Zorunlu dekont alanı açık olmalı.");
  return {
    eventId: identifier(eventId), enabled: input.enabled,
    description: text(input.description, 5000), fields,
    receipt: { enabled: receipt.enabled, required: receipt.required }, updatedAt,
  };
}

export function turkeyToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function registrationIsAvailable(event, form, now = new Date()) {
  return Boolean(event && event.published !== false && form?.enabled && event.date >= turkeyToday(now));
}

export async function hydrateRegistrationFlags(events, getStore) {
  const store = getStore(REGISTRATION_STORE);
  return mapConcurrent(events, async (event) => {
    const form = await store.get(formKey(event.id), { type: "json", consistency: "strong" });
    return form ? { ...event, registrationMode: "native", registrationEnabled: form.enabled === true }
      : { ...event, ...(event.registrationUrl ? { registrationMode: "external" } : {}) };
  });
}

export async function mapConcurrent(items, mapper, concurrency = 8) {
  const output = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      output[index] = await mapper(items[index], index);
    }
  }));
  return output;
}

export function validateRegistrationAnswers(raw, fields) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(400, "Form cevapları geçersiz.");
  const allowed = new Set(fields.map((field) => field.id));
  if (Object.keys(raw).some((key) => !allowed.has(key)))
    fail(400, "Form değişmiş olabilir. Sayfayı yenileyip tekrar deneyin.");
  const answers = Object.create(null);
  for (const field of fields) {
    const value = Object.hasOwn(raw, field.id) ? raw[field.id] : undefined;
    if (field.type === "checkboxes") {
      if (value != null && !Array.isArray(value)) fail(400, `${field.label}: seçenekler geçersiz.`);
      const selected = value || [];
      if (selected.length > field.options.length || selected.some((option) => !field.options.includes(option)) ||
        new Set(selected).size !== selected.length || (field.required && !selected.length))
        fail(400, `${field.label}: geçerli seçenekleri işaretleyin.`);
      answers[field.id] = [...selected];
      continue;
    }
    const max = field.type === "tel" ? 40 : field.type === "email" ? 254 : 2000;
    const answer = text(value, max, field.required);
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(answer))
      fail(400, `${field.label}: geçersiz karakterler içeriyor.`);
    if (answer && CHOICES.has(field.type) && !field.options.includes(answer))
      fail(400, `${field.label}: geçerli bir seçenek seçin.`);
    if (answer && field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answer))
      fail(400, `${field.label}: geçerli bir e-posta adresi girin.`);
    if (answer && field.type === "tel") {
      const digits = answer.replace(/\D/g, "");
      if (!/^\+?[\d\s().-]+$/.test(answer) || digits.length < 10 || digits.length > 15)
        fail(400, `${field.label}: 10 ile 15 rakam içeren bir telefon numarası girin.`);
    }
    answers[field.id] = answer;
  }
  return answers;
}

export async function readLimitedBytes(req, limit, message = "İstek çok büyük.") {
  const length = req.headers.get("content-length");
  if (length != null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))))
    fail(400, "Geçersiz istek boyutu.");
  if (length != null && Number(length) > limit) fail(413, message);
  if (!req.body) fail(400, "İstek içeriği gerekli.");
  const reader = req.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        fail(413, message);
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, total);
}

export async function readRegistrationJson(req) {
  if (req.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
    fail(415, "JSON gerekli.");
  const bytes = await readLimitedBytes(req, 100000);
  try {
    const input = JSON.parse(bytes.toString("utf8"));
    if (!input || typeof input !== "object" || Array.isArray(input)) throw Error();
    return input;
  } catch { fail(400, "Geçersiz JSON."); }
}

export async function readRegistrationSubmission(req) {
  const contentType = req.headers.get("content-type") || "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) fail(415, "Form ve dosya yüklemesi gerekli.");
  const bytes = await readLimitedBytes(req, REGISTRATION_MAX_BYTES, "Dekont en fazla 4 MB olabilir.");
  let data;
  try { data = await new Response(bytes, { headers: { "Content-Type": contentType } }).formData(); }
  catch { fail(400, "Form içeriği okunamadı. Lütfen tekrar deneyin."); }
  const allowed = new Set(["answers", "receipt", "requestId", "website"]);
  for (const name of data.keys()) {
    if (!allowed.has(name) || data.getAll(name).length !== 1) fail(400, "Geçersiz form alanı.");
  }
  const website = data.get("website");
  if (website != null && (typeof website !== "string" || website.trim()))
    fail(400, "Form gönderilemedi. Lütfen tekrar deneyin.");
  const requestId = text(data.get("requestId"), 36, true);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))
    fail(400, "Form gönderim kimliği geçersiz. Sayfayı yenileyin.");
  const rawAnswers = data.get("answers");
  if (typeof rawAnswers !== "string" || Buffer.byteLength(rawAnswers) > 64 * 1024)
    fail(400, "Form cevapları çok uzun veya geçersiz.");
  let answers;
  try { answers = JSON.parse(rawAnswers); }
  catch { fail(400, "Form cevapları okunamadı."); }
  const receipt = data.get("receipt");
  if (receipt != null && !(receipt instanceof Blob)) fail(400, "Dekont dosyası geçersiz.");
  return { requestId: requestId.toLowerCase(), answers, receipt: receipt?.size ? receipt : null };
}

export async function validateRegistrationReceipt(file) {
  if (file.size > RECEIPT_MAX_BYTES) fail(413, "Dekont en fazla 4 MB olabilir.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = file.type.toLowerCase();
  let valid = false;
  if (mime === "image/png") {
    valid = bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      bytes.readUInt32BE(8) === 13 && bytes.toString("ascii", 12, 16) === "IHDR" &&
      bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0 &&
      bytes.subarray(-12).equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]));
  } else if (mime === "image/jpeg") {
    valid = bytes.length >= 32 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff &&
      bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  } else if (mime === "application/pdf") {
    valid = /^%PDF-(?:1\.[0-7]|2\.0)(?:\s|$)/.test(bytes.subarray(0, 16).toString("ascii")) &&
      /%%EOF\s*$/.test(bytes.subarray(-1024).toString("ascii"));
  } else fail(415, "Dekontu PNG, JPG veya PDF olarak yükleyin.");
  if (!valid) fail(415, "Dekont dosyasının içeriği belirtilen türle uyuşmuyor veya dosya eksik.");
  const extension = mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "pdf";
  const rawName = typeof file.name === "string" ? file.name : "dekont";
  const name = rawName.split(/[\\/]/).at(-1).replace(/[\x00-\x1f\x7f"<>]/g, "").slice(0, 160).trim();
  return { bytes, metadata: { name: name || `dekont.${extension}`, mime, size: bytes.length } };
}

export function entryForAdmin(entry) {
  const { receipt, fingerprint, ...rest } = entry;
  return { ...rest, receipt: receipt ? { name: receipt.name, mime: receipt.mime, size: receipt.size } : null };
}

export function registrationSummary(entries) {
  const summary = { total: entries.length, pending: 0, approved: 0, rejected: 0, byClass: [] };
  const classes = new Map();
  for (const entry of entries) {
    if (["pending", "approved", "rejected"].includes(entry.status)) summary[entry.status]++;
    const classYear = entry.classYear || "Belirtilmedi";
    classes.set(classYear, (classes.get(classYear) || 0) + 1);
  }
  summary.byClass = [...classes].map(([classYear, count]) => ({ classYear, count }))
    .sort((a, b) => {
      const rank = (value) => CLASS_OPTIONS.includes(value) ? CLASS_OPTIONS.indexOf(value) : CLASS_OPTIONS.length;
      return rank(a.classYear) - rank(b.classYear) || a.classYear.localeCompare(b.classYear, "tr");
    });
  return summary;
}

const csvCell = (value) => {
  let string = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(string)) string = "'" + string;
  return `"${string.replaceAll('"', '""')}"`;
};
export function registrationCsv(entries) {
  const questions = new Map();
  for (const entry of entries) {
    for (const field of entry.fields || []) {
      // A schema change must not silently rename a historical answer column.
      const key = `${field.id}\u0000${field.label}`;
      if (!questions.has(key)) questions.set(key, { id: field.id, label: field.label });
    }
  }
  const columns = [...questions.values()];
  const rows = [["Kayıt kimliği", "Kayıt tarihi", "Durum", "Ad soyad", "Sınıf", "Telefon", "Dekont", ...columns.map((field) => field.label)]];
  for (const entry of entries) {
    const snapshots = new Set((entry.fields || []).map((field) => `${field.id}\u0000${field.label}`));
    rows.push([
      entry.id, entry.createdAt, entry.status, entry.name, entry.classYear, entry.phone,
      entry.receipt ? "Var" : "Yok",
      ...columns.map((field) => snapshots.has(`${field.id}\u0000${field.label}`) ? entry.answers?.[field.id] : ""),
    ]);
  }
  return "\ufeff" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
