import { randomInt, createHash } from 'node:crypto';
import { fail, identifier } from './security.mjs';

export async function paged(query, read) {
  const rows = [];
  for (let offset = 0; offset < 100000; offset += 500) {
    const page = await read(`${query}&limit=500&offset=${offset}`);
    if (!Array.isArray(page)) fail(503, 'Katılımcılar doğrulanamadı.');
    rows.push(...page);
    if (page.length < 500) return rows;
  }
  fail(503, 'Katılımcı listesi çok büyük; çekiliş başlatılmadı.');
}
export function participantsFor(event, events, attendance, profiles, now = Date.now()) {
  const dates = new Map(events.map(e => [e.id, `${e.date}T${e.time || '00:00'}`]));
  const selectedDate = dates.get(event.id);
  const names = new Map(profiles.map(p => [p.id, p.name]));
  const selected = new Map(attendance.filter(a => a.event_id === event.id).map(a => [a.user_id, a]));
  return [...selected].map(([id, claim]) => {
    const previous = new Set(attendance.filter(a => a.user_id === id && a.event_id !== event.id &&
      (dates.has(a.event_id) ? dates.get(a.event_id) < selectedDate && Date.parse(dates.get(a.event_id) + ':00+03:00') <= now : a.created_at < claim.created_at)).map(a => a.event_id));
    return { id, name: names.get(id) || 'İsimsiz katılımcı', previous: previous.size, weight: 1 + previous.size, claimedAt: claim.created_at };
  }).sort((a, b) => a.name.localeCompare(b.name, 'tr') || a.id.localeCompare(b.id));
}
export function drawInput(input) {
  const id = identifier(input.requestId), eventId = identifier(input.eventId);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) fail(400, 'Geçersiz çekiliş kimliği.');
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 200) fail(400, '1–200 arasında kazanan sayısı seçin.');
  if (!Array.isArray(input.excluded) || input.excluded.length > 10000) fail(400, 'Geçersiz katılımcı seçimi.');
  const excluded = [...new Set(input.excluded.map(identifier))].sort();
  const normalized = { id, eventId, count: input.count, excluded };
  return { ...normalized, hash: createHash('sha256').update(JSON.stringify(normalized)).digest('hex') };
}
export function weightedWinners(participants, count, pick = randomInt) {
  if (count > participants.length) fail(400, 'Kazanan sayısı dahil edilen kişi sayısını aşamaz.');
  const pool = [...participants], winners = [];
  while (winners.length < count) {
    const total = pool.reduce((sum, p) => sum + p.weight, 0);
    if (!Number.isSafeInteger(total) || total <= 0 || total >= 2 ** 48) fail(503, 'Çekiliş hakları doğrulanamadı.');
    let ticket = pick(total), index = 0;
    while (ticket >= pool[index].weight) ticket -= pool[index++].weight;
    winners.push(pool.splice(index, 1)[0]);
  }
  return winners;
}
export async function saveDraw(store, input, makeDraw) {
  const key = `events/${input.eventId}.json`;
  let candidate;
  for (let attempt = 0; attempt < 12; attempt++) {
    const snap = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
    if (snap && !snap.etag) fail(503, 'Çekiliş kaydı doğrulanamadı. Lütfen yeniden deneyin.');
    const draws = snap?.data?.draws || [];
    const existing = draws.find(d => d.id === input.id);
    if (existing) {
      if (existing.deleted) fail(409, 'Bu çekiliş silindi. Yeni çekiliş başlatın.');
      if (existing.hash !== input.hash) fail(409, 'Bu istek farklı bir çekiliş için kullanıldı.');
      return existing;
    }
    candidate ||= await makeDraw();
    const result = await store.setJSON(key, { draws: [candidate, ...draws] }, snap ? { onlyIfMatch: snap.etag } : { onlyIfNew: true });
    if (result.modified) return candidate;
  }
  fail(409, 'Çekiliş kaydı değişti. Aynı isteği yeniden deneyin.');
}
export async function deleteDraw(store, eventId, id) {
  const key = `events/${eventId}.json`;
  for (let attempt = 0; attempt < 12; attempt++) {
    const snap = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
    if (!snap) fail(404, 'Çekiliş bulunamadı.');
    if (!snap.etag) fail(503, 'Çekiliş kaydı doğrulanamadı.');
    const draws = snap.data.draws;
    const index = draws.findIndex(d => d.id === id);
    if (index < 0) fail(404, 'Çekiliş bulunamadı.');
    if (draws[index].deleted) return;
    draws[index] = { id, deleted: true };
    if ((await store.setJSON(key, { draws }, { onlyIfMatch: snap.etag })).modified) return;
  }
  fail(409, 'Çekiliş kaydı değişti. Yeniden deneyin.');
}
