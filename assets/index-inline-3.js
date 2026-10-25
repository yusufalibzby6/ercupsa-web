(async () => {
  const container = document.getElementById('home-events');
  const spotlight = document.getElementById('homeSpotlight');
  const { isPast, compare, formatDate, safeUrl, registrationAvailable } = ercupsaEvents;
  const availability = new Map();
  const escape = ercupsaEscape;
  const actionFor = event => {
    const check = availability.get(event.id);
    const native = event.registrationMode === 'native';
    const canRegister = registrationAvailable(event) && (native ? check?.available === true : true);
    return { canRegister, label: canRegister ? check?.stage === 'waitlist' ? 'Yedek kaydını oluştur' : 'Etkinliğe kaydol' : 'Etkinliği keşfet', href: `form.html?event=${encodeURIComponent(event.id)}${canRegister ? '#registrationSection' : ''}` };
  };
  function render(list) {
    if (container) container.innerHTML = list.map(event => {
      const poster = safeUrl(event.poster), action = actionFor(event);
      return `<a href="${action.href}" class="home-event-card${poster ? ' has-poster' : ''}">${poster ? `<img decoding="async" src="${escape(poster)}" alt="${escape(event.title)} etkinlik afişi" loading="lazy" width="640" height="480" class="home-event-poster">` : ''}<div class="home-event-copy"><span class="home-event-category">${escape(event.category || 'Etkinlik')}</span><h3>${escape(event.title)}</h3><p>${escape(formatDate(event.date))}${event.time ? ` · ${escape(event.time)}` : ''}${event.location ? ` • ${escape(event.location)}` : ''}</p><span class="home-event-cta">${action.label} <span aria-hidden="true">↗</span></span></div></a>`;
    }).join('') || '<div class="home-event-state">Yeni buluşmalarımız için Instagram ve WhatsApp duyurularımızı takip et.</div>';
    if (!spotlight || !list.length) return;
    const event = list[0], action = actionFor(event), poster = safeUrl(event.poster);
    spotlight.innerHTML = `<a class="home-spotlight-card${poster ? ' has-poster' : ''}" href="${action.href}"><div class="home-spotlight-media"><img src="${escape(poster || 'ercupsa.PNG')}" alt="${poster ? `${escape(event.title)} etkinlik afişi` : 'ERCUPSA'}" width="720" height="480" decoding="async" fetchpriority="high"></div><span class="home-spotlight-tag">Sıradaki buluşmamız</span><div class="home-spotlight-copy"><span>${escape(event.category || 'Etkinlik')}</span><h2>${escape(event.title)}</h2><p>${escape(formatDate(event.date))}${event.time ? ` · ${escape(event.time)}` : ''}${event.location ? `<br>${escape(event.location)}` : ''}</p><strong>${action.label}<span aria-hidden="true">↗</span></strong></div></a>`;
  }
  try {
    const response = await fetch('/api/events', { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw Error();
    const data = await response.json();
    if (!Array.isArray(data.events)) throw Error();
    const events = data.events.filter(event => event && event.published !== false && typeof event.id === 'string' && typeof event.title === 'string');
    const list = events.filter(event => !isPast(event)).sort(compare).slice(0, 3);
    render(list);
    const counter = document.getElementById('eventCounter');
    if (counter) counter.textContent = data.verified === false ? '—' : String(events.length);
    const photos = [...events].sort((a, b) => compare(b, a)).flatMap(event => (event.images || []).map(image => ({ url: safeUrl(image.url), eventId: event.id, title: event.title }))).filter(photo => photo.url).slice(0, 16);
    const photoGrid = document.getElementById('home-photos');
    if (photoGrid) {
      if (!photos.length) photoGrid.innerHTML = '<p class="home-event-state col-span-2 md:col-span-4">Etkinlik fotoğraflarımız yakında burada.</p>';
      else {
        const chunks = [];
        for (let i = 0; i < photos.length; i += 4) chunks.push(photos.slice(i, i + 4));
        let index = 0;
        const renderPhotos = () => { photoGrid.innerHTML = chunks[index].map(photo => `<a href="galeri.html#event-${encodeURIComponent(photo.eventId)}" class="block aspect-square rounded-2xl overflow-hidden"><img decoding="async" src="${escape(photo.url)}" alt="${escape(photo.title)} etkinliğinden bir anı" width="500" height="500" loading="lazy" class="w-full h-full object-cover hover:scale-105 transition duration-300"></a>`).join(''); };
        renderPhotos();
        if (chunks.length > 1) {
          const timer = setInterval(() => {
            if (document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches || !photoGrid.getBoundingClientRect().height) return;
            const bounds = photoGrid.getBoundingClientRect();
            if (bounds.bottom < 0 || bounds.top > innerHeight) return;
            index = (index + 1) % chunks.length; renderPhotos();
          }, 6000);
          window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
        }
      }
    }
    await Promise.all(list.filter(event => event.registrationMode === 'native' && registrationAvailable(event)).map(async event => {
      try {
        const result = await fetch(`/api/registrations?action=form&event_id=${encodeURIComponent(event.id)}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        if (!result.ok) return;
        const form = await result.json();
        availability.set(event.id, { available: form.available === true, stage: form.stage });
      } catch { /* The event remains discoverable while registration status cannot be verified. */ }
    }));
    render(list);
  } catch {
    if (container) container.innerHTML = '<p class="home-event-state">Etkinlikler şu anda yüklenemedi. Duyurularımızı sosyal medyada takip edebilirsin.</p>';
  }
})();

document.addEventListener('DOMContentLoaded', () => {
  const items = document.querySelectorAll('.home-page .reveal');
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    items.forEach(element => element.classList.add('in-view')); return;
  }
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add('in-view'); observer.unobserve(entry.target); }
  }), { threshold: 0.08 });
  items.forEach(element => observer.observe(element));
  // Fixed community/member figures are not animated from made-up intermediate values.
  document.querySelectorAll('.home-page .counter:not(#eventCounter)').forEach(element => {
    if (/^\d+$/.test(element.dataset.target || '')) element.textContent = element.dataset.target;
  });
});
