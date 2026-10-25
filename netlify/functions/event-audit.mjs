import { getStore as blobStore } from '@netlify/blobs';
import { guarded, requirePermission, response, fail } from '../lib/security.mjs';
import { CONTENT_STORE, EVENTS_KEY, eventArray, isDeletedEvent } from '../lib/event-state.mjs';
import { REGISTRATION_STORE } from '../lib/registrations.mjs';
import { projectAuditOperation } from '../lib/event-audit.mjs';
import { statisticsFilters, trackingKey } from '../lib/statistics.mjs';

const READ = { type: 'json', consistency: 'strong' };
export function createEventAuditHandler({ getStore = blobStore, adminStore } = {}) {
  return guarded(async req => {
    await requirePermission(req, 'audit.view', { getStore: adminStore });
    if (req.method !== 'GET') fail(405, 'İşlem geçmişi yalnızca görüntülenebilir.');
    const params = new URL(req.url).searchParams, filters = statisticsFilters(params), type = params.get('type') || '';
    if (type && !/^[a-z][a-z0-9_.-]{0,79}$/.test(type)) fail(400, 'İşlem türü geçersiz.');
    const pageText = params.get('page') || '1';
    if (!/^[1-9]\d{0,5}$/.test(pageText)) fail(400, 'Sayfa numarası geçersiz.');
    const records = eventArray(await getStore(CONTENT_STORE).get(EVENTS_KEY, READ), []);
    const registrationStore = getStore(REGISTRATION_STORE), operations = getStore('ercupsa-operations');
    const listed = await registrationStore.list({ prefix: 'state/' });
    const ids = new Set(records.map(record => record.id));
    for (const item of listed.blobs || []) {
      const match = item.key?.match(/^state\/([A-Za-z0-9_-]{1,100})\.json$/);
      if (match) ids.add(match[1]);
    }
    const events = new Map(records.map(record => [record.id, { id: record.id, title: (isDeletedEvent(record) ? record.event : record)?.title || 'Arşivlenmiş etkinlik' }]));
    const rows = [];
    const append = (items, id, origin) => {
      if (!Array.isArray(items)) fail(503, 'İşlem geçmişi doğrulanamadı.');
      items.forEach((item, index) => { const safe = projectAuditOperation(item, id, origin, index); if (safe) rows.push(safe); });
    };
    const selected = [...ids].filter(id => !filters.eventId || filters.eventId === id);
    for (let offset = 0; offset < selected.length; offset += 4) await Promise.all(selected.slice(offset, offset + 4).map(async id => {
      const record = records.find(item => item.id === id);
      if (record) append(record.operations || [], id, 'event');
      const [registration, tracking] = await Promise.all([registrationStore.get(`state/${id}.json`, READ), operations.get(trackingKey(id), READ)]);
      if (!events.has(id)) events.set(id, { id, title: typeof registration?.event?.title === 'string' ? registration.event.title : 'Arşivlenmiş etkinlik' });
      append(registration?.audit || [], id, 'registration'); append(tracking?.audit || [], id, 'attendance');
    }));
    // The administrator sees Turkey time in the UI; date filters use the same
    // calendar day instead of silently cutting the final three hours off.
    const localDay = at => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
    const filtered = rows.filter(item => (!type || item.type === type) && (!filters.from || localDay(item.at) >= filters.from) && (!filters.to || localDay(item.at) <= filters.to))
      .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
    const unique = [...new Map(filtered.map(item => [item.id, item])).values()], pageSize = 50, totalPages = Math.max(1, Math.ceil(unique.length / pageSize));
    const page = Math.min(Number(pageText), totalPages);
    return response({ events: [...events.values()], operations: unique.slice((page - 1) * pageSize, page * pageSize),
      total: unique.length, page, totalPages, types: [...new Set(rows.map(item => item.type))].sort(), filters: { ...filters, type } });
  });
}
export default createEventAuditHandler();
