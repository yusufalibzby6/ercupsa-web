import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const photo = readFileSync(new URL('../../ercupsa.PNG', import.meta.url));
const date = new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10);
const events = [{ id: 'motion-event', title: 'Bilim buluşması', date, time: '18:00', location: 'Eczacılık Fakültesi', published: true, registrationMode: 'native', registrationEnabled: true,
  images: [{ url: 'https://res.cloudinary.com/test/image/upload/motion.jpg' }] }];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
  });
  await page.route('https://**/*', route => route.abort());
  await page.route('https://res.cloudinary.com/**', route => route.fulfill({ body: photo, contentType: 'image/png' }));
  await page.route('**/api/**', route => route.fulfill({ status: 501, json: { error: 'Unmocked motion endpoint' } }));
  await page.route('**/api/events*', route => route.fulfill({ json: { events } }));
  await page.route('**/api/site-content*', route => route.fulfill({ json: { instagram: { posts: [] } } }));
  await page.route('**/api/yearbooks*', route => route.fulfill({ json: { yearbooks: [] } }));
  await page.route('**/api/registrations*', route => route.fulfill({ json: { available: true, stage: 'main' } }));
});

test('motion can be paused, stays paused across pages, and leaves registration links immediately usable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-motion-mode', 'full');
  await expect(page.locator('.home-spotlight-action')).toHaveAttribute('href', 'form.html?event=motion-event#registrationSection');
  await page.getByRole('button', { name: 'Animasyonları duraklat', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-motion-mode', 'paused');
  expect(await page.locator('.home-pharmacy-art > img').evaluate(element => element.getAnimations().length)).toBe(0);
  await page.goto('/etkinlikler.html');
  await expect(page.locator('body')).toHaveAttribute('data-motion-mode', 'paused');
  await expect(page.locator('.event-card')).toBeVisible();
  await page.getByRole('button', { name: 'Animasyonları sürdür', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-motion-mode', 'full');
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.getByRole('button', { name: 'Menü', exact: true }).click();
  await expect(page.locator('#siteMenu a[aria-current=page]')).toHaveText('Etkinlikler');
  const targets = await page.locator('#siteMenu a, #siteMenu button').evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect(); return { width: box.width, height: box.height };
  }));
  expect(targets.every(target => target.width >= 44 && target.height >= 44)).toBe(true);
  // Netlify also serves the existing form page at /form without changing its URL.
  await page.route('**/form', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: readFileSync('form.html') }));
  await page.goto('/form');
  await expect(page.locator('.form-catalog-card')).toContainText('Bilim buluşması');
  await page.getByRole('button', { name: 'Menü', exact: true }).click();
  await page.getByRole('button', { name: 'Animasyonları duraklat', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-motion-mode', 'paused');
});

test('reduced-motion preference stops running effects immediately without hiding content or freezing the countdown', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#homeCountdown')).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('body')).toHaveAttribute('data-motion-mode', 'reduced');
  await expect(page.locator('.motion-toggle')).toBeHidden();
  await expect(page.locator('#homeTitle')).toBeVisible();
  expect(await page.locator('.home-pharmacy-art > img').evaluate(element => element.getAnimations().length)).toBe(0);
  const before = await page.locator('[data-countdown-part=seconds]').textContent();
  await expect.poll(() => page.locator('[data-countdown-part=seconds]').textContent()).not.toBe(before);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('body')).toHaveAttribute('data-motion-mode', 'full');
  await expect(page.locator('.motion-toggle')).toBeVisible();
});

test('Save-Data disables decorative animation and storage failures keep a usable fallback', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', { value: { saveData: true, addEventListener() {} } });
    Object.defineProperty(Storage.prototype, 'getItem', { value() { throw new Error('Storage blocked'); } });
    Object.defineProperty(Storage.prototype, 'setItem', { value() { throw new Error('Storage blocked'); } });
  });
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-motion-mode', 'reduced');
  await expect(page.locator('.motion-toggle')).toBeHidden();
  await expect(page.locator('#discoverEvents')).toBeVisible();
  await expect(page.locator('#homeCountdown')).toBeVisible();
  expect(errors).toEqual([]);
});

test('unsupported observers and disabled JavaScript never leave essential content hidden', async ({ page, browser }) => {
  await page.addInitScript(() => { window.IntersectionObserver = undefined; });
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-motion-mode', 'lite');
  await expect(page.locator('#homeTitle')).toBeVisible();
  await expect(page.locator('#discoverEvents')).toBeVisible();
  const context = await browser.newContext({ javaScriptEnabled: false });
  const staticPage = await context.newPage();
  await staticPage.goto(new URL('/hakkimizda.html', page.url()).href);
  await expect(staticPage.getByRole('heading', { name: 'Hakkımızda', exact: true })).toBeVisible();
  await expect(staticPage.locator('main .glass-panel').first()).toBeVisible();
  await context.close();
});

test('hero effects pause off screen and countdown digit changes do not move the card', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto('/');
  await expect(page.locator('#homeCountdown')).toBeVisible();
  const before = await page.locator('#homeCountdown').boundingBox();
  const seconds = await page.locator('[data-countdown-part=seconds]').textContent();
  await expect.poll(() => page.locator('[data-countdown-part=seconds]').textContent()).not.toBe(seconds);
  const after = await page.locator('#homeCountdown').boundingBox();
  expect(after.width).toBe(before.width);
  expect(after.height).toBe(before.height);
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.locator('.home-pharmacy-art')).toHaveAttribute('data-motion-visible', 'false');
  expect(await page.locator('.home-pharmacy-art > img').evaluate(element => getComputedStyle(element).animationPlayState)).toBe('paused');
  await expect(page.locator('#homeCountdown')).not.toBeInViewport();
  const offscreenSeconds = await page.locator('[data-countdown-part=seconds]').textContent();
  await expect.poll(() => page.locator('[data-countdown-part=seconds]').textContent()).not.toBe(offscreenSeconds);
  expect(await page.locator('[data-countdown-part=seconds]').evaluate(element => element.getAnimations().length)).toBe(0);
});
