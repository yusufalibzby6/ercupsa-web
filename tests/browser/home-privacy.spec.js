import { test, expect } from '@playwright/test';

const preferenceKey = 'ercupsa_privacy_preferences_v1';
const origin = process.env.ERCUPSA_HOME_TEST_URL || '';
const posts = ['One', 'Two', 'Three', 'Four'].map(id => `https://www.instagram.com/p/${id}/`);
const sdk = `window.instgrm = { Embeds: { process() {
  document.querySelectorAll('.instagram-media').forEach(quote => {
    if (!quote.querySelector('iframe')) {
      const frame = document.createElement('iframe'); frame.title = 'Instagram test paylaşımı'; frame.src = 'about:blank'; quote.append(frame);
    }
  });
} } };`;

async function fixture(page, { events = [], yearbooks = [], form = {} } = {}) {
  const state = { embeds: 0, formReads: 0 };
  await page.route('https://**/*', route => route.abort());
  await page.route('https://www.instagram.com/embed.js', route => {
    state.embeds++;
    return route.fulfill({ contentType: 'text/javascript', body: sdk });
  });
  await page.route('**/api/**', route => route.fulfill({ status: 501, json: { error: 'Unmocked privacy endpoint' } }));
  await page.route('**/api/events*', route => route.fulfill({ json: { events, verified: true } }));
  await page.route('**/api/site-content*', route => route.fulfill({ json: { instagram: { posts } } }));
  await page.route('**/api/yearbooks*', route => route.fulfill({ json: { yearbooks } }));
  await page.route('**/api/registrations*', route => {
    state.formReads++;
    return route.fulfill({ json: form });
  });
  return state;
}
async function expand(page) {
  await page.locator('#homeInstagramDisclosure > summary').click();
  await expect(page.locator('#homeInstagramDisclosure')).toHaveAttribute('open', '');
}

test('Instagram stays disconnected until consent; decline preserves four direct links and a later grant can be withdrawn', async ({ page }) => {
  const state = await fixture(page), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/`);
  await expect(page.locator('#homeInstagramDisclosure')).not.toHaveAttribute('open', '');
  await expect(page.locator('#homeInstagramCards .home-instagram-open')).toHaveCount(4);
  expect(state.embeds).toBe(0);
  await expect(page.locator('#homeInstagramCards iframe, #homeInstagramCards .instagram-media')).toHaveCount(0);
  await expand(page);
  await expect(page.locator('[data-privacy-allow]')).toBeVisible();
  for (let index = 0; index < posts.length; index++) await expect(page.locator('.home-instagram-open').nth(index)).toHaveAttribute('href', posts[index]);
  await page.locator('[data-privacy-deny]').click();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).instagram, preferenceKey)).toBe(false);
  await page.reload(); await expand(page);
  await expect(page.locator('[data-privacy-edit]')).toBeVisible();
  expect(state.embeds).toBe(0);
  await page.locator('[data-privacy-edit]').click();
  await page.locator('[data-privacy-allow]').click();
  await expect(page.locator('#homeInstagramCards iframe')).toHaveCount(4);
  expect(state.embeds).toBe(1);
  await page.locator('[data-privacy-edit]').click();
  const reloaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'İznimi geri al', exact: true }).click();
  await reloaded; await expand(page);
  await expect(page.locator('[data-privacy-state]')).toContainText('kapalı');
  await expect(page.locator('#homeInstagramCards iframe')).toHaveCount(0);
  expect(state.embeds).toBe(1);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).instagram, preferenceKey)).toBe(false);
  expect(errors).toEqual([]);
});

test('withdrawing on the preference page also unloads Instagram from an already open homepage', async ({ page, context }) => {
  const state = await fixture(page);
  await page.goto(`${origin}/`); await expand(page);
  await page.locator('[data-privacy-allow]').click();
  await expect(page.locator('#homeInstagramCards iframe')).toHaveCount(4);
  const preferences = await context.newPage();
  await preferences.goto(`${origin}/cerezler.html`);
  await preferences.locator('[data-privacy-edit]').click();
  const reloaded = page.waitForEvent('load');
  await preferences.getByRole('button', { name: 'İznimi geri al', exact: true }).click();
  await reloaded; await expand(page);
  await expect(page.locator('#homeInstagramCards iframe')).toHaveCount(0);
  await expect(page.locator('[data-privacy-state]')).toContainText('kapalı');
  expect(state.embeds).toBe(1);
});

test('blocked browser storage still allows an explicit page-local choice without blocking the homepage', async ({ page }) => {
  const state = await fixture(page);
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw Error('Storage blocked'); };
    Storage.prototype.setItem = () => { throw Error('Storage blocked'); };
  });
  await page.goto(`${origin}/`);
  await expect(page.locator('#welcomeModal')).toHaveCount(0);
  await expand(page);
  await page.locator('[data-privacy-allow]').click();
  await expect(page.locator('#homeInstagramCards iframe')).toHaveCount(4);
  await expect(page.locator('[data-privacy-storage]')).toBeVisible();
  expect(state.embeds).toBe(1);
});

test('a stored grant still requires opening the compact section; closing releases frames and reopening reuses the SDK', async ({ page }) => {
  const state = await fixture(page);
  await page.addInitScript(key => localStorage.setItem(key, JSON.stringify({ version: 1, instagram: true, savedAt: new Date().toISOString() })), preferenceKey);
  await page.goto(`${origin}/`);
  await expect(page.locator('#homeInstagramCards .home-instagram-open')).toHaveCount(4);
  await expect(page.locator('#homeInstagramCards iframe, #homeInstagramCards .instagram-media')).toHaveCount(0);
  expect(state.embeds).toBe(0);
  const height = await page.locator('#homeInstagramDisclosure').evaluate(element => element.getBoundingClientRect().height);
  expect(height).toBeLessThanOrEqual(100);
  await expand(page);
  await expect(page.locator('#homeInstagramCards iframe')).toHaveCount(4);
  expect(state.embeds).toBe(1);
  await page.locator('#homeInstagramDisclosure > summary').click();
  await expect(page.locator('#homeInstagramCards iframe, #homeInstagramCards .instagram-media')).toHaveCount(0);
  await expand(page);
  await expect(page.locator('#homeInstagramCards iframe')).toHaveCount(4);
  expect(state.embeds).toBe(1);
});

const event = { id: 'next', title: 'Bilim ve Dayanışma Buluşması', date: '2026-11-10', time: '18:00', category: 'Konferans', location: 'Erciyes Üniversitesi', registrationMode: 'native', registrationEnabled: true, images: [] };

test('homepage verifies native waitlist registration and announces only a published yearbook without restoring removed statistics', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-25T12:00:00Z') });
  const state = await fixture(page, {
    events: [{ ...event, id: 'draft', published: false, title: 'Gizli taslak' }, { ...event, id: 'past', date: '2026-09-01' }, event],
    form: { available: true, stage: 'waitlist' },
    yearbooks: [{ id: '2026-2027', title: 'ERCUPSA 2026–2027', description: 'Birlikte iz bıraktık.', publishedAt: '2026-10-24T12:00:00Z' }],
  });
  await page.goto(`${origin}/`);
  await expect(page.locator('#homeSpotlight')).toContainText(event.title);
  await expect(page.locator('#homeSpotlight .home-spotlight-action')).toContainText('Yedek kayıt');
  await expect(page.locator('#homeSpotlight .home-spotlight-action')).toHaveAttribute('href', 'form.html?event=next#registrationSection');
  await expect(page.locator('#home-events .home-event-card')).toHaveCount(0);
  await expect(page.locator('#homeUpcomingSection')).toBeHidden();
  expect(state.formReads).toBe(1);
  await expect(page.locator('#eventCounter, .counter-glow, #welcomeModal')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Aktif Üye');
  await expect(page.locator('#homeYearbookAnnouncement')).toBeVisible();
  await expect(page.locator('#homeYearbookLink')).toHaveAttribute('href', 'yillik.html?donem=2026-2027');
  await expect(page.locator('body')).not.toContainText('Gizli taslak');
  for (const width of [320, 360, 375, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`).toBe(true);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('.home-button').first().evaluate(element => getComputedStyle(element).transitionDuration.split(',').every(value => parseFloat(value) === 0))).toBe(true);
});

test('closed or unavailable native forms keep safe discovery links and unpublished yearbooks stay hidden', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-25T12:00:00Z') });
  await fixture(page, { events: [event], form: { available: false, stage: 'closed' }, yearbooks: [{ id: 'draft', title: 'Yayımlanmamış yıllık' }] });
  await page.goto(`${origin}/`);
  await expect(page.locator('#homeSpotlight .home-spotlight-action')).toContainText('Detayları gör');
  await expect(page.locator('#homeSpotlight .home-spotlight-action')).toHaveAttribute('href', '/etkinlik/next');
  await expect(page.locator('#homeYearbookAnnouncement')).toBeHidden();
  await expect(page.locator('#home-events')).not.toContainText('kaydet');
});
