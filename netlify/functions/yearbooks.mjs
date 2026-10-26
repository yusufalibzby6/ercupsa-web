import { randomUUID } from 'node:crypto';
import { getStore as getBlobStore } from '@netlify/blobs';
import { body, fail, guarded, requireOwner, requirePermission, response, text } from '../lib/security.mjs';
import { CONTENT_STORE, EVENTS_KEY, activeEvents, eventArray } from '../lib/event-state.mjs';
import { YEARBOOK_STORE, yearbookKey, yearbookId, defaultYearbookDraft, normalizeYearbookDraft, projectYearbook, yearbookSummary } from '../lib/yearbooks.mjs';
import { readYearbookStatistics } from '../lib/statistics.mjs';
import { yearbookDocument, yearbookArchiveDocument } from '../../assets/yearbook-render.js';

const READ = { type: 'json', consistency: 'strong' };
const actor = session => ({ id: session.id, username: session.username });
export function createYearbooksHandler({ getStore = getBlobStore, readEvents, statistics, now = () => new Date(), revision = randomUUID, adminStore } = {}) {
  const catalogEvents = readEvents || (async () => activeEvents(eventArray(await getStore(CONTENT_STORE).get(EVENTS_KEY, READ), []), true));
  const getStatistics = statistics || (async ids => readYearbookStatistics(ids, { getStore, now }));
  const handler = guarded(async req => {
    const url = new URL(req.url), action = url.searchParams.get('action') || '';
    const publicRead = req.method === 'GET' && ['', 'readable'].includes(action);
    const session = publicRead ? null : req.method === 'DELETE' ? await requireOwner(req, { getStore: adminStore })
      : await requirePermission(req, req.method === 'GET' ? 'yearbooks.view' : ['publish', 'unpublish'].includes(action) ? 'yearbooks.publish' : 'yearbooks.manage', { getStore: adminStore });
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method) || req.method === 'GET' && !['', 'admin', 'preview', 'readable'].includes(action) || ['PUT', 'DELETE'].includes(req.method) && action || req.method === 'POST' && !['', 'publish', 'unpublish'].includes(action)) fail(405, 'Desteklenmeyen yıllık işlemi.');
    const store = getStore(YEARBOOK_STORE);
    async function records() {
      const listed = await store.list({ prefix: 'years/' });
      if (!Array.isArray(listed?.blobs) || listed.blobs.length > 100) fail(503, 'Yıllık arşivi doğrulanamadı.');
      const result = [];
      for (const item of listed.blobs) {
        const match = item.key?.match(/^years\/(20\d{2}-20\d{2})\.json$/);
        if (!match) fail(503, 'Yıllık arşivi doğrulanamadı.');
        const record = await store.get(item.key, READ);
        if (!record || record.id !== yearbookId(match[1]) || record.version !== 1) fail(503, 'Yıllık arşivi doğrulanamadı.');
        if (record.deleted !== true) result.push(record);
      }
      return result.sort((a, b) => b.id.localeCompare(a.id));
    }
    async function saved(id) {
      const value = await store.get(yearbookKey(id), READ);
      if (!value || value.deleted === true || value.version !== 1 || value.id !== id) fail(404, 'Yıllık bulunamadı.');
      return value;
    }
    async function snapshot(record, forPublication) {
      const draft = normalizeYearbookDraft(record.draft), events = await catalogEvents(), byId = new Map(events.map(event => [event.id, event]));
      if (forPublication && !draft.events.length) fail(400, 'Yayımlamadan önce en az bir etkinlik seçin.');
      const today = now().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
      const selected = draft.events.map(selection => {
        const event = byId.get(selection.id);
        if (!event) fail(409, 'Seçili bir etkinlik artık bulunmuyor. Taslağı kontrol edin.');
        if (event.date < draft.startDate || event.date > draft.endDate) fail(400, 'Seçili etkinlik dönem tarihleri dışında.');
        // Date-only comparison would admit an event scheduled later today.
        // With no start time, wait until the following day rather than assume
        // that a same-day event has already taken place.
        const eventStart = event.time ? Date.parse(`${event.date}T${event.time}:00+03:00`) : null;
        if (forPublication && (event.date > today || event.date === today && (!Number.isFinite(eventStart) || eventStart > now().getTime()))) fail(400, 'Henüz gerçekleşmemiş etkinlikleri yayımlanan yıllığa ekleyemezsiniz.');
        const allowed = new Set([...(event.images || []).map(image => image.url), event.poster].filter(Boolean));
        for (const image of selection.photos) {
          if (!allowed.has(image.url)) fail(400, 'Seçili fotoğraf etkinliğin mevcut görsellerinde bulunmuyor.');
          if (forPublication && !image.rightsApproved) fail(400, 'Yayımlamadan önce her fotoğrafın yayın uygunluğunu kontrol edin.');
        }
        return { id: event.id, title: event.title, category: event.category || '', date: event.date, time: event.time || '', location: event.location || '', section: selection.section, message: selection.message, photos: selection.photos.map(({ url, caption }) => ({ url, caption })) };
      });
      if (forPublication && draft.boardPhoto.url && !draft.boardPhoto.rightsApproved) fail(400, 'Yönetim kurulu fotoğrafının yayın uygunluğunu kontrol edin.');
      return projectYearbook({ ...draft, id: record.id, period: record.period, events: selected, statistics: await getStatistics(selected.map(event => event.id)), publishedAt: forPublication ? now().toISOString() : null, publicationRevision: (record.publicationRevision || 0) + (forPublication ? 1 : 0) });
    }
    if (req.method === 'GET') {
      const requested = url.searchParams.get('id') || url.searchParams.get('donem');
      if (publicRead) {
        if (requested) {
          const record = await saved(yearbookId(requested));
          if (record.visibility !== 'published' || !record.publishedSnapshot) fail(404, 'Yıllık henüz yayımlanmamış.');
          const yearbook = projectYearbook(record.publishedSnapshot);
          return action === 'readable' ? new Response(yearbookDocument(yearbook), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }) : response({ yearbook });
        }
        const yearbooks = (await records()).filter(record => record.visibility === 'published' && record.publishedSnapshot).map(yearbookSummary);
        return action === 'readable' ? new Response(yearbookArchiveDocument(yearbooks), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }) : response({ yearbooks });
      }
      if (action === 'preview') return response({ yearbook: await snapshot(await saved(yearbookId(requested)), false), preview: true }, 200, { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' });
      const catalog = (await records()).map(record => ({ id: record.id, period: record.period, title: record.draft.title, visibility: record.visibility, revision: record.revision, updatedAt: record.updatedAt, publishedAt: record.publishedSnapshot?.publishedAt || null }));
      const events = (await catalogEvents()).map(({ id, title, date, category, poster, images }) => ({ id, title, date, category, poster: poster || '', images: (images || []).map(({ url, width, height }) => ({ url, width, height })) }));
      return response({ catalog, events, ...(requested ? { yearbook: await saved(yearbookId(requested)) } : {}) }, 200, { 'Cache-Control': 'private, no-store' });
    }
    const input = await body(req), id = yearbookId(input.id || input.period), key = yearbookKey(id), at = now().toISOString(), nextRevision = revision();
    if (req.method === 'POST' && !action) {
      const previous = await store.getWithMetadata(key, READ);
      if (previous?.data && previous.data.deleted !== true) fail(409, 'Bu dönem için zaten bir yıllık var.');
      if (previous?.data && (previous.data.version !== 1 || previous.data.id !== id || !previous.etag)) fail(503, 'Yıllık arşivi doğrulanamadı.');
      const initial = { version: 1, id, period: id, revision: nextRevision, createdAt: at, updatedAt: at, draft: defaultYearbookDraft(id), visibility: 'draft', publishedSnapshot: null, publicationRevision: 0,
        operations: [...(previous?.data?.operations || []), { id: revision(), type: 'create', at, actor: actor(session) }].slice(-200) };
      const result = await store.setJSON(key, initial, previous?.data ? { onlyIfMatch: previous.etag } : { onlyIfNew: true });
      if (!result.modified) fail(409, 'Bu dönem için zaten bir yıllık var.');
      return response({ ok: true, yearbook: initial }, 201);
    }
    const expected = text(input.revision, 100, true), draft = req.method === 'PUT' ? normalizeYearbookDraft(input.draft) : null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const stored = await store.getWithMetadata(key, READ);
      if (!stored?.data || !stored.etag) fail(404, 'Yıllık bulunamadı.');
      const current = stored.data;
      if (current.version !== 1 || current.id !== id) fail(503, 'Yıllık doğrulanamadı.');
      if (current.deleted === true) fail(404, 'Yıllık silinmiş.');
      if (current.revision !== expected) fail(409, 'Yıllık başka bir pencerede değişti. Taslağı kopyalayıp kaydedileni yükleyin.');
      if (req.method === 'DELETE') {
        // Blobs has no conditional delete. Replace the contents with an atomic
        // deletion marker so an in-flight editor cannot restore a removed book.
        // Only the operation history remains; gallery assets are never touched.
        const deleted = { version: 1, id, period: current.period, revision: nextRevision, deleted: true, createdAt: current.createdAt, updatedAt: at, deletedAt: at,
          operations: [...(current.operations || []), { id: nextRevision, type: 'delete', at, actor: actor(session) }].slice(-200) };
        const result = await store.setJSON(key, deleted, { onlyIfMatch: stored.etag });
        if (result.modified) return response({ ok: true, id, deleted: true });
        continue;
      }
      let changed;
      if (draft) changed = { draft };
      else if (action === 'publish') changed = { visibility: 'published', publishedSnapshot: await snapshot(current, true), publicationRevision: (current.publicationRevision || 0) + 1,
        rightsReview: { at, actor: actor(session), photos: current.draft.events.flatMap(event => event.photos.map(photo => ({ eventId: event.id, url: photo.url }))), boardPhoto: current.draft.boardPhoto.url || '' } };
      else changed = { visibility: 'draft' };
      const operation = { id: nextRevision, type: draft ? 'update' : action, at, actor: actor(session) };
      const record = { ...current, ...changed, revision: nextRevision, updatedAt: at, operations: [...(current.operations || []), operation].slice(-200) };
      const result = await store.setJSON(key, record, { onlyIfMatch: stored.etag });
      if (result.modified) return response({ ok: true, yearbook: record });
    }
    fail(409, 'Yıllık değişti. Kaydedileni yükleyip yeniden deneyin.');
  });
  return async req => { const result = await handler(req); if (new URL(req.url).searchParams.get('action') === 'preview') { result.headers.set('Cache-Control', 'private, no-store'); result.headers.set('X-Robots-Tag', 'noindex, nofollow'); } return result; };
}
export default createYearbooksHandler();
