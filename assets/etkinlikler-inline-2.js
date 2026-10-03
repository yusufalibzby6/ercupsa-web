let events = [];
let filter = 'upcoming';
function render() {
  const { isPast, compare, formatDate, safeUrl } = ercupsaEvents;
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
    return `<article class="glass rounded-3xl overflow-hidden flex flex-col md:flex-row ${past ? 'opacity-90' : ''}">${poster ? `<a href="${details}" class="block md:w-64 shrink-0"><img decoding="async" src="${ercupsaEscape(poster)}" alt="${ercupsaEscape(event.title)} etkinlik afişi" loading="lazy" class="w-full aspect-[4/5] object-cover"></a>` : ''}<div class="p-6 md:p-8 flex-1"><div class="flex flex-wrap items-center gap-2 mb-3"><span class="badge-chip px-3 py-1 rounded-full text-ercupsaRed font-bold text-xs">${ercupsaEscape(event.category || 'Etkinlik')}</span><span class="text-xs text-gray-500"><i class="fa-regular fa-calendar mr-1" aria-hidden="true"></i>${ercupsaEscape(formatDate(event.date))}</span></div><h2 class="text-2xl font-black"><a href="${details}">${ercupsaEscape(event.title)}</a></h2><p class="text-gray-600 mt-3 leading-relaxed whitespace-pre-wrap">${ercupsaEscape(event.description)}</p><div class="flex flex-wrap gap-4 text-sm text-gray-500 mt-4">${event.time ? `<span><i class="fa-regular fa-clock mr-1" aria-hidden="true"></i>${ercupsaEscape(event.time)} · Türkiye saati</span>` : ''}${event.location ? `<span><i class="fa-solid fa-location-dot mr-1" aria-hidden="true"></i>${ercupsaEscape(event.location)}</span>` : ''}</div><div class="mt-6 flex flex-wrap gap-3"><a href="${details}" class="btn-primary inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold">${!past && safeUrl(event.registrationUrl) ? 'Detaylar ve kayıt formu' : 'Etkinlik detayları'}<i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>${event.images?.length ? `<a href="galeri.html#event-${encodeURIComponent(event.id)}" class="inline-flex items-center gap-2 bg-gray-100 px-5 py-3 rounded-xl font-bold"><i class="fa-regular fa-images" aria-hidden="true"></i>Fotoğrafları gör</a>` : ''}</div></div></article>`;
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
