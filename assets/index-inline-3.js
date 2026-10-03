fetch('/api/events').then(response => {
  if (!response.ok) throw new Error('Etkinlikler yüklenemedi.');
  return response.json();
}).then(({ events = [] }) => {
  const { isPast, compare, formatDate, safeUrl } = ercupsaEvents;
  const list = events.filter(event => !isPast(event)).sort(compare).slice(0, 3);
  const elEvents = document.getElementById('home-events');
  if (elEvents) elEvents.innerHTML = list.map(event => {
    const poster = safeUrl(event.poster);
    return `<a href="form.html?event=${encodeURIComponent(event.id)}" class="glass-panel rounded-3xl overflow-hidden hover:-translate-y-1 transition flex-shrink-0 w-[78vw] sm:w-[60vw] md:w-auto snap-center">${poster ? `<img decoding="async" src="${ercupsaEscape(poster)}" alt="${ercupsaEscape(event.title)} etkinlik afişi" loading="lazy" class="w-full aspect-[4/5] object-cover">` : ''}<div class="p-5"><div class="text-xs font-bold text-ercupsaRed">${ercupsaEscape(event.category || 'Etkinlik')}</div><h3 class="font-black text-lg mt-1">${ercupsaEscape(event.title)}</h3><p class="text-sm text-gray-500 mt-2">${ercupsaEscape(formatDate(event.date))}${event.time ? ` · ${ercupsaEscape(event.time)}` : ''}${event.location ? ` • ${ercupsaEscape(event.location)}` : ''}</p><span class="inline-block mt-4 text-sm font-bold text-ercupsaRed">Etkinliği keşfet →</span></div></a>`;
  }).join('') || '<div class="w-full text-center text-gray-500 py-8">Yeni buluşmalarımız için Instagram ve WhatsApp duyurularımızı takip et.</div>';

  const photos = [...events].sort((a, b) => compare(b, a)).flatMap(event => (event.images || []).map(img => ({
    url: safeUrl(img.url), eventId: event.id, title: event.title,
  }))).filter(photo => photo.url).slice(0, 16);
  const elPhotos = document.getElementById('home-photos');
  if (elPhotos) {
    if (!photos.length) elPhotos.innerHTML = '<p class="col-span-2 md:col-span-4 text-center text-gray-500 py-6 text-sm">Etkinlik fotoğraflarımız yakında burada.</p>';
    else {
      const chunks = [];
      for (let i = 0; i < photos.length; i += 4) chunks.push(photos.slice(i, i + 4));
      let idx = 0;
      const renderChunk = () => { elPhotos.innerHTML = chunks[idx].map(photo => `<a href="galeri.html#event-${encodeURIComponent(photo.eventId)}" class="block aspect-square rounded-2xl overflow-hidden"><img decoding="async" src="${ercupsaEscape(photo.url)}" alt="${ercupsaEscape(photo.title)} etkinliğinden bir anı" loading="lazy" class="w-full h-full object-cover hover:scale-105 transition duration-300"></a>`).join(''); };
      renderChunk();
      if (chunks.length > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) setInterval(() => {
        elPhotos.style.opacity = '0';
        setTimeout(() => { idx = (idx + 1) % chunks.length; renderChunk(); elPhotos.style.opacity = '1'; }, 300);
      }, 5000);
    }
  }
  const counter = document.getElementById('eventCounter');
  if (counter) { counter.dataset.target = events.length; counter.textContent = events.length; }

}).catch(() => {
  const events = document.getElementById('home-events');
  if (events) events.innerHTML = '<p class="text-gray-500 py-8">Etkinlikler şu anda yüklenemedi. Duyurularımızı sosyal medyada takip edebilirsin.</p>';
});

document.addEventListener('DOMContentLoaded', () => {
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add('in-view'); observer.unobserve(entry.target); }
  }), { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach(element => observer.observe(element));
  const counters = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const element = entry.target;
    const target = parseInt(element.dataset.target, 10) || 0;
    const beginning = performance.now();
    const tick = now => {
      const progress = Math.min((now - beginning) / 1200, 1);
      element.textContent = Math.floor(progress * target);
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    counters.unobserve(element);
  }), { threshold: 0.5 });
  document.querySelectorAll('.counter:not(#eventCounter)').forEach(element => counters.observe(element));
});
