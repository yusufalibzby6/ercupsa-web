// Progressive enhancement: content is visible and usable before this module runs.
// No animation changes a registration, answer, ticket, request or navigation.
const slug = location.pathname.split('/').filter(Boolean).pop() || 'index';
const page = slug.endsWith('.html') ? slug : `${slug}.html`;
const scopes = {
  'index.html': {
    items: '.home-section-heading, .home-pillar, .home-event-card, .home-photo-card, .home-yearbook',
    hosts: ['#home-events', '#home-photos', '#homeSpotlight', '#homeYearbookAnnouncement'],
  },
  'etkinlikler.html': { items: 'main h1, .event-card', hosts: ['#events'] },
  'form.html': { items: '#formHead, .form-catalog-card, .event-detail-layout h2, .registration-success h3, .registration-success-mark, #registrationFeedback', hosts: ['#formCatalogList', '#nativeFormWrap'] },
  'galeri.html': { items: '.gallery-intro h1, .gallery-intro-copy', hosts: [] },
  'hakkimizda.html': { items: 'main h1, main .glass-panel', hosts: [] },
  'ekip.html': { items: 'main h1, #teamIntro, #teamCards > div', hosts: ['#teamCards'] },
  'sss.html': { items: 'main h1, main details', hosts: [] },
  'iletisim.html': { items: 'main h1, main > p', hosts: [] },
  'test.html': { items: 'main h1, #questionWrap > h2, #questionWrap .option-btn, #result > .glass-panel', hosts: ['#questionWrap', '#result'] },
  'biletler.html': { items: 'main h1, .participation-guide > h2, .participation-attendance h4, .participation-board-card strong', hosts: ['#attendance', '#board'] },
  'topluluk.html': { items: 'main h1, #experiences > article', hosts: ['#experiences'] },
};

if (scopes[page] && document.body.classList.contains('motion-page')) init(scopes[page]);

function init(scope) {
  const body = document.body;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const pointer = matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)');
  const connection = navigator.connection;
  const lite = typeof IntersectionObserver !== 'function' || (navigator.deviceMemory > 0 && navigator.deviceMemory <= 4) ||
    (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4);
  const active = new Set();
  const animations = new WeakMap();
  const seen = new WeakSet();
  const registered = new WeakSet();
  const observedHosts = new WeakSet();
  const art = document.querySelector('.home-pharmacy-art');
  const hero = document.querySelector('.home-hero');
  let paused = false, suspended = false, sceneVisible = true, pointerFrame = 0;
  let mode = 'reduced';
  try { paused = localStorage.getItem('ercupsa-motion') === 'paused'; } catch {}

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'motion-toggle';
  toggle.setAttribute('aria-label', 'Animasyonları duraklat');
  toggle.setAttribute('aria-pressed', 'false');
  toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path class="motion-pause-icon" d="M9 5v14M15 5v14"/><path class="motion-play-icon" d="m9 5 10 7-10 7Z"/></svg>';
  const menu = document.getElementById('siteMenu');
  if (menu) {
    let preferences = menu.querySelector('.site-preferences');
    if (!preferences) {
      preferences = document.createElement('div');
      preferences.className = 'site-preferences';
      preferences.setAttribute('role', 'group');
      preferences.setAttribute('aria-label', 'Görünüm ve hareket tercihleri');
      const theme = menu.querySelector('.theme-toggle');
      if (theme) { theme.before(preferences); preferences.append(theme); }
      else menu.append(preferences);
    }
    preferences.append(toggle);
  }

  function cancel(element) {
    const animation = animations.get(element);
    if (animation) { animation.cancel(); active.delete(animation); animations.delete(element); }
  }
  function stop() {
    for (const animation of active) animation.cancel();
    active.clear();
    if (pointerFrame) cancelAnimationFrame(pointerFrame);
    pointerFrame = 0;
    if (art) art.style.removeProperty('transform');
  }
  function updateState() {
    mode = reduced.matches || connection?.saveData ? 'reduced' : paused ? 'paused' : lite ? 'lite' : 'full';
    body.dataset.motionMode = mode;
    body.dataset.motionRunning = String(!document.hidden && !suspended);
    toggle.hidden = reduced.matches || !!connection?.saveData;
    toggle.setAttribute('aria-pressed', String(paused));
    toggle.setAttribute('aria-label', paused ? 'Animasyonları sürdür' : 'Animasyonları duraklat');
    toggle.title = paused ? 'Animasyonları sürdür' : 'Animasyonları duraklat';
    if (mode !== 'full' || document.hidden || suspended) stop();
  }

  function animate(element, { delay = 0, opacityOnly = false, duration = 460 } = {}) {
    if (!['full', 'lite'].includes(mode) || document.hidden || suspended || !element.isConnected || !element.animate ||
        element.contains(document.activeElement) || !element.getClientRects().length ||
        element.closest('.ticket, .digital-ticket-frame, #lightbox') || element.querySelector('.ticket, canvas, [data-qr]')) return;
    const bounds = element.getBoundingClientRect();
    if (bounds.bottom <= 0 || bounds.top >= innerHeight || bounds.right <= 0 || bounds.left >= innerWidth) return;
    cancel(element);
    const distance = innerWidth < 600 ? 9 : 16;
    const frames = opacityOnly || mode === 'lite'
      ? [{ opacity: .65 }, { opacity: 1 }]
      : [{ opacity: .65, transform: `translateY(${distance}px)` }, { opacity: 1, transform: 'none' }];
    const animation = element.animate(frames, {
      duration: mode === 'lite' ? 200 : duration, delay: Math.min(delay, 140),
      easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'none',
    });
    active.add(animation); animations.set(element, animation);
    const finished = () => { active.delete(animation); if (animations.get(element) === animation) animations.delete(element); };
    animation.onfinish = finished; animation.oncancel = finished;
  }

  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      const element = entry.target;
      observer.unobserve(element);
      if (!seen.has(element)) {
        seen.add(element);
        animate(element, { delay: Number(element.dataset.motionOrder || 0) * 35,
          opacityOnly: element.matches('.option-btn, #result > *, .gallery-intro-copy') });
      }
    }
  }, { threshold: .08 }) : null;

  function scan(root = document) {
    const elements = [...(root.matches?.(scope.items) ? [root] : []), ...root.querySelectorAll(scope.items)];
    elements.forEach(element => {
      if (registered.has(element)) return;
      registered.add(element);
      element.dataset.motionOrder = String([...element.parentElement.children].indexOf(element) % 5);
      observer?.observe(element);
    });
  }

  // Only known dynamic containers are watched; text ticks don't rescan the page.
  const mutation = new MutationObserver(records => {
    const roots = new Set();
    for (const record of records) {
      if (record.target instanceof Element && record.target.matches('[data-countdown-part]')) {
        animate(record.target, { opacityOnly: true, duration: 150 });
        continue;
      }
      for (const node of record.addedNodes) if (node instanceof Element) roots.add(node);
    }
    for (const root of roots) scan(root);
    bindHosts();
  });
  function bindHosts() {
    for (const selector of scope.hosts) {
      const host = document.querySelector(selector);
      if (!host || observedHosts.has(host)) continue;
      observedHosts.add(host);
      mutation.observe(host, { childList: true, subtree: ['#homeSpotlight', '#nativeFormWrap'].includes(selector) });
    }
  }

  toggle.addEventListener('click', () => {
    paused = !paused;
    try { localStorage.setItem('ercupsa-motion', paused ? 'paused' : 'playing'); } catch {}
    updateState();
  });
  reduced.addEventListener('change', updateState);
  connection?.addEventListener?.('change', updateState);
  pointer.addEventListener('change', () => { if (!pointer.matches) stop(); });
  document.addEventListener('visibilitychange', updateState);
  window.addEventListener('pagehide', () => { suspended = true; updateState(); });
  window.addEventListener('pageshow', () => { suspended = false; updateState(); });
  window.addEventListener('storage', event => {
    if (event.key === 'ercupsa-motion' || event.key === null) { paused = event.newValue === 'paused'; updateState(); }
  });
  document.addEventListener('focusin', event => {
    for (let element = event.target; element instanceof Element && element !== body; element = element.parentElement) cancel(element);
  });
  window.addEventListener('beforeprint', stop);

  if (hero && art) {
    const scene = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      sceneVisible = entries[0].isIntersecting;
      art.dataset.motionVisible = String(sceneVisible);
      if (!sceneVisible) { if (pointerFrame) cancelAnimationFrame(pointerFrame); pointerFrame = 0; art.style.removeProperty('transform'); }
    }, { threshold: 0 }) : null;
    scene?.observe(art);
    art.dataset.motionVisible = String(!!scene);
    hero.addEventListener('pointermove', event => {
      if (mode !== 'full' || !pointer.matches || !sceneVisible || document.hidden || suspended || pointerFrame) return;
      const x = event.clientX / innerWidth - .5, y = event.clientY / innerHeight - .5;
      pointerFrame = requestAnimationFrame(() => { pointerFrame = 0; art.style.transform = `translate3d(${(x * 8).toFixed(2)}px,${(y * 6).toFixed(2)}px,0)`; });
    }, { passive: true });
    hero.addEventListener('pointerleave', () => { if (pointerFrame) cancelAnimationFrame(pointerFrame); pointerFrame = 0; art.style.removeProperty('transform'); });
  }
  if (page === 'sss.html') document.querySelector('main')?.addEventListener('toggle', event => {
    if (event.target.matches('details[open]')) for (const paragraph of event.target.querySelectorAll('p')) animate(paragraph, { opacityOnly: true, duration: 220 });
  }, true);

  updateState();
  scan(); bindHosts();
  if (page === 'index.html') {
    document.querySelectorAll('.home-hero-copy > .home-eyebrow, .home-title-line, .home-hero-copy > p').forEach((element, index) => {
      animate(element, { delay: index * 35, duration: 520 });
    });
  }
}
