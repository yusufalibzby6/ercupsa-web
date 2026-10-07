import { $, escape, onAdminEvent } from './common.js';

const PENDING_KEY = 'ercupsa_raffle_pending_v1';
const terminalCodes = new Set(['RAFFLE_POOL_REQUIRED', 'RAFFLE_POOL_CHANGED', 'RAFFLE_INVALID_SELECTION', 'RAFFLE_DRAW_DELETED', 'RAFFLE_REQUEST_CONFLICT']);
const eventSelect = $('raffleEvent'), countInput = $('raffleCount'), start = $('raffleStart'), loyaltyToggle = $('raffleLoyaltyBonus');
const entryToggle = $('raffleCheckedInOnly'), entryBonusToggle = $('raffleCheckinBonus');
let events = [], participants = [], draws = [], excluded = new Set();
let ready = false, loaded = false, busy = false, version = 0, loadedEventId = '', poolVersion = null;
let queuedCatalog = null, lastDraw = null, pending = recoverPending(), pendingStored = true;
if (pending) {
  excluded = new Set(pending.excluded);
  loadedEventId = pending.eventId;
  loyaltyToggle.checked = pending.loyaltyBonus !== false;
  entryToggle.checked = pending.checkedInOnly === true;
  entryBonusToggle.checked = pending.checkinBonus === true;
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
        ['loyaltyBonus', 'checkedInOnly', 'checkinBonus'].some(key => Object.hasOwn(value, key) && typeof value[key] !== 'boolean')) {
      sessionStorage.removeItem(PENDING_KEY); return null;
    }
    // Recover only the request identity and selection. Names never enter browser storage.
    return { requestId: value.requestId, eventId: value.eventId, count: value.count, excluded: value.excluded, poolVersion: value.poolVersion,
      ...Object.fromEntries(['loyaltyBonus', 'checkedInOnly', 'checkinBonus'].filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]])) };
  } catch { return null; }
}
function clearPending() {
  pending = null;
  pendingStored = true;
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* Memory state remains authoritative for this page. */ }
}
function verifyOutcome(result) {
  const draw = result?.draw;
  const winners = draw?.winners, pool = draw?.participants;
  if (!draw || draw.id !== pending.requestId || draw.eventId !== pending.eventId || draw.poolVersion !== pending.poolVersion ||
      (Object.hasOwn(draw, 'loyaltyBonus') && typeof draw.loyaltyBonus !== 'boolean') ||
      (draw.loyaltyBonus !== false) !== (pending.loyaltyBonus !== false) ||
      ['checkedInOnly', 'checkinBonus'].some(key => (Object.hasOwn(draw, key) && typeof draw[key] !== 'boolean') || (draw[key] === true) !== (pending[key] === true)) ||
      !Array.isArray(winners) || winners.length !== pending.count || !Array.isArray(pool) ||
      [...winners, ...pool].some(person => !person || typeof person.id !== 'string' || typeof person.name !== 'string' ||
        !Number.isInteger(person.weight) || person.weight < 1 || !Number.isInteger(person.previous) || person.previous < 0 ||
        person.weight !== (draw.loyaltyBonus === false ? 1 : person.previous + 1)) ||
      new Set(winners.map(person => person.id)).size !== winners.length ||
      winners.some(person => pending.excluded.includes(person.id) || !pool.some(participant => participant.id === person.id &&
        participant.weight === person.weight && participant.previous === person.previous))) {
    throw new Error('Kaydedilmiş çekiliş sonucu doğrulanamadı.');
  }
  return draw;
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
  eventSelect.disabled = locked;
  countInput.disabled = locked;
  loyaltyToggle.disabled = locked;
  entryToggle.disabled = locked;
  entryBonusToggle.disabled = locked || !loyaltyToggle.checked;
  $('raffleRefresh').disabled = locked || !eventSelect.value;
  $('raffleSearch').disabled = locked;
  $('raffleIncludeAll').disabled = locked || !loaded;
  $('raffleParticipants').querySelectorAll('input').forEach(input => input.disabled = locked);
  $('raffleHistory').querySelectorAll('button').forEach(button => button.disabled = locked);
  $('rafflePresentation').disabled = !ready || !(eventSelect.value || pending || lastDraw);
  start.disabled = busy || (!pending && (!loaded || !eventSelect.value || !participants.some(p => !excluded.has(p.id))));
  start.textContent = pending && !busy ? 'Aynı çekiliş sonucunu yeniden sorgula' : 'Çekilişi başlat';
}
function eventTitle(id = eventSelect.value) {
  return events.find(event => event.id === id)?.title || (lastDraw?.eventId === id ? lastDraw.eventTitle : '') || 'Etkinlik çekilişi';
}
function stageTitle() {
  const title = lastDraw?.eventTitle || eventTitle(pending?.eventId);
  $('raffleStageEvent').textContent = title;
  $('rafflePresentationTitle').textContent = title;
  const mode = lastDraw || pending || { loyaltyBonus: loyaltyToggle.checked, checkedInOnly: entryToggle.checked, checkinBonus: entryBonus() };
  $('raffleStageMode').textContent = modeLabel(mode.loyaltyBonus !== false, mode.checkinBonus === true, mode.checkedInOnly === true);
}
function modeLabel(loyaltyBonus, checkinBonus = false, checkedInOnly = false) {
  const chance = loyaltyBonus ? checkinBonus ? 'Önceki gerçek girişlere ek hak' : 'Önceki katılımlara ek hak' : 'Herkese eşit şans';
  return chance + (checkedInOnly ? ' · Yalnızca giriş yapanlar' : '');
}
function entryBonus() {
  return loyaltyToggle.checked && entryBonusToggle.checked;
}
function effectiveWeight(person) {
  return loyaltyToggle.checked ? person.weight : 1;
}
function renderMode() {
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
  $('raffleSummary').textContent = `${included.length} kişi dahil · ${included.reduce((sum, person) => sum + effectiveWeight(person), 0)} toplam hak · ${excluded.size} kişi hariç`;
  countInput.max = String(Math.min(200, included.length || 1));
  const filtered = participants.filter(person => person.name.toLocaleLowerCase('tr').includes(search));
  list.innerHTML = filtered.map(person =>
    `<label class="raffle-person ${excluded.has(person.id) ? 'is-excluded' : ''}"><input type="checkbox" data-person="${escape(person.id)}" ${excluded.has(person.id) ? '' : 'checked'}><span><strong>${escape(person.name)}</strong><small>${person.previous} önceki ${entryBonus() ? 'gerçek giriş' : 'etkinlik'} · ${effectiveWeight(person)} hak</small><small>${escape(claimDate(person.claimedAt))}</small></span><span class="raffle-weight">×${effectiveWeight(person)}</span></label>`
  ).join('') || (participants.length ? '<p>Aramanızla eşleşen katılımcı bulunamadı.</p>' : `<p>${entryToggle.checked ? 'Biletini hesabına ekleyip etkinliğe giriş yapan kişiler burada görünür.' : 'Bu etkinliğin biletini hesabına ekleyenler burada görünür.'}</p>`);
  controls();
  if (focused) [...list.querySelectorAll('input')].find(input => input.dataset.person === focused)?.focus({ preventScroll: true });
  list.scrollTop = scroll;
}
function winnerList(winners, draw = null, withPrize = false) {
  return '<ol class="raffle-winners">' + winners.map((person, index) => `<li><span>${index + 1}</span><div><strong>${escape(person.name)}</strong><small>${person.weight} hak · ${person.previous} önceki ${draw?.checkinBonus === true ? 'gerçek giriş' : 'etkinlik'}</small>${withPrize ? `<small class="raffle-prize-status">${person.prizeDelivered === true ? `Ödül teslim edildi · ${escape(claimDate(person.prizeDeliveredAt))}` : 'Ödül teslim bekliyor'}</small><button type="button" data-prize-draw="${escape(draw.id)}" data-prize-winner="${escape(person.id)}" data-prize-delivered="${person.prizeDelivered !== true}">${person.prizeDelivered === true ? 'Teslim işaretini kaldır' : 'Ödül teslim edildi olarak işaretle'}</button>` : ''}</div></li>`).join('') + '</ol>';
}
function renderHistory() {
  $('raffleHistory').innerHTML = draws.map(draw => `<article class="raffle-history-card"><div class="raffle-history-heading"><div><h4>${escape(draw.eventTitle)}</h4><p>${escape(claimDate(draw.createdAt))} · ${draw.participants.length} kişi · ${draw.winners.length} kazanan</p><p class="raffle-mode">${modeLabel(draw.loyaltyBonus !== false, draw.checkinBonus === true, draw.checkedInOnly === true)}</p></div><div class="raffle-history-actions"><button type="button" data-export-draw="${escape(draw.id)}">Kazananları indir (CSV)</button><button type="button" data-delete-draw="${escape(draw.id)}">Çekilişi sil</button></div></div>${winnerList(draw.winners, draw, true)}</article>`).join('') || '<p>Bu etkinlik için henüz çekiliş yapılmadı.</p>';
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
  if (!ready || busy || pending) return;
  const current = ++version, eventId = eventSelect.value;
  const sameEvent = eventId === loadedEventId;
  loadedEventId = eventId; loaded = false; poolVersion = null;
  participants = []; draws = [];
  if (!sameEvent) { excluded.clear(); $('raffleSearch').value = ''; }
  if (!keepResults) {
    lastDraw = null; $('raffleResults').innerHTML = '';
    $('raffleStageName').textContent = 'Sıradaki şanslı kim?';
    $('raffleStage').classList.remove('is-drawing', 'is-celebrating');
  }
  renderParticipants(); renderHistory(); stageTitle();
  if (!eventId) { excluded.clear(); renderParticipants(); feedback('Çekiliş için önce bir etkinlik oluşturun.'); return; }
  feedback('Biletini hesabına ekleyen katılımcılar yükleniyor…');
  try {
    const modes = { checkedInOnly: entryToggle.checked, checkinBonus: entryBonus() };
    const data = await request('GET', null, { eventId, ...modes });
    if (current !== version || eventId !== eventSelect.value) return;
    if (!Array.isArray(data.participants) || !Array.isArray(data.draws) || !/^[0-9a-f]{64}$/i.test(data.poolVersion) ||
        data.checkedInOnly !== modes.checkedInOnly || data.checkinBonus !== modes.checkinBonus) throw new Error('Katılımcı listesi doğrulanamadı. Listeyi yeniden yükleyin.');
    participants = data.participants; draws = data.draws; poolVersion = data.poolVersion; loaded = true;
    excluded = new Set([...excluded].filter(id => participants.some(person => person.id === id)));
    renderParticipants(); renderHistory(); feedback('Katılımcı seçimini ve kazanan sayısını ayarlayıp çekilişi başlatabilirsiniz.');
  } catch (error) {
    if (current !== version || eventId !== eventSelect.value) return;
    feedback(error.message, true);
    // Reading saved outcomes must remain possible if the live participant database is unavailable.
    try {
      const history = await request('GET', null, { action: 'history', eventId });
      if (current !== version || eventId !== eventSelect.value) return;
      if (Array.isArray(history.draws)) { draws = history.draws; renderHistory(); }
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
  populateCatalog(); load();
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
  ready = true;
  if (pending) {
    populateCatalog();
    feedback('Önceki çekilişin sonucu henüz doğrulanmadı. Aynı çekiliş sonucunu yeniden sorgulayın; yeni çekiliş oluşturulmaz.', true);
  } else load();
  controls();
});
eventSelect.addEventListener('change', () => load());
$('raffleRefresh').addEventListener('click', () => load());
$('raffleSearch').addEventListener('input', renderParticipants);
$('raffleIncludeAll').addEventListener('click', () => { excluded.clear(); renderParticipants(); });
loyaltyToggle.addEventListener('change', () => {
  if (busy || pending) return;
  renderMode(); renderParticipants();
  if (entryBonusToggle.checked) load({ keepResults: !!lastDraw });
});
for (const toggle of [entryToggle, entryBonusToggle]) toggle.addEventListener('change', () => {
  if (busy || pending) return;
  renderMode(); load({ keepResults: !!lastDraw });
});
$('raffleParticipants').addEventListener('change', event => {
  const id = event.target.dataset.person;
  if (!id || busy || pending) return;
  if (event.target.checked) excluded.delete(id); else excluded.add(id);
  renderParticipants();
});
start.addEventListener('click', async () => {
  if (busy) return;
  const retry = !!pending;
  if (!pending) {
    const count = Number(countInput.value), included = participants.filter(person => !excluded.has(person.id));
    if (!loaded || !eventSelect.value || !poolVersion || !Number.isInteger(count) || count < 1 || count > Math.min(200, included.length)) {
      feedback('Kazanan sayısı 1 ile dahil edilen kişi sayısı arasında olmalı (en fazla 200).', true); return;
    }
    const payload = { requestId: crypto.randomUUID(), eventId: eventSelect.value, count, excluded: [...excluded], poolVersion, loyaltyBonus: loyaltyToggle.checked, checkedInOnly: entryToggle.checked, checkinBonus: entryBonus() };
    if (new TextEncoder().encode(JSON.stringify(payload)).length > 100000) {
      feedback('Hariç tutulan kişi listesi çok büyük. Daha az kişiyi hariç tutup yeniden deneyin.', true); return;
    }
    pendingStored = true;
    try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(payload)); }
    catch { pendingStored = false; }
    pending = payload;
  }
  busy = true; controls(); version++;
  lastDraw = null; $('raffleResults').innerHTML = ''; stageTitle();
  const stage = $('raffleStage');
  stage.classList.remove('is-celebrating'); stage.classList.add('is-drawing');
  feedback(retry ? 'Kaydedilmiş çekiliş sonucu sorgulanıyor…' : 'Çekiliş yapılıyor…');
  const candidates = participants.filter(person => !pending.excluded.includes(person.id));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let index = 0;
  $('raffleStageName').textContent = reduced ? 'Şanslı isimler seçiliyor…' : candidates[0]?.name || 'Şanslı isimler seçiliyor…';
  const timer = reduced ? null : setInterval(() => {
    $('raffleStageName').textContent = candidates[(index++ * 7 + Math.floor(Math.random() * candidates.length)) % candidates.length]?.name || 'Seçiliyor…';
  }, 90);
  const pause = new Promise(resolve => setTimeout(resolve, 5000));
  try {
    // Retry first reads the saved outcome without depending on the participant database.
    const outcome = async () => {
      if (retry) {
        const saved = await request('GET', null, { action: 'result', eventId: pending.eventId, requestId: pending.requestId });
        if (saved.draw === null) return request('POST', pending);
        if (Object.hasOwn(saved, 'draw') && saved.draw) return saved;
        throw new Error('Kaydedilmiş çekiliş sonucu doğrulanamadı.');
      }
      return request('POST', pending);
    };
    const [result] = await Promise.all([outcome(), pause]);
    verifyOutcome(result);
    if (timer) clearInterval(timer);
    lastDraw = result.draw;
    $('raffleStageName').textContent = 'Kazananları tebrik ediyoruz!';
    $('raffleResults').innerHTML = winnerList(result.draw.winners, result.draw); stageTitle();
    stage.classList.remove('is-drawing'); stage.classList.add('is-celebrating');
    draws = [result.draw, ...draws.filter(draw => draw.id !== result.draw.id)];
    clearPending(); renderHistory();
    feedback(`${result.draw.winners.length} kazanan seçildi ve çekiliş geçmişine kaydedildi.`);
  } catch (error) {
    if (timer) clearInterval(timer);
    stage.classList.remove('is-drawing'); $('raffleStageName').textContent = 'Sonuç gösterilemedi';
    if (terminalCodes.has(error.code)) { clearPending(); loaded = false; poolVersion = null; }
    feedback(error.message + (pending ? ' Sonuç kaydedilmiş olabilir. Aynı çekiliş sonucunu yeniden sorgulayın; yeni çekiliş oluşturulmaz.' : ' Katılımcı listesini yenileyerek devam edebilirsiniz.'), true);
  } finally { busy = false; finishCatalog(); controls(); }
});
function csvCell(value) {
  let text = String(value ?? '');
  if (/^\s*[=+\-@]/u.test(text) || /^[\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
function exportWinners(draw) {
  const rows = [['Sıra', 'Ad soyad', 'Katılımcı kimliği', 'Etkinlik', 'Çekiliş tarihi', 'Hak', 'Önceki etkinlik', 'Çekiliş kuralı', 'Ödül teslim durumu', 'Ödül teslim tarihi'], ...draw.winners.map((person, index) => [index + 1, person.name, person.id, draw.eventTitle, claimDate(draw.createdAt), person.weight, person.previous, modeLabel(draw.loyaltyBonus !== false, draw.checkinBonus === true, draw.checkedInOnly === true), person.prizeDelivered === true ? 'Teslim edildi' : 'Teslim bekliyor', claimDate(person.prizeDeliveredAt)])];
  const blob = new Blob(['\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `ERCUPSA-kazananlar-${draw.id}.csv`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('raffleHistory').addEventListener('click', async event => {
  const prize = event.target.closest('[data-prize-draw]');
  if (prize && !busy && !pending) {
    const eventId = eventSelect.value, id = prize.dataset.prizeDraw, winnerId = prize.dataset.prizeWinner, delivered = prize.dataset.prizeDelivered === 'true';
    busy = true; controls();
    try {
      const { draw } = await request('POST', { eventId, id, winnerId, delivered }, { action: 'prize' });
      if (!draw || draw.id !== id || draw.eventId !== eventId || !Array.isArray(draw.winners) ||
          !draw.winners.some(person => person.id === winnerId && (person.prizeDelivered === true) === delivered)) throw new Error('Ödül teslim kaydı doğrulanamadı. Listeyi yenileyin.');
      draws = draws.map(item => item.id === id ? draw : item);
      if (lastDraw?.id === id) lastDraw = draw;
      renderHistory(); feedback(delivered ? 'Ödül teslim edildi olarak kaydedildi.' : 'Ödül teslim işareti kaldırıldı.');
    } catch (error) { feedback(`${error.message} Gerekirse listeyi yenileyerek kaydı kontrol edin.`, true); }
    finally { busy = false; finishCatalog(); controls(); }
    return;
  }
  const exportButton = event.target.closest('[data-export-draw]');
  if (exportButton && !busy && !pending) {
    const draw = draws.find(draw => draw.id === exportButton.dataset.exportDraw);
    if (draw) exportWinners(draw); return;
  }
  const button = event.target.closest('[data-delete-draw]');
  if (!button || busy || pending || !confirm('Bu çekiliş ve kazanan kaydı silinsin mi? Daha sonra yeni bir çekiliş yapabilirsiniz.')) return;
  const eventId = eventSelect.value, id = button.dataset.deleteDraw;
  busy = true; controls();
  try {
    await request('DELETE', { eventId, id });
    draws = draws.filter(draw => draw.id !== id);
    if (lastDraw?.id === id) {
      lastDraw = null; $('raffleResults').innerHTML = ''; $('raffleStageName').textContent = 'Yeni çekilişe hazır';
      $('raffleStage').classList.remove('is-celebrating'); stageTitle();
    }
    renderHistory(); feedback('Çekiliş silindi. Yeni bir çekiliş başlatabilirsiniz.');
  } catch (error) { feedback(error.message, true); }
  finally { busy = false; finishCatalog(); controls(); }
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
  if (presentation.open) return;
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
renderMode();
controls();
