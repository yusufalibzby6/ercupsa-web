import { $, escape, onAdminEvent } from './common.js';

let events = [], participants = [], entries = [], accounts = [], selectedId = '';
let ready = false, active = false, loading = false, staffLoading = false, staffBusy = false;
let listVersion = 0, staffVersion = 0, visibleLimit = 100, deleteId = '';
const time = value => value ? new Date(value).toLocaleString('tr-TR') : '—';
async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error || 'İşlem tamamlanamadı.'); error.status = response.status; throw error; }
  return data;
}
function message(id, text, error = false) { $(id).textContent = text; $(id).dataset.error = String(error); }
function controls() {
  $('attendanceRefresh').disabled = !ready || !selectedId || loading;
  $('attendanceEvent').disabled = loading;
  $('staffFields').disabled = !ready || staffBusy || staffLoading;
  $('staffCreate').disabled = !ready || staffBusy || staffLoading || !events.length;
  $('staffReload').disabled = !ready || staffBusy || staffLoading;
  for (const button of $('staffAccounts').querySelectorAll('button')) button.disabled = staffBusy;
  $('attendanceScanner').hidden = !selectedId;
  if (selectedId) $('attendanceScanner').href = `giris.html?${new URLSearchParams({ event: selectedId })}`;
}
function populateEvents() {
  const oldId = selectedId;
  if (!events.some(event => event.id === selectedId)) selectedId = events[0]?.id || '';
  $('attendanceEvent').replaceChildren(...events.map(event => new Option(`${event.title}${event.date ? ` · ${event.date}` : ''}`, event.id)));
  $('attendanceEvent').value = selectedId;
  // Preserve the administrator's in-progress event assignment selection.
  const checked = new Set([...$('staffEventScopes').querySelectorAll('input:checked')].map(input => input.value));
  $('staffEventScopes').innerHTML = events.map(event => `<label><input type="checkbox" name="staffEvent" value="${escape(event.id)}" ${checked.has(event.id) ? 'checked' : ''}>${escape(event.title)}</label>`).join('') || '<p class="gate-muted">Önce bir etkinlik oluşturun.</p>';
  if (oldId !== selectedId) { ++listVersion; loading = false; clearAttendance(); }
  controls();
}
function clearAttendance() {
  participants = []; entries = []; visibleLimit = 100;
  for (const id of ['attendanceRegistered', 'attendanceClaimed', 'attendanceEntered']) $(id).textContent = '—';
  $('attendanceSearch').value = ''; $('attendanceFilter').value = 'all';
  message('attendanceStatus', selectedId ? '' : 'Henüz etkinlik yok.'); renderAttendance();
}
function renderAttendance() {
  const query = $('attendanceSearch').value.trim().toLocaleLowerCase('tr');
  const filter = $('attendanceFilter').value;
  const claimedTickets = new Set(participants.map(person => person.ticketId));
  // An unclaimed paper ticket can be admitted too; keep it visible and counted.
  const rows = [...participants, ...entries.filter(entry => !claimedTickets.has(entry.ticketId)).map(entry => ({
    name: entry.name || 'Bilet sahibi', claimedAt: null, enteredAt: entry.enteredAt, ticketId: entry.ticketId,
  }))];
  const matches = rows.filter(person => person.name.toLocaleLowerCase('tr').includes(query) &&
    (filter === 'all' || (filter === 'entered' ? Boolean(person.enteredAt) : !person.enteredAt)));
  $('attendanceListCount').textContent = `${matches.length} kişi${matches.length > visibleLimit ? ` · ilk ${visibleLimit} gösteriliyor` : ''}`;
  $('attendancePeople').innerHTML = matches.slice(0, visibleLimit).map(person => `<tr><td>${escape(person.name)}</td><td>${person.claimedAt ? escape(time(person.claimedAt)) : 'Hesabına eklememiş'}</td><td>${person.enteredAt ? `<span>Giriş yaptı · ${escape(time(person.enteredAt))}</span>` : 'Henüz giriş yapmadı'}</td></tr>`).join('') || '<tr><td colspan="3" class="gate-muted">Bu filtrede katılımcı bulunamadı.</td></tr>';
  $('attendanceMore').hidden = matches.length <= visibleLimit;
}
async function loadAttendance({ quiet = false } = {}) {
  if (!ready || !selectedId || loading) return;
  const eventId = selectedId, version = ++listVersion;
  loading = true; controls(); if (!quiet) message('attendanceStatus', 'Katılım bilgileri yükleniyor…');
  const results = await Promise.allSettled([
    request(`/api/gate?${new URLSearchParams({ eventId })}`),
    request(`/api/registrations?${new URLSearchParams({ action: 'admin', event_id: eventId })}`),
  ]);
  if (version !== listVersion || !ready || selectedId !== eventId) return;
  const errors = [];
  if (results[0].status === 'fulfilled') {
    const data = results[0].value;
    if (Array.isArray(data.participants) && Array.isArray(data.entries) && Number.isInteger(data.summary?.claimed) && Number.isInteger(data.summary?.entered)) {
      participants = data.participants; entries = data.entries;
      $('attendanceClaimed').textContent = data.summary.claimed; $('attendanceEntered').textContent = data.summary.entered;
      renderAttendance();
    } else errors.push('Bilet ve giriş sayıları doğrulanamadı.');
  } else errors.push(results[0].reason.message);
  if (results[1].status === 'fulfilled' && Number.isInteger(results[1].value.summary?.total)) $('attendanceRegistered').textContent = results[1].value.summary.total;
  else errors.push(results[1].status === 'rejected' ? `Form kayıtları: ${results[1].reason.message}` : 'Form kayıt sayısı doğrulanamadı.');
  message('attendanceStatus', errors.length ? `${errors.join(' ')} Gösterilen bilgiler güncel olmayabilir; yenileyin.` : `Son güncelleme ${new Date().toLocaleTimeString('tr-TR')} · Bu sekme açıkken 15 saniyede bir yenilenir.`, Boolean(errors.length));
  loading = false; controls();
}
function renderAccounts() {
  $('staffAccounts').innerHTML = accounts.map(account => `<article class="gate-staff-account"><div><strong>${escape(account.name)}</strong><p class="gate-muted">${escape(account.username)} · ${account.active ? 'Aktif' : 'Pasif'}</p><p class="gate-muted">${account.eventIds.map(id => escape(events.find(event => event.id === id)?.title || 'Silinmiş etkinlik')).join(' · ')}</p></div><div class="gate-actions">${deleteId === account.id ? `<span>Yetkisi ve açık oturumu kaldırılsın mı?</span><button type="button" class="gate-danger" data-staff-confirm="${escape(account.id)}">Evet, kaldır</button><button type="button" data-staff-cancel>Vazgeç</button>` : `<button type="button" class="gate-danger" data-staff-delete="${escape(account.id)}">Hesabı kaldır</button>`}</div></article>`).join('') || '<p class="gate-muted">Henüz görevli hesabı yok.</p>';
  controls();
}
async function loadAccounts() {
  if (!ready || staffLoading || staffBusy) return;
  const version = ++staffVersion; staffLoading = true; controls(); message('staffStatus', 'Görevli hesapları yükleniyor…');
  try {
    const data = await request('/api/staff?action=accounts');
    if (version !== staffVersion || !ready) return;
    if (!Array.isArray(data.accounts)) throw new Error('Görevli listesi doğrulanamadı.');
    accounts = data.accounts; renderAccounts(); message('staffStatus', '');
  } catch (error) { if (version === staffVersion) message('staffStatus', `${error.message} Görevli listesini yeniden yükleyin.`, true); }
  finally { if (version === staffVersion) { staffLoading = false; controls(); } }
}
onAdminEvent('events-loaded', event => {
  events = Array.isArray(event.detail) ? event.detail : [];
  populateEvents(); renderAccounts();
  if (ready && active) loadAttendance();
});
onAdminEvent('admin-ready', () => { ready = true; controls(); if (active) { loadAttendance(); loadAccounts(); } });
document.addEventListener('admin-tab', event => {
  active = event.detail === 'attendance';
  if (active && ready) { loadAttendance(); loadAccounts(); }
});
document.addEventListener('admin-logout', () => {
  ready = false; active = false; ++listVersion; ++staffVersion; loading = false; staffLoading = false;
  selectedId = ''; events = []; accounts = []; deleteId = '';
  $('staffForm').reset(); $('staffEventScopes').replaceChildren(); $('attendanceEvent').replaceChildren();
  clearAttendance(); renderAccounts(); message('staffStatus', ''); controls();
});
$('attendanceEvent').addEventListener('change', () => { selectedId = $('attendanceEvent').value; ++listVersion; loading = false; clearAttendance(); controls(); loadAttendance(); });
$('attendanceRefresh').addEventListener('click', () => loadAttendance());
$('attendanceSearch').addEventListener('input', () => { visibleLimit = 100; renderAttendance(); });
$('attendanceFilter').addEventListener('change', () => { visibleLimit = 100; renderAttendance(); });
$('attendanceMore').addEventListener('click', () => { visibleLimit += 100; renderAttendance(); });
$('staffReload').addEventListener('click', loadAccounts);
$('staffForm').addEventListener('submit', async event => {
  event.preventDefault(); if (!ready || staffBusy || staffLoading) return;
  const eventIds = [...$('staffEventScopes').querySelectorAll('input:checked')].map(input => input.value);
  if (!eventIds.length) { message('staffStatus', 'Görevliye en az bir etkinlik seçin.', true); return; }
  const version = staffVersion;
  const input = { username: $('staffUsername').value.trim(), name: $('staffName').value.trim(), password: $('staffPassword').value, eventIds };
  staffBusy = true; controls(); message('staffStatus', 'Görevli hesabı oluşturuluyor…');
  try {
    const data = await request('/api/staff?action=accounts', { method: 'POST', body: JSON.stringify(input) });
    if (version !== staffVersion || !ready) return;
    if (!data.account?.id) throw new Error('Hesap oluşturulduğu doğrulanamadı. Görevli listesini yenileyin.');
    accounts.push(data.account); $('staffForm').reset(); renderAccounts();
    message('staffStatus', 'Görevli hesabı oluşturuldu. Kullanıcı adını, belirlediğiniz şifreyi ve giriş ekranının bağlantısını görevliyle paylaşın.');
  } catch (error) { if (version === staffVersion) message('staffStatus', `${error.message}${!error.status || error.status >= 500 ? ' Hesap oluşmuş olabilir; tekrar denemeden önce görevli listesini yenileyin.' : ''}`, true); }
  finally { staffBusy = false; controls(); }
});
$('staffAccounts').addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button || staffBusy) return;
  if (button.hasAttribute('data-staff-cancel')) { deleteId = ''; renderAccounts(); return; }
  if (button.dataset.staffDelete) { deleteId = button.dataset.staffDelete; renderAccounts(); $('staffAccounts').querySelector('[data-staff-confirm]')?.focus(); return; }
  const id = button.dataset.staffConfirm; if (!id || id !== deleteId || !accounts.some(account => account.id === id)) return;
  const version = staffVersion; staffBusy = true; controls(); message('staffStatus', 'Görevli hesabı kaldırılıyor…');
  try {
    const data = await request(`/api/staff?${new URLSearchParams({ action: 'accounts', id })}`, { method: 'DELETE' });
    if (version !== staffVersion || !ready) return;
    if (data.ok !== true) throw new Error('Hesabın kaldırıldığı doğrulanamadı. Listeyi yenileyin.');
    accounts = accounts.filter(account => account.id !== id); deleteId = ''; renderAccounts();
    message('staffStatus', 'Görevli hesabı kaldırıldı. Bu hesabın açık oturumları da artık giriş kaydedemez.');
  } catch (error) { if (version === staffVersion) message('staffStatus', `${error.message} Görevli listesini yenileyerek sonucu kontrol edin.`, true); }
  finally { staffBusy = false; controls(); }
});
setInterval(() => { if (ready && active && !document.hidden) loadAttendance({ quiet: true }); }, 15000);
controls();
