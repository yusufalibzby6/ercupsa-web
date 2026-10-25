import { renderYearbook, renderYearbookArchive } from './yearbook-render.js';

const host = document.getElementById('yearbookContent');
function enhancements() {
  for (const image of document.querySelectorAll('.yearbook-page img')) {
    const unavailable = () => { if (image.dataset.yearbookUnavailable) return; image.dataset.yearbookUnavailable = 'true'; image.hidden = true; const note = document.createElement('p'); note.className = 'yb-photo-unavailable'; note.textContent = 'Bu fotoğraf şu anda görüntülenemiyor.'; image.after(note); };
    image.addEventListener('error', unavailable, { once: true });
    // A server-rendered photograph can fail before this module runs.
    if (image.complete && !image.naturalWidth) unavailable();
  }
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('is-seen'); observer.unobserve(entry.target); } }), { threshold: 0.08 });
  const items = [...document.querySelectorAll('.yb-reveal')];
  items.forEach(item => { if (item.getBoundingClientRect().top < innerHeight) item.classList.add('is-seen'); observer.observe(item); });
  document.body.classList.add('yb-motion');
}
async function load() {
  if (!host) return;
  if (document.body.dataset.yearbookRendered === 'true') { enhancements(); return; }
  const params = new URLSearchParams(location.search), id = params.get('donem') || params.get('id'), archive = document.body.dataset.yearbookArchive === 'true';
  const preview = params.get('preview') === '1';
  if (preview) { const robots = document.createElement('meta'); robots.name = 'robots'; robots.content = 'noindex,nofollow'; document.head.append(robots); }
  try {
    if (!archive && !/^20\d{2}-20\d{2}$/.test(id || '')) throw Error('Yıllık bağlantısını kontrol edin.');
    const query = archive ? '' : '?' + new URLSearchParams({ id, ...(preview ? { action: 'preview' } : {}) });
    const response = await fetch('/api/yearbooks' + query, { cache: 'no-store', credentials: preview ? 'same-origin' : 'omit', signal: AbortSignal.timeout(20000) });
    const data = await response.json();
    if (!response.ok) throw Error(preview && response.status === 401 ? 'Önizleme için yönetici oturumunuz açık olmalı.' : 'Bu yıllık henüz yayımlanmamış veya şu anda görüntülenemiyor.');
    if (archive) { if (!Array.isArray(data.yearbooks)) throw Error(); host.innerHTML = renderYearbookArchive(data.yearbooks); }
    else { if (!data.yearbook || data.yearbook.id !== id || !Array.isArray(data.yearbook.events)) throw Error(); host.innerHTML = renderYearbook(data.yearbook, { preview }); document.title = `${data.yearbook.title} | ERCUPSA Yıllıkları`; }
    enhancements();
  } catch (error) {
    host.replaceChildren(); const note = document.createElement('div'); note.className = 'yb-empty'; const heading = document.createElement('h2'); heading.textContent = 'Yıllık şu anda açılamadı'; const description = document.createElement('p'); description.textContent = error.message || 'Biraz sonra yeniden deneyebilirsiniz.'; const link = document.createElement('a'); link.href = '/yilliklar.html'; link.textContent = 'Yıllık arşivine dön →'; note.append(heading, description, link); host.append(note);
  }
}
load();
