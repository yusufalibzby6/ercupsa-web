import { $, api, escape, onAdminEvent, canAdmin } from './common.js';

const host = $('eventAuditEditor');
const labels = { create: 'Etkinlik oluşturuldu', update: 'Etkinlik güncellendi', publish: 'Etkinlik yayımlandı', unpublish: 'Etkinlik yayından kaldırıldı', delete: 'Etkinlik çöp kutusuna taşındı', restore: 'Etkinlik geri alındı', recover: 'Etkinlik kurtarıldı', purge: 'Etkinlik kalıcı silindi', 'form.open': 'Kayıt formu açıldı', 'form.close': 'Kayıt formu kapatıldı', 'form.update': 'Kayıt formu düzenlendi', 'capacity.change': 'Asıl kontenjan değişti', 'waitlist.change': 'Yedek kontenjan değişti', 'counter.change': 'Sayaç görünürlüğü değişti', 'registration.cancel': 'Kayıt iptal edildi', 'registration.delete': 'Kayıt silindi', 'registration.promote': 'Yedek asıl listeye alındı', 'payment.review': 'Ödeme kontrolü güncellendi', 'payment.change': 'Ödeme beyanı ayarı değişti', 'payment.approve': 'Ödeme onaylandı', 'payment.pending': 'Ödeme kontrolü beklemeye alındı', 'attendance.complete': 'Giriş takibi durumu değişti' };
const fieldLabels = { maxRegistrations: 'Asıl kontenjan', capacity: 'Kontenjan', waitlistCapacity: 'Yedek kontenjan', waitlistEnabled: 'Yedek kayıt', showRemainingCapacity: 'Kontenjan sayacı', enabled: 'Kayıt formu', paymentEnabled: 'Ödeme beyanı', status: 'Kayıt durumu', reviewStatus: 'Ödeme durumu', trackingComplete: 'Giriş takibi' };
const valueLabels = { main: 'Asıl', waitlisted: 'Yedek', cancelled: 'İptal', pending: 'Onay bekleniyor', approved: 'Onaylandı', not_required: 'Gerekli değil' };
function describeValues(values) {
  return Object.entries(values || {}).map(([key, value]) => `${fieldLabels[key] || key}: ${value == null ? 'Sınırsız' : typeof value === 'boolean' ? value ? 'Açık' : 'Kapalı' : valueLabels[value] || value}`).join(' · ') || '—';
}
let ready = false, active = false, loaded = false, busy = false, epoch = 0, page = 1, totalPages = 1;
if (host) {
  host.innerHTML = `<div class="admin-section-heading"><div><h2>Etkinlik denetimi</h2><p>Yönetim işlemlerinin zamanı, türü ve yetkili hesabı.</p></div></div><form id="auditFilters" class="event-audit-filters"><label>Etkinlik<select id="auditEvent"><option value="">Tüm etkinlikler</option></select></label><label>İşlem<select id="auditType"><option value="">Tüm işlemler</option></select></label><label>Başlangıç<input id="auditFrom" type="date"></label><label>Bitiş<input id="auditTo" type="date"></label><button class="admin-primary" id="auditRefresh">Geçmişi göster</button></form><p id="auditStatus" role="status" aria-live="polite"></p><p class="event-audit-note">Bu kayıtlar telefon, dekont, form cevapları veya QR kodu içermez. Geçmiş kayıtlarında bulunmayan tarih ve yetkili bilgileri sonradan üretilmez.</p><div id="auditOperations" class="event-audit-list"></div><div class="event-audit-pagination"><button id="auditPrevious" type="button">Önceki</button><span id="auditPage"></span><button id="auditNext" type="button">Sonraki</button></div>`;
  function status(text, error = false) { $('auditStatus').textContent = text; $('auditStatus').dataset.error = String(error); }
  function controls() {
    host.querySelectorAll('input,select,button').forEach(element => { element.disabled = !ready || busy; });
    $('auditPrevious').disabled ||= page <= 1; $('auditNext').disabled ||= page >= totalPages;
  }
  async function load() {
    if (!ready || !active || busy || !canAdmin('audit.view')) return;
    const version = epoch; busy = true; controls(); status('İşlem geçmişi yükleniyor…');
    try {
      const query = new URLSearchParams({ eventId: $('auditEvent').value, type: $('auditType').value, from: $('auditFrom').value, to: $('auditTo').value, page: String(page) });
      const data = await api('/api/event-audit?' + query);
      if (version !== epoch || !ready || !active) return;
      if (!Array.isArray(data.operations) || !Array.isArray(data.events) || !Array.isArray(data.types) || !Number.isInteger(data.page) || !Number.isInteger(data.totalPages)) throw Error('İşlem geçmişi doğrulanamadı.');
      const selectedEvent = $('auditEvent').value, selectedType = $('auditType').value;
      $('auditEvent').replaceChildren(new Option('Tüm etkinlikler', ''), ...data.events.map(item => new Option(item.title, item.id))); $('auditEvent').value = selectedEvent;
      $('auditType').replaceChildren(new Option('Tüm işlemler', ''), ...data.types.map(type => new Option(labels[type] || type, type))); $('auditType').value = selectedType;
      const names = new Map(data.events.map(item => [item.id, item.title]));
      $('auditOperations').innerHTML = data.operations.map(operation => `<article class="event-audit-operation"><span class="event-audit-dot" aria-hidden="true"></span><div><strong>${escape(labels[operation.type] || operation.type)}</strong><h3>${escape(names.get(operation.eventId) || 'Arşivlenmiş etkinlik')}</h3><p>${escape(new Date(operation.at).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }))} · ${operation.actor ? `@${escape(operation.actor.username)}` : 'Yetkili bilgisi kayıtta yok / sistem'}</p>${operation.before || operation.after ? `<dl><dt>Önce</dt><dd>${escape(describeValues(operation.before))}</dd><dt>Sonra</dt><dd>${escape(describeValues(operation.after))}</dd></dl>` : ''}</div></article>`).join('') || '<p class="event-audit-empty">Seçilen aralıkta işlem kaydı yok.</p>';
      page = data.page; totalPages = data.totalPages; loaded = true; $('auditPage').textContent = `${page} / ${totalPages}`;
      status(`${data.total} işlem bulundu.`);
    } catch (error) { if (version === epoch && ready) status(error.message, true); }
    finally { if (version === epoch) { busy = false; controls(); } }
  }
  $('auditFilters').addEventListener('submit', event => { event.preventDefault(); page = 1; load(); });
  $('auditPrevious').onclick = () => { if (page > 1) { page--; load(); } };
  $('auditNext').onclick = () => { if (page < totalPages) { page++; load(); } };
  function reset() { epoch++; ready = loaded = busy = false; page = totalPages = 1; $('auditOperations').replaceChildren(); $('auditEvent').replaceChildren(new Option('Tüm etkinlikler', '')); $('auditType').replaceChildren(new Option('Tüm işlemler', '')); $('auditPage').textContent = ''; status(''); controls(); }
  onAdminEvent('admin-session', reset);
  onAdminEvent('admin-ready', () => { ready = canAdmin('audit.view'); controls(); if (ready && active && !loaded) load(); });
  document.addEventListener('admin-tab', event => { active = event.detail === 'audit' && canAdmin('audit.view'); if (active && ready && !loaded) load(); });
  document.addEventListener('admin-logout', reset);
  controls();
}
