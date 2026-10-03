function embedInfo(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' && parsed.hostname === 'docs.google.com' && parsed.pathname.includes('/forms/')) {
      parsed.searchParams.set('embedded', 'true');
      return parsed.href;
    }
    if (parsed.protocol === 'https:' && parsed.hostname === 'tally.so' && parsed.pathname.startsWith('/r/')) {
      return `https://tally.so/embed/${encodeURIComponent(parsed.pathname.slice(3))}?hideTitle=1&alignLeft=1&transparentBackground=1&dynamicHeight=1`;
    }
  } catch {}
  return '';
}

fetch('/api/events').then(response => {
  if (!response.ok) throw new Error('Etkinlik bilgileri yüklenemedi.');
  return response.json();
}).then(({ events = [] }) => {
  const { today, compare, formatDate, start, safeUrl, mapUrl, calendar } = ercupsaEvents;
  const todayDate = today();
  const requestedId = new URLSearchParams(location.search).get('event');
  const target = requestedId ? events.find(event => event.id === requestedId)
    : events.filter(event => event.date >= todayDate && safeUrl(event.registrationUrl)).sort(compare)[0];
  if (!target) {
    document.getElementById('formEmptyMessage').textContent = requestedId
      ? 'Bu etkinlik bulunamadı. Diğer etkinliklerimize göz atabilirsin.'
      : 'Etkinlikleri keşfetmek için takvimimize göz atabilirsin.';
    document.getElementById('formEmpty').classList.remove('hidden');
    return;
  }

  const pastDay = target.date < todayDate;
  document.title = `${target.title} | ERCUPSA`;
  document.getElementById('formTitle').textContent = target.title;
  document.getElementById('formSub').textContent = target.category || 'Etkinlik';
  document.getElementById('eventDescription').textContent = target.description || '';
  document.getElementById('eventDate').textContent = formatDate(target.date);
  document.getElementById('eventTime').textContent = start(target) !== null ? `${target.time} · Türkiye saati` : 'Saat duyurusu için sosyal hesaplarımızı takip et.';
  if (target.location) {
    document.getElementById('eventLocation').textContent = target.location;
    document.getElementById('eventLocationWrap').classList.remove('hidden');
    document.getElementById('mapsLink').href = mapUrl(target.location);
    document.getElementById('mapsLink').classList.remove('hidden');
  }
  const poster = safeUrl(target.poster);
  if (poster) {
    const image = document.getElementById('eventPoster');
    image.src = poster;
    image.alt = `${target.title} etkinlik afişi`;
    image.classList.remove('hidden');
  }
  const detailUrl = new URL(`form.html?event=${encodeURIComponent(target.id)}`, location.href).href;
  const calendarText = calendar(target, detailUrl);
  if (calendarText) {
    const objectUrl = URL.createObjectURL(new Blob([calendarText], { type: 'text/calendar;charset=utf-8' }));
    const link = document.getElementById('calendarLink');
    link.href = objectUrl;
    link.download = `ercupsa-${target.id}.ics`;
    link.classList.remove('hidden');
    window.addEventListener('pagehide', () => URL.revokeObjectURL(objectUrl), { once: true });
  }
  if (target.images?.length) {
    document.getElementById('eventGalleryLink').href = `galeri.html#event-${encodeURIComponent(target.id)}`;
    document.getElementById('eventGalleryLink').classList.remove('hidden');
  }
  document.getElementById('shareEvent').addEventListener('click', async () => {
    const status = document.getElementById('eventShareStatus');
    try {
      if (navigator.share) await navigator.share({ title: target.title, url: detailUrl });
      else {
        await navigator.clipboard.writeText(detailUrl);
        status.textContent = 'Etkinlik bağlantısı kopyalandı.';
      }
    } catch (error) {
      if (error.name !== 'AbortError') status.textContent = `Etkinlik bağlantısı: ${detailUrl}`;
    }
  });
  document.getElementById('eventDetails').classList.remove('hidden');

  const registrationUrl = safeUrl(target.registrationUrl);
  // Google Forms decides whether submissions are accepted. A start time is not a closing time.
  if (!pastDay && registrationUrl) {
    document.getElementById('registrationLink').href = registrationUrl;
    document.getElementById('registrationSection').classList.remove('hidden');
    const embed = embedInfo(registrationUrl);
    if (embed) {
      document.getElementById('formFrame').src = embed;
      document.getElementById('formFrame').title = `${target.title} kayıt formu`;
      document.getElementById('formWrap').classList.remove('hidden');
    }
  } else {
    document.getElementById('eventFollowMessage').textContent = pastDay
      ? 'Buluşmalarımızdan yeni kareler ve gelecek etkinliklerimiz için bizi takip et.'
      : 'Bu etkinliğin duyurularını Instagram ve WhatsApp üzerinden takip edebilirsin.';
  }
}).catch(() => {
  document.getElementById('formEmptyMessage').textContent = 'Etkinlik bilgileri şu anda yüklenemedi. Lütfen daha sonra tekrar dene.';
  document.getElementById('formEmpty').classList.remove('hidden');
});
