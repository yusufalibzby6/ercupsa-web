(() => {
  const { today, compare, formatDate, start, safeUrl, mapUrl, calendar } = ercupsaEvents;
  const parameters = new URLSearchParams(location.search);
  const hasSelectedEvent = parameters.has('event');
  const requestedId = parameters.get('event');
  const element = id => document.getElementById(id);
  const show = id => element(id).classList.remove('hidden');
  const hide = id => element(id).classList.add('hidden');
  const detailPath = event => `form.html?event=${encodeURIComponent(event.id)}`;

  if (hasSelectedEvent) {
    element('formTitle').textContent = 'Etkinlik detayları';
    element('formSub').textContent = 'Etkinliğin tarih, saat ve konum bilgileri ile kayıt formuna ulaş.';
    element('formEyebrow').textContent = 'Etkinlik';
    element('formBackLink').href = 'form.html';
    element('formBackLink').querySelector('span').textContent = 'Tüm kayıt formları';
    element('formLoading').querySelector('p').textContent = 'Etkinlik bilgileri yükleniyor…';
  }

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

  function catalogFact(label, value, icon) {
    const fact = document.createElement('div');
    const name = document.createElement('dt');
    const decoration = document.createElement('i');
    decoration.className = icon;
    decoration.setAttribute('aria-hidden', 'true');
    name.append(decoration, ` ${label}`);
    const content = document.createElement('dd');
    content.textContent = value;
    fact.append(name, content);
    return fact;
  }

  function renderCatalog(events, todayDate) {
    const available = events.filter(event => formatDate(event.date) && event.date >= todayDate
      && safeUrl(event.registrationUrl)).sort(compare);
    if (!available.length) {
      element('formEmptyMessage').textContent = 'Şu anda paylaşılmış bir kayıt formu bulunmuyor. Yeni duyurular için etkinliklerimize göz atabilirsin.';
      show('formEmpty');
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const event of available) {
      const card = document.createElement('article');
      card.className = 'form-catalog-card glass-panel';
      card.dataset.eventId = event.id;
      const poster = safeUrl(event.poster);
      if (poster) {
        const image = document.createElement('img');
        image.className = 'form-catalog-poster';
        image.src = poster;
        image.alt = `${event.title} etkinlik afişi`;
        image.loading = 'lazy';
        image.decoding = 'async';
        card.append(image);
      }
      const body = document.createElement('div');
      body.className = 'form-catalog-body';
      if (event.category) {
        const category = document.createElement('p');
        category.className = 'form-catalog-category';
        category.textContent = event.category;
        body.append(category);
      }
      const title = document.createElement('h3');
      title.className = 'form-catalog-title';
      title.textContent = event.title;
      const facts = document.createElement('dl');
      facts.className = 'event-facts form-catalog-facts';
      facts.append(
        catalogFact('Tarih', formatDate(event.date), 'fa-regular fa-calendar'),
        catalogFact('Saat', start(event) !== null ? `${event.time} · Türkiye saati` : 'Saat bilgisi paylaşılmadı.', 'fa-regular fa-clock'),
      );
      const eventLocation = String(event.location || '').trim();
      if (eventLocation) facts.append(catalogFact('Konum', eventLocation, 'fa-solid fa-location-dot'));
      const link = document.createElement('a');
      link.className = 'btn-primary event-primary-action form-catalog-action';
      link.href = `${detailPath(event)}#registrationSection`;
      link.textContent = 'Kayıt formunu aç';
      link.setAttribute('aria-label', `${event.title} kayıt formunu aç`);
      const arrow = document.createElement('i');
      arrow.className = 'fa-solid fa-arrow-right';
      arrow.setAttribute('aria-hidden', 'true');
      link.append(arrow);
      body.append(title, facts, link);
      card.append(body);
      fragment.append(card);
    }
    element('formCatalogList').replaceChildren(fragment);
    show('formCatalog');
  }

  function renderEvent(target, todayDate) {
    const pastDay = target.date < todayDate;
    document.title = `${target.title} | ERCUPSA`;
    element('formTitle').textContent = target.title;
    element('formSub').textContent = target.category || 'Etkinlik';
    element('eventDescription').textContent = target.description || '';
    element('eventDate').textContent = formatDate(target.date) || 'Tarih bilgisi paylaşılmadı.';
    element('eventTime').textContent = start(target) !== null ? `${target.time} · Türkiye saati` : 'Saat bilgisi paylaşılmadı.';
    const eventLocation = String(target.location || '').trim();
    element('eventLocation').textContent = eventLocation || 'Konum bilgisi paylaşılmadı.';
    if (eventLocation) {
      element('mapsLink').href = mapUrl(eventLocation);
      show('mapsLink');
    }
    const poster = safeUrl(target.poster);
    if (poster) {
      const image = element('eventPoster');
      image.src = poster;
      image.alt = `${target.title} etkinlik afişi`;
      show('eventPoster');
    }
    const detailUrl = new URL(detailPath(target), location.href).href;
    const calendarText = calendar(target, detailUrl);
    if (calendarText) {
      const link = element('calendarLink');
      link.download = `ercupsa-${target.id}.ics`;
      show('calendarLink');
      let objectUrl = '';
      const releaseCalendar = () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = '';
      };
      const prepareCalendar = () => {
        releaseCalendar();
        objectUrl = URL.createObjectURL(new Blob([calendarText], { type: 'text/calendar;charset=utf-8' }));
        link.href = objectUrl;
      };
      prepareCalendar();
      window.addEventListener('pagehide', releaseCalendar);
      window.addEventListener('pageshow', event => { if (event.persisted) prepareCalendar(); });
    }
    if (target.images?.length) {
      element('eventGalleryLink').href = `galeri.html#event-${encodeURIComponent(target.id)}`;
      show('eventGalleryLink');
    }
    element('shareEvent').onclick = async () => {
      const status = element('eventShareStatus');
      try {
        if (navigator.share) await navigator.share({ title: target.title, url: detailUrl });
        else {
          await navigator.clipboard.writeText(detailUrl);
          status.textContent = 'Etkinlik bağlantısı kopyalandı.';
        }
      } catch (error) {
        if (error.name !== 'AbortError') status.textContent = `Etkinlik bağlantısı: ${detailUrl}`;
      }
    };
    show('eventDetails');

    const registrationUrl = safeUrl(target.registrationUrl);
    // Google Forms decides whether submissions are accepted. A start time is not a closing time.
    if (formatDate(target.date) && !pastDay && registrationUrl) {
      element('registrationLink').href = registrationUrl;
      show('registrationSection');
      show('eventRegisterLink');
      const embed = embedInfo(registrationUrl);
      if (embed) {
        element('formFrame').src = embed;
        element('formFrame').title = `${target.title} kayıt formu`;
        show('formWrap');
      }
      if (location.hash === '#registrationSection') {
        requestAnimationFrame(() => element('registrationSection').scrollIntoView());
      }
    } else {
      element('eventFollowMessage').textContent = pastDay
        ? 'Buluşmalarımızdan yeni kareler ve gelecek etkinliklerimiz için bizi takip et.'
        : 'Bu etkinliğin duyurularını Instagram ve WhatsApp üzerinden takip edebilirsin.';
    }
  }

  async function loadForms() {
    hide('formError');
    hide('formEmpty');
    hide('formCatalog');
    show('formLoading');
    element('formRetry').disabled = true;
    try {
      const response = await fetch('/api/events');
      if (!response.ok) throw new Error('Etkinlik bilgileri yüklenemedi.');
      const data = await response.json();
      if (!Array.isArray(data.events)) throw new Error('Etkinlik bilgileri geçersiz.');
      const events = data.events.filter(event => event && typeof event.id === 'string'
        && event.id.trim() && event.published !== false);
      const todayDate = today();
      if (hasSelectedEvent) {
        const target = events.find(event => event.id === requestedId);
        if (target) renderEvent(target, todayDate);
        else {
          element('formEmptyMessage').textContent = 'Bu etkinlik bulunamadı. Diğer kayıt formlarına göz atabilirsin.';
          show('formEmpty');
        }
      } else renderCatalog(events, todayDate);
    } catch {
      show('formError');
    } finally {
      hide('formLoading');
      element('formRetry').disabled = false;
    }
  }

  element('formRetry').addEventListener('click', loadForms);
  loadForms();
})();
