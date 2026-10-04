import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const photo = name => ({ url: `https://res.cloudinary.com/test/image/upload/${name}.jpg` });
const albums = [
  { id: 'izmir', title: 'İzmir gezisi', category: 'Gezi', location: 'İzmir', date: '2026-09-20', images: [photo('izmir-one'), photo('izmir-two')] },
  { id: 'atolye', title: 'Bilim atölyesi', category: 'Atölye', location: 'Fakülte', date: '2026-10-01', images: [photo('atolye-one'), photo('atolye-two'), photo('atolye-three'), photo('atolye-four'), photo('atolye-five')] },
];

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', route => route.abort());
  await page.route('https://res.cloudinary.com/**', route => route.fulfill({
    contentType: 'image/png', body: readFileSync('assets/ticket-template-blank.png'),
  }));
  await page.route('**/api/events*', route => route.fulfill({ json: { events: albums } }));
});

test('album search combines with categories and shared album links reveal filtered albums', async ({ page }) => {
  await page.goto('/galeri.html');
  await expect(page.locator('#gallery-summary')).toHaveText('7fotoğraf · 2 etkinlik albümü');
  await expect(page.locator('.gallery-album h2')).toHaveText(['Bilim atölyesi', 'İzmir gezisi']);
  await page.getByRole('button', { name: 'Gezi', exact: true }).click();
  await expect(page.locator('.gallery-album h2')).toHaveText(['İzmir gezisi']);
  await expect(page.getByRole('button', { name: 'Gezi', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Gezi', exact: true })).toBeFocused();
  await page.getByRole('searchbox', { name: 'Etkinlik albümlerinde ara' }).fill('İZMİR');
  await expect(page.locator('#gallery-result-count')).toContainText('1 albüm · 2 fotoğraf');
  await page.getByRole('searchbox', { name: 'Etkinlik albümlerinde ara' }).fill('olmayan');
  await expect(page.locator('#gallery-status')).toContainText('Bu aramada albüm bulunamadı.');
  await page.getByRole('button', { name: 'Filtreleri temizle', exact: true }).click();
  await expect(page.locator('.gallery-album')).toHaveCount(2);
  await expect(page.locator('#gallery-search')).toBeFocused();
  await page.getByRole('button', { name: 'Gezi', exact: true }).click();
  await page.evaluate(() => { location.hash = 'event-atolye'; });
  await expect(page.locator('#event-atolye')).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Tümü', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#gallery-search')).toHaveValue('');
});

test('single-photo albums keep original image, protect focus, and escape unsafe content', async ({ page }) => {
  await page.route('**/api/events*', route => route.fulfill({ json: { events: [{
    id: 'single', title: '<img src=x onerror="window.galleryInjected=true">', category: '<script>bad</script>',
    date: '2026-10-01', images: [photo('safe-original'), { url: 'javascript:alert(1)' }, { url: '' }],
  }] } }));
  await page.goto('/galeri.html#event-single');
  await expect(page.locator('#event-single')).toBeInViewport();
  await expect(page.locator('#event-single h2')).toHaveText('<img src=x onerror="window.galleryInjected=true">');
  await expect(page.locator('#dynamic img[src=x]')).toHaveCount(0);
  await expect(page.locator('button[data-gallery-event]')).toHaveCount(1);
  const trigger = page.locator('button[data-gallery-event]');
  await trigger.click();
  await expect(page.locator('#lightimg')).toHaveAttribute('src', 'https://res.cloudinary.com/test/image/upload/safe-original.jpg');
  await expect(page.locator('#gallery-counter')).toHaveText('1 / 1');
  await expect(page.locator('#prev')).not.toBeVisible();
  await expect(page.locator('#next')).not.toBeVisible();
  expect(await page.locator('main').evaluate(element => element.inert)).toBe(true);
  await page.keyboard.press('Tab');
  await expect(page.locator('#close')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  expect(await page.locator('main').evaluate(element => element.inert)).toBe(false);
  expect(await page.evaluate(() => window.galleryInjected)).toBeUndefined();
});

test('mobile mosaics remain inside the viewport and failed thumbnails still open originals', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('https://res.cloudinary.com/**', route => {
    if (route.request().url().includes('c_limit')) return route.abort();
    return route.fulfill({ contentType: 'image/png', body: readFileSync('assets/ticket-template-blank.png') });
  });
  await page.goto('/galeri.html');
  const cover = page.locator('#event-atolye button[data-gallery-event]').first();
  await cover.scrollIntoViewIfNeeded();
  await expect(cover).toHaveAttribute('data-unavailable', '');
  await expect(cover).toContainText('Önizleme yüklenemedi.');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  const coverBounds = await cover.boundingBox();
  expect(coverBounds.width).toBeLessThanOrEqual(339);
  expect(coverBounds.height).toBeGreaterThan(250);
  await cover.click();
  await expect(page.locator('#lightimg')).toHaveAttribute('src', albums[1].images[0].url);
  await expect.poll(() => page.locator('#lightimg').evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true);
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#gallery-counter')).toHaveText('5 / 5');
  await page.keyboard.press('Escape');
  await expect(cover).toBeFocused();
});
