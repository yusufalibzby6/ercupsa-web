import { usableEvents, upcomingEvents, countdownParts, eventDateLabel, publicImage, validEventTime, turkeyDate } from './home-event-model.js';

const spotlight = document.getElementById('homeSpotlight');
const upcomingHost = document.getElementById('home-events');
const upcomingSection = document.getElementById('homeUpcomingSection');
const recentHost = document.getElementById('homeRecentEvents');
const recentSection = document.getElementById('homeRecentSection');
const photoHost = document.getElementById('home-photos');
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
let events = [], loaded = false, catalogBusy = false, renderKey = '', featuredId = '', timer;
const availability = new Map(), pending = new Map();
const detailsUrl = event => `form.html?event=${encodeURIComponent(event.id)}`;

function registration(event) {
  if (event.registrationMode !== 'native') {
    return publicImage(event.registrationUrl)
      ? { state: 'open', label: 'Kayıt ol', status: 'Kayıtlar açık', href: detailsUrl(event) + '#registrationSection' }
      : { state: 'closed', label: 'Detayları gör', status: 'Etkinlik bilgileri', href: detailsUrl(event) };
  }
  if (event.registrationEnabled !== true) return { state: 'closed', label: 'Detayları gör', status: 'Kayıt kapalı', href: detailsUrl(event) };
  const saved = availability.get(event.id);
  if (saved?.available === true && saved.stage !== 'closed') return {
    state: saved.stage === 'waitlist' ? 'waitlist' : 'open', label: saved.stage === 'waitlist' ? 'Yedek kayıt' : 'Kayıt ol',
    status: saved.stage === 'waitlist' ? 'Yedek kayıtlar açık' : 'Kayıtlar açık', href: detailsUrl(event) + '#registrationSection',
  };
  return { state: saved ? 'closed' : 'checking', label: 'Detayları gör', href: detailsUrl(event),
    status: !saved ? 'Kayıt durumu kontrol ediliyor' : saved.error ? 'Kayıt durumu doğrulanamadı' : saved.full ? 'Kontenjan dolu' : 'Kayıt kapalı' };
}

function dateFacts(event, compact = false) {
  return `<time datetime="${escape(event.date)}${validEventTime(event.time) ? `T${escape(event.time)}:00+03:00` : ''}">${escape(eventDateLabel(event.date))}${validEventTime(event.time) ? ` · ${escape(event.time)} <span class="home-timezone">TSİ</span>` : '<span class="home-time-pending"> · Saat duyurulacak</span>'}</time>${event.location ? `<span class="home-event-location"><i class="fa-solid fa-location-dot" aria-hidden="true"></i>${escape(event.location)}</span>` : compact ? '' : '<span class="home-event-location">Konum duyurulacak</span>'}`;
}

function renderFeature(event) {
  if (!spotlight) return;
  const focusSelector = spotlight.dataset.eventId === event?.id && spotlight.contains(document.activeElement)
    ? document.activeElement.classList.contains('home-spotlight-action') ? '.home-spotlight-action'
      : document.activeElement.classList.contains('home-spotlight-detail') ? '.home-spotlight-detail' : null
    : null;
  spotlight.removeAttribute('aria-live');
  if (!event) {
    delete spotlight.dataset.eventId;
    spotlight.innerHTML = `<div class="home-spotlight-empty"><span class="home-empty-icon" aria-hidden="true">→</span><div><h2>Yeni etkinliklerimiz çok yakında!</h2><a href="${events.length ? '#homeRecentSection' : 'galeri.html'}">Geçmiş etkinliklerimizi keşfet <span aria-hidden="true">→</span></a></div></div>`;
    return;
  }
  const action = registration(event), poster = publicImage(event.poster), countdown = countdownParts(event);
  spotlight.dataset.eventId = event.id;
  spotlight.innerHTML = `<article class="home-spotlight-card${poster ? ' has-poster' : ''}"><a class="home-spotlight-media${poster ? '' : ' is-placeholder'}" href="${detailsUrl(event)}" tabindex="-1" aria-hidden="true"><img class="home-spotlight-poster" src="${escape(poster || 'ercupsa.PNG')}" alt="" width="360" height="480" decoding="async" fetchpriority="high"></a><div class="home-spotlight-copy"><span class="home-spotlight-tag">Sıradaki buluşma</span><h2>${escape(event.title)}</h2><div class="home-spotlight-facts">${dateFacts(event)}</div><p class="home-spotlight-status" data-registration-state="${action.state}"><span aria-hidden="true"></span>${action.status}</p></div>${countdown ? `<div id="homeCountdown" class="home-countdown" role="timer" aria-live="off"><p id="homeCountdownLabel">Buluşmaya kalan süre</p>${[['days', 'Gün'], ['hours', 'Saat'], ['minutes', 'Dk'], ['seconds', 'Sn']].map(([part, label]) => `<div class="home-countdown-unit"><strong data-countdown-part="${part}">${String(countdown[part]).padStart(2, '0')}</strong><span>${label}</span></div>`).join('')}</div>` : ''}<div class="home-spotlight-actions"><a class="home-spotlight-action" data-registration-state="${action.state}" href="${action.href}">${action.label}<span aria-hidden="true">→</span></a>${action.state === 'open' || action.state === 'waitlist' ? `<a class="home-spotlight-detail" href="${detailsUrl(event)}">Detayları gör <span aria-hidden="true">→</span></a>` : ''}</div></article>`;
  if (focusSelector) spotlight.querySelector(focusSelector)?.focus({ preventScroll: true });
}

function renderUpcoming(list) {
  if (!upcomingHost) return;
  if (upcomingSection) upcomingSection.hidden = !list.length;
  upcomingHost.innerHTML = list.map(event => {
    const poster = publicImage(event.poster), action = registration(event);
    return `<article class="home-event-card${poster ? ' has-poster' : ''}" data-event-id="${escape(event.id)}">${poster ? `<a href="${detailsUrl(event)}" class="home-event-media" tabindex="-1" aria-hidden="true"><img class="home-event-poster" src="${escape(poster)}" alt="" loading="lazy" decoding="async" width="160" height="200"></a>` : ''}<div class="home-event-copy"><span class="home-event-category">${escape(event.category || 'Etkinlik')}</span><h3><a href="${detailsUrl(event)}">${escape(event.title)}</a></h3><div class="home-event-facts">${dateFacts(event, true)}</div><a class="home-event-cta" data-registration-state="${action.state}" href="${action.href}">${action.label} <span aria-hidden="true">→</span></a><span class="home-event-status">${action.status}</span></div></article>`;
  }).join('');
}

function renderMemories(renderPhotos = true) {
  const future = new Set(upcomingEvents(events).map(event => event.id));
  const past = [...events].filter(event => !future.has(event.id)).sort((a, b) => b.date.localeCompare(a.date) || (b.time || '').localeCompare(a.time || ''));
  if (recentHost) recentHost.innerHTML = past.slice(0, 2).map(event => `<a class="home-recent-card" href="${detailsUrl(event)}"><div><span>${escape(event.category || 'Etkinlik')}</span><h3>${escape(event.title)}</h3><time datetime="${escape(event.date)}">${escape(eventDateLabel(event.date))}</time></div><span class="home-recent-arrow" aria-hidden="true">→</span></a>`).join('');
  if (recentSection) recentSection.hidden = !past.length;
  if (!photoHost || !renderPhotos) return;
  const photos = [], urls = new Set();
  for (const event of [...events].sort((a, b) => b.date.localeCompare(a.date))) {
    for (const image of (Array.isArray(event.images) ? event.images : []).slice(0, 2)) {
      const url = publicImage(image?.url);
      if (url && !urls.has(url)) { urls.add(url); photos.push({ url, event }); }
    }
    if (photos.length >= 6) break;
  }
  photoHost.innerHTML = photos.slice(0, 6).map(({ url, event }) => `<a class="home-photo-card" href="galeri.html#event-${encodeURIComponent(event.id)}"><img src="${escape(url)}" alt="${escape(event.title)} etkinliğinden bir anı" width="320" height="240" loading="lazy" decoding="async"><span>${escape(event.title)}</span></a>`).join('') || '<p class="home-photo-empty">Birlikte biriktirdiğimiz anılar için <a href="galeri.html">fotoğraf galerisine göz at →</a></p>';
}

function updateCountdown() {
  const timerHost = document.getElementById('homeCountdown'), event = events.find(event => event.id === featuredId);
  if (!timerHost || !event) return;
  const parts = countdownParts(event);
  if (!parts) { timerHost.remove(); return; }
  for (const [part, value] of Object.entries(parts)) {
    const number = timerHost.querySelector(`[data-countdown-part="${part}"]`), text = String(value).padStart(2, '0');
    if (number && number.textContent !== text) number.textContent = text;
  }
  timerHost.setAttribute('aria-label', `Etkinliğe ${parts.days} gün ${parts.hours} saat ${parts.minutes} dakika ${parts.seconds} saniye kaldı`);
}

function render() {
  if (!loaded) return;
  const upcoming = upcomingEvents(events), shown = upcoming.slice(0, 3);
  const key = JSON.stringify([turkeyDate(), ...shown.map(event => [event.id, registration(event)])]);
  if (key !== renderKey) {
    const previous = featuredId;
    renderKey = key; featuredId = upcoming[0]?.id || '';
    renderFeature(upcoming[0]); renderUpcoming(upcoming.slice(1, 3));
    if (previous !== featuredId) renderMemories(false);
    if (previous && previous !== featuredId) {
      const status = document.getElementById('homeEventAnnouncement');
      if (status) status.textContent = upcoming[0] ? `Sıradaki etkinlik: ${upcoming[0].title}` : 'Yaklaşan etkinliklerin tamamı başladı. Yeni etkinlikler yakında.';
    }
    for (const event of shown) if (event.registrationMode === 'native' && event.registrationEnabled === true && !availability.has(event.id)) checkRegistration(event);
  }
  updateCountdown();
}

async function checkRegistration(event, refresh = false) {
  if (pending.has(event.id) || !refresh && availability.has(event.id)) return;
  const task = (async () => {
    try {
      const response = await fetch(`/api/registrations?action=form&event_id=${encodeURIComponent(event.id)}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw Error();
      const data = await response.json();
      availability.set(event.id, { available: data.available === true, stage: data.stage, full: data.full === true, at: Date.now() });
    } catch { availability.set(event.id, { error: true, at: Date.now() }); }
    finally { pending.delete(event.id); render(); }
  })();
  pending.set(event.id, task);
  return task;
}

function startClock() {
  clearInterval(timer);
  timer = setInterval(() => { if (!document.hidden) render(); }, 1000);
}
async function load() {
  if (catalogBusy) return;
  catalogBusy = true;
  try {
    const response = await fetch('/api/events', { cache: 'no-store', signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw Error();
    const data = await response.json();
    if (!Array.isArray(data.events)) throw Error();
    events = usableEvents(data.events); loaded = true; renderKey = ''; renderMemories(); render(); startClock();
  } catch {
    if (spotlight) spotlight.innerHTML = '<div class="home-spotlight-empty"><div><h2>Etkinlikler şu anda yüklenemedi.</h2><p>Biraz sonra tekrar deneyebilirsin.</p><button class="home-event-retry" type="button" id="homeEventsRetry">Yeniden dene</button> <a href="etkinlikler.html">Etkinliklere göz at →</a></div></div>';
  } finally { catalogBusy = false; }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  render();
  for (const event of upcomingEvents(events).slice(0, 3)) if (event.registrationMode === 'native' && event.registrationEnabled === true &&
      Date.now() - (availability.get(event.id)?.at || 0) > 60000) checkRegistration(event, true);
});
window.addEventListener('pagehide', () => clearInterval(timer));
window.addEventListener('pageshow', event => { if (event.persisted && loaded) { render(); startClock(); } });
document.addEventListener('click', event => { if (event.target.closest('#homeEventsRetry')) load(); });
document.addEventListener('error', event => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement)) return;
  if (image.classList.contains('home-spotlight-poster') && !image.src.endsWith('/ercupsa.PNG')) { image.src = 'ercupsa.PNG'; image.parentElement.classList.add('is-placeholder'); }
  else if (image.closest('.home-photo-card, .home-event-media')) { image.hidden = true; image.parentElement.classList.add('image-unavailable'); }
}, true);
load();
