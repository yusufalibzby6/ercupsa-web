import jsQR from 'jsqr';
import { $, escape } from './common.js';

let operator = null, events = [], participants = [], selectedId = '', busy = false, listBusy = false;
let listVersion = 0, sessionVersion = 0, visibleLimit = 100, manualPerson = null;
let stream = null, cameraVersion = 0, frameTimer = null, cameraStarting = false, detector = null;
const video = $('gateVideo'), dialog = $('gateManualDialog');
const canvas = document.createElement('canvas'), context = canvas.getContext('2d', { willReadFrequently: true });
const dateTime = value => value ? new Date(value).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '';
async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error || 'İşlem tamamlanamadı.'); error.status = response.status; error.code = data.code; throw error; }
  return data;
}
function message(id, text, error = false) { $(id).textContent = text; $(id).dataset.error = String(error); }
function result(state, title, detail) { $('gateResult').dataset.state = state; $('gateResultTitle').textContent = title; $('gateResultDetail').textContent = detail; }
function controls() {
  const disabled = !operator || !selectedId || busy;
  $('gateEvent').disabled = busy;
  $('gateCodeSubmit').disabled = disabled;
  $('gateCameraStart').disabled = disabled || cameraStarting;
  $('gateRefresh').disabled = disabled || listBusy;
  $('gateLogout').disabled = busy;
  $('gateManualConfirm').disabled = busy;
  $('gateManualCancel').disabled = busy;
  for (const button of $('gatePeople').querySelectorAll('button')) button.disabled = disabled;
}
function stopCamera() {
  cameraVersion++; cameraStarting = false;
  clearTimeout(frameTimer); frameTimer = null;
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null; video.srcObject = null;
  $('gateCamera').hidden = true; $('gateCameraStop').hidden = true;
  $('gateCameraStart').textContent = 'Kamerayı aç'; controls();
}
function clearPrivate() {
  stopCamera(); ++listVersion; participants = []; events = []; selectedId = ''; manualPerson = null;
  if (dialog.open) dialog.close();
  $('gateEvent').replaceChildren(); $('gatePeople').replaceChildren(); $('gateSearch').value = ''; $('gateCode').value = '';
  $('gateClaimed').textContent = '—'; $('gateEntered').textContent = '—'; $('gateOperator').textContent = '';
  $('gateEventDetails').textContent = ''; $('gateListStatus').textContent = ''; $('gateSearchCount').textContent = '';
  result('idle', 'Bir bilet okutun', 'Önce giriş yapın ve etkinliği seçin.');
  $('gateApp').hidden = true; $('gateLogout').hidden = true; $('gateAdminLink').hidden = true; controls();
}
function expired() {
  operator = null; clearPrivate(); $('gateBootStatus').hidden = true; $('gateLogin').hidden = false;
  message('gateLoginStatus', 'Oturum sona erdi. Yeniden giriş yapın.', true);
}
async function boot() {
  const version = ++sessionVersion;
  $('gateBootStatus').hidden = false; message('gateBootStatus', 'Oturum kontrol ediliyor…'); $('gateSessionRetry').hidden = true;
  try {
    const data = await request('/api/staff?action=session');
    if (version !== sessionVersion) return;
    if (!data.operator || !['admin', 'staff'].includes(data.operator.role)) throw new Error('Oturum doğrulanamadı.');
    await enter(data.operator);
  } catch (error) {
    if (version !== sessionVersion) return;
    if (error.status === 401) { operator = null; clearPrivate(); $('gateBootStatus').hidden = true; $('gateLogin').hidden = false; }
    else { $('gateBootStatus').hidden = false; message('gateBootStatus', error.message, true); $('gateSessionRetry').hidden = false; controls(); }
  }
}
async function enter(value) {
  operator = value;
  clearPrivate();
  $('gateLogin').hidden = true; $('gateBootStatus').hidden = true; $('gateApp').hidden = false;
  $('gateLogout').hidden = false; $('gateAdminLink').hidden = value.role !== 'admin';
  $('gateOperator').textContent = `${value.name || 'Görevli'} · ${value.role === 'admin' ? 'Yönetici' : 'Etkinlik görevlisi'}`;
  const data = await request('/api/gate?action=events');
  if (!Array.isArray(data.events)) throw new Error('Etkinlik listesi doğrulanamadı.');
  events = data.events;
  $('gateEvent').replaceChildren(...events.map(event => new Option(`${event.title}${event.date ? ` · ${event.date}` : ''}`, event.id)));
  if (!events.length) { message('gateListStatus', 'Size atanmış bir etkinlik yok. Yöneticinizden etkinlik yetkisi isteyin.'); controls(); return; }
  const requested = new URLSearchParams(location.search).get('event');
  if (events.some(event => event.id === requested)) $('gateEvent').value = requested;
  changeEvent();
}
function changeEvent() {
  stopCamera(); selectedId = $('gateEvent').value; ++listVersion; listBusy = false; participants = []; visibleLimit = 100;
  manualPerson = null; if (dialog.open) dialog.close();
  $('gateSearch').value = ''; $('gateCode').value = ''; $('gateClaimed').textContent = '—'; $('gateEntered').textContent = '—';
  const event = events.find(item => item.id === selectedId);
  $('gateEventDetails').textContent = event ? [event.date, event.time, event.location].filter(Boolean).join(' · ') : '';
  result('idle', 'Bir bilet okutun', 'Bu etkinliğin bilet QR’sini okutun. Her bilete yalnızca bir giriş kaydedilir.');
  renderPeople(); controls(); loadPeople();
}
function renderPeople() {
  const query = $('gateSearch').value.trim().toLocaleLowerCase('tr');
  const matches = participants.filter(person => person.name.toLocaleLowerCase('tr').includes(query));
  $('gateSearchCount').textContent = participants.length ? `${matches.length} kişi gösteriliyor${matches.length > visibleLimit ? ` · ilk ${visibleLimit}` : ''}` : '';
  $('gatePeople').innerHTML = matches.slice(0, visibleLimit).map(person => `<article class="gate-person"><div><strong>${escape(person.name)}</strong><small class="${person.enteredAt ? 'gate-entered' : ''}">${person.enteredAt ? `Giriş yaptı · ${escape(dateTime(person.enteredAt))}` : 'Biletini ekledi · Henüz giriş yapmadı'}</small></div>${person.enteredAt ? '' : `<button type="button" data-manual="${escape(person.id)}">Elle giriş</button>`}</article>`).join('') || '<p class="gate-muted">Katılımcı bulunamadı.</p>';
  $('gateMore').hidden = matches.length <= visibleLimit; controls();
}
async function loadPeople({ quiet = false } = {}) {
  if (!operator || !selectedId || listBusy) return;
  const eventId = selectedId, version = ++listVersion;
  listBusy = true; controls(); if (!quiet) message('gateListStatus', 'Katılım bilgileri yükleniyor…');
  try {
    const data = await request(`/api/gate?${new URLSearchParams({ eventId })}`);
    if (version !== listVersion || eventId !== selectedId || !operator) return;
    if (!Array.isArray(data.participants) || !Number.isInteger(data.summary?.claimed) || !Number.isInteger(data.summary?.entered)) throw new Error('Katılım bilgileri doğrulanamadı.');
    participants = data.participants;
    $('gateClaimed').textContent = data.summary.claimed; $('gateEntered').textContent = data.summary.entered;
    message('gateListStatus', `Son güncelleme ${new Date().toLocaleTimeString('tr-TR')} · Açık ekranda 15 saniyede bir yenilenir.`); renderPeople();
  } catch (error) {
    if (version !== listVersion || eventId !== selectedId) return;
    if (error.status === 401) expired();
    else message('gateListStatus', `${error.message} ${participants.length ? 'Gösterilen liste güncel olmayabilir.' : 'Liste yüklenemedi.'}`, true);
  } finally { if (version === listVersion) { listBusy = false; controls(); } }
}
async function scan(code, userId = null) {
  if (busy || !operator || !selectedId) return;
  stopCamera(); busy = true; controls();
  const eventId = selectedId;
  result('idle', 'Bilet kontrol ediliyor…', 'Lütfen sonucu bekleyin.');
  try {
    const action = userId ? 'manual' : 'scan';
    const data = await request(`/api/gate?action=${action}`, { method: 'POST', body: JSON.stringify({ eventId, ...(userId ? { userId } : { code }) }) });
    if (eventId !== selectedId || !operator) return;
    if (!['entered', 'already'].includes(data.status) || !data.entry) throw new Error('Giriş sonucu doğrulanamadı. Aynı bileti yeniden kontrol edin.');
    const name = data.entry.name || 'Bilet sahibi';
    result(data.status, data.status === 'entered' ? 'Giriş başarılı ✓' : 'Bu bilet daha önce kullanıldı', `${name} · ${dateTime(data.entry.enteredAt)}${data.status === 'already' ? ' · İkinci giriş kaydedilmedi.' : ''}`);
    $('gateCode').value = '';
    $('gateCameraStart').textContent = 'Sonraki bileti okut';
    message('gateCameraStatus', 'Sonraki kişiyi okutmak için “Sonraki bileti okut” düğmesine basın.');
    if (dialog.open) dialog.close(); manualPerson = null;
    // Invalidate a pre-entry fetch so it cannot overwrite the refreshed counts.
    ++listVersion; listBusy = false; loadPeople({ quiet: true });
  } catch (error) {
    if (!operator || eventId !== selectedId) return;
    if (error.status === 401) expired();
    else if (!error.status || error.status >= 500 || error.status === 429) result('uncertain', 'Giriş sonucu doğrulanamadı', `${error.message} Giriş kaydedilmiş olabilir; aynı bileti yeniden okutun. Sistem ikinci giriş oluşturmaz.`);
    else result('error', 'Giriş yapılamadı', error.message);
    if (dialog.open) dialog.close(); manualPerson = null;
    $('gateCameraStart').textContent = 'Sonraki bileti okut';
  } finally { busy = false; controls(); }
}
async function startCamera() {
  if (busy || cameraStarting || !operator || !selectedId) return;
  stopCamera(); const version = ++cameraVersion;
  cameraStarting = true; controls(); message('gateCameraStatus', 'Kamera açılıyor…');
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Bu tarayıcıda kamera kullanılamıyor. HTTPS üzerinden açın veya bilet kodunu yazın.');
    const captured = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
    if (version !== cameraVersion || document.hidden || !operator) { captured.getTracks().forEach(track => track.stop()); return; }
    stream = captured; video.srcObject = stream;
    $('gateCamera').hidden = false; $('gateCameraStop').hidden = false;
    await video.play();
    if (version !== cameraVersion) return;
    detector = null;
    if ('BarcodeDetector' in globalThis) {
      try { detector = new globalThis.BarcodeDetector({ formats: ['qr_code'] }); } catch { /* jsQR supports browsers without QR BarcodeDetector. */ }
    }
    message('gateCameraStatus', 'QR kodunu çerçevenin içinde tutun. Sonuç çıktığında tarama durur.');
    tick(version);
  } catch (error) {
    if (version !== cameraVersion) return;
    stopCamera();
    message('gateCameraStatus', error.name === 'NotAllowedError' ? 'Kamera izni verilmedi. Tarayıcı ayarlarından izin verebilir veya bilet kodunu yazabilirsiniz.' : error.message || 'Kamera açılamadı. Bilet kodunu yazabilirsiniz.', true);
  } finally { if (version === cameraVersion) { cameraStarting = false; controls(); } }
}
async function tick(version) {
  if (version !== cameraVersion || !stream || document.hidden || busy) return;
  let code = '';
  if (video.readyState >= 2) {
    if (detector) {
      try { const detected = await detector.detect(video); code = detected.find(item => item.rawValue)?.rawValue || ''; }
      catch { detector = null; }
    }
    if (!detector && context && !code) {
      const scale = Math.min(1, 800 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      code = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'dontInvert' })?.data || '';
    }
  }
  if (version !== cameraVersion) return;
  if (code) { await scan(code); return; }
  frameTimer = setTimeout(() => tick(version), 180);
}
$('gateLoginForm').addEventListener('submit', async event => {
  event.preventDefault(); $('gateLoginButton').disabled = true;
  message('gateLoginStatus', 'Giriş yapılıyor…');
  try {
    const data = await request('/api/staff?action=login', { method: 'POST', body: JSON.stringify({ username: $('gateUsername').value.trim(), password: $('gatePassword').value }) });
    $('gatePassword').value = '';
    if (!data.operator) throw new Error('Oturum doğrulanamadı.');
    await enter(data.operator); message('gateLoginStatus', '');
  } catch (error) {
    if (error.status === 401 && operator) expired();
    else if (operator) { $('gateBootStatus').hidden = false; message('gateBootStatus', error.message, true); $('gateSessionRetry').hidden = false; controls(); }
    else message('gateLoginStatus', error.message, true);
  }
  finally { $('gateLoginButton').disabled = false; }
});
$('gateLogout').addEventListener('click', async () => {
  stopCamera(); $('gateLogout').disabled = true;
  try {
    if (operator?.role === 'admin') await request('/api/events?action=logout', { method: 'POST' });
    await request('/api/staff?action=logout', { method: 'POST' });
    ++sessionVersion; operator = null; clearPrivate(); $('gateBootStatus').hidden = true; $('gateSessionRetry').hidden = true; $('gateLogin').hidden = false; message('gateLoginStatus', 'Çıkış yapıldı.');
  }
  catch (error) { result('error', 'Çıkış yapılamadı', error.message); }
  finally { controls(); }
});
$('gateSessionRetry').addEventListener('click', boot);
$('gateEvent').addEventListener('change', changeEvent);
$('gateCodeForm').addEventListener('submit', event => { event.preventDefault(); const code = $('gateCode').value.trim(); if (code) scan(code); });
$('gateCameraStart').addEventListener('click', startCamera);
$('gateCameraStop').addEventListener('click', () => { stopCamera(); message('gateCameraStatus', 'Kamera kapatıldı.'); });
$('gateRefresh').addEventListener('click', () => loadPeople());
$('gateSearch').addEventListener('input', () => { visibleLimit = 100; renderPeople(); });
$('gateMore').addEventListener('click', () => { visibleLimit += 100; renderPeople(); });
$('gatePeople').addEventListener('click', event => {
  const id = event.target.closest('[data-manual]')?.dataset.manual;
  if (!id || busy) return;
  manualPerson = participants.find(person => person.id === id && !person.enteredAt);
  if (!manualPerson) return;
  $('gateManualName').textContent = manualPerson.name; dialog.showModal();
});
$('gateManualCancel').addEventListener('click', () => { manualPerson = null; dialog.close(); });
$('gateManualConfirm').addEventListener('click', () => { if (manualPerson) scan('', manualPerson.id); });
dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); else manualPerson = null; });
document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); else if (operator) loadPeople({ quiet: true }); });
window.addEventListener('pagehide', stopCamera);
setInterval(() => { if (!document.hidden && operator && !busy) loadPeople({ quiet: true }); }, 15000);
controls(); boot();
