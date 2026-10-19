import { fail, text } from "./security.mjs";
import { photoFormat } from "./photo-format.mjs";

export const TEAM_STORE = "ercupsa-team";
export const TEAM_KEY = "roster.json";
export const TEAM_PHOTO_MAX_BYTES = 180 * 1024;
export const TEAM_PHOTO_MAX_SIDE = 800;

// The initial roster is kept in source so a first visit never writes storage.
export const DEFAULT_TEAM = Object.freeze([
  {
    "id": "advisor",
    "name": "Arş. Gör. Dr. Kübra Uzun",
    "role": "Danışman Hoca",
    "photo": "danisman-hoca.jpg",
    "featured": true
  },
  {
    "id": "member-1",
    "name": "Yusuf Ali Bozbay",
    "role": "Başkan",
    "photo": "ekip1.JPG",
    "featured": false
  },
  {
    "id": "member-2",
    "name": "Göknur Çifçi",
    "role": "Başkan Yardımcısı",
    "photo": "ekip2.jpg",
    "featured": false
  },
  {
    "id": "member-3",
    "name": "Ayşenur Durdu",
    "role": "Yönetim Kurulu Üyesi",
    "photo": "ekip3.jpg",
    "featured": false
  },
  {
    "id": "member-4",
    "name": "Hayrunnisa Kaya",
    "role": "Yönetim Kurulu Üyesi",
    "photo": "ekip4.jpg",
    "featured": false
  },
  {
    "id": "member-5",
    "name": "Gülnur Köroğlu",
    "role": "Genel Sekreter",
    "photo": "ekip5.jpg",
    "featured": false
  },
  {
    "id": "member-6",
    "name": "Betül Öncü",
    "role": "Sosyal Medya",
    "photo": "ekip6.jpg",
    "featured": false
  },
  {
    "id": "member-7",
    "name": "Rümeysa Ekici",
    "role": "Sosyal Medya",
    "photo": "ekip7.jpg",
    "featured": false
  },
  {
    "id": "member-8",
    "name": "Medine Pala",
    "role": "Tasarım",
    "photo": "ekip8.jpg",
    "featured": false
  },
  {
    "id": "member-9",
    "name": "Ebrar Görgüç",
    "role": "Tasarım",
    "photo": "ekip20.jpg",
    "featured": false
  },
  {
    "id": "member-10",
    "name": "Azra İrem Öcal",
    "role": "Sosyal Etkinlik",
    "photo": "ekip9.jpg",
    "featured": false
  },
  {
    "id": "member-11",
    "name": "Ceyda Şahin",
    "role": "Sosyal Etkinlik",
    "photo": "ekip10.jpg",
    "featured": false
  },
  {
    "id": "member-12",
    "name": "Gökçe Baydemir",
    "role": "Sosyal Etkinlik",
    "photo": "ekip11.jpg",
    "featured": false
  },
  {
    "id": "member-13",
    "name": "Tuğçe Çalışkan",
    "role": "Sponsorluk",
    "photo": "ekip12.jpg",
    "featured": false
  },
  {
    "id": "member-14",
    "name": "Dileknaz Ergül",
    "role": "Sponsorluk",
    "photo": "ekip13.jpg",
    "featured": false
  },
  {
    "id": "member-15",
    "name": "Belinay Daş",
    "role": "Sponsorluk",
    "photo": "assets/team/belinay-das.webp",
    "featured": false
  },
  {
    "id": "member-16",
    "name": "Meliha Nur Kabay",
    "role": "Sosyal Sorumluluk",
    "photo": "ekip14.jpg",
    "featured": false
  },
  {
    "id": "member-17",
    "name": "Candan Öztürk",
    "role": "Sosyal Sorumluluk",
    "photo": "ekip15.jpg",
    "featured": false
  },
  {
    "id": "member-18",
    "name": "Rana Sütçü",
    "role": "Eğitim Proje",
    "photo": "ekip16.jpg",
    "featured": false
  },
  {
    "id": "member-19",
    "name": "Nisa Ece Çelebi",
    "role": "Eğitim Proje",
    "photo": "ekip17.jpg",
    "featured": false
  },
  {
    "id": "member-20",
    "name": "Mir İbrahim Doğan",
    "role": "Denetleme Kurulu",
    "photo": "ekip18.jpg",
    "featured": false
  },
  {
    "id": "member-21",
    "name": "Eren Baydoğan",
    "role": "Sayman",
    "photo": "ekip19.jpg",
    "featured": false
  }
]);

const photoPattern = /^\/api\/team\?action=photo&id=([a-f0-9]{64})$/;
export function teamPhotoId(value) { return typeof value === "string" ? value.match(photoPattern)?.[1] || "" : ""; }
const safeId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
export function teamMembers(value) {
  if (!Array.isArray(value) || value.length > 100) fail(400, "Ekip listesi en fazla 100 kişi olabilir.");
  const ids = new Set(), defaults = new Set(DEFAULT_TEAM.map(member => member.photo));
  return value.map(member => {
    if (!member || typeof member !== "object" || Array.isArray(member) || !safeId(member.id) || ids.has(member.id))
      fail(400, "Her ekip üyesinin benzersiz bir kimliği olmalı.");
    ids.add(member.id);
    const photo = text(member.photo, 200);
    if (photo && !defaults.has(photo) && !teamPhotoId(photo)) fail(400, "Fotoğrafı ekip düzenleyicisinden yükleyin.");
    if (typeof member.featured !== "boolean") fail(400, "Ekip kartının görünümü geçersiz.");
    return { id: member.id, name: text(member.name, 120, true), role: text(member.role, 120, true), photo, featured: member.featured };
  });
}
export function readTeam(value) {
  if (value == null) return { members: structuredClone(DEFAULT_TEAM), revision: "", updatedAt: null };
  try {
    if (!value || typeof value !== "object" || typeof value.revision !== "string" ||
        (value.revision === "" ? value.updatedAt !== null : !safeId(value.revision) ||
          typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt)))) throw Error();
    return { members: teamMembers(value.members), revision: value.revision, updatedAt: value.updatedAt };
  } catch { fail(503, "Kaydedilmiş ekip bilgileri doğrulanamadı. Lütfen tekrar deneyin."); }
}
export function teamPhotoFormat(bytes) {
  if (!bytes.length) fail(400, "Fotoğraf dosyasını seçin.");
  if (bytes.length > TEAM_PHOTO_MAX_BYTES) fail(413, "Sıkıştırılmış ekip fotoğrafı en fazla 180 KB olabilir.");
  const format = photoFormat(bytes);
  if (!format || format.bytes.length !== bytes.length) fail(415, "Fotoğrafın içeriği geçerli bir JPG, PNG veya WebP değil.");
  let width, height;
  if (format.mime === "image/png") {
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else if (format.mime === "image/jpeg") {
    let offset = 2;
    while (offset < bytes.length) {
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0x01) continue;
      if (offset + 2 > bytes.length) fail(415, "Fotoğrafın JPG içeriği eksik.");
      const length = bytes.readUInt16BE(offset);
      if ([0xc0, 0xc1, 0xc2].includes(marker)) { height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); break; }
      offset += length;
    }
  } else {
    let offset = 12, canvasWidth, canvasHeight;
    while (offset + 8 <= bytes.length) {
      const type = bytes.toString("ascii", offset, offset + 4), size = bytes.readUInt32LE(offset + 4), start = offset + 8;
      if (type === "VP8X") { canvasWidth = 1 + bytes.readUIntLE(start + 4, 3); canvasHeight = 1 + bytes.readUIntLE(start + 7, 3); }
      if (type === "VP8 ") { width = bytes.readUInt16LE(start + 6) & 0x3fff; height = bytes.readUInt16LE(start + 8) & 0x3fff; break; }
      if (type === "VP8L") {
        width = 1 + (((bytes[start + 2] & 0x3f) << 8) | bytes[start + 1]);
        height = 1 + (((bytes[start + 4] & 0x0f) << 10) | (bytes[start + 3] << 2) | (bytes[start + 2] >> 6)); break;
      }
      offset = start + size + size % 2;
    }
    if (canvasWidth && (canvasWidth !== width || canvasHeight !== height)) fail(415, "Fotoğrafın WebP boyutları uyuşmuyor.");
  }
  if (!width || !height || width > TEAM_PHOTO_MAX_SIDE || height > TEAM_PHOTO_MAX_SIDE)
    fail(400, "Fotoğrafın uzun kenarı en fazla 800 piksel olmalı. Panelden tekrar yükleyin.");
  return { mime: format.mime, width, height };
}
export async function readTeamPhoto(req) {
  const length = req.headers.get("content-length");
  if (length != null && (!/^\d+$/.test(length) || Number(length) > TEAM_PHOTO_MAX_BYTES))
    fail(413, "Sıkıştırılmış ekip fotoğrafı en fazla 180 KB olabilir.");
  if (!req.body) fail(400, "Fotoğraf dosyasını seçin.");
  const reader = req.body.getReader(), chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > TEAM_PHOTO_MAX_BYTES) { await reader.cancel(); fail(413, "Sıkıştırılmış ekip fotoğrafı en fazla 180 KB olabilir."); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, total);
}
