/* Event dates and times are always interpreted in Türkiye, regardless of the device timezone. */
window.ercupsaEvents = (() => {
  const zone = 'Europe/Istanbul';
  const validDate = date => /^\d{4}-\d{2}-\d{2}$/.test(date || '') && Number.isFinite(Date.parse(`${date}T12:00:00+03:00`))
    && new Date(`${date}T12:00:00+03:00`).toISOString().slice(0, 10) === date;
  const validTime = time => /^([01]\d|2[0-3]):[0-5]\d$/.test(time || '');
  const today = () => new Intl.DateTimeFormat('en', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).reduce((date, part) => {
    if (['year', 'month', 'day'].includes(part.type)) date[part.type] = part.value;
    return date;
  }, {});
  const dateToday = () => { const date = today(); return `${date.year}-${date.month}-${date.day}`; };
  const start = event => validDate(event.date) && validTime(event.time)
    ? Date.parse(`${event.date}T${event.time}:00+03:00`) : null;
  const isPast = event => !validDate(event.date) || (start(event) !== null
    ? start(event) <= Date.now() : event.date < dateToday());
  const compare = (a, b) => String(a.date || '').localeCompare(String(b.date || ''))
    || String(a.time || '23:59').localeCompare(String(b.time || '23:59'));
  const formatDate = date => validDate(date) ? new Intl.DateTimeFormat('tr-TR', {
    timeZone: zone, day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(`${date}T12:00:00+03:00`)) : '';
  const safeUrl = value => {
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  };
  // A saved native form owns registration even when disabled; do not fall back to an old external link.
  const registrationAvailable = event => Boolean(event && event.published !== false && validDate(event.date)
    && event.date >= dateToday() && (event.registrationMode === 'native'
      ? event.registrationEnabled === true : safeUrl(event.registrationUrl)));
  const mapUrl = location => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(location)}`;
  const icsEscape = value => String(value || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
  // Fold at 75 bytes as required by iCalendar, including UTF-8 Turkish characters.
  const fold = line => {
    const encoder = new TextEncoder();
    let result = '', bytes = 0;
    for (const char of line) {
      const size = encoder.encode(char).length;
      if (bytes + size > 75) { result += '\r\n '; bytes = 1; }
      result += char; bytes += size;
    }
    return result;
  };
  const calendar = (event, url) => {
    if (!validDate(event.date)) return '';
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const timed = start(event);
    const when = timed !== null
      ? `DTSTART:${new Date(timed).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`
      : `DTSTART;VALUE=DATE:${event.date.replace(/-/g, '')}`;
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ERCUPSA//Etkinlikler//TR',
      'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', `UID:${icsEscape(event.id)}@ercupsa.com.tr`,
      `DTSTAMP:${stamp}`, when, `SUMMARY:${icsEscape(event.title)}`,
      `DESCRIPTION:${icsEscape(event.description)}`, `LOCATION:${icsEscape(event.location)}`,
      `URL:${url}`, 'END:VEVENT', 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
  };
  return { today: dateToday, start, isPast, compare, formatDate, safeUrl, registrationAvailable, mapUrl, calendar };
})();
