import { test, expect } from '@playwright/test';
import QRCode from 'qrcode';

const events = [
  { id: 'one', title: 'Etkinlik bir', date: '2026-10-07', time: '18:00', location: 'Salon A', images: [], published: true },
  { id: 'two', title: 'Etkinlik iki', date: '2026-10-08', time: '19:00', location: 'Salon B', images: [], published: true },
];
const code = 'ERC-' + 'A'.repeat(24);
const people = [
  { id: 'a', name: 'Ada <img src=x onerror=alert(1)>', ticketId: 'ticket-a', claimedAt: '2026-10-07T12:00:00Z', enteredAt: null },
  { id: 'b', name: 'Bora Daş', ticketId: 'ticket-b', claimedAt: '2026-10-07T13:00:00Z', enteredAt: null },
];
async function fixture(page, options = {}) {
  const state = { operator: options.loggedOut ? null : { id: 'staff-a', name: 'Görevli', role: options.admin ? 'admin' : 'staff', eventIds: ['one'] },
    participants: structuredClone(people), entries: [], scans: [], logouts: [], accounts: [], created: [], removed: [], gateGets: [],
    eventErrors: [...(options.eventErrors || [])], scanErrors: [...(options.scanErrors || [])], accountErrors: [...(options.accountErrors || [])], holdGate: null };
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/**', route => route.fulfill({ status: 501, json: { error: 'Unmocked API' } }));
  await page.route('**/api/events*', route => {
    const req = route.request(), action = new URL(req.url()).searchParams.get('action');
    if (action === 'logout') { state.logouts.push('admin'); return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ json: { events } });
  });
  await page.route('**/api/community*', route => route.fulfill({ json: { submissions: [], batches: [] } }));
  await page.route('**/api/ticket-design*', route => route.fulfill({ json: { design: null } }));
  await page.route('**/api/raffles*', route => route.fulfill({ json: { event: events[0], participants: [], poolVersion: '1'.repeat(64), draws: [] } }));
  await page.route('**/api/registrations*', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('action') === 'summary') return route.fulfill({ json: { events: [] } });
    return route.fulfill({ json: { form: null, event: events.find(event => event.id === url.searchParams.get('event_id')), entries: [], summary: { total: url.searchParams.get('event_id') === 'one' ? 7 : 3, byClass: [] }, page: 1, totalPages: 1 } });
  });
  await page.route('**/api/staff*', route => {
    const req = route.request(), url = new URL(req.url()), action = url.searchParams.get('action');
    if (action === 'session') return route.fulfill(state.operator ? { json: { operator: state.operator } } : { status: 401, json: { error: 'Görevli girişi gerekli.' } });
    if (action === 'login') {
      const input = req.postDataJSON();
      if (input.username !== 'gorevli' || input.password !== 'local-password') return route.fulfill({ status: 401, json: { error: 'Kullanıcı adı veya şifre geçersiz.' } });
      state.operator = { id: 'staff-a', name: 'Görevli', role: 'staff', eventIds: ['one'] };
      return route.fulfill({ json: { operator: state.operator } });
    }
    if (action === 'logout') { state.logouts.push('staff'); state.operator = null; return route.fulfill({ json: { ok: true } }); }
    if (action === 'accounts') {
      if (req.method() === 'GET') return route.fulfill({ json: { accounts: state.accounts, events } });
      const error = state.accountErrors.shift();
      if (error) return route.fulfill({ status: error, json: { error: 'Görevli işlemi tamamlanamadı.' } });
      if (req.method() === 'POST') {
        const input = req.postDataJSON(); state.created.push(input);
        const account = { id: 'new-staff', username: input.username, name: input.name, eventIds: input.eventIds, active: true };
        state.accounts.push(account); return route.fulfill({ status: 201, json: { account } });
      }
      state.removed.push(url.searchParams.get('id')); state.accounts = state.accounts.filter(account => account.id !== url.searchParams.get('id'));
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ status: 400, json: { error: 'Unexpected staff action' } });
  });
  await page.route('**/api/gate*', async route => {
    const req = route.request(), url = new URL(req.url()), action = url.searchParams.get('action');
    if (action === 'events') {
      const error = state.eventErrors.shift();
      if (error) return route.fulfill({ status: error, json: { error: 'Etkinlikler alınamadı.' } });
      return route.fulfill({ json: { events: state.operator?.role === 'admin' ? events : events.filter(event => state.operator?.eventIds.includes(event.id)) } });
    }
    if (req.method() === 'GET') {
      const eventId = url.searchParams.get('eventId'); state.gateGets.push(eventId);
      if (state.holdGate) await state.holdGate;
      const participants = eventId === 'one' ? state.participants : [], entries = eventId === 'one' ? state.entries : [];
      return route.fulfill({ json: { event: events.find(event => event.id === eventId), participants, entries, summary: { claimed: participants.length, entered: entries.length } } });
    }
    const input = req.postDataJSON(); state.scans.push({ action, ...input });
    const error = state.scanErrors.shift();
    if (error) return route.fulfill({ status: error.status, json: { error: error.message } });
    const person = state.participants.find(person => person.id === (input.userId || 'a'));
    const existing = state.entries.find(entry => entry.ticketId === person.ticketId);
    const entry = existing || { ticketId: person.ticketId, userId: person.id, name: person.name, enteredAt: '2026-10-07T18:00:00Z', method: action === 'manual' ? 'manual' : 'qr' };
    if (!existing) { state.entries.push(entry); person.enteredAt = entry.enteredAt; }
    return route.fulfill({ json: { status: existing ? 'already' : 'entered', entry, event: events[0] } });
  });
  return state;
}
async function scanner(page, options = {}) {
  const state = await fixture(page, options); await page.goto('/giris.html');
  if (!options.loggedOut && !options.eventErrors?.length) await expect(page.locator('#gateClaimed')).toHaveText('2');
  return state;
}

test('staff login is scoped and scan admits only once, with manual entry confirmation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await scanner(page, { loggedOut: true });
  await expect(page.locator('#gateLogin')).toBeVisible();
  await page.locator('#gateUsername').fill('gorevli'); await page.locator('#gatePassword').fill('wrong'); await page.locator('#gateLoginButton').click();
  await expect(page.locator('#gateLoginStatus')).toContainText('geçersiz');
  await page.locator('#gatePassword').fill('local-password'); await page.locator('#gateLoginButton').click();
  await expect(page.locator('#gateClaimed')).toHaveText('2');
  await expect(page.locator('#gateEvent option')).toHaveCount(1); await expect(page.locator('#gateAdminLink')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator('#gatePeople img')).toHaveCount(0);
  await page.locator('#gateCode').fill(code); await page.locator('#gateCodeSubmit').click();
  await expect(page.locator('#gateResultTitle')).toContainText('Giriş başarılı'); await expect(page.locator('#gateEntered')).toHaveText('1');
  await page.locator('#gateCode').fill(code); await page.locator('#gateCodeSubmit').click();
  await expect(page.locator('#gateResultTitle')).toContainText('daha önce kullanıldı'); expect(state.entries).toHaveLength(1);
  await page.locator('#gateSearch').fill('bora'); await page.locator('[data-manual=b]').click();
  await expect(page.locator('#gateManualDialog')).toBeVisible(); expect(state.scans).toHaveLength(2);
  await page.locator('#gateManualConfirm').click(); await expect(page.locator('#gateEntered')).toHaveText('2');
  expect(state.scans[2]).toMatchObject({ action: 'manual', eventId: 'one', userId: 'b' });
  await page.locator('#gateLogout').click(); await expect(page.locator('#gateLogin')).toBeVisible();
  await expect(page.locator('#gatePeople')).toBeEmpty(); await expect(page.locator('#gateResultDetail')).not.toContainText('Bora');
});

test('wrong event and uncertain response explain failure without falsely claiming success', async ({ page }) => {
  await scanner(page, { scanErrors: [{ status: 409, message: 'Bu bilet başka bir etkinliğe ait.' }, { status: 503, message: 'Bağlantı kesildi.' }] });
  await page.locator('#gateCode').fill(code); await page.locator('#gateCodeSubmit').click();
  await expect(page.locator('#gateResult')).toHaveAttribute('data-state', 'error'); await expect(page.locator('#gateResultDetail')).toContainText('başka bir etkinliğe');
  await page.locator('#gateCodeSubmit').click(); await expect(page.locator('#gateResult')).toHaveAttribute('data-state', 'uncertain');
  await expect(page.locator('#gateResultDetail')).toContainText('aynı bileti yeniden okutun'); await expect(page.locator('#gateEntered')).toHaveText('0');
});

test('valid session with failed event fetch keeps a visible retry and admin logout clears both sessions', async ({ page }) => {
  const state = await scanner(page, { admin: true, eventErrors: [503] });
  await expect(page.locator('#gateBootStatus')).toBeVisible(); await expect(page.locator('#gateBootStatus')).toContainText('Etkinlikler alınamadı');
  await page.locator('#gateSessionRetry').click(); await expect(page.locator('#gateClaimed')).toHaveText('2');
  await expect(page.locator('#gateEvent option')).toHaveCount(2);
  await page.locator('#gateLogout').click(); await expect(page.locator('#gateLogin')).toBeVisible();
  expect(state.logouts).toEqual(['admin', 'staff']); await page.reload(); await expect(page.locator('#gateLogin')).toBeVisible();
});

test('camera denial keeps code entry available', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => { throw new DOMException('denied', 'NotAllowedError'); } } }));
  await scanner(page); await page.locator('#gateCameraStart').click();
  await expect(page.locator('#gateCameraStatus')).toContainText('Kamera izni verilmedi');
  await expect(page.locator('#gateCamera')).toBeHidden(); await expect(page.locator('#gateCodeSubmit')).toBeEnabled();
});

test('catalog failure after successful staff login keeps a visible retry', async ({ page }) => {
  await scanner(page, { loggedOut: true, eventErrors: [503] });
  await page.locator('#gateUsername').fill('gorevli'); await page.locator('#gatePassword').fill('local-password'); await page.locator('#gateLoginButton').click();
  await expect(page.locator('#gateBootStatus')).toBeVisible(); await expect(page.locator('#gateBootStatus')).toContainText('Etkinlikler alınamadı');
  await page.locator('#gateSessionRetry').click(); await expect(page.locator('#gateClaimed')).toHaveText('2');
  await expect(page.locator('#gateBootStatus')).toBeHidden();
});

test('jsQR fallback reads camera frames and stops the stream once a result is found', async ({ page }) => {
  const image = await QRCode.toDataURL(code, { width: 280, margin: 4 });
  await page.addInitScript(({ image }) => {
    globalThis.BarcodeDetector = undefined; delete globalThis.BarcodeDetector;
    const qr = new Image(); qr.src = image;
    const originalDraw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function(source, ...rest) { return originalDraw.call(this, source instanceof HTMLVideoElement ? qr : source, ...rest); };
    HTMLMediaElement.prototype.play = async () => {};
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { get: () => 2 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { get: () => 280 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { get: () => 280 });
    globalThis.cameraStops = 0;
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => {
      await qr.decode(); const canvas = document.createElement('canvas'); const captured = canvas.captureStream(1);
      for (const track of captured.getTracks()) { const stop = track.stop.bind(track); track.stop = () => { globalThis.cameraStops++; stop(); }; }
      return captured;
    } } });
  }, { image });
  const state = await scanner(page); await page.locator('#gateCameraStart').click();
  await expect(page.locator('#gateResultTitle')).toContainText('Giriş başarılı');
  expect(state.scans[0]).toMatchObject({ action: 'scan', code });
  await expect(page.locator('#gateCamera')).toBeHidden(); expect(await page.evaluate(() => globalThis.cameraStops)).toBe(1);
});

test('camera stop and event switching release every camera track', async ({ page }) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = async () => {}; globalThis.cameraStops = 0;
    globalThis.BarcodeDetector = class { async detect() { return []; } };
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { get: () => 2 });
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => {
      const captured = document.createElement('canvas').captureStream(1);
      for (const track of captured.getTracks()) { const stop = track.stop.bind(track); track.stop = () => { globalThis.cameraStops++; stop(); }; }
      return captured;
    } } });
  });
  await scanner(page, { admin: true }); await page.locator('#gateCameraStart').click(); await expect(page.locator('#gateCamera')).toBeVisible();
  await page.locator('#gateCameraStop').click(); await expect(page.locator('#gateCamera')).toBeHidden(); expect(await page.evaluate(() => globalThis.cameraStops)).toBe(1);
  await page.locator('#gateCameraStart').click(); await expect(page.locator('#gateCamera')).toBeVisible();
  await page.locator('#gateEvent').selectOption('two'); await expect(page.locator('#gateCamera')).toBeHidden(); expect(await page.evaluate(() => globalThis.cameraStops)).toBe(2);
});

test('admin overview stays lazy, compares registration/claim/entry and scopes staff creation and revocation', async ({ page }) => {
  const state = await fixture(page, { admin: true });
  state.entries.push({ ticketId: 'paper-ticket', userId: null, name: 'Bilet sahibi', enteredAt: '2026-10-07T18:00:00Z', method: 'qr' });
  await page.goto('/admin.html'); await expect(page.locator('#app')).toBeVisible(); expect(state.gateGets).toHaveLength(0);
  await page.locator('[data-tab=attendance]').click(); await expect(page.locator('#attendanceRegistered')).toHaveText('7');
  await expect(page.locator('#attendanceClaimed')).toHaveText('2'); await expect(page.locator('#attendanceEntered')).toHaveText('1');
  await expect(page.locator('#attendancePeople img')).toHaveCount(0);
  await expect(page.locator('#attendanceScanner')).toHaveAttribute('href', 'giris.html?event=one');
  await page.locator('#attendanceFilter').selectOption('entered'); await expect(page.locator('#attendancePeople tr')).toHaveCount(1); await expect(page.locator('#attendancePeople')).toContainText('Hesabına eklememiş');
  await page.locator('#staffName').fill('Elif'); await page.locator('#staffUsername').fill('invalid/name');
  expect(await page.locator('#staffUsername').evaluate(input => input.checkValidity())).toBe(false);
  await page.locator('#staffUsername').fill('elif-gorevli');
  expect(await page.locator('#staffUsername').evaluate(input => input.checkValidity())).toBe(true);
  await page.locator('#staffPassword').fill('local-staff-password');
  await page.locator('#staffCreate').click(); await expect(page.locator('#staffStatus')).toContainText('en az bir etkinlik'); expect(state.created).toHaveLength(0);
  await page.locator('#staffEventScopes input[value=one]').check(); await page.locator('#staffCreate').click();
  await expect(page.locator('#staffStatus')).toContainText('hesabı oluşturuldu'); expect(state.created[0].eventIds).toEqual(['one']);
  await expect(page.locator('#staffPassword')).toHaveValue(''); await expect(page.locator('#staffAccounts')).toContainText('Elif'); await expect(page.locator('#staffAccounts')).not.toContainText('local-staff-password');
  await page.locator('[data-staff-delete]').click(); expect(state.removed).toHaveLength(0);
  await page.locator('[data-staff-confirm]').click(); await expect(page.locator('#staffStatus')).toContainText('hesabı kaldırıldı'); expect(state.removed).toEqual(['new-staff']);
  await page.locator('#attendanceEvent').selectOption('two'); await expect(page.locator('#attendanceRegistered')).toHaveText('3'); await expect(page.locator('#attendanceClaimed')).toHaveText('0'); await expect(page.locator('#attendanceEntered')).toHaveText('0');
});
