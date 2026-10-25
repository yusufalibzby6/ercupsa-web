import { createHash } from 'node:crypto';
import { guarded, response, body, fail, identifier, text } from '../lib/security.mjs';
import { db } from '../lib/database.mjs';
import { readEvents } from './events.mjs';
import { operatorFor } from '../lib/staff.mjs';
import { operationsStore, readCheckins, enterTicket } from '../lib/checkins.mjs';
import { paged } from '../lib/raffles.mjs';
import { readRegistrationTicketOwners, readRegistrationTicketRestrictions, registrationTicketIsBlocked } from '../lib/registration-ticket-owners.mjs';

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
const safeEntry = entry => ({ ticketId: entry.ticketId, userId: entry.userId, name: entry.name,
  ...(entry.registrationId ? { registrationId: entry.registrationId, classYear: entry.classYear || '' } : {}),
  ...(entry.accountName ? { accountName: entry.accountName } : {}), enteredAt: entry.enteredAt, method: entry.method });
const ownerKey = ticket => `${ticket.batch_id}:${ticket.code_hash}`;
function ticketIdentity(entry, ticket, owners, profileName, historical = false) {
  const person = ticket && (historical || !ticket.revoked) ? owners.get(ownerKey(ticket)) : null;
  // Account claims and form registrations are separate identities. A form
  // ticket keeps the registrant as its primary owner even if someone claims it
  // using a different account name. Never match by name or phone number.
  const { registrationId: _registrationId, classYear: _classYear, accountName: _accountName, ...rest } = entry;
  return { ...rest, userId: ticket ? ticket.claimed_by || null : entry.userId || null,
    name: person?.name || profileName || (entry.registrationId ? 'Bilet sahibi' : entry.name) || 'Bilet sahibi',
    ...(person ? { registrationId: person.id, classYear: person.classYear,
      ...(profileName && profileName !== person.name ? { accountName: profileName } : {}) } : {}) };
}
export function createGateHandler({ read = db, events = readEvents, store = operationsStore, now = () => new Date(), adminGetStore, registrationStore } = {}) {
  return guarded(async req => {
    try {
      const url = new URL(req.url), action = url.searchParams.get('action') || 'participants', storage = store();
      if (req.method === 'GET' && action === 'events') {
        const operator = await operatorFor(req, undefined, storage, now(), { adminGetStore });
        const catalog = (await events()).filter(event => operator.role === 'admin' || operator.eventIds.includes(event.id));
        return response({ events: catalog.map(({ id, title, date, time, location }) => ({ id, title, date, time, location })) });
      }
      const input = req.method === 'POST' ? await body(req) : null;
      const eventId = identifier(input?.eventId ?? url.searchParams.get('eventId'));
      const operator = await operatorFor(req, eventId, storage, now(), { adminGetStore });
      if (req.method === 'POST' && !operator.canManage) fail(403, 'Etkinlik girişi kaydetme yetkiniz yok.');
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
        const owners = new Map((await readRegistrationTicketOwners(eventId, { store: registrationStore, includeInactive: true })).map(person => [`${person.batchId}:${person.codeHash}`, person]));
        const ticketIds = [...new Set([...claims.map(claim => identifier(claim.ticket_id)), ...entries.map(entry => identifier(entry.ticketId))])];
        const tickets = [];
        for (let i = 0; i < ticketIds.length; i += 100) tickets.push(...await paged(`tickets?event_id=eq.${eventId}&id=in.(${ticketIds.slice(i, i + 100).join(',')})&select=id,event_id,batch_id,code_hash,claimed_by,revoked&order=id.asc`, read, { cursor: ['id'] }));
        const ticketById = new Map(tickets.map(ticket => [ticket.id, ticket]));
        const participants = claims.map(claim => {
          const identity = ticketIdentity({ userId: claim.user_id, name: names.get(claim.user_id) || 'İsimsiz katılımcı' }, ticketById.get(claim.ticket_id), owners, names.get(claim.user_id));
          return { id: claim.user_id, name: identity.name, ...(identity.registrationId ? { registrationId: identity.registrationId, classYear: identity.classYear } : {}),
            ...(identity.accountName ? { accountName: identity.accountName } : {}), ticketId: claim.ticket_id, claimedAt: claim.created_at, enteredAt: entered.get(claim.ticket_id) || null };
        }).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
        return response({ event, participants, entries: entries.map(entry => {
          const claim = byTicket.get(entry.ticketId);
          return safeEntry(ticketIdentity(claim ? { ...entry, userId: claim.user_id } : entry,
            ticketById.get(entry.ticketId), owners, names.get(claim?.user_id), true));
        }), summary: { claimed: claims.length, entered: entries.length } });
      }
      if (req.method === 'POST' && ['scan', 'manual'].includes(action)) {
        let ticket;
        if (action === 'scan') {
          const code = ticketCode(input.code, req);
          [ticket] = await read(`tickets?code_hash=eq.${createHash('sha256').update(code).digest('hex')}&select=id,event_id,batch_id,code_hash,claimed_by,revoked&limit=1`);
        } else {
          const userId = identifier(input.userId);
          const [claim] = await read(`attendance?event_id=eq.${eventId}&user_id=eq.${userId}&select=ticket_id&limit=1`);
          if (!claim) codedFail(404, 'GATE_NO_TICKET', 'Bu kişi etkinliğin biletini hesabına eklememiş.');
          [ticket] = await read(`tickets?id=eq.${identifier(claim.ticket_id)}&select=id,event_id,batch_id,code_hash,claimed_by,revoked&limit=1`);
          if (ticket?.claimed_by !== userId) codedFail(409, 'GATE_INVALID_TICKET', 'Bilet sahibi doğrulanamadı. Listeyi yenileyin.');
        }
        if (!ticket || ticket.revoked) codedFail(409, 'GATE_INVALID_TICKET', 'Bilet geçersiz veya iptal edilmiş.');
        if (ticket.event_id !== eventId) codedFail(409, 'GATE_WRONG_EVENT', 'Bu bilet başka bir etkinliğe ait.');
        let name = 'Bilet sahibi';
        if (ticket.claimed_by) {
          const [profile] = await read(`profiles?id=eq.${identifier(ticket.claimed_by)}&select=name&limit=1`);
          name = profile?.name || 'İsimsiz katılımcı';
        }
        const owners = new Map((await readRegistrationTicketOwners(eventId, { store: registrationStore })).map(person => [`${person.batchId}:${person.codeHash}`, person]));
        // Check the authoritative lifecycle immediately before recording entry;
        // profile/owner reads must not leave an earlier eligibility snapshot.
        const restrictions = await readRegistrationTicketRestrictions(eventId, { store: registrationStore });
        if (registrationTicketIsBlocked(ticket, restrictions))
          codedFail(409, 'GATE_INVALID_TICKET', 'Bu kaydın bileti etkinlik girişi için uygun değil veya kayıt iptal edilmiş.');
        const identity = ticketIdentity({ userId: ticket.claimed_by || null, name }, ticket, owners, ticket.claimed_by ? name : null);
        const result = await enterTicket(storage, eventId, { ticketId: identifier(ticket.id), ...identity,
          enteredAt: now().toISOString(), operatorId: operator.id, method: action === 'scan' ? 'qr' : 'manual' });
        return response({ ...result, entry: safeEntry(ticketIdentity(result.entry, ticket, owners, ticket.claimed_by ? name : null)), event: { id: event.id, title: event.title } });
      }
      fail(405, 'Desteklenmeyen işlem.');
    } catch (error) {
      if (error.code?.startsWith('GATE_')) return response({ error: error.message, code: error.code }, error.status);
      throw error;
    }
  });
}
export default createGateHandler();
