import { test, expect } from '@playwright/test';

const event = { id: 'event-one', title: 'Yetki testi etkinliği', date: '2026-10-20', time: '18:00', images: [], published: true };
const account = { id: 'user-one', name: 'Ayşe Öğrenci', email: 'ayse@example.test', createdAt: '2026-10-13T12:00:00Z', hasProfile: true, publicName: true, publicNameBlocked: false };
const participant = { id: 'user-one', name: 'Ayşe Öğrenci', previous: 0, weight: 1, claimedAt: '2026-10-13T12:00:00Z' };
const draw = { id: 'draw-one', eventId: event.id, eventTitle: event.title, poolVersion: '1'.repeat(64), source: 'qr', loyaltyBonus: false,
  checkedInOnly: false, checkinBonus: false, participants: [participant], winners: [participant], createdAt: '2026-10-13T12:00:00Z' };
const posts = ['ONE', 'TWO', 'THREE', 'FOUR'].map(id => `https://www.instagram.com/p/${id}/`);

async function fixture(page, permissions = ['events.view', 'accounts.view', 'instagram.view', 'raffles.view', 'attendance.view']) {
  const state = { gets: [], mutations: [], errors: [] };
  page.on('pageerror', error => state.errors.push(error.message));
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/**', route => {
    const req = route.request(), url = new URL(req.url()), action = url.searchParams.get('action');
    if (req.method() !== 'GET') {
      state.mutations.push({ path: url.pathname, method: req.method(), action });
      return route.fulfill({ status: 403, json: { error: 'Bu işlem için yetkiniz yok.' } });
    }
    state.gets.push({ path: url.pathname, action });
    if (url.pathname === '/api/admin-auth') return route.fulfill({ json: { session: { id: 'delegate', username: 'other-admin', name: 'Diğer yönetici', role: 'admin', permissions } } });
    if (url.pathname === '/api/events') return route.fulfill({ json: { events: [event] } });
    if (url.pathname === '/api/accounts') return route.fulfill({ json: url.searchParams.has('userId')
      ? { account, attendance: [], claimTotal: 0, entryTotal: 0, checkinsAvailable: true }
      : { accounts: [account], page: 1, pages: 1, total: 1, pageSize: 50 } });
    if (url.pathname === '/api/site-content') return route.fulfill({ json: { instagram: { posts, revision: 'test-revision' } } });
    if (url.pathname === '/api/raffles') return route.fulfill({ json: { event, participants: [participant], draws: [draw], poolVersion: '1'.repeat(64), source: 'qr', checkedInOnly: false, checkinBonus: false } });
    if (url.pathname === '/api/gate') return route.fulfill({ json: { participants: [], entries: [], summary: { claimed: 0, entered: 0 } } });
    return route.fulfill({ status: 501, json: { error: 'Unexpected private API read' } });
  });
  await page.goto('/admin.html'); await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#eventsList')).toContainText(event.title);
  return state;
}

const reads = (state, path) => state.gets.filter(get => get.path === path);

test('readonly accounts can inspect email and history but cannot change public-name moderation', async ({ page }) => {
  const state = await fixture(page);
  expect(reads(state, '/api/accounts')).toEqual([]);
  await page.locator('[data-tab=accounts]').click();
  await expect(page.locator('#accountsList')).toContainText(account.email);
  await page.locator('[data-account-id=user-one]').click();
  await expect(page.locator('#accountDetail')).toBeVisible();
  await expect(page.locator('#accountVisibilityToggle')).toBeHidden();
  await page.evaluate(() => document.querySelector('#accountVisibilityToggle').dispatchEvent(new MouseEvent('click')));
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test('readonly Instagram displays all four posts and does not save synthetic edits', async ({ page }) => {
  const state = await fixture(page);
  expect(reads(state, '/api/site-content')).toEqual([]);
  await page.locator('[data-tab=instagram]').click();
  await expect(page.locator('#instagramPost1')).toHaveValue(posts[0]);
  await expect(page.locator('#instagramPost1')).toBeDisabled(); await expect(page.locator('#instagramSave')).toBeHidden();
  await expect(page.locator('#instagramPreviewCards a')).toHaveCount(4);
  await page.evaluate(() => {
    const input = document.querySelector('#instagramPost1'); input.value = 'https://www.instagram.com/p/CHANGED/'; input.dispatchEvent(new Event('input'));
    document.querySelector('#instagramForm').dispatchEvent(new Event('submit', { cancelable: true }));
  });
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test('readonly raffles show pools and history but cannot draw, exclude, delete or deliver prizes', async ({ page }) => {
  const state = await fixture(page);
  expect(reads(state, '/api/raffles')).toEqual([]);
  await page.locator('[data-tab=raffles]').click();
  await expect(page.locator('#raffleParticipants')).toContainText(participant.name);
  await expect(page.locator('#raffleStart')).toBeHidden(); await expect(page.locator('#raffleCount')).toBeDisabled();
  await expect(page.locator('#raffleParticipants input')).toBeDisabled();
  // This person already won in the fixture's earlier draw and starts excluded.
  await expect(page.locator('#raffleSummary')).toContainText('0 kişi dahil');
  await expect(page.locator('[data-delete-draw]')).toBeHidden(); await expect(page.locator('[data-prize-draw]')).toBeHidden();
  await expect(page.locator('[data-export-draw]')).toBeVisible();
  await page.evaluate(() => {
    for (const selector of ['#raffleStart', '[data-delete-draw]', '[data-prize-draw]']) document.querySelector(selector).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const option = document.querySelector('#raffleParticipants input'); option.checked = true; option.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(state.mutations).toEqual([]);
  await expect(page.locator('#raffleSummary')).toContainText('0 kişi dahil'); expect(state.errors).toEqual([]);
});

test('hidden panels never request other scopes, including forged tab events', async ({ page }) => {
  const state = await fixture(page, ['events.view']);
  for (const tab of ['accounts', 'raffles', 'instagram', 'attendance', 'statistics', 'audit', 'yearbooks']) await expect(page.locator(`[data-tab=${tab}]`)).toBeHidden();
  await page.evaluate(() => {
    for (const tab of ['accounts', 'raffles', 'instagram', 'attendance', 'statistics', 'audit', 'yearbooks']) document.dispatchEvent(new CustomEvent('admin-tab', { detail: tab }));
  });
  for (const path of ['/api/accounts', '/api/raffles', '/api/site-content', '/api/gate', '/api/staff', '/api/registrations', '/api/community', '/api/statistics', '/api/event-audit', '/api/yearbooks']) expect(reads(state, path)).toEqual([]);
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});
