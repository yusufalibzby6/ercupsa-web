import { createHash, randomUUID } from 'node:crypto';
import { guarded, requireAdmin, response, body, fail, identifier, text } from '../lib/security.mjs';
import { operationsStore } from '../lib/checkins.mjs';
import { JSON_READ, mutateJson } from '../lib/blob-state.mjs';
import { STAFF_KEY, publicAccount, normalizedUsername, passwordRecord, passwordMatches, staffCookie, logoutCookie, operatorFor } from '../lib/staff.mjs';
import { readEvents } from './events.mjs';

export function createStaffHandler({ store = operationsStore, events = readEvents, now = () => new Date(), uuid = randomUUID } = {}) {
  return guarded(async req => {
    const url = new URL(req.url), action = url.searchParams.get('action') || 'session';
    const storage = store();
    if (action === 'session' && req.method === 'GET') return response({ operator: await operatorFor(req, undefined, storage, now()) });
    if (action === 'logout' && req.method === 'POST') return response({ ok: true }, 200, { 'Set-Cookie': logoutCookie(req) });
    if (action === 'login' && req.method === 'POST') {
      const input = await body(req), username = normalizedUsername(input.username);
      const ip = req.headers.get('x-nf-client-connection-ip') || 'local';
      // A second IP bucket prevents bypassing the password throttle by rotating usernames.
      for (const [scope, limit] of [[ip, 50], [ip + ':' + username, 10]]) {
        const key = 'staff/rates/' + createHash('sha256').update(scope).digest('hex');
        await mutateJson(storage, key, { hits: 0, expires: 0 }, record => {
          if (record.expires <= now().getTime()) { record.hits = 0; record.expires = now().getTime() + 15 * 60 * 1000; }
          if (record.hits >= limit) fail(429, 'Çok fazla giriş denemesi. 15 dakika sonra tekrar deneyin.');
          record.hits++;
          return { result: true };
        });
      }
      const account = (await storage.get(STAFF_KEY, JSON_READ))?.accounts?.find(item => item.username === username && item.active);
      if (!passwordMatches(input.password, account)) fail(401, 'Kullanıcı adı veya şifre geçersiz.');
      return response({ operator: { ...publicAccount(account), role: 'staff' } }, 200, { 'Set-Cookie': staffCookie(req, account, now()) });
    }
    requireAdmin(req);
    if (action === 'accounts' && req.method === 'GET') return response({ accounts: ((await storage.get(STAFF_KEY, JSON_READ))?.accounts || []).map(publicAccount), events: await events() });
    if (action === 'accounts' && req.method === 'POST') {
      const input = await body(req), username = normalizedUsername(input.username), name = text(input.name, 120, true);
      if (!Array.isArray(input.eventIds) || input.eventIds.length < 1 || input.eventIds.length > 200) fail(400, 'En az bir etkinlik seçin.');
      const eventIds = [...new Set(input.eventIds.map(identifier))];
      const catalog = await events();
      if (eventIds.some(id => !catalog.some(event => event.id === id))) fail(400, 'Görevli etkinlik seçimi geçersiz.');
      const candidate = { id: uuid(), username, name, eventIds, active: true, version: randomUUID(), ...passwordRecord(input.password) };
      const account = await mutateJson(storage, STAFF_KEY, { accounts: [] }, state => {
        if (state.accounts.some(item => item.username === username)) fail(409, 'Bu kullanıcı adı zaten kullanılıyor.');
        if (state.accounts.length >= 100) fail(400, 'En fazla 100 görevli hesabı oluşturabilirsiniz.');
        state.accounts.push(candidate);
        return { result: publicAccount(candidate) };
      });
      return response({ account }, 201);
    }
    if (action === 'accounts' && req.method === 'DELETE') {
      const id = identifier(url.searchParams.get('id'));
      await mutateJson(storage, STAFF_KEY, { accounts: [] }, state => {
        const before = state.accounts.length;
        state.accounts = state.accounts.filter(item => item.id !== id);
        return { write: state.accounts.length !== before, result: true };
      });
      return response({ ok: true });
    }
    fail(405, 'Desteklenmeyen işlem.');
  });
}
export default createStaffHandler();
