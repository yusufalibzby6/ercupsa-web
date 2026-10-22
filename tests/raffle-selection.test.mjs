import test from 'node:test';
import assert from 'node:assert/strict';
import { previousWinnerIds, raffleExcludedIds } from '../assets/raffle-selection.js';

const people = ['a', 'b', 'c', 'd'].map(id => ({ id, name: 'Aynı isim' }));
const round = (id, ids, extra = {}) => ({ id, eventId: 'one', winners: ids.map(id => ({ id })), ...extra });

test('winner defaults combine rounds of the same event/source, including both form entry filters', () => {
  const draws = [round('old', ['a']), round('new', ['b']), round('other', ['c'], { eventId: 'two' }),
    round('form', ['d'], { source: 'registrations', checkedInOnly: true })];
  assert.deepEqual([...previousWinnerIds(draws, 'one', 'qr')], ['a', 'b']);
  assert.deepEqual([...previousWinnerIds(draws, 'one', 'registrations')], ['d']);
  assert.deepEqual([...previousWinnerIds(draws, 'two', 'qr')], ['c']);
  assert.deepEqual([...raffleExcludedIds(people, previousWinnerIds(draws, 'one', 'qr'), new Set(), new Set())], ['a', 'b']);
});

test('manual inclusion can override a winner while unrelated manual exclusions remain', () => {
  assert.deepEqual([...raffleExcludedIds(people, new Set(['a', 'b']), new Set(['c', 'missing']), new Set(['a']))], ['b', 'c']);
  // A fresh win clears that inclusion override in the caller before computing defaults.
  assert.deepEqual([...raffleExcludedIds(people, new Set(['a', 'b']), new Set(['c']), new Set())], ['a', 'b', 'c']);
});

test('deleted/failed rounds do not exclude people, and another surviving win still does', () => {
  const draws = [round('deleted', ['a', 'b'], { deleted: true }), round('failed', ['c'], { failed: true }), round('valid', ['a'])];
  assert.deepEqual([...previousWinnerIds(draws, 'one', 'qr')], ['a']);
  assert.deepEqual([...raffleExcludedIds(people, previousWinnerIds(draws, 'one', 'qr'), new Set(['d']), new Set())], ['a', 'd']);
});
