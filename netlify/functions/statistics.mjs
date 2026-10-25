import { getStore as blobStore } from '@netlify/blobs';
import { randomUUID } from 'node:crypto';
import { guarded, requirePermission, response, body, fail, identifier } from '../lib/security.mjs';
import { statisticsFilters, readStatistics, readStatisticsCatalog, trackingKey } from '../lib/statistics.mjs';
import { mutateJson } from '../lib/blob-state.mjs';
import { appendAudit, auditOperation } from '../lib/event-audit.mjs';

export function createStatisticsHandler({ getStore = blobStore, read, now = () => new Date(), adminStore, uuid = randomUUID } = {}) {
  return guarded(async req => {
    const session = await requirePermission(req, req.method === 'GET' ? 'statistics.view' : 'attendance.manage', { getStore: adminStore });
    const url = new URL(req.url);
    if (req.method === 'GET') return response(await readStatistics({ getStore, read, now, filters: statisticsFilters(url.searchParams) }));
    if (req.method !== 'POST' || url.searchParams.get('action') !== 'complete') fail(405, 'Desteklenmeyen işlem.');
    const input = await body(req), eventId = identifier(input.eventId);
    if (typeof input.trackingComplete !== 'boolean' || typeof input.expectedRevision !== 'string' || input.expectedRevision.length > 100) fail(400, 'Katılım takibi seçimi geçersiz.');
    const event = (await readStatisticsCatalog(getStore)).find(item => item.id === eventId);
    if (!event) fail(404, 'Etkinlik bulunamadı.');
    const instant = now(), at = instant.toISOString(), operationId = uuid(), revision = uuid();
    if (input.trackingComplete && Date.parse(`${event.date}T${event.time || '00:00'}:00+03:00`) > instant.getTime()) fail(409, 'Henüz başlamamış etkinliğin giriş takibi tamamlanamaz.');
    const result = await mutateJson(getStore('ercupsa-operations'), trackingKey(eventId), { revision: '', trackingComplete: false }, value => {
      if (value.trackingComplete === input.trackingComplete) return { write: false, result: value };
      if (value.revision !== input.expectedRevision) fail(409, 'Giriş takibi başka bir pencerede değişti. İstatistikleri yenileyin.');
      appendAudit(value, auditOperation({ id: operationId, type: 'attendance.complete', at, actor: session, eventId,
        before: { trackingComplete: value.trackingComplete }, after: { trackingComplete: input.trackingComplete } }));
      Object.assign(value, { revision, trackingComplete: input.trackingComplete, completedAt: input.trackingComplete ? at : null });
      return { result: value };
    });
    return response({ ok: true, tracking: { trackingComplete: result.trackingComplete, revision: result.revision, completedAt: result.completedAt || null } });
  });
}
export default createStatisticsHandler();
