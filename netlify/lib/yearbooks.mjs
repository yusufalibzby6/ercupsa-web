import { fail, identifier, text } from './security.mjs';

export const YEARBOOK_STORE = 'ercupsa-yearbooks';
export const YEARBOOK_SECTIONS = Object.freeze({ conference: 'Öne çıkan konferanslar', technical: 'Teknik geziler ve bilimsel etkinlikler', social: 'Birlikte geçirdiğimiz anlar', responsibility: 'Sosyal sorumluluk' });
export const yearbookKey = id => `years/${yearbookId(id)}.json`;
export function yearbookId(value) {
  const id = text(value, 9, true), match = id.match(/^(20\d{2})-(20\d{2})$/);
  if (!match || Number(match[2]) !== Number(match[1]) + 1) fail(400, 'Dönemi 2026-2027 biçiminde yazın.');
  return id;
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail(400, 'Geçerli bir dönem tarihi seçin.');
  return value;
}
export function yearbookPhoto(value) {
  const url = text(value, 2000);
  if (!url) return '';
  let parsed;
  try { parsed = new URL(url); } catch { fail(400, 'Geçersiz yıllık fotoğrafı.'); }
  let path;
  try { path = decodeURIComponent(parsed.pathname).toLowerCase(); } catch { fail(400, 'Geçersiz yıllık fotoğrafı.'); }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'res.cloudinary.com' || parsed.username || parsed.password || parsed.port || parsed.hash || parsed.search || !path.includes('/image/upload/') || /\.svg(?:$|\/)|(?:^|[,/])f_svg(?:[,/]|$)/.test(path)) fail(400, 'Yıllıkta yalnızca Cloudinary fotoğrafları kullanılabilir.');
  return parsed.href;
}
function photo(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.rightsApproved !== 'boolean') fail(400, 'Fotoğraf yayın izni kontrolünü belirtin.');
  return { url: yearbookPhoto(value.url), caption: text(value.caption, 240), rightsApproved: value.rightsApproved };
}
export function defaultYearbookDraft(period = '2026-2027') {
  const id = yearbookId(period), [start, end] = id.split('-');
  return { title: `ERCUPSA ${start}–${end}`, description: 'Birlikte öğrendik, birlikte iz bıraktık.', startDate: `${start}-09-01`, endDate: `${end}-06-30`, events: [], boardPhoto: { url: '', caption: 'ERCUPSA yönetim ve koordinasyon ekibi', rightsApproved: false }, presidentName: '', presidentMessage: '', closingMessage: 'Bu yılın her anında bizimle olan herkese teşekkür ederiz.' };
}
export function normalizeYearbookDraft(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Yıllık taslağı gerekli.');
  const startDate = date(input.startDate), endDate = date(input.endDate);
  if (startDate > endDate) fail(400, 'Dönem bitişi başlangıçtan önce olamaz.');
  if (!Array.isArray(input.events) || input.events.length > 100) fail(400, 'En fazla 100 etkinlik seçebilirsiniz.');
  const seen = new Set();
  const events = input.events.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail(400, 'Geçersiz etkinlik seçimi.');
    const id = identifier(item.id);
    if (seen.has(id) || !Object.hasOwn(YEARBOOK_SECTIONS, item.section)) fail(400, 'Etkinlik tekrarı veya bölüm seçimi geçersiz.');
    seen.add(id);
    if (!Array.isArray(item.photos) || item.photos.length > 12) fail(400, 'Bir etkinlik için en fazla 12 fotoğraf seçin.');
    const photos = item.photos.map(photo), urls = new Set();
    for (const image of photos) { if (!image.url || urls.has(image.url)) fail(400, 'Fotoğraflar boş veya tekrarlı olamaz.'); urls.add(image.url); }
    return { id, section: item.section, message: text(item.message, 2000), photos };
  });
  if (events.reduce((sum, item) => sum + item.photos.length, 0) > 120) fail(400, 'Yıllıkta en fazla 120 fotoğraf kullanılabilir.');
  return { title: text(input.title, 180, true), description: text(input.description, 1500), startDate, endDate, events,
    boardPhoto: photo(input.boardPhoto || { url: '', caption: '', rightsApproved: false }), presidentName: text(input.presidentName, 120), presidentMessage: text(input.presidentMessage, 5000), closingMessage: text(input.closingMessage, 2000) };
}
const number = value => value === null || Number.isSafeInteger(value) && value >= 0 && value <= 1e9;
export function publicYearbookStatistics(value, eventCount) {
  if (!value || typeof value !== 'object' || value.eventCount !== eventCount || !Number.isFinite(Date.parse(value.asOf))) fail(503, 'Yıllık istatistikleri doğrulanamadı.');
  const output = {};
  for (const key of ['eventCount', 'applications', 'main', 'waitlisted', 'cancelled', 'entered', 'qrEntered', 'manualEntered']) {
    if (!number(value[key])) fail(503, 'Yıllık istatistikleri doğrulanamadı.');
    output[key] = value[key];
  }
  output.asOf = value.asOf;
  output.coverage = {};
  for (const key of ['eventsWithEntryData', 'totalEvents', 'completeEvents']) {
    if (!Number.isSafeInteger(value.coverage?.[key]) || value.coverage[key] < 0 || value.coverage[key] > eventCount) fail(503, 'Yıllık veri kapsamı doğrulanamadı.');
    output.coverage[key] = value.coverage[key];
  }
  return output;
}
export function projectYearbook(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.events)) fail(503, 'Yayımlanmış yıllık doğrulanamadı.');
  return { id: yearbookId(snapshot.id), period: snapshot.period, title: text(snapshot.title, 180, true), description: text(snapshot.description, 1500), startDate: date(snapshot.startDate), endDate: date(snapshot.endDate),
    events: snapshot.events.map(event => ({ id: identifier(event.id), title: text(event.title, 150, true), category: text(event.category, 100), date: date(event.date), time: text(event.time, 5), location: text(event.location, 200), section: Object.hasOwn(YEARBOOK_SECTIONS, event.section) ? event.section : 'social', message: text(event.message, 2000), photos: (event.photos || []).map(image => ({ url: yearbookPhoto(image.url), caption: text(image.caption, 240) })) })),
    boardPhoto: snapshot.boardPhoto?.url ? { url: yearbookPhoto(snapshot.boardPhoto.url), caption: text(snapshot.boardPhoto.caption, 240) } : null,
    presidentName: text(snapshot.presidentName, 120), presidentMessage: text(snapshot.presidentMessage, 5000), closingMessage: text(snapshot.closingMessage, 2000),
    statistics: publicYearbookStatistics(snapshot.statistics, snapshot.events.length), publishedAt: snapshot.publishedAt || null, publicationRevision: snapshot.publicationRevision || 0 };
}
export function yearbookSummary(record) {
  const value = projectYearbook(record.publishedSnapshot);
  return { id: value.id, period: value.period, title: value.title, description: value.description, publishedAt: value.publishedAt, publicationRevision: value.publicationRevision };
}
