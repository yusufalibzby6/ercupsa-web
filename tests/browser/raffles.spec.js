import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const events = [
  { id: 'one', title: 'Çekiliş gecesi', date: '2026-10-07', time: '18:00', images: [], published: true },
  { id: 'two', title: 'İkinci etkinlik', date: '2026-10-08', images: [], published: true },
];
const participants = [
  { id: 'a', name: 'Ada <img src=x onerror=alert(1)>', previous: 3, weight: 4, claimedAt: '2026-10-07T10:00:00Z' },
  { id: 'b', name: 'Bora Daş', previous: 0, weight: 1, claimedAt: '2026-10-07T11:00:00Z' },
  { id: 'c', name: 'Ceren Ergül', previous: 1, weight: 2, claimedAt: '2026-10-07T12:00:00Z' },
];
const poolVersion = '1'.repeat(64);
const pendingKey = 'ercupsa_raffle_pending_v1';

async function fixture(page, options = {}) {
  const state = {
    draws: structuredClone(options.draws || []), requests: [], lookups: [], deletes: [], gets: [],
    events: structuredClone(events), participants: structuredClone(options.participants || participants),
    poolVersion, postErrors: [...(options.postErrors || [])], lookupErrors: [...(options.lookupErrors || [])],
    deleteErrors: [...(options.deleteErrors || [])], holdPool: null,
  };
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/**', route => route.fulfill({ status: 501, json: { error: 'Unmocked API' } }));
  await page.route('**/api/events*', route => route.fulfill({ json: { events: state.events } }));
  await page.route('**/api/community*', route => route.fulfill({ json: { submissions: [], batches: [] } }));
  await page.route('**/api/ticket-design*', route => route.fulfill({ json: { design: null } }));
  await page.route('**/api/registrations*', route => route.fulfill({ json: { form: null, summaries: [] } }));
  await page.route('**/api/raffles*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (req.method() === 'GET') {
      const selected = url.searchParams.get('eventId'), action = url.searchParams.get('action');
      if (action === 'result') {
        state.lookups.push(url.searchParams.get('requestId'));
        const error = state.lookupErrors.shift();
        if (error) return route.fulfill({ status: error.status, json: { error: error.message || 'Sonuç sorgulanamadı.', ...(error.code ? { code: error.code } : {}) } });
        return route.fulfill({ json: { draw: state.draws.find(d => d.id === url.searchParams.get('requestId') && d.eventId === selected) || null } });
      }
      if (action === 'history') return route.fulfill({ json: { draws: state.draws.filter(d => d.eventId === selected) } });
      state.gets.push(selected);
      if (state.holdPool) await state.holdPool;
      return route.fulfill({ json: { event: state.events.find(e => e.id === selected), participants: selected === 'one' ? state.participants : [], poolVersion: state.poolVersion, draws: state.draws.filter(d => d.eventId === selected) } });
    }
    const input = req.postDataJSON();
    if (req.method() === 'DELETE') {
      state.deletes.push(input);
      const error = state.deleteErrors.shift();
      if (!error || error.commit) state.draws = state.draws.filter(d => d.id !== input.id);
      if (error) return route.fulfill({ status: error.status, json: { error: 'Silme işlemi tamamlanamadı.' } });
      return route.fulfill({ json: { ok: true } });
    }
    state.requests.push(input);
    let draw = state.draws.find(d => d.id === input.requestId);
    if (!draw && input.poolVersion !== state.poolVersion) return route.fulfill({ status: 409, json: { error: 'Katılımcı listesi değişti. Listeyi yenileyin.', code: 'RAFFLE_POOL_CHANGED' } });
    const error = state.postErrors.shift();
    if (!draw && (!error || error.commit)) {
      const included = state.participants.filter(p => !input.excluded.includes(p.id));
      draw = { id: input.requestId, eventId: input.eventId, poolVersion: input.poolVersion, eventTitle: 'Çekiliş gecesi', participants: included, winners: included.slice(0, input.count), createdAt: '2026-10-07T18:00:00Z' };
      state.draws.unshift(draw);
    }
    if (error) return route.fulfill({ status: error.status, json: { error: error.message || 'Bağlantı kesildi.', ...(error.code ? { code: error.code } : {}) } });
    return route.fulfill({ json: { draw } });
  });
  let releaseBundle;
  if (options.delayBundle) {
    const gate = new Promise(resolve => { releaseBundle = resolve; });
    await page.route('**/assets/admin-community.bundle.js*', async route => { await gate; await route.continue(); });
  }
  await page.goto('/admin.html', { waitUntil: options.delayBundle ? 'commit' : 'load' });
  if (options.delayBundle) {
    await expect(page.locator('#app')).toBeVisible();
    state.releaseBundle = releaseBundle;
    return state;
  }
  await page.locator('[data-tab=raffles]').click();
  await expect(page.locator('#raffleParticipants input')).toHaveCount(state.participants.length);
  return state;
}

test('draw excludes people, reveals unique winners after five seconds and saves/deletes/repeats', async ({ page }) => {
  const state = await fixture(page);
  await expect(page.locator('#raffleSummary')).toContainText('3 kişi dahil · 7 toplam hak');
  await expect(page.locator('#raffleParticipants img')).toHaveCount(0);
  await page.locator('[data-person=b]').uncheck();
  await page.locator('#raffleCount').fill('2');
  await expect(page.locator('#raffleSummary')).toContainText('2 kişi dahil · 6 toplam hak');
  await page.locator('#raffleStart').click();
  await expect(page.locator('#raffleEvent')).toBeDisabled();
  await expect(page.locator('#raffleStage')).toHaveClass(/is-drawing/);
  await page.waitForTimeout(1000);
  await expect(page.locator('#raffleResults li')).toHaveCount(0);
  await expect(page.locator('#raffleResults li')).toHaveCount(2, { timeout: 6500 });
  await expect(page.locator('#raffleResults')).not.toContainText('Bora');
  await expect(page.locator('#raffleHistory article')).toHaveCount(1);
  expect(state.requests[0].excluded).toEqual(['b']);
  expect(state.requests[0].poolVersion).toBe(poolVersion);
  page.on('dialog', dialog => dialog.accept());
  await page.locator('[data-delete-draw]').click();
  await expect(page.locator('#raffleHistory article')).toHaveCount(0);
  await page.locator('#raffleStart').click();
  await expect(page.locator('#raffleResults li')).toHaveCount(2, { timeout: 6500 });
  expect(state.requests[1].requestId).not.toEqual(state.requests[0].requestId);
  expect(state.deletes).toHaveLength(1);
});

test('uncertain save queries the same result and reduced-motion avoids rotating names', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = await fixture(page, { postErrors: [{ status: 503, commit: true }] });
  await page.locator('#raffleStart').click();
  await expect(page.locator('#raffleStatus')).toContainText('Sonuç kaydedilmiş olabilir');
  await expect(page.locator('#raffleEvent')).toBeDisabled();
  await expect(page.locator('#raffleStart')).toHaveText('Aynı çekiliş sonucunu yeniden sorgula');
  await page.locator('#raffleStart').click();
  await expect(page.locator('#raffleStageName')).toHaveText('Şanslı isimler seçiliyor…');
  await expect(page.locator('#raffleResults li')).toHaveCount(1, { timeout: 6500 });
  expect(state.lookups).toEqual([state.requests[0].requestId]);
  expect(state.requests).toHaveLength(1);
  expect(state.draws).toHaveLength(1);
  await expect(page.locator('#raffleEvent')).toBeEnabled();
});

test('401, 429 and retryable 409 preserve the uncertain request instead of rerolling', async ({ page }) => {
  const state = await fixture(page, { postErrors: [
    { status: 401 }, { status: 429 }, { status: 409, code: 'RAFFLE_RETRY', message: 'Aynı isteği yeniden deneyin.' },
  ] });
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.locator('#raffleStart').click();
    await expect(page.locator('#raffleStart')).toHaveText('Aynı çekiliş sonucunu yeniden sorgula');
    await expect(page.locator('#raffleEvent')).toBeDisabled();
    expect(state.requests).toHaveLength(attempt + 1);
  }
  await page.locator('#raffleStart').click();
  await expect(page.locator('#raffleResults li')).toHaveCount(1, { timeout: 6500 });
  expect(state.requests).toHaveLength(4);
  for (const input of state.requests) expect(input).toEqual(state.requests[0]);
  expect(state.draws).toHaveLength(1);
});

test('reload restores uncertain identity and finds a saved result without another POST', async ({ page }) => {
  const state = await fixture(page, { postErrors: [{ status: 503, commit: true }] });
  await page.locator('[data-person=b]').uncheck();
  await page.locator('#raffleStart').click();
  await expect(page.locator('#raffleStart')).toHaveText('Aynı çekiliş sonucunu yeniden sorgula');
  const saved = await page.evaluate(key => sessionStorage.getItem(key), pendingKey);
  expect(saved).toContain(state.requests[0].requestId);
  for (const person of participants) expect(saved).not.toContain(person.name);
  await page.reload();
  await page.locator('[data-tab=raffles]').click();
  // A reload may resolve automatically or leave the explicit recovery button.
  if (await page.locator('#raffleStart').textContent() === 'Aynı çekiliş sonucunu yeniden sorgula') await page.locator('#raffleStart').click();
  await expect(page.locator('#raffleResults li')).toHaveCount(1, { timeout: 6500 });
  expect(state.requests).toHaveLength(1);
  expect(state.lookups).toContain(state.requests[0].requestId);
  expect(await page.evaluate(key => sessionStorage.getItem(key), pendingKey)).toBeNull();
  await page.locator('#raffleRefresh').click();
  await expect(page.locator('#raffleParticipants input')).toHaveCount(3);
  await expect(page.locator('[data-person=b]')).not.toBeChecked();
});

test('changed participant pool requires a refresh and keeps the explicit exclusions', async ({ page }) => {
  const state = await fixture(page);
  await page.locator('[data-person=b]').uncheck();
  await page.locator('#raffleCount').fill('2');
  state.poolVersion = '2'.repeat(64);
  state.participants.push({ id: 'd', name: 'Deniz', previous: 0, weight: 1 });
  await page.locator('#raffleStart').click();
  await expect(page.locator('#raffleStatus')).toContainText('Listeyi yenileyin');
  await expect(page.locator('#raffleStart')).toBeDisabled();
  expect(state.draws).toHaveLength(0);
  await page.locator('#raffleRefresh').click();
  await expect(page.locator('#raffleParticipants input')).toHaveCount(4);
  await expect(page.locator('[data-person=b]')).not.toBeChecked();
  await expect(page.locator('#raffleCount')).toHaveValue('2');
  await page.locator('#raffleStart').click();
  await expect(page.locator('#raffleResults li')).toHaveCount(2, { timeout: 6500 });
  expect(state.requests[1].poolVersion).toBe(state.poolVersion);
  expect(state.requests[1].requestId).not.toBe(state.requests[0].requestId);
  expect(state.requests[1].excluded).toEqual(['b']);
});

test('mobile search, no-match feedback, reinclusion and refresh preserve selection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.locator('#raffleSearch').fill('bora');
  await expect(page.locator('#raffleParticipants input')).toHaveCount(1);
  await page.locator('[data-person=b]').uncheck();
  await page.locator('#raffleSearch').fill('böylebirisimbulunmaz');
  await expect(page.locator('#raffleParticipants')).not.toContainText('biletini hesabına');
  await expect(page.locator('#raffleSummary')).toContainText('2 kişi dahil');
  await page.locator('#raffleIncludeAll').click();
  await page.locator('#raffleSearch').fill('bora');
  await expect(page.locator('[data-person=b]')).toBeChecked();
  await page.locator('[data-person=b]').uncheck();
  await page.locator('#raffleRefresh').click();
  await expect(page.locator('[data-person=b]')).not.toBeChecked();
  await page.locator('#raffleSearch').fill('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.locator('#raffleEvent').selectOption('two');
  await expect(page.locator('#raffleParticipants input')).toHaveCount(0);
  await expect(page.locator('#raffleStart')).toBeDisabled();
  await page.locator('#raffleEvent').selectOption('one');
  await expect(page.locator('#raffleParticipants input')).toHaveCount(3);
});

test('keyboard exclusions keep focus and participant scroll position', async ({ page }) => {
  const many = Array.from({ length: 40 }, (_, i) => ({ id: 'p' + i, name: 'Katılımcı ' + i, previous: 0, weight: 1 }));
  await fixture(page, { participants: many });
  const target = page.locator('[data-person=p25]');
  await target.focus();
  const before = await page.locator('#raffleParticipants').evaluate(el => el.scrollTop);
  expect(before).toBeGreaterThan(0);
  await page.keyboard.press('Space');
  await expect(target).not.toBeChecked();
  await expect(target).toBeFocused();
  const after = await page.locator('#raffleParticipants').evaluate(el => el.scrollTop);
  expect(Math.abs(after - before)).toBeLessThan(2);
  await page.keyboard.press('Space');
  await expect(target).toBeChecked();
});

test('empty event catalog invalidates an outstanding participant response', async ({ page }) => {
  const state = await fixture(page);
  let release;
  state.holdPool = new Promise(resolve => { release = resolve; });
  await page.locator('#raffleRefresh').click();
  await expect(page.locator('#raffleStart')).toBeDisabled();
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('events-loaded', { detail: [] })));
  await expect(page.locator('#raffleEvent option')).toHaveCount(0);
  release(); state.holdPool = null;
  await page.waitForTimeout(250);
  await expect(page.locator('#raffleParticipants input')).toHaveCount(0);
  await expect(page.locator('#raffleStart')).toBeDisabled();
});

test('failed deletion stays visible for retry and winner CSV protects spreadsheet formulas', async ({ page }) => {
  const person = { id: 'a', name: '=HYPERLINK("https://invalid.test")', previous: 0, weight: 1 };
  const draw = { id: 'fdb63636-409d-4f29-810f-d461962f5008', eventId: 'one', eventTitle: 'Çekiliş gecesi', createdAt: '2026-10-07T18:00:00Z', participants: [person], winners: [person] };
  const state = await fixture(page, { draws: [draw], deleteErrors: [{ status: 503 }] });
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-export-draw]').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('ERCUPSA-kazananlar-' + draw.id + '.csv');
  const csv = await readFile(await download.path(), 'utf8');
  expect(csv.startsWith('\uFEFF')).toBe(true);
  expect(csv).toContain("'=HYPERLINK");
  expect(csv).toContain('Çekiliş gecesi');
  page.on('dialog', dialog => dialog.accept());
  await page.locator('[data-delete-draw]').click();
  await expect(page.locator('#raffleStatus')).toContainText('Silme işlemi tamamlanamadı');
  await expect(page.locator('#raffleHistory article')).toHaveCount(1);
  await page.locator('[data-delete-draw]').click();
  await expect(page.locator('#raffleHistory article')).toHaveCount(0);
  expect(state.deletes).toHaveLength(2);
  expect(state.deletes[1]).toEqual(state.deletes[0]);
});

test('presentation opens a private stage with keyboard exit, drawing and winner reveal', async ({ page }) => {
  await fixture(page);
  await page.locator('#rafflePresentation').click();
  const overlay = page.locator('#rafflePresentationOverlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('Çekiliş gecesi');
  await expect(overlay.locator('#raffleParticipants')).toHaveCount(0);
  await expect(overlay.locator('[data-tab]')).toHaveCount(0);
  await expect(overlay.locator('#raffleStage')).toHaveCount(1);
  await page.locator('#raffleStart').click();
  await expect(page.locator('#raffleResults li')).toHaveCount(1, { timeout: 6500 });
  await page.keyboard.press('Escape');
  await expect(overlay).not.toBeVisible();
  await expect(page.locator('#rafflePresentation')).toBeFocused();
  await expect(page.locator('#rafflesTab #raffleStage')).toHaveCount(1);
  await expect(page.locator('#raffleHistory article')).toHaveCount(1);
});

test('late community bundle replays authentication and event catalog without reloading', async ({ page }) => {
  const state = await fixture(page, { delayBundle: true });
  state.releaseBundle();
  await page.locator('[data-tab=raffles]').click();
  await expect(page.locator('#raffleParticipants input')).toHaveCount(3);
  await expect(page.locator('#raffleStart')).toBeEnabled();
  await expect(page.locator('#ticketEvent option')).toHaveCount(2);
  await expect(page.locator('#registrationEvent option')).toHaveCount(2);
  expect(state.gets).toContain('one');
});
