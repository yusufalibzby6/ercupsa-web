import { $, api, escape, onAdminEvent, canAdmin, isOwner } from './common.js';

const host = $('yearbooksEditor');
const sections = { conference: 'Konferanslar', technical: 'Teknik ve bilimsel etkinlikler', social: 'Sosyal etkinlikler', responsibility: 'Sosyal sorumluluk' };
const validPhoto = value => { try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'res.cloudinary.com' && u.pathname.includes('/image/upload/') && !/\.svg(?:$|\/)/i.test(u.pathname) ? u.href : ''; } catch { return ''; } };
let ready = false, active = false, busy = false, loaded = false, epoch = 0, current = null, draft = null, events = [], catalog = [], dirty = false;
if (host) {
  host.innerHTML = `<div class="admin-section-heading"><div><h2>ERCUPSA Yıllıkları</h2><p>Dönemin hikâyesini hazırlayın. Taslaklar siz yayımlayana kadar herkese kapalıdır.</p></div></div>
    <div class="ayb-toolbar"><label>Yıllık seç<select id="yearbookSelect"><option value="">Bir yıllık seçin</option></select></label><button type="button" id="yearbookReload">Kaydedileni yükle</button><form id="yearbookCreateForm"><label>Yeni dönem<input id="yearbookPeriod" value="2026-2027" pattern="20[0-9]{2}-20[0-9]{2}" maxlength="9" required aria-label="Yeni yıllık dönemi"></label><button id="yearbookCreate">Taslak oluştur</button></form></div>
    <p id="yearbookStatus" role="status" aria-live="polite"></p><div id="yearbookEditorBody" hidden></div>`;
  const status = (value, error = false) => {
    for (const id of ['yearbookStatus', 'yearbookActionStatus']) {
      const node = $(id); if (!node) continue;
      node.textContent = value; node.dataset.error = String(error);
      node.setAttribute('role', error ? 'alert' : 'status');
    }
  };
  const photos = event => [...new Set([event.poster, ...(event.images || []).map(image => image.url)].map(validPhoto).filter(Boolean))];
  function controls() {
    host.querySelectorAll('input,textarea,select,button').forEach(control => { control.disabled = !ready || busy; });
    $('yearbookPeriod').disabled ||= !canAdmin('yearbooks.manage'); $('yearbookCreate').disabled ||= !canAdmin('yearbooks.manage');
    host.querySelectorAll('[data-edit], [data-move], [data-remove], #yearbookSave, #yearbookAddEvent').forEach(control => { control.disabled ||= !canAdmin('yearbooks.manage'); });
    host.querySelectorAll('[data-move]').forEach(control => { const index = Number(control.dataset.event); control.disabled ||= control.dataset.move === 'up' ? index === 0 : index === (draft?.events.length || 0) - 1; });
    host.querySelectorAll('#yearbookPublish,#yearbookUnpublish').forEach(control => { control.disabled ||= !canAdmin('yearbooks.publish') || dirty; });
    const deletion = $('yearbookDelete'); if (deletion) { deletion.hidden = !isOwner(); deletion.disabled ||= !isOwner(); }
    const preview = $('yearbookPreview'); if (preview) { preview.setAttribute('aria-disabled', String(busy || dirty)); preview.tabIndex = busy || dirty ? -1 : 0; }
    const help = $('yearbookPublicationHelp');
    if (help) help.textContent = dirty ? 'Yayımlamadan önce değişiklikleri “Taslağı kaydet” ile kaydedin.'
      : !canAdmin('yearbooks.publish') ? 'Bu hesabın yıllık yayımlama yetkisi yok. Kaydedilmiş taslağı önizleyebilirsiniz.'
      : !draft?.events.length ? 'Yayımlamak için en az bir gerçekleşmiş etkinlik seçip taslağı kaydedin.'
      : draft.events.some(event => event.photos.some(photo => !photo.rightsApproved)) || draft.boardPhoto.url && !draft.boardPhoto.rightsApproved ? 'Seçilen fotoğrafların yayın uygunluğu kutularını kontrol edip taslağı kaydedin.'
      : 'Yayımlanınca yıllık arşivinde ve ana sayfadaki duyuruda görünür. Açma bağlantısı burada gösterilir.';
  }
  function setDirty() { dirty = true; controls(); const mark = $('yearbookUnsaved'); if (mark) mark.textContent = 'Kaydedilmemiş değişiklikler'; }
  function renderCatalog() {
    $('yearbookSelect').replaceChildren(new Option('Bir yıllık seçin', ''), ...catalog.map(book => new Option(`${book.title} · ${book.visibility === 'published' ? 'Yayında' : 'Taslak'}`, book.id)));
    $('yearbookSelect').value = current?.id || '';
  }
  function photoCard(image, eventIndex, photoIndex) {
    return `<div class="ayb-photo"><img src="${escape(image.url)}" alt="Seçili yıllık fotoğrafı" loading="lazy" width="160" height="120"><label>Fotoğraf açıklaması<input data-edit="photoCaption" data-event="${eventIndex}" data-photo="${photoIndex}" value="${escape(image.caption)}" maxlength="240"></label><label class="ayb-check"><input type="checkbox" data-edit="photoRights" data-event="${eventIndex}" data-photo="${photoIndex}" ${image.rightsApproved ? 'checked' : ''}>Bu fotoğrafın yıllıkta yayımlanmasına uygunluğunu kontrol ettim.</label><button type="button" data-remove="photo" data-event="${eventIndex}" data-photo="${photoIndex}">Fotoğrafı yıllıktan çıkar</button></div>`;
  }
  function render() {
    const body = $('yearbookEditorBody'); body.hidden = !draft;
    if (!draft) { body.replaceChildren(); controls(); return; }
    const photoOwners = new Map();
    for (const event of events) for (const url of photos(event)) if (!photoOwners.has(url)) photoOwners.set(url, event.title);
    const allPhotos = [...photoOwners.keys()];
    const published = current.visibility === 'published' && !!current.publishedSnapshot;
    body.innerHTML = `<div class="ayb-editor-top"><span class="ayb-badge">${current.visibility === 'published' ? 'Yayında · Düzenlemeler tekrar yayımlanana kadar taslaktır' : 'Taslak · Herkese kapalı'}</span><span id="yearbookUnsaved">${dirty ? 'Kaydedilmemiş değişiklikler' : 'Kaydedildi'}</span></div>
      <div class="ayb-note">Yayımlama, o anki metinlerin, seçilen fotoğrafların ve doğrulanmış istatistiklerin sabit bir kopyasını oluşturur. Sonraki etkinlikler geçmiş yıllığı değiştirmez. Fotoğrafları seçmek mevcut galeri kayıtlarını değiştirmez.</div>
      <section class="ayb-panel"><h3>Dönemin çerçevesi</h3><div class="ayb-fields"><label class="ayb-wide">Yıllık başlığı<input data-edit="title" value="${escape(draft.title)}" maxlength="180" required></label><label class="ayb-wide">Açılış açıklaması<textarea data-edit="description" maxlength="1500" rows="3">${escape(draft.description)}</textarea></label><label>Dönem başlangıcı<input type="date" data-edit="startDate" value="${escape(draft.startDate)}" required></label><label>Dönem sonu<input type="date" data-edit="endDate" value="${escape(draft.endDate)}" required></label></div></section>
      <section class="ayb-panel"><h3>Etkinlikler ve anılar</h3><p class="ayb-help">Bölümler konferans, bilimsel etkinlik, sosyal etkinlik ve sosyal sorumluluk sırasıyla gösterilir. Oklarla her bölümdeki etkinlik sırasını düzenleyebilirsiniz.</p><div class="ayb-event-add"><label>Etkinlik seç<select id="yearbookEventChoice">${events.filter(event => !draft.events.some(selection => selection.id === event.id)).map(event => `<option value="${escape(event.id)}">${escape(event.title)} · ${escape(event.date)}</option>`).join('')}</select></label><button type="button" id="yearbookAddEvent">Etkinliği ekle</button></div><div id="yearbookEvents">${draft.events.map((selection, index) => { const event = events.find(event => event.id === selection.id); return `<article class="ayb-event" data-yearbook-event="${escape(selection.id)}"><div class="ayb-event-title"><div><span>${index + 1}. etkinlik</span><h4>${escape(event?.title || 'Artık bulunmayan etkinlik')}</h4><small>${escape(event?.date || '')}</small></div><div class="ayb-order"><button type="button" data-move="up" data-event="${index}" aria-label="Etkinliği yukarı taşı" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-move="down" data-event="${index}" aria-label="Etkinliği aşağı taşı" ${index === draft.events.length - 1 ? 'disabled' : ''}>↓</button><button type="button" data-remove="event" data-event="${index}">Çıkar</button></div></div><div class="ayb-fields"><label>Bölüm<select data-edit="section" data-event="${index}">${Object.entries(sections).map(([key, label]) => `<option value="${key}" ${key === selection.section ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="ayb-wide">Bu etkinliğe özel mesaj<textarea data-edit="message" data-event="${index}" rows="2" maxlength="2000">${escape(selection.message)}</textarea></label></div><div class="ayb-photo-picker" aria-label="Etkinlik fotoğrafları">${photos(event || {}).map((url, photoIndex) => `<label><img src="${escape(url)}" alt="${escape(event?.title || 'Etkinlik')} fotoğraf seçeneği ${photoIndex + 1}" loading="lazy" width="120" height="90"><span><input type="checkbox" data-edit="photoSelection" data-event="${index}" data-url="${escape(url)}" ${selection.photos.some(image => image.url === url) ? 'checked' : ''}>Yıllığa ekle</span></label>`).join('') || '<p class="ayb-help">Bu etkinlikte seçilebilecek galeri fotoğrafı bulunmuyor.</p>'}</div><div class="ayb-selected-photos">${selection.photos.map((image, photoIndex) => photoCard(image, index, photoIndex)).join('')}</div></article>`; }).join('') || '<p class="ayb-help">Henüz etkinlik seçilmedi. İlk etkinliği yukarıdan ekleyebilirsiniz.</p>'}</div></section>
      <section class="ayb-panel"><h3>Ekibimiz ve başkanın mesajı</h3><div class="ayb-fields"><label class="ayb-wide">Yönetim kurulu fotoğrafı<select data-edit="boardUrl"><option value="">Fotoğraf seçilmedi</option>${allPhotos.map((url, index) => `<option value="${escape(url)}" ${draft.boardPhoto.url === url ? 'selected' : ''}>Galeri fotoğrafı ${index + 1} · ${escape(photoOwners.get(url) || '')}</option>`).join('')}${draft.boardPhoto.url && !allPhotos.includes(draft.boardPhoto.url) ? `<option value="${escape(draft.boardPhoto.url)}" selected>Önceden seçilmiş yönetim kurulu fotoğrafı</option>` : ''}</select></label>${draft.boardPhoto.url ? `<div class="ayb-board-preview"><img src="${escape(draft.boardPhoto.url)}" alt="Yönetim kurulu fotoğrafı" width="240" height="180"></div>` : ''}<label>Fotoğraf açıklaması<input data-edit="boardCaption" value="${escape(draft.boardPhoto.caption)}" maxlength="240"></label><label class="ayb-check ayb-wide"><input type="checkbox" data-edit="boardRights" ${draft.boardPhoto.rightsApproved ? 'checked' : ''}>Yönetim kurulu fotoğrafının yıllıkta yayımlanmasına uygunluğunu kontrol ettim.</label><label>Başkanın adı<input data-edit="presidentName" value="${escape(draft.presidentName)}" maxlength="120"></label><label class="ayb-wide">Başkanın mesajı<textarea data-edit="presidentMessage" rows="5" maxlength="5000">${escape(draft.presidentMessage)}</textarea></label><label class="ayb-wide">Dönem sonu teşekkür mesajı<textarea data-edit="closingMessage" rows="3" maxlength="2000">${escape(draft.closingMessage)}</textarea></label></div></section>
      <section class="ayb-publication" aria-label="Yıllığın yayın bilgisi"><strong>${published ? 'Yıllık yayında' : 'Henüz herkese açık bir kopya yok'}</strong><p>${published ? 'Ziyaretçiler yıllığı aşağıdaki bağlantılardan açabilir.' : 'Yayımlama başarıyla tamamlandığında yıllık ana sayfadaki duyuruda ve arşivde görünür.'}</p><div class="ayb-public-links"><a id="yearbookPublicLink" href="/yillik/${encodeURIComponent(current.id)}" target="_blank" rel="noopener" ${published ? '' : 'hidden'}>Yayımlanan yıllığı aç ↗</a><a id="yearbookArchiveLink" href="/yilliklar.html" target="_blank" rel="noopener">Yıllık arşivini aç ↗</a></div></section><div class="ayb-actions"><button type="button" id="yearbookSave" class="ayb-primary">Taslağı kaydet</button><a id="yearbookPreview" href="/yillik.html?donem=${encodeURIComponent(current.id)}&preview=1" target="_blank" rel="noopener">Kaydedilmiş taslağı önizle ↗</a><button type="button" id="yearbookPublish">${current.visibility === 'published' ? 'Güncel taslağı yeniden yayımla' : 'Yıllığı yayımla'}</button>${current.visibility === 'published' ? '<button type="button" id="yearbookUnpublish">Yayından kaldır</button>' : ''}${isOwner() ? '<button type="button" id="yearbookDelete">Yıllığı sil</button>' : ''}</div><p id="yearbookPublicationHelp" class="ayb-help" role="status"></p><p id="yearbookActionStatus" class="ayb-action-status" role="status" aria-live="polite"></p>`;
    controls();
  }
  function accept(record) { if (!record?.draft || !record.revision || !record.id) throw Error('Yıllık doğrulanamadı.'); current = record; draft = structuredClone(record.draft); dirty = false; render(); renderCatalog(); }
  async function load(id = current?.id || '') {
    if (!ready || busy || !active) return;
    const version = epoch; busy = true; controls(); status('Yıllıklar yükleniyor…');
    try { const data = await api('/api/yearbooks?' + new URLSearchParams({ action: 'admin', ...(id ? { id } : {}) }));
      if (version !== epoch || !ready) return;
      if (!Array.isArray(data.catalog) || !Array.isArray(data.events)) throw Error('Yıllık arşivi doğrulanamadı.');
      catalog = data.catalog; events = data.events; loaded = true;
      if (data.yearbook) accept(data.yearbook); else { current = draft = null; dirty = false; renderCatalog(); render(); }
      status('Yalnızca yayımladığınız yıllıklar ziyaretçilere görünür.');
    } catch (error) { if (version === epoch && ready) { $('yearbookSelect').value = current?.id || ''; status(error.message, true); } }
    finally { if (version === epoch) { busy = false; controls(); } }
  }
  async function mutate(action) {
    if (!ready || busy || !current || (action === 'save' ? !canAdmin('yearbooks.manage') : !canAdmin('yearbooks.publish')) || action !== 'save' && dirty) return;
    if (action === 'save' && [...host.querySelectorAll('[data-edit]')].some(input => !input.checkValidity())) { host.querySelector('[data-edit]:invalid')?.reportValidity(); return; }
    if (action !== 'save' && !confirm(action === 'publish' ? 'Kaydedilmiş taslak, seçilen fotoğraflar ve o andaki doğrulanmış istatistiklerle herkese açık yayımlansın mı?' : 'Yıllık herkese kapatılsın mı? Taslak ve yayımlanmış kopya silinmez.')) return;
    const version = epoch; busy = true; controls(); status(action === 'save' ? 'Taslak kaydediliyor…' : 'Yayın durumu değiştiriliyor…');
    try { const data = await api('/api/yearbooks' + (action === 'save' ? '' : `?action=${action}`), { method: action === 'save' ? 'PUT' : 'POST', body: JSON.stringify({ id: current.id, revision: current.revision, ...(action === 'save' ? { draft } : {}) }) });
      if (version !== epoch || !ready) return;
      if (data.ok !== true || action === 'publish' && (data.yearbook?.visibility !== 'published' || !data.yearbook.publishedSnapshot)) throw Error('Yayın işleminin tamamlandığı doğrulanamadı. Kaydedileni yükleyip durumu kontrol edin.');
      accept(data.yearbook); const summary = catalog.find(book => book.id === current.id); if (summary) Object.assign(summary, { title: draft.title, visibility: current.visibility, revision: current.revision }); renderCatalog();
      status(action === 'save' ? 'Taslak kaydedildi. Önizlemeyi açabilirsiniz.' : action === 'publish' ? 'Yıllık yayımlandı. Bu kopya sonraki dönem verileriyle değişmez.' : 'Yıllık yayından kaldırıldı. İçerik taslakta korunuyor.');
    } catch (error) { if (version === epoch && ready) status(`${error.message} Değişiklikleriniz ekranda korunuyor.`, true); }
    finally { if (version === epoch) { busy = false; controls(); } }
  }
  async function remove() {
    if (!ready || busy || !current || !isOwner()) return;
    if (!confirm(`“${current.draft.title}” yıllığı silinsin mi? Taslak, yayımlanmış kopya ve varsa kaydedilmemiş değişiklikler kaldırılır. Bu işlem geri alınamaz. Etkinlikler ve galeri fotoğrafları korunur.`)) return;
    const version = epoch, id = current.id; busy = true; controls(); status('Yıllık siliniyor…');
    try {
      const data = await api('/api/yearbooks', { method: 'DELETE', body: JSON.stringify({ id, revision: current.revision }) });
      if (version !== epoch || !ready) return;
      if (data.ok !== true || data.deleted !== true || data.id !== id) throw Error('Silme işlemi doğrulanamadı. Kaydedileni yükleyip durumu kontrol edin.');
      catalog = catalog.filter(book => book.id !== id); current = draft = null; dirty = false;
      renderCatalog(); render(); status('Yıllık silindi. Aynı dönem için yeniden taslak oluşturabilirsiniz.');
      $('yearbookSelect').focus();
    } catch (error) { if (version === epoch && ready) status(`${error.message} Yıllık ekranda korunuyor.`, true); }
    finally { if (version === epoch) { busy = false; controls(); } }
  }
  $('yearbookSelect').addEventListener('change', () => { const id = $('yearbookSelect').value; if (dirty && !confirm('Kaydedilmemiş değişiklikler bırakılsın mı?')) { $('yearbookSelect').value = current?.id || ''; return; } load(id); });
  $('yearbookReload').addEventListener('click', () => { if (!dirty || confirm('Kaydedilmemiş değişiklikler bırakılsın ve kaydedilen kopya yüklensin mi?')) load(); });
  $('yearbookCreateForm').addEventListener('submit', async event => {
    event.preventDefault(); if (!ready || busy || !canAdmin('yearbooks.manage') || !$('yearbookCreateForm').reportValidity() || dirty && !confirm('Kaydedilmemiş değişiklikler bırakılsın mı?')) return;
    const version = epoch; busy = true; controls(); status('Yıllık taslağı oluşturuluyor…');
    try { const data = await api('/api/yearbooks', { method: 'POST', body: JSON.stringify({ period: $('yearbookPeriod').value }) }); if (version !== epoch || !ready) return; const id = data.yearbook.id; busy = false; await load(id); status('Yıllık taslak olarak oluşturuldu; herkese kapalı.'); }
    catch (error) { if (version === epoch && ready) status(error.message, true); }
    finally { if (version === epoch) { busy = false; controls(); } }
  });
  host.addEventListener('input', event => {
    const input = event.target.closest('[data-edit]'); if (!input || !ready || busy || !draft || !canAdmin('yearbooks.manage')) return;
    const key = input.dataset.edit, selection = draft.events[Number(input.dataset.event)], image = selection?.photos[Number(input.dataset.photo)];
    if (['title','description','startDate','endDate','presidentName','presidentMessage','closingMessage'].includes(key)) draft[key] = input.value;
    else if (['section','message'].includes(key) && selection) selection[key] = input.value;
    else if (key === 'photoCaption' && image) image.caption = input.value;
    else if (key === 'photoRights' && image) image.rightsApproved = input.checked;
    else if (key === 'boardCaption') draft.boardPhoto.caption = input.value;
    else if (key === 'boardRights') draft.boardPhoto.rightsApproved = input.checked;
    else if (key === 'boardUrl') { draft.boardPhoto.url = validPhoto(input.value); draft.boardPhoto.rightsApproved = false; setDirty(); render(); return; }
    else if (key === 'photoSelection' && selection) { const url = validPhoto(input.dataset.url); if (input.checked && url && !selection.photos.some(image => image.url === url)) selection.photos.push({ url, caption: '', rightsApproved: false }); else if (!input.checked) selection.photos = selection.photos.filter(image => image.url !== url); setDirty(); render(); return; }
    else return;
    setDirty();
  });
  host.addEventListener('click', event => {
    const preview = event.target.closest('#yearbookPreview'); if (preview && (dirty || busy)) { event.preventDefault(); status('Önizlemeden önce değişiklikleri kaydedin.'); return; }
    const button = event.target.closest('button'); if (!button || button.disabled || busy || !ready) return;
    if (button.id === 'yearbookSave') return mutate('save'); if (button.id === 'yearbookPublish') return mutate('publish'); if (button.id === 'yearbookUnpublish') return mutate('unpublish');
    if (button.id === 'yearbookDelete') return remove();
    if (!canAdmin('yearbooks.manage') || !draft) return;
    if (button.id === 'yearbookAddEvent') { const id = $('yearbookEventChoice').value; if (id && !draft.events.some(item => item.id === id)) draft.events.push({ id, section: 'social', message: '', photos: [] }); else return; }
    else if (button.dataset.move) { const index = Number(button.dataset.event), next = index + (button.dataset.move === 'up' ? -1 : 1); if (!draft.events[index] || !draft.events[next]) return; [draft.events[index], draft.events[next]] = [draft.events[next], draft.events[index]]; }
    else if (button.dataset.remove === 'event') draft.events.splice(Number(button.dataset.event), 1);
    else if (button.dataset.remove === 'photo') draft.events[Number(button.dataset.event)]?.photos.splice(Number(button.dataset.photo), 1);
    else return;
    setDirty(); render();
  });
  function reset() { epoch++; ready = busy = loaded = dirty = false; current = draft = null; catalog = events = []; renderCatalog(); render(); status(''); }
  onAdminEvent('admin-session', reset);
  onAdminEvent('admin-ready', () => { ready = canAdmin('yearbooks.view'); controls(); if (ready && active && !loaded) load(); });
  document.addEventListener('admin-tab', event => { active = event.detail === 'yearbooks' && canAdmin('yearbooks.view'); if (active && ready && !loaded) load(); });
  document.addEventListener('admin-logout', reset);
  window.addEventListener('beforeunload', event => { if (ready && dirty) { event.preventDefault(); event.returnValue = ''; } });
  controls();
}
