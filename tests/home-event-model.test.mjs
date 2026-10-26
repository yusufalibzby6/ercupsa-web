import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validEventDate, eventStart, upcomingEvents, countdownParts } from '../assets/home-event-model.js';

const now = Date.parse('2026-10-25T12:00:00Z');
const event = (id, overrides = {}) => ({ id, title: id, published: true, date: '2026-10-26', time: '18:00', ...overrides });
const parts = value => value == null ? value : Object.fromEntries(['days', 'hours', 'minutes', 'seconds'].map(key => [key, value[key]]));

test('event start uses Türkiye UTC+03 independently of a caller device timezone and rejects impossible dates or times', () => {
  assert.equal(eventStart(event('next')), Date.parse('2026-10-26T15:00:00Z'));
  assert.equal(validEventDate('2024-02-29'), true);
  for (const date of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-01', '2026-10-00', '2026-1-1', '', null, undefined]) {
    assert.equal(validEventDate(date), false, String(date));
    assert.equal(eventStart(event('invalid', { date })), null);
  }
  for (const time of ['', '25:00', '24:00', '12:60', '9:30', '15:30:00', null, undefined]) assert.equal(eventStart(event('invalid-time', { time })), null, String(time));
});

test('countdown is based on the actual start and never fabricates a midnight or a negative countdown', () => {
  assert.deepEqual(parts(countdownParts(event('next'), now)), { days: 1, hours: 3, minutes: 0, seconds: 0 });
  assert.deepEqual(parts(countdownParts(event('next'), now + 1000)), { days: 1, hours: 2, minutes: 59, seconds: 59 });
  const start = eventStart(event('next'));
  assert.deepEqual(parts(countdownParts(event('next'), start - 1)), { days: 0, hours: 0, minutes: 0, seconds: 1 });
  assert.equal(countdownParts(event('next'), start), null);
  assert.equal(countdownParts(event('next'), start + 1), null);
  assert.equal(countdownParts(event('unknown', { time: '' }), now), null);
  assert.equal(countdownParts(event('broken', { date: '2027-02-30' }), now), null);
});

test('upcoming selection sorts genuine published events without mutating records and advances exactly at a start boundary', () => {
  const first = event('first', { date: '2026-10-25', time: '15:01' });
  const second = event('second', { date: '2026-10-25', time: '15:02' });
  const records = [second, event('draft', { published: false }), first, event('past', { date: '2026-10-24' }), event('invalid', { date: '2026-02-30' })];
  const original = structuredClone(records);
  assert.deepEqual(upcomingEvents(records, now).map(item => item.id), ['first', 'second']);
  assert.deepEqual(upcomingEvents(records, now + 60000).map(item => item.id), ['second']);
  assert.deepEqual(upcomingEvents(records, now + 120000).map(item => item.id), []);
  assert.deepEqual(records, original);
});

test('date-only event visibility follows the Türkiye calendar across local-device midnight', () => {
  const record = event('date-only', { date: '2026-10-26', time: '' });
  assert.equal(upcomingEvents([record], Date.parse('2026-10-25T21:00:00Z')).length, 1);
  assert.equal(upcomingEvents([record], Date.parse('2026-10-26T20:59:59Z')).length, 1);
  assert.equal(upcomingEvents([record], Date.parse('2026-10-26T21:00:00Z')).length, 0);
  assert.equal(countdownParts(record, now), null);
});
