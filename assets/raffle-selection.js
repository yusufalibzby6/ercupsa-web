// QR accounts and form records have separate identities. Form entry filters
// share the same record IDs; names are never used to identify a past winner.
export function previousWinnerIds(draws, eventId, source) {
  const winners = new Set();
  for (const draw of draws) {
    if (draw.eventId !== eventId || (draw.source || 'qr') !== source || draw.deleted || draw.failed) continue;
    for (const person of draw.winners || []) if (typeof person.id === 'string') winners.add(person.id);
  }
  return winners;
}

export function raffleExcludedIds(participants, winners, manual, includedWinners) {
  return new Set(participants.filter(person => manual.has(person.id) ||
    winners.has(person.id) && !includedWinners.has(person.id)).map(person => person.id));
}
