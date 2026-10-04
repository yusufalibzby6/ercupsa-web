(() => {
  const wrap = document.getElementById('dynamic');
  const lightbox = document.getElementById('lightbox');
  const lightimg = document.getElementById('lightimg');
  const closeButton = document.getElementById('close');
  const counter = document.getElementById('gallery-counter');
  const imageError = document.getElementById('gallery-image-error');
  const toolbar = document.getElementById('gallery-toolbar');
  const search = document.getElementById('gallery-search');
  const filters = document.getElementById('gallery-filters');
  const summary = document.getElementById('gallery-summary');
  const resultCount = document.getElementById('gallery-result-count');
  let galleryEvents = [];
  let selectedCategory = '';
  let photos = [];
  let currentIndex = 0;
  let currentTitle = '';
  let returnFocus;
  let previousOverflow;
  let backgroundElements = [];

  function safeImageUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new URL(value, location.href);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  function thumbnailUrl(value) {
    const url = new URL(value);
    // Leave signed, already transformed and non-Cloudinary sources intact.
    const uploadPath = '/image/upload/';
    if (url.hostname !== 'res.cloudinary.com' || !url.pathname.includes(uploadPath)) return value;
    const firstPart = url.pathname.split(uploadPath)[1].split('/')[0];
    if (firstPart.startsWith('s--') || /^(?:c|w|h|f|q|e|g|a|t|dpr|fl)_/.test(firstPart)) return value;
    url.pathname = url.pathname.replace(uploadPath, `${uploadPath}c_limit,w_500,f_auto,q_auto/`);
    return url.href;
  }

  function dateLabel(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '';
    const date = new Date(`${value}T12:00:00+03:00`);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('tr-TR', {
      timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', year: 'numeric',
    });
  }

  function searchable(value) {
    return String(value || '').toLocaleLowerCase('tr-TR').normalize('NFKC');
  }

  function renderFilters() {
    const categories = [...new Set(galleryEvents.map(event => event.category))];
    filters.innerHTML = [{ label: 'Tümü', value: '' }, ...categories.map(category => ({ label: category, value: category }))]
      .map(({ label, value }) => `<button type="button" class="gallery-filter" data-gallery-category="${ercupsaEscape(value)}" aria-pressed="${value === selectedCategory}" aria-controls="dynamic">${ercupsaEscape(label)}</button>`).join('');
  }

  function renderAlbums() {
    const query = searchable(search.value.trim());
    const visibleEvents = galleryEvents.filter(event =>
      (!selectedCategory || event.category === selectedCategory) &&
      (!query || searchable(`${event.title} ${event.category} ${event.location || ''} ${dateLabel(event.date)}`).includes(query)));
    const photoCount = visibleEvents.reduce((total, event) => total + event.images.length, 0);
    resultCount.textContent = `${visibleEvents.length} albüm · ${photoCount} fotoğraf${query || selectedCategory ? ' gösteriliyor' : ' · En yeni etkinlikten başlayarak'}`;
    wrap.innerHTML = visibleEvents.map(event => {
      const title = event.title;
      const date = dateLabel(event.date);
      const albumNumber = String(galleryEvents.indexOf(event) + 1).padStart(2, '0');
      const smallAlbum = event.images.length < 3;
      return `<section id="event-${ercupsaEscape(event.id)}" class="gallery-album" aria-labelledby="gallery-title-${ercupsaEscape(event.id)}">
        <div class="gallery-album-heading"><div><p class="gallery-album-number">Albüm ${albumNumber}</p><h2 id="gallery-title-${ercupsaEscape(event.id)}">${ercupsaEscape(title)}</h2><div class="gallery-album-meta">${date ? `<span>${ercupsaEscape(date)}</span>` : ''}<span>${event.images.length} fotoğraf</span></div></div><span class="gallery-album-category">${ercupsaEscape(event.category)}</span></div>
        <div class="gallery-mosaic${smallAlbum ? ' gallery-mosaic--small' : ''}${event.images.length === 1 ? ' gallery-mosaic--single' : ''}">${event.images.map((photo, index) => `<button class="gallery-photo${!smallAlbum && index === 0 ? ' gallery-photo--cover' : ''}" type="button" data-gallery-event="${ercupsaEscape(event.id)}" data-gallery-index="${index}" aria-haspopup="dialog" aria-label="${ercupsaEscape(title)}, ${index + 1} / ${event.images.length} fotoğrafı büyüt"><img decoding="async" src="${ercupsaEscape(thumbnailUrl(photo.url))}" loading="lazy" width="500" height="500" alt="${ercupsaEscape(title)}, ${index + 1}. fotoğraf"><span class="gallery-photo-caption" aria-hidden="true"><span>${index === 0 ? 'Albümü keşfet' : `${index + 1}. fotoğraf`}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/></svg></span></button>`).join('')}</div>
      </section>`;
    }).join('') || (galleryEvents.length
      ? '<div id="gallery-status" class="gallery-state" role="status"><p class="gallery-state-title">Bu aramada albüm bulunamadı.</p><p>Başka bir etkinlik adı deneyebilir veya filtreleri temizleyebilirsin.</p><button type="button" class="gallery-retry" data-gallery-clear>Filtreleri temizle</button></div>'
      : '<div id="gallery-status" class="gallery-state" role="status"><p class="gallery-state-title">Yeni anılar burada yerini alacak.</p><p>Henüz etkinlik fotoğrafı yüklenmedi.</p><a href="etkinlikler.html">Etkinliklerimizi keşfet →</a></div>');
  }

  function scrollToLinkedAlbum() {
    if (!location.hash.startsWith('#event-')) return;
    let id;
    try { id = decodeURIComponent(location.hash.slice('#event-'.length)); } catch { return; }
    if (!galleryEvents.some(event => event.id === id)) return;
    if (!document.getElementById(`event-${id}`)) {
      selectedCategory = '';
      search.value = '';
      renderFilters();
      renderAlbums();
    }
    document.getElementById(`event-${id}`)?.scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }

  search.addEventListener('input', renderAlbums);
  filters.addEventListener('click', event => {
    const button = event.target.closest('[data-gallery-category]');
    if (!button) return;
    selectedCategory = button.dataset.galleryCategory;
    // Preserve the active button and keyboard focus while changing albums.
    filters.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    renderAlbums();
  });
  window.addEventListener('hashchange', scrollToLinkedAlbum);

  function showPhoto(index) {
    if (!photos.length) return;
    currentIndex = (index + photos.length) % photos.length;
    imageError.hidden = true;
    lightimg.alt = `${currentTitle}, ${currentIndex + 1}. fotoğraf`;
    lightimg.src = photos[currentIndex];
    counter.textContent = `${currentIndex + 1} / ${photos.length}`;
    document.getElementById('gallery-lightbox-title').textContent = currentTitle;
    document.getElementById('prev').hidden = photos.length < 2;
    document.getElementById('next').hidden = photos.length < 2;
  }

  function closeGallery() {
    if (lightbox.classList.contains('hidden')) return;
    lightbox.classList.add('hidden');
    lightbox.classList.remove('flex');
    lightbox.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = previousOverflow;
    backgroundElements.forEach(([element, wasInert]) => { element.inert = wasInert; });
    backgroundElements = [];
    if (returnFocus?.isConnected) returnFocus.focus();
  }

  function openGallery(event, index, trigger) {
    photos = event.images.map(photo => photo.url);
    currentTitle = event.title || 'Etkinlik';
    returnFocus = trigger;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    backgroundElements = [...document.body.children]
      .filter(element => element !== lightbox && !['SCRIPT', 'STYLE'].includes(element.tagName))
      .map(element => [element, element.inert]);
    backgroundElements.forEach(([element]) => { element.inert = true; });
    showPhoto(index);
    lightbox.classList.remove('hidden');
    lightbox.classList.add('flex');
    lightbox.setAttribute('aria-hidden', 'false');
    closeButton.focus();
  }

  closeButton.addEventListener('click', closeGallery);
  document.getElementById('prev').addEventListener('click', () => showPhoto(currentIndex - 1));
  document.getElementById('next').addEventListener('click', () => showPhoto(currentIndex + 1));
  lightbox.addEventListener('click', event => { if (event.target === lightbox) closeGallery(); });
  lightimg.addEventListener('error', () => { imageError.hidden = false; });
  lightimg.addEventListener('load', () => { imageError.hidden = true; });
  document.addEventListener('keydown', event => {
    if (lightbox.classList.contains('hidden')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeGallery();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      showPhoto(currentIndex + (event.key === 'ArrowLeft' ? -1 : 1));
    } else if (event.key === 'Tab') {
      const buttons = [...lightbox.querySelectorAll('button')].filter(button => !button.hidden);
      const first = buttons[0];
      const last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  wrap.addEventListener('click', event => {
    const button = event.target.closest('button[data-gallery-event]');
    if (button) {
      const galleryEvent = galleryEvents.find(item => item.id === button.dataset.galleryEvent);
      if (galleryEvent) openGallery(galleryEvent, Number(button.dataset.galleryIndex), button);
    } else if (event.target.closest('[data-gallery-retry]')) {
      loadGallery();
    } else if (event.target.closest('[data-gallery-clear]')) {
      selectedCategory = '';
      search.value = '';
      renderFilters();
      renderAlbums();
      search.focus();
    }
  });

  wrap.addEventListener('error', event => {
    if (event.target.tagName !== 'IMG') return;
    const button = event.target.closest('.gallery-photo');
    if (!button || button.hasAttribute('data-unavailable')) return;
    button.setAttribute('data-unavailable', '');
    const fallback = document.createElement('span');
    fallback.className = 'gallery-photo-fallback';
    fallback.textContent = 'Önizleme yüklenemedi. Fotoğrafı açmak için dokun.';
    fallback.setAttribute('aria-hidden', 'true');
    button.append(fallback);
  }, true);

  async function loadGallery() {
    wrap.setAttribute('aria-busy', 'true');
    toolbar.hidden = true;
    resultCount.hidden = true;
    summary.textContent = 'Fotoğraflar hazırlanıyor…';
    wrap.innerHTML = '<p id="gallery-status" class="gallery-state" role="status">Etkinlik fotoğrafları yükleniyor…</p>';
    try {
      const response = await fetch('/api/events');
      if (!response.ok) throw new Error('Gallery request failed');
      const data = await response.json();
      if (!Array.isArray(data.events)) throw new Error('Invalid gallery response');
      galleryEvents = data.events.filter(event => event && typeof event.id === 'string')
        .map(event => ({
          ...event,
          title: typeof event.title === 'string' && event.title.trim() ? event.title.trim() : 'Etkinlik',
          category: typeof event.category === 'string' && event.category.trim() ? event.category.trim() : 'Etkinlik',
          images: (Array.isArray(event.images) ? event.images : [])
            .map(photo => ({ url: safeImageUrl(photo?.url) }))
            .filter(photo => photo.url),
        }))
        .filter(event => event.images.length)
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      selectedCategory = '';
      search.value = '';
      summary.innerHTML = `<strong>${galleryEvents.reduce((total, event) => total + event.images.length, 0)}</strong><span>fotoğraf · ${galleryEvents.length} etkinlik albümü</span>`;
      renderFilters();
      renderAlbums();
      toolbar.hidden = !galleryEvents.length;
      resultCount.hidden = !galleryEvents.length;
      scrollToLinkedAlbum();
    } catch {
      summary.textContent = 'Anılarımıza birazdan tekrar bakalım.';
      wrap.innerHTML = '<div id="gallery-status" class="gallery-state" role="alert"><p class="gallery-state-title">Fotoğraflar şu anda yüklenemedi.</p><p>Biraz sonra tekrar deneyebilirsin.</p><button type="button" data-gallery-retry class="gallery-retry">Tekrar dene</button></div>';
    } finally {
      wrap.setAttribute('aria-busy', 'false');
    }
  }

  loadGallery();
})();
