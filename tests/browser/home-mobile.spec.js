import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// A device outside Türkiye must still see the event's Türkiye start time.
test.use({ timezoneId: 'America/Los_Angeles' });
const origin = process.env.ERCUPSA_HOME_TEST_URL || '';
const instant = '2026-10-25T12:00:00Z';
const image = 'https://res.cloudinary.com/demo/image/upload/mobile-home.jpg';
const photo = readFileSync(new URL('../../ercupsa.PNG', import.meta.url));
const event = (id, overrides = {}) => ({
  id, title: `Eczacılık Buluşması ${id}`, category: 'Konferans', date: '2026-10-26', time: '18:00',
  location: 'Erciyes Üniversitesi Eczacılık Fakültesi Kırmızı Salon', poster: image, published: true,
  registrationMode: 'native', registrationEnabled: true, images: [], ...overrides,
});
const posts = ['One', 'Two', 'Three', 'Four'].map(id => `https://www.instagram.com/p/${id}/`);

async function fixture(page, { events = [event('next')], forms = {}, failed = false, yearbooks = [], time = instant } = {}) {
  const state = { formReads: [], embeds: [], errors: [] };
  page.on('pageerror', error => state.errors.push(error.message));
  // Freeze the start before navigation; slow asset loading must not consume
  // real seconds and change the expected hour/minute boundary under test.
  await page.clock.install({ time: new Date(Date.parse(time) - 60000) });
  await page.clock.pauseAt(new Date(time));
  await page.route('https://**/*', route => {
    if (route.request().url().startsWith('https://res.cloudinary.com/')) return route.fulfill({ body: photo, contentType: 'image/png' });
    if (route.request().url().includes('instagram.com/embed.js')) state.embeds.push(route.request().url());
    return route.abort();
  });
  await page.route('**/api/**', route => route.fulfill({ status: 501, json: { error: 'Unmocked mobile-home endpoint' } }));
  await page.route('**/api/events*', route => route.fulfill(failed
    ? { status: 503, json: { error: 'Geçici bağlantı hatası' } }
    : { json: { events, verified: true } }));
  await page.route('**/api/site-content*', route => route.fulfill({ json: { instagram: { posts } } }));
  await page.route('**/api/yearbooks*', route => route.fulfill({ json: { yearbooks } }));
  await page.route('**/api/registrations*', async route => {
    const id = new URL(route.request().url()).searchParams.get('event_id');
    state.formReads.push(id);
    const form = forms[id] || { available: true, stage: 'main' };
    if (form.wait) await form.wait;
    const { wait, ...payload } = form;
    return route.fulfill(form.error ? { status: 503, json: { error: 'Kayıt durumu doğrulanamadı' } } : { json: payload });
  });
  await page.goto(`${origin}/`);
  return state;
}

test('a first mobile visit immediately exposes real content without a welcome gate, counters or repeated social promotion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Birlikte öğreniyor');
  await expect(page.locator('#homeSpotlight')).toContainText('Eczacılık Buluşması next');
  await expect(page.locator('#welcomeModal, #eventCounter, .counter-glow')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/Aktif Üye|Sosyal Medya Kanalı|Duyurularımızı kaçırma/);
  await expect(page.locator('#discoverEvents')).toBeVisible();
  const button = await page.locator('#discoverEvents').boundingBox();
  expect(button.y + button.height).toBeLessThan(844);
  expect(button.height).toBeGreaterThanOrEqual(44);
  for (const link of await page.locator('.home-social-links a').all()) { const target = await link.boundingBox(); expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44); }
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  await expect(page.locator('a[href^="https://www.instagram.com/ercupsa"]')).toHaveCount(1);
  await expect(page.locator('a[href*="chat.whatsapp.com/"]')).toHaveCount(1);
  await expect(page.locator('a[href*="linkedin.com/in/"]')).toHaveCount(1);
  expect(state.embeds).toEqual([]);
  expect(state.errors).toEqual([]);
});

for (const width of [320, 360, 375, 390, 430, 768, 1024, 1440]) test(`event-first homepage stays readable and within the viewport at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  const state = await fixture(page, { events: [
    event('next', { title: 'Eczacılıkta Bilim ve Sosyal Sorumluluk: Birlikte Öğrenmenin Uzun Başlıklı Buluşması' }),
    event('second', { date: '2026-10-27' }), event('third', { date: '2026-10-28' }), event('fourth', { date: '2026-10-29' }),
  ] });
  await expect(page.locator('#homeSpotlight')).toContainText('Eczacılıkta Bilim');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `horizontal overflow at ${width}`).toBe(true);
  const spot = await page.locator('#homeSpotlight').boundingBox();
  expect(spot.y).toBeLessThan(844 * 2);
  expect(spot.x).toBeGreaterThanOrEqual(0);
  expect(spot.x + spot.width).toBeLessThanOrEqual(width + 1);
  const countdown = await page.locator('#homeCountdown').boundingBox();
  expect(countdown.y + countdown.height).toBeLessThan(844 * 2);
  const primary = await page.locator('#discoverEvents').boundingBox();
  expect(primary.width).toBeGreaterThanOrEqual(44);
  expect(primary.height).toBeGreaterThanOrEqual(44);
  expect(await page.locator('h1').evaluate(element => getComputedStyle(element).fontSize).then(parseFloat)).toBeLessThanOrEqual(width < 768 ? 48 : 80);
  expect(await page.locator('#home-events .home-event-card').count()).toBeLessThanOrEqual(3);
  expect(state.errors).toEqual([]);
});

test('no upcoming event uses a short empty state instead of a large placeholder poster', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page, { events: [event('past', { date: '2026-10-24' }), event('draft', { published: false })] });
  await expect(page.locator('#homeSpotlight')).toContainText('Yeni etkinliklerimiz çok yakında');
  await expect(page.locator('#homeSpotlight img')).toHaveCount(0);
  expect((await page.locator('#homeSpotlight').boundingBox()).height).toBeLessThan(220);
  await expect(page.locator('#homeSpotlight a')).toHaveAttribute('href', 'galeri.html');
  await expect(page.locator('#homeRecentSection, #homeRecentEvents')).toHaveCount(0);
  await expect(page.locator('a[href^="form.html?event=past"]')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Eczacılık Buluşması draft');
});

test('homepage gallery is a compact manual photo strip that preserves existing album links and lazy images', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const galleryEvent = event('older-album', { date: '2026-10-24', images: Array.from({ length: 8 }, (_, index) => ({ url: image + '?photo=' + index, width: 1200, height: 900 })) });
  await fixture(page, { events: [event('next'), galleryEvent, ...['2026-10-23', '2026-10-22'].map((date, album) => event('album-' + album, { date, images: [0, 1].map(index => ({ url: image + '?album=' + album + '&photo=' + index, width: 1200, height: 900 })) }))] });
  const strip = page.locator('#home-photos');
  await expect(strip.locator('a').first()).toHaveAttribute('href', 'galeri.html#event-older-album');
  const original = await strip.locator('a').evaluateAll(links => links.map(link => link.href));
  await expect(strip.locator('img').first()).toHaveAttribute('loading', 'lazy');
  const dimensions = await strip.evaluate(element => ({ scroll: element.scrollWidth, width: element.clientWidth, height: element.getBoundingClientRect().height }));
  expect(dimensions.scroll).toBeGreaterThan(dimensions.width);
  expect(dimensions.height).toBeLessThan(250);
  await strip.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  expect(await strip.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await page.clock.fastForward(7000);
  expect(await strip.locator('a').evaluateAll(links => links.map(link => link.href))).toEqual(original);
  await expect(page.getByRole('link', { name: /^Tüm fotoğraflar/i })).toHaveAttribute('href', 'galeri.html');
});

test('mobile menu supports touch, Escape, outside dismissal and focus without moving the main content', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page);
  const button = page.locator('#siteMenuButton'), menu = page.locator('#siteMenu');
  const box = await button.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
  const originalTop = (await page.locator('h1').boundingBox()).y;
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.locator('a[href="etkinlikler.html"]')).toBeVisible();
  await expect(menu.locator('a[href="form.html"]')).toBeVisible();
  expect((await page.locator('h1').boundingBox()).y).toBe(originalTop);
  for (const link of await menu.locator('a').all()) {
    const target = await link.boundingBox();
    expect(target.height).toBeGreaterThanOrEqual(44);
  }
  await page.keyboard.press('Escape');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(button).toBeFocused();
  await button.click();
  await page.mouse.click(4, 700);
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  await page.setViewportSize({ width: 1024, height: 844 });
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.errors).toEqual([]);
});

const part = (page, key) => page.locator(`#homeCountdown [data-countdown-part="${key}"]`);
async function expectCountdown(page, expected) {
  for (const [key, value] of Object.entries(expected)) await expect.poll(async () => Number(await part(page, key).textContent())).toBe(value);
}

test('countdown uses the true Türkiye start in a foreign device timezone and updates seconds without layout shifts or per-second API calls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page);
  await expect(page.locator('#homeCountdown')).toBeVisible();
  await expectCountdown(page, { days: 1, hours: 3, minutes: 0, seconds: 0 });
  expect((await page.locator('#homeCountdown').boundingBox()).y).toBeLessThan(844 * 2);
  const before = await page.locator('#homeCountdown').boundingBox();
  const reads = state.formReads.length;
  await page.clock.fastForward(1000);
  await expectCountdown(page, { days: 1, hours: 2, minutes: 59, seconds: 59 });
  const after = await page.locator('#homeCountdown').boundingBox();
  expect(after.width).toBe(before.width); expect(after.height).toBe(before.height);
  await page.clock.fastForward(4000);
  await expectCountdown(page, { days: 1, hours: 2, minutes: 59, seconds: 55 });
  expect(state.formReads.length).toBe(reads);
  await expect(page.locator('#home-events #homeCountdown')).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test('countdown advances to the next actual upcoming event at the boundary and disappears when none remain', async ({ page }) => {
  const state = await fixture(page, { events: [
    event('second', { date: '2026-10-25', time: '15:02' }),
    event('first', { date: '2026-10-25', time: '15:01' }),
  ] });
  await expect(page.locator('#homeSpotlight')).toHaveAttribute('data-event-id', 'first');
  await expectCountdown(page, { days: 0, hours: 0, minutes: 1, seconds: 0 });
  await page.clock.fastForward(60000);
  await expect(page.locator('#homeSpotlight')).toHaveAttribute('data-event-id', 'second');
  await expectCountdown(page, { days: 0, hours: 0, minutes: 1, seconds: 0 });
  await page.clock.fastForward(60000);
  await expect(page.locator('#homeSpotlight')).toContainText('Yeni etkinliklerimiz çok yakında');
  await expect(page.locator('#homeCountdown')).not.toBeVisible();
  expect(state.errors).toEqual([]);
});

test('Türkiye midnight, rather than the device calendar day, determines upcoming events', async ({ page }) => {
  await fixture(page, { time: '2026-10-25T21:59:00Z', events: [event('midnight', { date: '2026-10-26', time: '01:00' })] });
  await expect(page.locator('#homeSpotlight')).toHaveAttribute('data-event-id', 'midnight');
  await expectCountdown(page, { days: 0, hours: 0, minutes: 1, seconds: 0 });
});

for (const time of ['', '25:99']) test(`a ${time ? 'malformed' : 'missing'} start time never produces an invented countdown`, async ({ page }) => {
  await fixture(page, { events: [event('unknown-time', { time })] });
  await expect(page.locator('#homeSpotlight')).toHaveAttribute('data-event-id', 'unknown-time');
  await expect(page.locator('#homeCountdown')).not.toBeVisible();
  await expect(page.locator('body')).not.toContainText(/NaN|Invalid Date/);
});

test('invalid calendar dates and unpublished events cannot become the featured countdown', async ({ page }) => {
  await fixture(page, { events: [
    event('invalid', { date: '2027-02-30' }), event('not-a-date', { date: 'broken' }),
    event('draft', { date: '2026-10-25', time: '15:01', published: false }), event('next'),
  ] });
  await expect(page.locator('#homeSpotlight')).toHaveAttribute('data-event-id', 'next');
  await expectCountdown(page, { days: 1, hours: 3, minutes: 0, seconds: 0 });
  await expect(page.locator('body')).not.toContainText('Eczacılık Buluşması invalid');
  await expect(page.locator('body')).not.toContainText('Eczacılık Buluşması draft');
});

for (const [label, form, action, hash] of [
  ['main', { available: true, stage: 'main' }, 'Kayıt ol', true],
  ['waitlist', { available: true, stage: 'waitlist' }, 'Yedek kayıt', true],
  ['closed', { available: false, stage: 'closed', full: true }, 'Detayları gör', false],
  ['unverified', { error: true }, 'Detayları gör', false],
]) test(`featured registration respects the existing ${label} form state`, async ({ page }) => {
  const state = await fixture(page, { forms: { next: form } });
  const link = page.locator('#homeSpotlight .home-spotlight-action');
  await expect(link).toContainText(action);
  await expect(link).toHaveAttribute('href', `form.html?event=next${hash ? '#registrationSection' : ''}`);
  if (hash) await expect(page.locator('#homeSpotlight .home-spotlight-detail')).toHaveAttribute('href', 'form.html?event=next');
  else await expect(page.locator('#homeSpotlight .home-spotlight-detail')).toHaveCount(0);
  expect(state.formReads).toContain('next');
});

test('a disabled native form never silently falls back to its legacy Google Forms link', async ({ page }) => {
  const state = await fixture(page, { events: [event('disabled', { registrationEnabled: false, registrationUrl: 'https://docs.google.com/forms/legacy' })] });
  await expect(page.locator('#homeSpotlight .home-spotlight-action')).toHaveAttribute('href', 'form.html?event=disabled');
  expect(state.formReads).not.toContain('disabled');
  await expect(page.locator('#homeSpotlight a[href*="docs.google.com"]')).toHaveCount(0);
});

test('untrusted event labels stay text and unsafe media URLs are never injected into homepage cards', async ({ page }) => {
  const title = 'Bilim <img src=x onerror="window.injected=true">';
  const state = await fixture(page, { events: [event('safe-id', { title, poster: 'javascript:alert(1)', location: '<script>window.injected=true</script>', images: [{ url: 'javascript:alert(1)' }] })] });
  await expect(page.locator('#homeSpotlight')).toContainText(title);
  await expect(page.locator('#homeSpotlight img[src="x"], #homeSpotlight script')).toHaveCount(0);
  await expect(page.locator('img[src^="javascript:"], a[href^="javascript:"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  expect(state.errors).toEqual([]);
});

test('long published yearbook text and event metadata wrap instead of overflowing or being clipped', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page, { events: [event('next'), event('second', { date: '2026-10-27', category: 'K'.repeat(80), location: 'L'.repeat(200) })],
    yearbooks: [{ id: '2026-2027', title: 'Y'.repeat(180), description: 'D'.repeat(140), publishedAt: '2026-10-24T12:00:00Z' }] });
  await expect(page.locator('#homeYearbookAnnouncement')).toBeVisible();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`).toBe(true);
    for (const selector of ['#homeYearbookTitle', '#homeYearbookDescription', '.home-event-category', '.home-event-facts']) {
      const overflow = await page.locator(selector).first().evaluate(element => {
        const range = document.createRange(); range.selectNodeContents(element);
        const parent = element.closest('.home-yearbook, .home-event-copy').getBoundingClientRect();
        return [...range.getClientRects()].some(rect => rect.left < parent.left - 1 || rect.right > parent.right + 1);
      });
      expect(overflow, `${selector} text outside card at ${width}`).toBe(false);
    }
  }
});

test('a delayed registration status preserves keyboard focus and countdown rollover leaves gallery links intact', async ({ page }) => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  await fixture(page, { events: [event('next', { date: '2026-10-25', time: '15:01', images: [{ url: image }] }), event('second', { date: '2026-10-25', time: '15:02' })],
    forms: { next: { available: true, stage: 'main', wait } } });
  const action = page.locator('#homeSpotlight .home-spotlight-action');
  await expect(action).toHaveAttribute('data-registration-state', 'checking');
  await action.focus();
  await page.locator('#home-photos .home-photo-card').evaluateAll(links => links.forEach(link => { link.dataset.identity = 'preserved'; }));
  release();
  await expect(action).toHaveAttribute('data-registration-state', 'open');
  await expect(action).toBeFocused();
  await page.clock.fastForward(60000);
  await expect(page.locator('#homeSpotlight')).toHaveAttribute('data-event-id', 'second');
  await expect(page.locator('#home-photos .home-photo-card')).toHaveAttribute('data-identity', 'preserved');
});
