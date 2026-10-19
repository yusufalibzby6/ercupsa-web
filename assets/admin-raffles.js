import { $, escape, onAdminEvent, canAdmin } from './common.js';

const PENDING_KEY = 'ercupsa_raffle_pending_v1';
const SOURCE_KEY = 'ercupsa_raffle_source_v1';
const terminalCodes = new Set(['RAFFLE_POOL_REQUIRED', 'RAFFLE_POOL_CHANGED', 'RAFFLE_INVALID_SELECTION', 'RAFFLE_DRAW_DELETED', 'RAFFLE_REQUEST_CONFLICT']);
const eventSelect = $('raffleEvent'), countInput = $('raffleCount'), start = $('raffleStart'), loyaltyToggle = $('raffleLoyaltyBonus');
const entryToggle = $('raffleCheckedInOnly'), entryBonusToggle = $('raffleCheckinBonus');
const sourceButtons = [$('raffleSourceQr'), $('raffleSourceRegistrations')].filter(Boolean);
const formFilterButtons = [$('raffleFormsAll'), $('raffleFormsCheckedIn')].filter(Boolean);
let events = [], participants = [], draws = [], excluded = new Set();
let ready = false, active = false, loaded = false, busy = false, version = 0, loadedEventId = '', loadedSource = '', poolVersion = null, animationTimer = null;
let queuedCatalog = null, lastDraw = null, pending = recoverPending(), pendingStored = true;
let source = pending ? sourceOf(pending) : recoverSource();
let qrSettings = { loyaltyBonus: true, checkedInOnly: false, checkinBonus: false };
let formCheckedInOnly = source === 'registrations' && pending?.checkedInOnly === true;
if (pending) {
  excluded = new Set(pending.excluded);
  loadedEventId = pending.eventId;
  loadedSource = sourceOf(pending);
  loyaltyToggle.checked = pending.loyaltyBonus !== false;
  entryToggle.checked = pending.checkedInOnly === true;
  entryBonusToggle.checked = pending.checkinBonus === true;
}
if (source === 'registrations') {
  loyaltyToggle.checked = entryBonusToggle.checked = false;
  entryToggle.checked = formCheckedInOnly;
}

function recoverSource() {
  try { return sessionStorage.getItem(SOURCE_KEY) === 'registrations' ? 'registrations' : 'qr'; }
  catch { return 'qr'; }
}
function sourceOf(value) { return value?.source || 'qr'; }
function sourceLabel(value = source, checkedInOnly = false) {
  return value === 'registrations' ? 'Form kayıtları' + (checkedInOnly ? ' · Kapıda bileti okutulanlar' : '') : 'QR katılımcıları';
}
function personView(person) {
  return Object.fromEntries(['id', 'name', 'previous', 'weight', 'claimedAt', 'createdAt', 'enteredAt', 'prizeDelivered', 'prizeDeliveredAt'].filter(key => Object.hasOwn(person, key)).map(key => [key, person[key]]));
}
function drawView(draw) {
  return { ...Object.fromEntries(['id', 'eventId', 'eventTitle', 'poolVersion', 'loyaltyBonus', 'checkedInOnly', 'checkinBonus', 'createdAt'].filter(key => Object.hasOwn(draw, key)).map(key => [key, draw[key]])),
    source: sourceOf(draw), participants: draw.participants.map(personView), winners: draw.winners.map(personView) };
}

function recoverPending() {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
    const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
    if (!value) return null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.requestId) ||
        !validId(value.eventId) || !Number.isInteger(value.count) || value.count < 1 || value.count > 200 ||
        !Array.isArray(value.excluded) || value.excluded.length > 10000 || !value.excluded.every(validId) ||
        !/^[0-9a-f]{64}$/i.test(value.poolVersion) ||
        (Object.hasOwn(value, 'source') && !['qr', 'registrations'].includes(value.source)) ||
        (value.source === 'registrations' && ['loyaltyBonus', 'checkinBonus'].some(key => value[key] !== false)) ||
        ['loyaltyBonus', 'checkedInOnly', 'checkinBonus'].some(key => Object.hasOwn(value, key) && typeof value[key] !== 'boolean')) {
      sessionStorage.removeItem(PENDING_KEY); return null;
    }
    // Recover only the request identity and selection. Names never enter browser storage.
    return { requestId: value.requestId, eventId: value.eventId, count: value.count, excluded: value.excluded, poolVersion: value.poolVersion,
      ...(Object.hasOwn(value, 'source') ? { source: value.source } : {}),
      ...Object.fromEntries(['loyaltyBonus', 'checkedInOnly', 'checkinBonus'].filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]])) };
  } catch { return null; }
}
function clearPending() {
  pending = null;
  pendingStored = true;
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* Memory state remains authoritative for this page. */ }
}
function verifyOutcome(result, selection) {
  const draw = result?.draw;
  const winners = draw?.winners, pool = draw?.participants;
  if (!draw || draw.id !== selection.requestId || draw.eventId !== selection.eventId || draw.poolVersion !== selection.poolVersion ||
      !['qr', 'registrations'].includes(sourceOf(draw)) || sourceOf(draw) !== sourceOf(selection) ||
      (Object.hasOwn(draw, 'loyaltyBonus') && typeof draw.loyaltyBonus !== 'boolean') ||
      (draw.loyaltyBonus !== false) !== (selection.loyaltyBonus !== false) ||
      ['checkedInOnly', 'checkinBonus'].some(key => (Object.hasOwn(draw, key) && typeof draw[key] !== 'boolean') || (draw[key] === true) !== (selection[key] === true)) ||
      !Array.isArray(winners) || winners.length !== selection.count || !Array.isArray(pool) ||
      [...winners, ...pool].some(person => !person || typeof person.id !== 'string' || typeof person.name !== 'string' ||
        !Number.isInteger(person.weight) || person.weight < 1 || !Number.isInteger(person.previous) || person.previous < 0 ||
        person.weight !== (draw.loyaltyBonus === false ? 1 : person.previous + 1)) ||
      new Set(winners.map(person => person.id)).size !== winners.length ||
      (sourceOf(draw) === 'registrations' && (draw.loyaltyBonus !== false || draw.checkinBonus === true || [...winners, ...pool].some(person => person.previous !== 0 || person.weight !== 1))) ||
      winners.some(person => selection.excluded.includes(person.id) || !pool.some(participant => participant.id === person.id &&
        participant.weight === person.weight && participant.previous === person.previous))) {
    throw new Error('Kaydedilmiş çekiliş sonucu doğrulanamadı.');
  }
  return drawView(draw);
}
function feedback(message, error = false) {
  $('raffleStatus').textContent = message + (pending && !pendingStored ? ' Tarayıcı isteği saklayamadı; sonuç doğrulanana kadar sayfayı yenilemeyin veya kapatmayın.' : '');
  $('raffleStatus').dataset.error = String(error);
}
async function request(method, data, query) {
  const params = query || (method === 'GET' ? { eventId: eventSelect.value } : null);
  const url = '/api/raffles' + (params ? '?' + new URLSearchParams(params) : '');
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(30000) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || 'İşlem tamamlanamadı.');
    error.status = response.status; error.code = result.code; throw error;
  }
  return result;
}
function controls() {
  const locked = busy || !!pending;
  const readonly = !canAdmin('raffles.manage');
  eventSelect.disabled = locked || !ready;
  countInput.disabled = locked || readonly;
  sourceButtons.forEach(button => { button.disabled = locked || !ready; button.setAttribute('aria-pressed', String(button.dataset.source === source)); });
  formFilterButtons.forEach(button => {
    button.disabled = locked || !ready;
    button.setAttribute('aria-pressed', String((button.dataset.checkedIn === 'true') === entryToggle.checked));
  });
  loyaltyToggle.disabled = locked || readonly || source === 'registrations';
  entryToggle.disabled = locked || readonly || source === 'registrations';
  entryBonusToggle.disabled = locked || readonly || source === 'registrations' || !loyaltyToggle.checked;
  $('raffleRefresh').disabled = locked || !eventSelect.value;
  $('raffleSearch').disabled = locked;
  $('raffleIncludeAll').hidden = readonly;
  $('raffleIncludeAll').disabled = locked || readonly || !loaded;
  $('raffleParticipants').querySelectorAll('input').forEach(input => input.disabled = locked || readonly);
  $('raffleHistory').querySelectorAll('button').forEach(button => {
    const mutates = button.hasAttribute('data-delete-draw') || button.hasAttribute('data-prize-draw');
    button.hidden = mutates && readonly; button.disabled = locked || (mutates && readonly);
  });
  $('rafflePresentation').disabled = !ready || !(eventSelect.value || pending || lastDraw);
  start.hidden = readonly;
  start.disabled = !ready || readonly || busy || (!pending && (!loaded || !eventSelect.value || !participants.some(p => !excluded.has(p.id))));
  start.textContent = pending && !busy ? 'Aynı çekiliş sonucunu yeniden sorgula' : 'Çekilişi başlat';
}
function eventTitle(id = eventSelect.value) {
  return events.find(event => event.id === id)?.title || (lastDraw?.eventId === id ? lastDraw.eventTitle : '') || 'Etkinlik çekilişi';
}
function stageTitle() {
  const title = lastDraw?.eventTitle || eventTitle(pending?.eventId);
  $('raffleStageEvent').textContent = title;
  $('rafflePresentationTitle').textContent = title;
  const mode = lastDraw || pending || { source, loyaltyBonus: loyaltyToggle.checked, checkedInOnly: entryToggle.checked, checkinBonus: entryBonus() };
  $('raffleStageMode').textContent = modeLabel(mode.loyaltyBonus !== false, mode.checkinBonus === true, mode.checkedInOnly === true, sourceOf(mode));
  if ($('raffleStageSource')) $('raffleStageSource').textContent = sourceLabel(sourceOf(mode), mode.checkedInOnly === true);
}
function modeLabel(loyaltyBonus, checkinBonus = false, checkedInOnly = false, selectedSource = 'qr') {
  const chance = loyaltyBonus ? checkinBonus ? 'Önceki gerçek girişlere ek hak' : 'Önceki katılımlara ek hak' : 'Herkese eşit şans';
  return chance + (checkedInOnly ? selectedSource === 'registrations' ? ' · Kapıda bileti okutulanlar' : ' · Yalnızca giriş yapanlar' : '');
}
function entryBonus() {
  return source === 'qr' && loyaltyToggle.checked && entryBonusToggle.checked;
}
function effectiveWeight(person) {
  return source === 'qr' && loyaltyToggle.checked ? person.weight : 1;
}
function renderMode() {
  const forms = source === 'registrations';
  if ($('raffleRegistrationFilters')) $('raffleRegistrationFilters').hidden = !forms;
  if ($('raffleEntrySetting')) $('raffleEntrySetting').hidden = forms;
  if ($('raffleSourceHelp')) $('raffleSourceHelp').textContent = forms
    ? entryToggle.checked
      ? 'Bu etkinliğin formunu doldurup kişisel bileti kapıda okutulanlar listelenir. Hesap oluşturma veya bileti hesaba ekleme şartı yoktur; her kişi 1 hak kazanır.'
      : 'Bu etkinliğin kayıt formunu dolduranlar listelenir. Hesap oluşturma veya QR ekleme şartı yoktur; her aktif form kaydı 1 hak kazanır.'
    : 'Bu etkinliğin bilet QR kodunu hesabına ekleyenler listelenir. Form kayıtları bu listeye karıştırılmaz.';
  if ($('raffleParticipantsHelp')) $('raffleParticipantsHelp').textContent = forms
    ? 'İşareti kaldırarak bu kaydı yalnızca çekilişten çıkarabilirsiniz. Etkinlik kaydı korunur.'
    : 'İşareti kaldırarak kişiyi yalnızca çekilişten çıkarabilirsiniz. Hesabı ve bileti korunur.';
  document.querySelectorAll('.raffle-chance-setting').forEach(setting => setting.classList.toggle('is-unavailable', forms));
  if (forms) {
    $('raffleLoyaltyHelp').textContent = 'Form çekilişinde herkesin 1 hakkı vardır. Önceki QR katılımları ek hak vermez.';
    $('raffleEntryHelp').textContent = entryToggle.checked
      ? 'Yalnızca bu etkinliğin form kaydına bağlı kişisel bileti kapıda okutulanlar dahil edilir.'
      : 'Form çekilişinde giriş şartı aranmaz; formu dolduranlar dahil edilir.';
    $('raffleCheckinBonusHelp').textContent = 'Gerçek girişlere göre ek hak, QR katılımcıları seçildiğinde kullanılabilir.';
    stageTitle(); controls(); return;
  }
  $('raffleLoyaltyHelp').textContent = loyaltyToggle.checked
    ? `Açık: Her kişi 1 hakla başlar; ${entryBonus() ? 'giriş yaptığı önceki her farklı etkinlik' : 'önceki her farklı etkinlik'} +1 hak verir.`
    : 'Kapalı: Önceki katılımlardan bağımsız olarak herkesin 1 hakkı olur.';
  $('raffleEntryHelp').textContent = entryToggle.checked
    ? 'Yalnızca biletini hesabına ekleyen ve bu etkinliğe giriş yaptığı kaydedilen kişiler katılır.'
    : 'Etkinliğin biletini hesabına ekleyen herkes katılır; giriş şartı aranmaz.';
  $('raffleCheckinBonusHelp').textContent = entryBonus()
    ? 'Ek hak için önceki etkinliklerde görevli tarafından kaydedilmiş girişler sayılır.'
    : 'Ek hak için önceki etkinliklerin hesaba eklenmiş biletleri sayılır. Ek hak kapalıyken herkes eşittir.';
  stageTitle();
}
function claimDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) : '';
}
function renderParticipants() {
  const list = $('raffleParticipants'), scroll = list.scrollTop;
  const focused = list.contains(document.activeElement) ? document.activeElement.dataset.person : null;
  const search = $('raffleSearch').value.toLocaleLowerCase('tr');
  const included = participants.filter(person => !excluded.has(person.id));
  $('raffleSummary').textContent = `${included.length} kişi dahil · ${included.reduce((sum, person) => sum + effectiveWeight(person), 0)} toplam hak · ${excluded.size} kişi hariç` + (source === 'registrations' && entryToggle.checked ? ' · Kapıda bileti okutulanlar' : '');
  countInput.max = String(Math.min(200, included.length || 1));
  const filtered = participants.filter(person => person.name.toLocaleLowerCase('tr').includes(search));
  list.innerHTML = filtered.map(person =>
    `<label class="raffle-person ${excluded.has(person.id) ? 'is-excluded' : ''}"><input type="checkbox" data-person="${escape(person.id)}" ${excluded.has(person.id) ? '' : 'checked'}><span><strong>${escape(person.name)}</strong><small>${source === 'registrations' ? 'Form kaydı · 1 hak' : `${person.previous} önceki ${entryBonus() ? 'gerçek giriş' : 'etkinlik'} · ${effectiveWeight(person)} hak`}</small><small>${escape(claimDate(source === 'registrations' ? person.createdAt : person.claimedAt))}</small>${source === 'registrations' && entryToggle.checked ? `<small>Kapıda okutuldu${person.enteredAt ? ` · ${escape(claimDate(person.enteredAt))}` : ''}</small>` : ''}</span><span class="raffle-weight">×${effectiveWeight(person)}</span></label>`
  ).join('') || (participants.length ? '<p class="raffle-empty">Aramanızla eşleşen katılımcı bulunamadı.</p>' : `<p class="raffle-empty">${source === 'registrations' ? entryToggle.checked ? 'Bu etkinlikte henüz kişisel bileti kapıda okutulmuş aktif form kaydı bulunmuyor.' : 'Bu etkinlikte henüz aktif form kaydı bulunmuyor.' : entryToggle.checked ? 'Biletini hesabına ekleyip etkinliğe giriş yapan kişiler burada görünür.' : 'Bu etkinliğin biletini hesabına ekleyenler burada görünür.'}</p>`);
  controls();
  if (focused) [...list.querySelectorAll('input')].find(input => input.dataset.person === focused)?.focus({ preventScroll: true });
  list.scrollTop = scroll;
}
function winnerList(winners, draw = null, withPrize = false) {
  return '<ol class="raffle-winners">' + winners.map((person, index) => `<li><span>${index + 1}</span><div><strong>${escape(person.name)}</strong><small>${sourceOf(draw) === 'registrations' ? 'Form kaydı · 1 hak' : `${person.weight} hak · ${person.previous} önceki ${draw?.checkinBonus === true ? 'gerçek giriş' : 'etkinlik'}`}</small>${withPrize ? `<small class="raffle-prize-status">${person.prizeDelivered === true ? `Ödül teslim edildi · ${escape(claimDate(person.prizeDeliveredAt))}` : 'Ödül teslim bekliyor'}</small><button type="button" data-prize-draw="${escape(draw.id)}" data-prize-winner="${escape(person.id)}" data-prize-delivered="${person.prizeDelivered !== true}">${person.prizeDelivered === true ? 'Teslim işaretini kaldır' : 'Ödül teslim edildi olarak işaretle'}</button>` : ''}</div></li>`).join('') + '</ol>';
}
function renderHistory() {
  $('raffleHistory').innerHTML = draws.map(draw => `<article class="raffle-history-card"><div class="raffle-history-heading"><div><span class="raffle-source-badge">${sourceLabel(sourceOf(draw), draw.checkedInOnly === true)}</span><h4>${escape(draw.eventTitle)}</h4><p>${escape(claimDate(draw.createdAt))} · ${draw.participants.length} kişi · ${draw.winners.length} kazanan</p><p class="raffle-mode">${modeLabel(draw.loyaltyBonus !== false, draw.checkinBonus === true, draw.checkedInOnly === true, sourceOf(draw))}</p></div><div class="raffle-history-actions"><button type="button" data-export-draw="${escape(draw.id)}">Kazananları indir (CSV)</button><button type="button" data-delete-draw="${escape(draw.id)}">Çekilişi sil</button></div></div>${winnerList(draw.winners, draw, true)}</article>`).join('') || '<p class="raffle-empty">Bu etkinlik için henüz çekiliş yapılmadı.</p>';
  controls();
}
function populateCatalog() {
  const previous = pending?.eventId || eventSelect.value;
  eventSelect.innerHTML = events.map(event => `<option value="${escape(event.id)}">${escape(event.title)}</option>`).join('');
  if (pending && !events.some(event => event.id === previous)) {
    const option = new Option('Arşivlenmiş etkinlik · Sonucu kurtar', previous);
    eventSelect.append(option);
  }
  if ([...eventSelect.options].some(option => option.value === previous)) eventSelect.value = previous;
  if (pending) countInput.value = String(pending.count);
  stageTitle(); controls();
}
async function load({ keepResults = false } = {}) {
  if (!ready || !active || !canAdmin('raffles.view') || busy || pending) return;
  const current = ++version, eventId = eventSelect.value, selectedSource = source;
  const sameEvent = eventId === loadedEventId && selectedSource === loadedSource;
  loadedEventId = eventId; loadedSource = selectedSource; loaded = false; poolVersion = null;
  participants = []; draws = [];
  if (!sameEvent) { excluded.clear(); $('raffleSearch').value = ''; }
  if (!keepResults) {
    lastDraw = null; $('raffleResults').innerHTML = '';
    $('raffleStageName').textContent = 'Sıradaki şanslı kim?';
    $('raffleStage').classList.remove('is-drawing', 'is-celebrating');
  }
  renderParticipants(); renderHistory(); stageTitle();
  if (!eventId) { excluded.clear(); renderParticipants(); feedback('Çekiliş için önce bir etkinlik oluşturun.'); return; }
  feedback(selectedSource === 'registrations' ? entryToggle.checked ? 'Form kaydı olup bileti kapıda okutulanlar yükleniyor…' : 'Kayıt formunu dolduranlar yükleniyor…' : 'Biletini hesabına ekleyen katılımcılar yükleniyor…');
  try {
    const modes = { checkedInOnly: entryToggle.checked, checkinBonus: entryBonus() };
    const data = await request('GET', null, { eventId, source: selectedSource, ...modes });
    if (!ready || current !== version || eventId !== eventSelect.value || selectedSource !== source) return;
    if (!Array.isArray(data.participants) || !Array.isArray(data.draws) || !/^[0-9a-f]{64}$/i.test(data.poolVersion) ||
        sourceOf(data) !== selectedSource ||
        data.checkedInOnly !== modes.checkedInOnly || data.checkinBonus !== modes.checkinBonus) throw new Error('Katılımcı listesi doğrulanamadı. Listeyi yeniden yükleyin.');
    participants = data.participants.map(personView); draws = data.draws.map(drawView); poolVersion = data.poolVersion; loaded = true;
    excluded = new Set([...excluded].filter(id => participants.some(person => person.id === id)));
    renderParticipants(); renderHistory(); feedback('Katılımcı seçimini ve kazanan sayısını ayarlayıp çekilişi başlatabilirsiniz.');
  } catch (error) {
    if (!ready || current !== version || eventId !== eventSelect.value || selectedSource !== source) return;
    feedback(error.message, true);
    // Reading saved outcomes must remain possible if the live participant database is unavailable.
    try {
      const history = await request('GET', null, { action: 'history', eventId });
      if (!ready || current !== version || eventId !== eventSelect.value || selectedSource !== source) return;
      if (Array.isArray(history.draws)) { draws = history.draws.map(drawView); renderHistory(); }
    } catch { /* Keep the original participant error and drawing disabled. */ }
  }
  controls();
}
function receiveCatalog(catalog) {
  events = Array.isArray(catalog) ? catalog : [];
  if (busy || pending) {
    queuedCatalog = events;
    if (pending) populateCatalog();
    return;
  }
  populateCatalog(); if (ready && active) load();
}
function finishCatalog() {
  if (pending || queuedCatalog === null) return;
  const previous = eventSelect.value;
  events = queuedCatalog; queuedCatalog = null;
  populateCatalog();
  if (eventSelect.value !== previous || !eventSelect.value) load({ keepResults: !!lastDraw });
}
onAdminEvent('events-loaded', event => receiveCatalog(event.detail));
onAdminEvent('admin-ready', () => {
  ready = canAdmin('raffles.view');
  if (!canAdmin('raffles.manage')) clearPending();
  if (ready && pending) {
    excluded = new Set(pending.excluded);
    loadedEventId = pending.eventId; loadedSource = sourceOf(pending);
    populateCatalog();
    feedback('Önceki çekilişin sonucu henüz doğrulanmadı. Aynı çekiliş sonucunu yeniden sorgulayın; yeni çekiliş oluşturulmaz.', true);
  } else if (ready && active) load();
  controls();
});
document.addEventListener('admin-tab', event => {
  active = event.detail === 'raffles' && canAdmin('raffles.view');
  if (active && ready && !loaded) load();
});
eventSelect.addEventListener('change', () => load());
sourceButtons.forEach(button => button.addEventListener('click', () => {
  const next = button.dataset.source;
  if (!ready || busy || pending || next === source || !['qr', 'registrations'].includes(next)) return;
  if (source === 'qr') qrSettings = { loyaltyBonus: loyaltyToggle.checked, checkedInOnly: entryToggle.checked, checkinBonus: entryBonusToggle.checked };
  else formCheckedInOnly = entryToggle.checked;
  source = next;
  loyaltyToggle.checked = source === 'qr' && qrSettings.loyaltyBonus;
  entryToggle.checked = source === 'qr' ? qrSettings.checkedInOnly : formCheckedInOnly;
  entryBonusToggle.checked = source === 'qr' && qrSettings.checkinBonus;
  try { sessionStorage.setItem(SOURCE_KEY, source); } catch { /* Selection still works for this page. */ }
  excluded.clear(); $('raffleSearch').value = '';
  renderMode(); load();
}));
formFilterButtons.forEach(button => button.addEventListener('click', () => {
  const checked = button.dataset.checkedIn === 'true';
  if (!ready || !active || busy || pending || source !== 'registrations' || checked === entryToggle.checked) return;
  formCheckedInOnly = entryToggle.checked = checked;
  excluded.clear(); $('raffleSearch').value = '';
  renderMode(); load();
}));
$('raffleRefresh').addEventListener('click', () => load());
$('raffleSearch').addEventListener('input', renderParticipants);
$('raffleIncludeAll').addEventListener('click', () => { if (!ready || !canAdmin('raffles.manage')) return; excluded.clear(); renderParticipants(); });
loyaltyToggle.addEventListener('change', () => {
  if (!ready || !canAdmin('raffles.manage') || busy || pending) return;
  renderMode(); renderParticipants();
  if (entryBonusToggle.checked) load({ keepResults: !!lastDraw });
});
for (const toggle of [entryToggle, entryBonusToggle]) toggle.addEventListener('change', () => {
  if (!ready || !canAdmin('raffles.manage') || busy || pending) return;
  renderMode(); load({ keepResults: !!lastDraw });
});
$('raffleParticipants').addEventListener('change', event => {
  const id = event.target.dataset.person;
  if (!ready || !canAdmin('raffles.manage') || !id || busy || pending) return;
  if (event.target.checked) excluded.delete(id); else excluded.add(id);
  renderParticipants();
});
start.addEventListener('click', async () => {
  if (!ready || !active || !canAdmin('raffles.manage') || busy) return;
  const retry = !!pending;
  if (!pending) {
    const count = Number(countInput.value), included = participants.filter(person => !excluded.has(person.id));
    if (!loaded || !eventSelect.value || !poolVersion || !Number.isInteger(count) || count < 1 || count > Math.min(200, included.length)) {
      feedback('Kazanan sayısı 1 ile dahil edilen kişi sayısı arasında olmalı (en fazla 200).', true); return;
    }
    const payload = { requestId: crypto.randomUUID(), eventId: eventSelect.value, source, count, excluded: [...excluded], poolVersion, loyaltyBonus: loyaltyToggle.checked, checkedInOnly: entryToggle.checked, checkinBonus: entryBonus() };
    if (new TextEncoder().encode(JSON.stringify(payload)).length > 100000) {
      feedback('Hariç tutulan kişi listesi çok büyük. Daha az kişiyi hariç tutup yeniden deneyin.', true); return;
    }
    pendingStored = true;
    try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(payload)); }
    catch { pendingStored = false; }
    pending = payload;
  }
  busy = true; controls();
  const current = ++version, selection = pending;
  lastDraw = null; $('raffleResults').innerHTML = ''; stageTitle();
  const stage = $('raffleStage');
  stage.classList.remove('is-celebrating'); stage.classList.add('is-drawing');
  feedback(retry ? 'Kaydedilmiş çekiliş sonucu sorgulanıyor…' : 'Çekiliş yapılıyor…');
  const candidates = participants.filter(person => !selection.excluded.includes(person.id));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let index = 0;
  $('raffleStageName').textContent = reduced ? 'Şanslı isimler seçiliyor…' : candidates[0]?.name || 'Şanslı isimler seçiliyor…';
  const timer = animationTimer = reduced ? null : setInterval(() => {
    $('raffleStageName').textContent = candidates[(index++ * 7 + Math.floor(Math.random() * candidates.length)) % candidates.length]?.name || 'Seçiliyor…';
  }, 90);
  const pause = new Promise(resolve => setTimeout(resolve, 5000));
  try {
    // Retry first reads the saved outcome without depending on the participant database.
    const outcome = async () => {
      if (retry) {
        const saved = await request('GET', null, { action: 'result', eventId: selection.eventId, requestId: selection.requestId });
        if (!ready || current !== version || pending !== selection) return null;
        if (saved.draw === null) return request('POST', selection);
        if (Object.hasOwn(saved, 'draw') && saved.draw) return saved;
        throw new Error('Kaydedilmiş çekiliş sonucu doğrulanamadı.');
      }
      return request('POST', selection);
    };
    const [result] = await Promise.all([outcome(), pause]);
    if (!ready || current !== version || pending !== selection) return;
    const draw = verifyOutcome(result, selection);
    if (timer) clearInterval(timer);
    lastDraw = draw;
    $('raffleStageName').textContent = 'Kazananları tebrik ediyoruz!';
    $('raffleResults').innerHTML = winnerList(draw.winners, draw); stageTitle();
    stage.classList.remove('is-drawing'); stage.classList.add('is-celebrating');
    draws = [draw, ...draws.filter(item => item.id !== draw.id)];
    // Recovery can happen with no live pool loaded, or after authentication
    // cleared private state. Keep the frozen exclusions bound to this source
    // so refreshing the same pool preserves the administrator's selection.
    excluded = new Set(selection.excluded);
    loadedEventId = selection.eventId; loadedSource = sourceOf(selection);
    clearPending(); renderHistory();
    feedback(`${draw.winners.length} kazanan seçildi ve çekiliş geçmişine kaydedildi.`);
  } catch (error) {
    if (!ready || current !== version || pending !== selection) return;
    if (timer) clearInterval(timer);
    stage.classList.remove('is-drawing'); $('raffleStageName').textContent = 'Sonuç gösterilemedi';
    if (terminalCodes.has(error.code)) { clearPending(); loaded = false; poolVersion = null; }
    feedback(error.message + (pending ? ' Sonuç kaydedilmiş olabilir. Aynı çekiliş sonucunu yeniden sorgulayın; yeni çekiliş oluşturulmaz.' : ' Katılımcı listesini yenileyerek devam edebilirsiniz.'), true);
  } finally { if (timer) clearInterval(timer); if (animationTimer === timer) animationTimer = null; if (current === version) { busy = false; finishCatalog(); controls(); } }
});
function csvCell(value) {
  let text = String(value ?? '');
  if (/^\s*[=+\-@]/u.test(text) || /^[\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
function exportWinners(draw) {
  const rows = [['Sıra', 'Ad soyad', 'Katılımcı kimliği', 'Etkinlik', 'Çekiliş tarihi', 'Katılımcı kaynağı', 'Hak', 'Önceki etkinlik', 'Çekiliş kuralı', 'Ödül teslim durumu', 'Ödül teslim tarihi'], ...draw.winners.map((person, index) => [index + 1, person.name, person.id, draw.eventTitle, claimDate(draw.createdAt), sourceLabel(sourceOf(draw), draw.checkedInOnly === true), person.weight, person.previous, modeLabel(draw.loyaltyBonus !== false, draw.checkinBonus === true, draw.checkedInOnly === true, sourceOf(draw)), person.prizeDelivered === true ? 'Teslim edildi' : 'Teslim bekliyor', claimDate(person.prizeDeliveredAt)])];
  const blob = new Blob(['\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `ERCUPSA-kazananlar-${draw.id}.csv`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('raffleHistory').addEventListener('click', async event => {
  if (!ready || !active || !canAdmin('raffles.view')) return;
  const prize = event.target.closest('[data-prize-draw]');
  if (prize && canAdmin('raffles.manage') && !busy && !pending) {
    const current = ++version, eventId = eventSelect.value, id = prize.dataset.prizeDraw, winnerId = prize.dataset.prizeWinner, delivered = prize.dataset.prizeDelivered === 'true';
    const original = draws.find(draw => draw.id === id);
    busy = true; controls();
    try {
      const { draw } = await request('POST', { eventId, id, winnerId, delivered }, { action: 'prize' });
      if (!ready || current !== version || eventId !== eventSelect.value) return;
      if (!draw || draw.id !== id || draw.eventId !== eventId || !Array.isArray(draw.winners) ||
          !Array.isArray(draw.participants) || sourceOf(draw) !== sourceOf(original) ||
          !draw.winners.some(person => person.id === winnerId && (person.prizeDelivered === true) === delivered)) throw new Error('Ödül teslim kaydı doğrulanamadı. Listeyi yenileyin.');
      const saved = drawView(draw);
      draws = draws.map(item => item.id === id ? saved : item);
      if (lastDraw?.id === id) lastDraw = saved;
      renderHistory(); feedback(delivered ? 'Ödül teslim edildi olarak kaydedildi.' : 'Ödül teslim işareti kaldırıldı.');
    } catch (error) { if (ready && current === version) feedback(`${error.message} Gerekirse listeyi yenileyerek kaydı kontrol edin.`, true); }
    finally { if (current === version) { busy = false; finishCatalog(); controls(); } }
    return;
  }
  const exportButton = event.target.closest('[data-export-draw]');
  if (exportButton && !busy && !pending) {
    const draw = draws.find(draw => draw.id === exportButton.dataset.exportDraw);
    if (draw) exportWinners(draw); return;
  }
  const button = event.target.closest('[data-delete-draw]');
  if (!button || !canAdmin('raffles.manage') || busy || pending || !confirm('Bu çekiliş ve kazanan kaydı silinsin mi? Daha sonra yeni bir çekiliş yapabilirsiniz.')) return;
  const current = ++version, eventId = eventSelect.value, id = button.dataset.deleteDraw;
  busy = true; controls();
  try {
    await request('DELETE', { eventId, id });
    if (!ready || current !== version || eventId !== eventSelect.value) return;
    draws = draws.filter(draw => draw.id !== id);
    if (lastDraw?.id === id) {
      lastDraw = null; $('raffleResults').innerHTML = ''; $('raffleStageName').textContent = 'Yeni çekilişe hazır';
      $('raffleStage').classList.remove('is-celebrating'); stageTitle();
    }
    renderHistory(); feedback('Çekiliş silindi. Yeni bir çekiliş başlatabilirsiniz.');
  } catch (error) { if (ready && current === version) feedback(error.message, true); }
  finally { if (current === version) { busy = false; finishCatalog(); controls(); } }
});

const presentation = $('rafflePresentationOverlay'), stage = $('raffleStage');
const movedNodes = [stage, start, $('raffleStatus')];
let presentationOrigin = null, placeholders = [], previousOverflow = '';
function closePresentation() {
  if (!placeholders.length) return;
  for (let index = 0; index < movedNodes.length; index++) placeholders[index].replaceWith(movedNodes[index]);
  placeholders = [];
  document.body.style.overflow = previousOverflow;
  if (presentation.open) presentation.close();
  presentationOrigin?.focus({ preventScroll: true });
}
$('rafflePresentation').addEventListener('click', () => {
  if (!ready || !active || !canAdmin('raffles.view') || presentation.open) return;
  presentationOrigin = document.activeElement;
  previousOverflow = document.body.style.overflow;
  placeholders = movedNodes.map(node => {
    const marker = document.createComment('raffle-presentation-home');
    node.before(marker); $('rafflePresentationContent').append(node); return marker;
  });
  stageTitle(); document.body.style.overflow = 'hidden'; presentation.showModal();
  $('rafflePresentationExit').focus();
});
$('rafflePresentationExit').addEventListener('click', closePresentation);
presentation.addEventListener('cancel', event => { event.preventDefault(); closePresentation(); });
presentation.addEventListener('close', closePresentation);
document.addEventListener('admin-logout', event => {
  version++; ready = active = loaded = busy = false;
  if (animationTimer) clearInterval(animationTimer);
  animationTimer = null;
  closePresentation();
  events = []; participants = []; draws = []; excluded.clear();
  queuedCatalog = lastDraw = null; loadedEventId = loadedSource = ''; poolVersion = null;
  // An expired cookie can precede login after refresh or an uncertain save.
  // Keep only the anonymous request identity to recover the same saved draw.
  if (!['initial-session-probe', 'session-expired'].includes(event.detail?.reason)) {
    clearPending(); source = 'qr';
    try { sessionStorage.removeItem(SOURCE_KEY); } catch { /* No private data is stored here. */ }
    qrSettings = { loyaltyBonus: true, checkedInOnly: false, checkinBonus: false };
    formCheckedInOnly = false;
    loyaltyToggle.checked = true; entryToggle.checked = entryBonusToggle.checked = false;
  }
  eventSelect.replaceChildren(); $('raffleSearch').value = '';
  $('raffleResults').replaceChildren(); $('raffleStageName').textContent = 'Sıradaki şanslı kim?';
  stage.classList.remove('is-drawing', 'is-celebrating');
  renderMode(); renderParticipants(); renderHistory(); feedback(''); controls();
});
renderMode();
controls();
