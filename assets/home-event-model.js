// Event wall-clock values belong to Türkiye; device timezones cannot move them.
export function validEventDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T12:00:00+03:00`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}
export const validEventTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export function eventStart(event) {
  return validEventDate(event?.date) && validEventTime(event?.time)
    ? Date.parse(`${event.date}T${event.time}:00+03:00`) : null;
}
export function turkeyDate(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
export function usableEvents(events) {
  return (Array.isArray(events) ? events : []).filter(event => event && event.published !== false &&
    typeof event.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(event.id) &&
    typeof event.title === 'string' && event.title.trim() && validEventDate(event.date));
}
export function upcomingEvents(events, now = Date.now()) {
  const today = turkeyDate(now);
  return usableEvents(events).filter(event => {
    const start = eventStart(event);
    return start === null ? event.date >= today : start > now;
  }).sort((a, b) => a.date.localeCompare(b.date) ||
    (validEventTime(a.time) ? a.time : '24:00').localeCompare(validEventTime(b.time) ? b.time : '24:00') || a.id.localeCompare(b.id));
}
export function countdownParts(event, now = Date.now()) {
  const start = eventStart(event);
  if (start === null || !Number.isFinite(now) || start <= now) return null;
  const total = Math.ceil((start - now) / 1000);
  return { days: Math.floor(total / 86400), hours: Math.floor(total % 86400 / 3600), minutes: Math.floor(total % 3600 / 60), seconds: total % 60 };
}
export function eventDateLabel(date) {
  return validEventDate(date) ? new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${date}T12:00:00+03:00`)) : '';
}
export function publicImage(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
