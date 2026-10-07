import { createHmac, timingSafeEqual, randomBytes, scryptSync } from 'node:crypto';
import { admin, fail, text } from './security.mjs';
import { operationsStore } from './checkins.mjs';
import { JSON_READ } from './blob-state.mjs';

export const STAFF_KEY = 'staff/state.json';
export const publicAccount = account => ({ id: account.id, username: account.username, name: account.name, eventIds: account.eventIds, active: account.active });
export const normalizedUsername = value => {
  const username = text(value, 50, true).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,49}$/.test(username)) fail(400, 'Kullanıcı adı 3–50 karakter olmalı; harf, rakam, nokta, tire veya alt çizgi kullanın.');
  return username;
};
export function passwordRecord(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) fail(400, 'Görevli şifresi 8–128 karakter olmalı.');
  const salt = randomBytes(16).toString('hex');
  return { salt, passwordHash: scryptSync(password, salt, 32).toString('hex') };
}
export function passwordMatches(password, account) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const derived = scryptSync(password, account?.salt || 'invalid-login-salt', 32);
  const expected = Buffer.from(account?.passwordHash || '0'.repeat(64), 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected) && Boolean(account);
}
const signature = value => createHmac('sha256', process.env.ADMIN_PASSWORD || '').update('gate:' + value).digest('base64url');
export function staffCookie(req, account, now = new Date()) {
  if (!process.env.ADMIN_PASSWORD) fail(503, 'Görevli oturumu henüz yapılandırılmadı.');
  const token = Buffer.from(JSON.stringify({ id: account.id, version: account.version, expires: now.getTime() + 8 * 60 * 60 * 1000 })).toString('base64url');
  return `ercupsa_gate=${token}.${signature(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${new URL(req.url).protocol === 'https:' ? '; Secure' : ''}`;
}
export function logoutCookie(req) {
  return `ercupsa_gate=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${new URL(req.url).protocol === 'https:' ? '; Secure' : ''}`;
}
export async function operatorFor(req, eventId, storage = operationsStore(), now = new Date()) {
  if (admin(req)) return { id: 'admin', name: 'Yönetici', role: 'admin', eventIds: [] };
  const raw = (req.headers.get('cookie') || '').split(';').map(item => item.trim()).find(item => item.startsWith('ercupsa_gate='))?.slice(13);
  if (!process.env.ADMIN_PASSWORD || !raw || raw.length > 1024) fail(401, 'Görevli girişi gerekli.');
  const parts = raw.split('.'), expected = signature(parts[0]);
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]{43}$/.test(parts[1]) || !timingSafeEqual(Buffer.from(parts[1]), Buffer.from(expected))) fail(401, 'Görevli oturumu geçersiz.');
  let token;
  try { token = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { fail(401, 'Görevli oturumu geçersiz.'); }
  if (!token || typeof token.id !== 'string' || typeof token.version !== 'string' ||
      !Number.isFinite(token.expires) || token.expires <= now.getTime()) fail(401, 'Görevli oturumu sona erdi. Tekrar giriş yapın.');
  const account = (await storage.get(STAFF_KEY, JSON_READ))?.accounts?.find(item => item.id === token.id && item.version === token.version && item.active);
  if (!account) fail(401, 'Görevli hesabı kaldırılmış veya yetkisi değiştirilmiş.');
  if (eventId && !account.eventIds.includes(eventId)) fail(403, 'Bu etkinlik için görevli yetkiniz yok.');
  return { id: account.id, name: account.name, role: 'staff', eventIds: account.eventIds };
}
