import { randomInt, createHash } from 'node:crypto';
import { fail, identifier, HttpError } from './security.mjs';

export class RaffleError extends HttpError {
  constructor(status, code, message) {
    super(status, message);
    this.code = code;
  }
}
export function raffleFail(status, code, message) {
  throw new RaffleError(status, code, message);
}

// Supabase's configured row cap can be below our requested page size. A short
// page is not evidence that the result set ended; only an empty page is.
export async function paged(query, read, { cursor = [] } = {}) {
  const rows = [], seen = new Set();
  let offset = 0, after = '';
  const maximum = 100000;
  for (let request = 0; request < 2001; request++) {
    const limit = Math.min(500, maximum - rows.length) || 1;
    const page = await read(`${query}&limit=${limit}&offset=${cursor.length ? 0 : offset}${after}`);
    if (!Array.isArray(page) || page.length > limit) fail(503, 'Katılımcılar doğrulanamadı.');
    if (!page.length) return rows;
    if (rows.length + page.length > maximum) break;
    if (cursor.length) {
      for (const row of page) {
        // These columns contain UUIDs or the validated ASCII event IDs. Never
        // interpolate unchecked database data into a PostgREST filter.
        const values = cursor.map(field => identifier(row[field]));
        const key = JSON.stringify(values);
        if (seen.has(key)) fail(503, 'Katılımcı listesi değişti. Lütfen yeniden yükleyin.');
        seen.add(key);
      }
      const last = page.at(-1);
      const conditions = cursor.map((field, i) => {
        const greater = `${field}.gt.${identifier(last[field])}`;
        return i ? `and(${cursor.slice(0, i).map(previous => `${previous}.eq.${identifier(last[previous])}`).join(',')},${greater})` : greater;
      });
      after = `&${conditions.length > 1 ? 'or' : 'and'}=${encodeURIComponent(`(${conditions.join(',')})`)}`;
    }
    rows.push(...page);
    offset += page.length;
  }
  fail(503, 'Katılımcı listesi çok büyük; çekiliş başlatılmadı.');
}

export function participantsFor(event, events, attendance, profiles, now = Date.now()) {
  const dates = new Map(events.map(e => [e.id, `${e.date}T${e.time || '00:00'}`]));
  const selectedDate = dates.get(event.id);
  const names = new Map(profiles.map(p => [p.id, p.name]));
  const selected = new Map(), previousByUser = new Map();
  for (const claim of attendance) {
    if (claim.event_id === event.id) selected.set(claim.user_id, claim);
    else if (dates.has(claim.event_id) && dates.get(claim.event_id) < selectedDate && Date.parse(dates.get(claim.event_id) + ':00+03:00') <= now) {
      if (!previousByUser.has(claim.user_id)) previousByUser.set(claim.user_id, new Set());
      previousByUser.get(claim.user_id).add(claim.event_id);
    }
    // A deleted event has no trustworthy date. Its claim timestamp does not
    // prove that the event happened: future tickets may be claimed early.
  }
  return [...selected].map(([id, claim]) => {
    const previous = previousByUser.get(id)?.size || 0;
    return { id, name: names.get(id) || 'İsimsiz katılımcı', previous, weight: 1 + previous, claimedAt: claim.created_at };
  }).sort((a, b) => a.name.localeCompare(b.name, 'tr') || a.id.localeCompare(b.id));
}

export function poolVersion(eventId, participants) {
  const snapshot = participants.map(p => ({ id: p.id, weight: p.weight, name: p.name, claimedAt: p.claimedAt }))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return createHash('sha256').update(JSON.stringify({ eventId, participants: snapshot })).digest('hex');
}

export function drawInput(input) {
  try {
    const id = identifier(input.requestId), eventId = identifier(input.eventId);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) fail(400, 'Geçersiz çekiliş kimliği.');
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > 200) fail(400, '1–200 arasında kazanan sayısı seçin.');
    if (!Array.isArray(input.excluded) || input.excluded.length > 10000) fail(400, 'Geçersiz katılımcı seçimi.');
    const excluded = [...new Set(input.excluded.map(identifier))].sort();
    const normalized = { id, eventId, count: input.count, excluded };
    if (input.poolVersion !== undefined) {
      if (typeof input.poolVersion !== 'string' || !/^[0-9a-f]{64}$/i.test(input.poolVersion)) fail(400, 'Geçersiz katılımcı listesi sürümü.');
      normalized.poolVersion = input.poolVersion.toLowerCase();
    }
    // Omitting the version keeps the exact old hash for already-saved legacy
    // draws. The handler rejects every new draw without a preview version.
    return { ...normalized, hash: createHash('sha256').update(JSON.stringify(normalized)).digest('hex') };
  } catch (error) {
    if (error instanceof HttpError && error.status === 400) raffleFail(400, 'RAFFLE_INVALID_SELECTION', error.message);
    throw error;
  }
}

export function weightedWinners(participants, count, pick = randomInt) {
  if (count > participants.length) raffleFail(400, 'RAFFLE_INVALID_SELECTION', 'Kazanan sayısı dahil edilen kişi sayısını aşamaz.');
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

export async function savedDraw(store, eventId, id) {
  const saved = await store.get(`events/${eventId}.json`, { type: 'json', consistency: 'strong' });
  const draw = (saved?.draws || []).find(d => d.id === id);
  if (draw?.deleted) raffleFail(409, 'RAFFLE_DRAW_DELETED', 'Bu çekiliş silindi. Yeni çekiliş başlatın.');
  if (draw?.failed) raffleFail(draw.status, draw.code, draw.message);
  return draw || null;
}

export async function drawHistory(store, eventId) {
  const saved = await store.get(`events/${eventId}.json`, { type: 'json', consistency: 'strong' });
  return (saved?.draws || []).filter(d => !d.deleted && !d.failed);
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
      if (existing.deleted) raffleFail(409, 'RAFFLE_DRAW_DELETED', 'Bu çekiliş silindi. Yeni çekiliş başlatın.');
      if (existing.hash !== input.hash) raffleFail(409, 'RAFFLE_REQUEST_CONFLICT', 'Bu istek farklı bir çekiliş için kullanıldı.');
      if (existing.failed) raffleFail(existing.status, existing.code, existing.message);
      return existing;
    }
    if (!candidate) {
      try {
        candidate = await makeDraw();
      } catch (error) {
        if (!(error instanceof RaffleError) || !['RAFFLE_POOL_REQUIRED', 'RAFFLE_POOL_CHANGED', 'RAFFLE_INVALID_SELECTION'].includes(error.code)) throw error;
        // A timed-out older request may already have validated this preview
        // and still be attempting its write. Commit rejection to the same CAS
        // ledger before telling a retry that it can discard the request ID.
        // Whichever decision wins blocks the other; no participant data is
        // retained for rejected requests.
        candidate = { id: input.id, hash: input.hash, failed: true, status: error.status, code: error.code, message: error.message };
      }
    }
    const result = await store.setJSON(key, { draws: [candidate, ...draws] }, snap ? { onlyIfMatch: snap.etag } : { onlyIfNew: true });
    if (result.modified) {
      if (candidate.failed) raffleFail(candidate.status, candidate.code, candidate.message);
      return candidate;
    }
  }
  raffleFail(409, 'RAFFLE_RETRY', 'Çekiliş kaydı değişti. Aynı isteği yeniden deneyin.');
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
  raffleFail(409, 'RAFFLE_RETRY', 'Çekiliş kaydı değişti. Aynı isteği yeniden deneyin.');
}
