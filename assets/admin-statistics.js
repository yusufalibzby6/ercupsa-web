import { $, api, escape, onAdminEvent, canAdmin } from './common.js';

const host = $('statisticsEditor');
let ready = false, active = false, loaded = false, busy = false, epoch = 0, report = null;
const number = value => value == null ? '—' : new Intl.NumberFormat('tr-TR').format(value);
if (host) {
  host.innerHTML = `<div class="admin-section-heading"><div><h2>Etkinlik istatistikleri</h2><p>Başvurular, biletler ve kapı girişleri ayrı değerlendirilir.</p></div></div>
  <form id="statisticsFilters" class="statistics-filters"><label>Etkinlik<select id="statisticsEvent"><option value="">Tüm etkinlikler</option></select></label><label>Dönem başlangıcı<input id="statisticsFrom" type="date"></label><label>Dönem bitişi<input id="statisticsTo" type="date"></label><button id="statisticsRefresh" class="admin-primary">Raporu göster</button></form>
  <p id="statisticsStatus" role="status" aria-live="polite"></p><div id="statisticsCards" class="statistics-cards"></div>
  <div class="statistics-note"><strong>Sayılar neyi gösteriyor?</strong><p>Toplamlar etkinlik kayıtları ve tekil bilet girişleridir; dönem boyunca benzersiz kişi sayısı değildir. “—” doğrulanmış veri olmadığını gösterir. Gelmeyenler ancak etkinlik başladıktan ve giriş takibi tamamlandıktan sonra hesaplanır.</p></div>
  <section class="statistics-table-panel"><h3>Etkinlik raporu</h3><div class="statistics-table-scroll"><table><thead><tr><th>Etkinlik</th><th>Başvuru</th><th>Asıl</th><th>Yedek</th><th>İptal</th><th>QR girişi</th><th>Elle giriş</th><th>Gelmeyen</th><th>Asıl doluluk</th><th>Takip</th></tr></thead><tbody id="statisticsRows"></tbody></table></div></section>`;
  function status(text, error = false) { $('statisticsStatus').textContent = text; $('statisticsStatus').dataset.error = String(error); }
  function controls() {
    host.querySelectorAll('input,select,button').forEach(control => { control.disabled = !ready || busy; });
    host.querySelectorAll('[data-complete-event]').forEach(control => { control.disabled ||= !canAdmin('attendance.manage'); });
  }
  function render() {
    const summary = report?.summary;
    $('statisticsCards').innerHTML = summary ? [['Toplam etkinlik', summary.eventCount], ['Toplam başvuru', summary.applications], ['Asıl katılımcı', summary.main], ['Yedek katılımcı', summary.waitlisted], ['İptal edilen', summary.cancelled], ['Doğrulanmış giriş', summary.entered], ['QR ile giriş', summary.qrEntered], ['Gelmeyen', summary.noShows]]
      .map(([label, value]) => `<article class="statistics-card"><span>${label}</span><strong>${number(value)}</strong></article>`).join('') : '';
    $('statisticsRows').innerHTML = (report?.events || []).map(event => `<tr><td><strong>${escape(event.title)}</strong><small>${escape(event.date)}${event.archived ? ' · Arşiv' : ''}</small></td>${['applications', 'main', 'waitlisted', 'cancelled', 'qrEntered', 'manualEntered', 'noShows'].map(key => `<td>${number(event[key])}</td>`).join('')}<td>${event.capacity == null ? event.applications == null ? '—' : 'Sınırsız' : `<span>${number(event.main)} / ${number(event.capacity)}</span>${event.occupancy == null ? '' : `<div class="statistics-progress" role="meter" aria-label="Asıl kontenjan doluluk oranı" aria-valuenow="${event.occupancy}" aria-valuemin="0" aria-valuemax="${Math.max(100, event.occupancy)}"><i style="width:${Math.min(100, event.occupancy)}%"></i></div><small>%${number(event.occupancy)}</small>`}`}</td><td>${event.trackingComplete ? '<span class="statistics-complete">Tamamlandı</span>' : 'Devam ediyor / bilinmiyor'}${canAdmin('attendance.manage') ? `<button type="button" data-complete-event="${escape(event.id)}">${event.trackingComplete ? 'Takibi yeniden aç' : 'Takibi tamamla'}</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="10">Bu aralıkta doğrulanmış etkinlik bulunmuyor.</td></tr>';
    controls();
  }
  async function load() {
    if (!ready || !active || busy || !canAdmin('statistics.view')) return;
    const version = epoch; busy = true; controls(); status('Doğrulanmış kayıtlar ve girişler hesaplanıyor…');
    try {
      const query = new URLSearchParams({ eventId: $('statisticsEvent').value, from: $('statisticsFrom').value, to: $('statisticsTo').value });
      const data = await api('/api/statistics?' + query);
      if (version !== epoch || !ready || !active) return;
      if (!data.summary || !Array.isArray(data.events) || !Array.isArray(data.catalog)) throw Error('İstatistikler doğrulanamadı.');
      const selected = $('statisticsEvent').value;
      $('statisticsEvent').replaceChildren(new Option('Tüm etkinlikler', ''), ...data.catalog.map(event => new Option(`${event.title} · ${event.date}`, event.id)));
      $('statisticsEvent').value = selected; report = data; loaded = true; render();
      const c = data.summary.coverage;
      status(`Güncelleme: ${new Date(data.asOf).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}. Giriş verisi ${c.eventsWithEntryData}/${c.totalEvents}, kayıt verisi ${c.eventsWithRegistrationData}/${c.totalEvents} etkinlikte doğrulanabildi.`);
    } catch (error) { if (version === epoch && ready) status(error.message, true); }
    finally { if (version === epoch) { busy = false; controls(); } }
  }
  $('statisticsFilters').addEventListener('submit', event => { event.preventDefault(); load(); });
  $('statisticsRows').addEventListener('click', async event => {
    const button = event.target.closest('[data-complete-event]'), record = report?.events.find(item => item.id === button?.dataset.completeEvent);
    if (!button || !record || busy || !ready || !canAdmin('attendance.manage')) return;
    if (!confirm(record.trackingComplete ? 'Etkinliğin giriş takibi yeniden açılsın mı?' : 'Etkinlik sona erdi ve giriş takibinin eksiksiz olduğunu doğruluyor musunuz? Bu işlem gelmeyenlerin hesaplanmasını sağlar.')) return;
    const version = epoch; busy = true; controls();
    try {
      await api('/api/statistics?action=complete', { method: 'POST', body: JSON.stringify({ eventId: record.id, trackingComplete: !record.trackingComplete, expectedRevision: record.trackingRevision }) });
      if (version !== epoch || !ready) return;
      busy = false; await load();
    } catch (error) { if (version === epoch && ready) status(error.message, true); }
    finally { if (version === epoch) { busy = false; controls(); } }
  });
  function reset() { epoch++; ready = loaded = busy = false; report = null; $('statisticsCards').replaceChildren(); $('statisticsRows').replaceChildren(); $('statisticsEvent').replaceChildren(new Option('Tüm etkinlikler', '')); status(''); controls(); }
  onAdminEvent('admin-session', reset);
  onAdminEvent('admin-ready', () => { ready = canAdmin('statistics.view'); controls(); if (ready && active && !loaded) load(); });
  document.addEventListener('admin-tab', event => { active = event.detail === 'statistics' && canAdmin('statistics.view'); if (active && ready && !loaded) load(); });
  document.addEventListener('admin-logout', reset);
  controls();
}
