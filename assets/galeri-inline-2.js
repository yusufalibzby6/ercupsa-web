(() => {
  const wrap = document.getElementById('dynamic');
  const lightbox = document.getElementById('lightbox');
  const lightimg = document.getElementById('lightimg');
  const closeButton = document.getElementById('close');
  const counter = document.getElementById('gallery-counter');
  const imageError = document.getElementById('gallery-image-error');
  let galleryEvents = [];
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
    }
  });

  async function loadGallery() {
    wrap.setAttribute('aria-busy', 'true');
    wrap.innerHTML = '<p id="gallery-status" class="glass rounded-3xl p-8 text-center text-gray-500" role="status">Etkinlik fotoğrafları yükleniyor…</p>';
    try {
      const response = await fetch('/api/events');
      if (!response.ok) throw new Error('Gallery request failed');
      const data = await response.json();
      if (!Array.isArray(data.events)) throw new Error('Invalid gallery response');
      galleryEvents = data.events.filter(event => event && typeof event.id === 'string')
        .map(event => ({
          ...event,
          images: (Array.isArray(event.images) ? event.images : [])
            .map(photo => ({ url: safeImageUrl(photo?.url) }))
            .filter(photo => photo.url),
        }))
        .filter(event => event.images.length)
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      wrap.innerHTML = galleryEvents.map(event => {
        const title = event.title || 'Etkinlik';
        const date = new Date(`${event.date}T12:00:00`);
        const dateLabel = Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
        return `<section id="event-${ercupsaEscape(event.id)}"><div class="flex items-end justify-between mb-4"><div><span class="redtext font-bold text-xs uppercase badge-chip px-2 py-1 rounded-full inline-block">${ercupsaEscape(event.category || 'Etkinlik')}</span><h2 class="text-2xl font-black mt-1">${ercupsaEscape(title)}</h2><p class="text-sm text-gray-500">${ercupsaEscape(dateLabel)}${dateLabel ? ' • ' : ''}${event.images.length} fotoğraf</p></div></div><div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">${event.images.map((photo, index) => `<button class="gallery-photo" type="button" data-gallery-event="${ercupsaEscape(event.id)}" data-gallery-index="${index}" aria-haspopup="dialog" aria-label="${ercupsaEscape(title)}, ${index + 1} / ${event.images.length} fotoğrafı büyüt"><img decoding="async" src="${ercupsaEscape(thumbnailUrl(photo.url))}" loading="lazy" width="500" height="500" alt="${ercupsaEscape(title)}, ${index + 1}. fotoğraf" class="w-full aspect-square object-cover rounded-2xl thumb"></button>`).join('')}</div></section>`;
      }).join('') || '<p id="gallery-status" class="glass rounded-3xl p-8 text-center text-gray-500" role="status">Henüz etkinlik fotoğrafı yüklenmedi.</p>';
      let hash = '';
      try { hash = decodeURIComponent(location.hash.replace(/^#event-/, '')); } catch { /* Ignore malformed links. */ }
      if (hash) document.getElementById(`event-${hash}`)?.scrollIntoView({ behavior: 'smooth' });
    } catch {
      wrap.innerHTML = '<div id="gallery-status" class="glass rounded-3xl p-8 text-center" role="alert"><p>Fotoğraflar şu anda yüklenemedi. Biraz sonra tekrar deneyebilirsin.</p><button type="button" data-gallery-retry class="gallery-retry">Tekrar dene</button></div>';
    } finally {
      wrap.setAttribute('aria-busy', 'false');
    }
  }

  loadGallery();
})();
