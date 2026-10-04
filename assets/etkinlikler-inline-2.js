let events = [];
let filter = 'upcoming';
const calendarUrls = new Set();
function releaseCalendarUrls() {
  calendarUrls.forEach(url => URL.revokeObjectURL(url));
  calendarUrls.clear();
}
window.addEventListener('pagehide', releaseCalendarUrls);
window.addEventListener('pageshow', event => { if (event.persisted) render(); });
function render() {
  const { isPast, compare, formatDate, safeUrl, today, start, mapUrl, calendar } = ercupsaEvents;
  releaseCalendarUrls();
  const todayDate = today();
  const list = events.filter(event => filter === 'all' || (filter === 'upcoming' ? !isPast(event) : isPast(event)))
    .sort((a, b) => {
      if (filter === 'past') return compare(b, a);
      if (filter === 'all' && isPast(a) !== isPast(b)) return isPast(a) ? 1 : -1;
      return filter === 'all' && isPast(a) ? compare(b, a) : compare(a, b);
    });
  document.getElementById('empty').classList.toggle('hidden', list.length > 0);
  document.getElementById('events').innerHTML = list.map(event => {
    const past = isPast(event), poster = safeUrl(event.poster);
    const details = `form.html?event=${encodeURIComponent(event.id)}`;
    const date = formatDate(event.date);
    const location = String(event.location || '').trim();
    const canRegister = date && event.date >= todayDate && safeUrl(event.registrationUrl);
    const calendarText = calendar(event, new URL(details, window.location.href).href);
    let calendarUrl = '';
    if (calendarText) {
      calendarUrl = URL.createObjectURL(new Blob([calendarText], { type: 'text/calendar;charset=utf-8' }));
      calendarUrls.add(calendarUrl);
    }
    return `<article class="glass rounded-3xl overflow-hidden flex flex-col md:flex-row ${past ? 'opacity-90' : ''}">
      ${poster ? `<a href="${details}" class="block md:w-64 shrink-0"><img decoding="async" src="${ercupsaEscape(poster)}" alt="${ercupsaEscape(event.title)} etkinlik afişi" loading="lazy" class="w-full aspect-[4/5] object-cover"></a>` : ''}
      <div class="p-6 md:p-8 flex-1 min-w-0">
        <span class="badge-chip inline-block px-3 py-1 rounded-full text-ercupsaRed font-bold text-xs mb-3">${ercupsaEscape(event.category || 'Etkinlik')}</span>
        <h2 class="text-2xl font-black"><a href="${details}">${ercupsaEscape(event.title)}</a></h2>
        <p class="text-gray-600 mt-3 leading-relaxed whitespace-pre-wrap">${ercupsaEscape(event.description)}</p>
        <dl class="event-facts event-card-facts">
          <div><dt><i class="fa-regular fa-calendar" aria-hidden="true"></i> Tarih</dt><dd>${ercupsaEscape(date || 'Tarih bilgisi paylaşılmadı.')}</dd></div>
          <div><dt><i class="fa-regular fa-clock" aria-hidden="true"></i> Saat</dt><dd>${start(event) !== null ? `${ercupsaEscape(event.time)} · Türkiye saati` : 'Saat bilgisi paylaşılmadı.'}</dd></div>
          <div><dt><i class="fa-solid fa-location-dot" aria-hidden="true"></i> Konum</dt><dd>${ercupsaEscape(location || 'Konum bilgisi paylaşılmadı.')}</dd></div>
        </dl>
        <div class="event-detail-actions">
          ${canRegister ? `<a href="${details}#registrationSection" class="btn-primary event-primary-action"><i class="fa-solid fa-arrow-right" aria-hidden="true"></i> Etkinliğe kaydol</a>` : ''}
          ${calendarUrl ? `<a href="${ercupsaEscape(calendarUrl)}" download="${ercupsaEscape(`ercupsa-${event.id}.ics`)}" class="event-secondary-action"><i class="fa-regular fa-calendar-plus" aria-hidden="true"></i> Takvime ekle</a>` : ''}
          ${location ? `<a href="${ercupsaEscape(mapUrl(location))}" target="_blank" rel="noopener noreferrer" class="event-secondary-action"><i class="fa-solid fa-route" aria-hidden="true"></i> Yol tarifi al</a>` : ''}
          <a href="${details}" class="event-secondary-action">Etkinlik detayları <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>
          ${event.images?.length ? `<a href="galeri.html#event-${encodeURIComponent(event.id)}" class="event-secondary-action"><i class="fa-regular fa-images" aria-hidden="true"></i>Fotoğrafları gör</a>` : ''}
        </div>
      </div>
    </article>`;
  }).join('');
}
document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => {
  filter = button.dataset.filter;
  document.querySelectorAll('.filter').forEach(item => {
    const active = item === button;
    item.className = `filter px-5 py-2.5 rounded-full ${active ? 'btn-primary' : 'bg-gray-100'} font-bold`;
    item.setAttribute('aria-pressed', String(active));
  });
  render();
}));
fetch('/api/events').then(response => {
  if (!response.ok) throw new Error('Etkinlikler yüklenemedi.');
  return response.json();
}).then(data => { events = data.events || []; render(); }).catch(() => {
  document.getElementById('events').innerHTML = '<div class="glass rounded-3xl p-8 text-center text-gray-500" role="status">Etkinlikler şu anda yüklenemedi. Lütfen daha sonra tekrar dene.</div>';
});
