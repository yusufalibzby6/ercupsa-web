import { $, escape } from './common.js';
let events = [], participants = [], draws = [], excluded = new Set();
let ready = false, loaded = false, busy = false, version = 0, pending = null;
const eventSelect = $('raffleEvent'), countInput = $('raffleCount'), start = $('raffleStart');
const feedback = (message, error = false) => {
  $('raffleStatus').textContent = message;
  $('raffleStatus').dataset.error = String(error);
};
async function request(method, data) {
  const url = '/api/raffles' + (method === 'GET' ? '?eventId=' + encodeURIComponent(eventSelect.value) : '');
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || 'İşlem tamamlanamadı.'); error.status = response.status; throw error; }
  return result;
}
function controls() {
  const locked = busy || !!pending;
  eventSelect.disabled = locked;
  countInput.disabled = locked;
  $('raffleRefresh').disabled = locked || !eventSelect.value;
  $('raffleSearch').disabled = locked;
  $('raffleIncludeAll').disabled = locked || !loaded;
  $('raffleParticipants').querySelectorAll('input').forEach(input => input.disabled = locked);
  $('raffleHistory').querySelectorAll('button').forEach(button => button.disabled = locked);
  start.disabled = busy || (!pending && (!loaded || !participants.some(p => !excluded.has(p.id))));
  start.textContent = pending && !busy ? 'Aynı çekiliş sonucunu yeniden sorgula' : 'Çekilişi başlat';
}
function claimDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) : '';
}
function renderParticipants() {
  const search = $('raffleSearch').value.toLocaleLowerCase('tr');
  const included = participants.filter(p => !excluded.has(p.id));
  $('raffleSummary').textContent = `${included.length} kişi dahil · ${included.reduce((s, p) => s + p.weight, 0)} toplam hak · ${excluded.size} kişi hariç`;
  countInput.max = String(Math.min(200, included.length || 1));
  $('raffleParticipants').innerHTML = participants.filter(p => p.name.toLocaleLowerCase('tr').includes(search)).map(p =>
    `<label class="raffle-person ${excluded.has(p.id) ? 'is-excluded' : ''}"><input type="checkbox" data-person="${escape(p.id)}" ${excluded.has(p.id) ? '' : 'checked'}><span><strong>${escape(p.name)}</strong><small>${p.previous} önceki etkinlik · ${p.weight} hak</small><small>${escape(claimDate(p.claimedAt))}</small></span><span class="raffle-weight">×${p.weight}</span></label>`
  ).join('') || '<p>Katılımcı bulunamadı. Bu etkinliğin biletini hesabına ekleyenler burada görünür.</p>';
  controls();
}
function winnerList(winners) {
  return '<ol class="raffle-winners">' + winners.map((p, i) => `<li><span>${i + 1}</span><div><strong>${escape(p.name)}</strong><small>${p.weight} hak · ${p.previous} önceki etkinlik</small></div></li>`).join('') + '</ol>';
}
function renderHistory() {
  $('raffleHistory').innerHTML = draws.map(d => `<article class="raffle-history-card"><div class="raffle-history-heading"><div><h4>${escape(d.eventTitle)}</h4><p>${escape(new Date(d.createdAt).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }))} · ${d.participants.length} kişi · ${d.winners.length} kazanan</p></div><button type="button" data-delete-draw="${escape(d.id)}">Çekilişi sil</button></div>${winnerList(d.winners)}</article>`).join('') || '<p>Bu etkinlik için henüz çekiliş yapılmadı.</p>';
  controls();
}
async function load() {
  if (!ready || !eventSelect.value || busy || pending) return;
  const current = ++version;
  loaded = false; participants = []; draws = []; excluded.clear();
  $('raffleResults').innerHTML = '';
  $('raffleStageName').textContent = 'Sıradaki şanslı kim?';
  renderParticipants(); renderHistory();
  feedback('Biletini hesabına ekleyen katılımcılar yükleniyor…');
  try {
    const data = await request('GET');
    if (current !== version) return;
    participants = data.participants; draws = data.draws; loaded = true;
    renderParticipants(); renderHistory(); feedback('Katılımcı seçimini ve kazanan sayısını ayarlayıp çekilişi başlatabilirsiniz.');
  } catch (error) { if (current === version) feedback(error.message, true); }
  controls();
}
document.addEventListener('admin-ready', () => { ready = true; load(); });
document.addEventListener('events-loaded', event => {
  if (busy || pending) return;
  events = event.detail;
  const previous = eventSelect.value;
  eventSelect.innerHTML = events.map(e => `<option value="${escape(e.id)}">${escape(e.title)}</option>`).join('');
  if (events.some(e => e.id === previous)) eventSelect.value = previous;
  if (!busy && !pending) load();
});
eventSelect.addEventListener('change', load);
$('raffleRefresh').addEventListener('click', load);
$('raffleSearch').addEventListener('input', renderParticipants);
$('raffleIncludeAll').addEventListener('click', () => { excluded.clear(); renderParticipants(); });
$('raffleParticipants').addEventListener('change', event => {
  const id = event.target.dataset.person;
  if (!id || busy || pending) return;
  if (event.target.checked) excluded.delete(id); else excluded.add(id);
  renderParticipants();
});
start.addEventListener('click', async () => {
  if (busy) return;
  if (!pending) {
    const count = Number(countInput.value);
    const included = participants.filter(p => !excluded.has(p.id));
    if (!loaded || !Number.isInteger(count) || count < 1 || count > Math.min(200, included.length)) {
      feedback('Kazanan sayısı 1 ile dahil edilen kişi sayısı arasında olmalı (en fazla 200).', true); return;
    }
    pending = { requestId: crypto.randomUUID(), eventId: eventSelect.value, count, excluded: [...excluded] };
  }
  busy = true; controls();
  $('raffleResults').innerHTML = '';
  const stage = $('raffleStage');
  stage.classList.remove('is-celebrating');
  stage.classList.add('is-drawing');
  feedback('Çekiliş yapılıyor…');
  const candidates = participants.filter(p => !pending.excluded.includes(p.id));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let index = 0;
  $('raffleStageName').textContent = reduced ? 'Şanslı isimler seçiliyor…' : candidates[0]?.name || 'Şanslı isimler seçiliyor…';
  const timer = reduced ? null : setInterval(() => {
    $('raffleStageName').textContent = candidates[(index++ * 7 + Math.floor(Math.random() * candidates.length)) % candidates.length]?.name || 'Seçiliyor…';
  }, 90);
  const pause = new Promise(resolve => setTimeout(resolve, 5000));
  try {
    // Save once on the server. Animation never determines the winners.
    const [result] = await Promise.all([request('POST', pending), pause]);
    if (timer) clearInterval(timer);
    $('raffleStageName').textContent = 'Kazananları tebrik ediyoruz!';
    $('raffleResults').innerHTML = winnerList(result.draw.winners);
    stage.classList.remove('is-drawing'); stage.classList.add('is-celebrating');
    draws = [result.draw, ...draws.filter(d => d.id !== result.draw.id)];
    pending = null; renderHistory();
    feedback(`${result.draw.winners.length} kazanan seçildi ve çekiliş geçmişine kaydedildi.`);
  } catch (error) {
    if (timer) clearInterval(timer);
    stage.classList.remove('is-drawing');
    $('raffleStageName').textContent = 'Sonuç gösterilemedi';
    if (error.status && error.status < 500) pending = null;
    feedback(error.message + (pending ? ' Sonuç kaydedilmiş olabilir. Aynı çekiliş sonucunu yeniden sorgulayın; yeni çekiliş oluşturulmaz.' : ''), true);
  } finally { busy = false; controls(); }
});
$('raffleHistory').addEventListener('click', async event => {
  const button = event.target.closest('[data-delete-draw]');
  if (!button || busy || pending || !confirm('Bu çekiliş ve kazanan kaydı silinsin mi? Daha sonra yeni bir çekiliş yapabilirsiniz.')) return;
  busy = true; controls();
  try {
    await request('DELETE', { eventId: eventSelect.value, id: button.dataset.deleteDraw });
    draws = draws.filter(d => d.id !== button.dataset.deleteDraw);
    $('raffleResults').innerHTML = ''; $('raffleStageName').textContent = 'Yeni çekilişe hazır';
    renderHistory(); feedback('Çekiliş silindi. Yeni bir çekiliş başlatabilirsiniz.');
  } catch (error) { feedback(error.message, true); }
  finally { busy = false; controls(); }
});
controls();
