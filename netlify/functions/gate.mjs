import { createHash } from 'node:crypto';
import { guarded, response, body, fail, identifier, text } from '../lib/security.mjs';
import { db } from '../lib/database.mjs';
import { readEvents } from './events.mjs';
import { operatorFor } from '../lib/staff.mjs';
import { operationsStore, readCheckins, enterTicket } from '../lib/checkins.mjs';
import { paged } from '../lib/raffles.mjs';

const codedFail = (status, code, message) => { const error = new Error(message); error.status = status; error.code = code; throw error; };
export function ticketCode(value, req) {
  let code = text(value, 2048, true).trim();
  if (!code.toUpperCase().startsWith('ERC-')) {
    let url;
    try { url = new URL(code); } catch { codedFail(400, 'GATE_INVALID_CODE', 'Geçerli bir ERCUPSA bilet QR’si veya kodu okutun.'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
        ![new URL(req.url).origin, 'https://ercupsa.com.tr', 'https://www.ercupsa.com.tr'].includes(url.origin) || url.pathname !== '/biletler.html')
      codedFail(400, 'GATE_INVALID_CODE', 'Bu QR, ERCUPSA bilet bağlantısı değil.');
    code = url.searchParams.get('ticket') || url.searchParams.get('code') || '';
  }
  code = code.toUpperCase().replace(/\s/g, '');
  if (!/^ERC-[A-F0-9]{24}$/.test(code)) codedFail(400, 'GATE_INVALID_CODE', 'Bilet kodunu kontrol edin.');
  return code;
}
const safeEntry = entry => ({ ticketId: entry.ticketId, userId: entry.userId, name: entry.name, enteredAt: entry.enteredAt, method: entry.method });
export function createGateHandler({ read = db, events = readEvents, store = operationsStore, now = () => new Date() } = {}) {
  return guarded(async req => {
    try {
      const url = new URL(req.url), action = url.searchParams.get('action') || 'participants', storage = store();
      if (req.method === 'GET' && action === 'events') {
        const operator = await operatorFor(req, undefined, storage, now());
        const catalog = (await events()).filter(event => operator.role === 'admin' || operator.eventIds.includes(event.id));
        return response({ events: catalog.map(({ id, title, date, time, location }) => ({ id, title, date, time, location })) });
      }
      const input = req.method === 'POST' ? await body(req) : null;
      const eventId = identifier(input?.eventId ?? url.searchParams.get('eventId'));
      const operator = await operatorFor(req, eventId, storage, now());
      const event = (await events()).find(item => item.id === eventId);
      if (!event) fail(404, 'Etkinlik bulunamadı.');
      if (req.method === 'GET' && action === 'participants') {
        const claims = await paged(`attendance?event_id=eq.${eventId}&select=user_id,ticket_id,created_at&order=user_id.asc`, read, { cursor: ['user_id'] });
        const entries = await readCheckins(eventId, storage);
        let profiles = [];
        for (let i = 0; i < claims.length; i += 100) {
          const ids = claims.slice(i, i + 100).map(claim => identifier(claim.user_id)).join(',');
          profiles.push(...await paged(`profiles?id=in.(${ids})&select=id,name&order=id.asc`, read, { cursor: ['id'] }));
        }
        const names = new Map(profiles.map(profile => [profile.id, profile.name]));
        const byTicket = new Map(claims.map(claim => [claim.ticket_id, claim]));
        const entered = new Map(entries.map(entry => [entry.ticketId, entry.enteredAt]));
        const participants = claims.map(claim => ({ id: claim.user_id, name: names.get(claim.user_id) || 'İsimsiz katılımcı', ticketId: claim.ticket_id, claimedAt: claim.created_at, enteredAt: entered.get(claim.ticket_id) || null })).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
        return response({ event, participants, entries: entries.map(entry => {
          const claim = byTicket.get(entry.ticketId);
          return safeEntry(claim ? { ...entry, userId: claim.user_id, name: names.get(claim.user_id) || entry.name } : entry);
        }), summary: { claimed: claims.length, entered: entries.length } });
      }
      if (req.method === 'POST' && ['scan', 'manual'].includes(action)) {
        let ticket;
        if (action === 'scan') {
          const code = ticketCode(input.code, req);
          [ticket] = await read(`tickets?code_hash=eq.${createHash('sha256').update(code).digest('hex')}&select=id,event_id,claimed_by,revoked&limit=1`);
        } else {
          const userId = identifier(input.userId);
          const [claim] = await read(`attendance?event_id=eq.${eventId}&user_id=eq.${userId}&select=ticket_id&limit=1`);
          if (!claim) codedFail(404, 'GATE_NO_TICKET', 'Bu kişi etkinliğin biletini hesabına eklememiş.');
          [ticket] = await read(`tickets?id=eq.${identifier(claim.ticket_id)}&select=id,event_id,claimed_by,revoked&limit=1`);
          if (ticket?.claimed_by !== userId) codedFail(409, 'GATE_INVALID_TICKET', 'Bilet sahibi doğrulanamadı. Listeyi yenileyin.');
        }
        if (!ticket || ticket.revoked) codedFail(409, 'GATE_INVALID_TICKET', 'Bilet geçersiz veya iptal edilmiş.');
        if (ticket.event_id !== eventId) codedFail(409, 'GATE_WRONG_EVENT', 'Bu bilet başka bir etkinliğe ait.');
        let name = 'Bilet sahibi';
        if (ticket.claimed_by) {
          const [profile] = await read(`profiles?id=eq.${identifier(ticket.claimed_by)}&select=name&limit=1`);
          name = profile?.name || 'İsimsiz katılımcı';
        }
        const result = await enterTicket(storage, eventId, { ticketId: identifier(ticket.id), userId: ticket.claimed_by || null, name,
          enteredAt: now().toISOString(), operatorId: operator.id, method: action === 'scan' ? 'qr' : 'manual' });
        return response({ ...result, entry: safeEntry(result.entry), event: { id: event.id, title: event.title } });
      }
      fail(405, 'Desteklenmeyen işlem.');
    } catch (error) {
      if (error.code?.startsWith('GATE_')) return response({ error: error.message, code: error.code }, error.status);
      throw error;
    }
  });
}
export default createGateHandler();
