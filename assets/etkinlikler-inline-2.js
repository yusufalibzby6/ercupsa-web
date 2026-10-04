let events = [];
let filter = 'upcoming';
let loadState = 'loading';
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
  const container = document.getElementById('events');
  const empty = document.getElementById('empty');
  container.setAttribute('aria-busy', String(loadState === 'loading'));
  if (loadState !== 'ready') {
    empty.classList.add('hidden');
    container.innerHTML = loadState === 'loading'
      ? '<div class="event-list-state" role="status"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><p>Etkinlikler yükleniyor…</p></div>'
      : '<div class="event-list-state" role="alert"><i class="fa-regular fa-calendar-xmark" aria-hidden="true"></i><h2>Etkinlikler şu anda yüklenemedi.</h2><p>Bağlantını kontrol edip yeniden deneyebilirsin.</p><button type="button" class="event-secondary-action" id="retryEvents">Yeniden dene</button></div>';
    document.getElementById('retryEvents')?.addEventListener('click', loadEvents);
    return;
  }
  const todayDate = today();
  const list = events.filter(event => filter === 'all' || (filter === 'upcoming' ? !isPast(event) : isPast(event)))
    .sort((a, b) => {
      if (filter === 'past') return compare(b, a);
      if (filter === 'all' && isPast(a) !== isPast(b)) return isPast(a) ? 1 : -1;
      return filter === 'all' && isPast(a) ? compare(b, a) : compare(a, b);
    });
  empty.classList.toggle('hidden', list.length > 0);
  document.getElementById('emptyMessage').textContent = filter === 'upcoming'
    ? 'Yeni buluşmalarımızı burada paylaşacağız. O zamana kadar geçmiş etkinliklere göz atabilirsin.'
    : filter === 'past' ? 'Geçmiş etkinliklerimizin anıları yakında burada olacak.' : 'Etkinliklerimizi yakında burada paylaşacağız.';
  container.innerHTML = list.map(event => {
    const past = isPast(event), poster = safeUrl(event.poster);
    const details = `form.html?event=${encodeURIComponent(event.id)}`;
    const date = formatDate(event.date);
    const location = String(event.location || '').trim();
    const canRegister = date && event.date >= todayDate && (typeof ercupsaEvents.registrationAvailable === 'function'
      ? ercupsaEvents.registrationAvailable(event) : safeUrl(event.registrationUrl));
    const calendarText = calendar(event, new URL(details, window.location.href).href);
    let calendarUrl = '';
    if (calendarText) {
      calendarUrl = URL.createObjectURL(new Blob([calendarText], { type: 'text/calendar;charset=utf-8' }));
      calendarUrls.add(calendarUrl);
    }
    return `<article class="glass event-card ${poster ? '' : 'event-card--no-poster'} ${past ? 'event-card--past' : ''}">
      ${poster ? `<a href="${details}" class="event-card-poster"><img decoding="async" src="${ercupsaEscape(poster)}" alt="${ercupsaEscape(event.title)} etkinlik afişi" loading="lazy"></a>` : ''}
      <div class="event-card-body">
        <header class="event-card-heading">
          <span class="badge-chip event-card-category">${ercupsaEscape(event.category || 'Etkinlik')}</span>
          <h2><a href="${details}">${ercupsaEscape(event.title)}</a></h2>
        </header>
        ${event.description ? `<p class="event-card-description">${ercupsaEscape(event.description)}</p>` : ''}
        <dl class="event-facts event-card-facts">
          <div><dt><i class="fa-regular fa-calendar" aria-hidden="true"></i> Tarih</dt><dd>${ercupsaEscape(date || 'Tarih bilgisi paylaşılmadı.')}</dd></div>
          <div><dt><i class="fa-regular fa-clock" aria-hidden="true"></i> Saat</dt><dd>${start(event) !== null ? `${ercupsaEscape(event.time)} · Türkiye saati` : 'Saat bilgisi paylaşılmadı.'}</dd></div>
          <div class="event-card-location"><dt><i class="fa-solid fa-location-dot" aria-hidden="true"></i> Konum</dt><dd>${ercupsaEscape(location || 'Konum bilgisi paylaşılmadı.')}</dd></div>
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
async function loadEvents() {
  loadState = 'loading';
  render();
  try {
    const response = await fetch('/api/events');
    if (!response.ok) throw new Error('Etkinlikler yüklenemedi.');
    const data = await response.json();
    if (!Array.isArray(data.events)) throw new Error('Etkinlikler yüklenemedi.');
    events = data.events.filter(event => event && typeof event === 'object');
    loadState = 'ready';
  } catch {
    loadState = 'error';
  }
  render();
}
loadEvents();
